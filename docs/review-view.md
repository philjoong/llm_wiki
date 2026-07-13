# Review 화면

`ReviewView` (`src/components/review/review-view.tsx`)의 UI 상호작용을 정리한다. 백엔드 파이프라인(decomposition, file write, Markdown v2 reconcile, graph assignment, 원자적 커밋)의 상세 로직은 **[ingest-current-state.md](ingest-current-state.md)** 참고. 이 문서는 화면 자체의 탭 구성, 카드 종류별 액션, 상태 전이만 다룬다.

**아키텍처 노트**: 이 문서는 한때 `entity_confirmation` 카드 타입(fuzzy 엔티티 매치 확인)을 서술했으나, 그 기능은 `mid-dev` 리팩터링에서 knowledge.sqlite 기반 아키텍처로 교체되며 완전히 제거됐다. 엔티티 이름 매칭은 이제 exact-match로 자동 처리되며 사용자 확인 단계가 없다 (자세한 내용은 [ingest-current-state.md](ingest-current-state.md) §7). 아래 내용은 현재 코드(`ReviewItem.type`이 `suggestion`/`modification` 2종) 기준으로 갱신됐다.

---

## 1. 화면 구성

```text
ReviewView
  ├─ 탭: "reviews" (기본) / "pending"
  ├─ reviews 탭
  │    ├─ 미해결 카드 목록 (ReviewCard, item.resolved === false)
  │    ├─ "— Resolved —" 구분선
  │    └─ 해결된 카드 목록 (opacity 처리, resolvedAction 텍스트 표시)
  └─ pending 탭 → PendingView (src/components/review/pending-view.tsx)
```

- 상태는 `useReviewStore` (`src/stores/review-store.ts`)가 전역으로 보관한다. `items: ReviewItem[]` 하나로 reviews 탭 전체를 구동한다.
- reviews 탭 헤더에 미해결 카드 개수 배지가 표시된다. 해결된 카드가 있으면 "Clear resolved" 버튼(`clearResolved()`)으로 일괄 제거 가능.
- 카드 우상단 X 버튼(`onDismiss` → `dismissItem(id)`)은 파일 액션 없이 카드를 목록에서 즉시 제거한다 — 승인/거부와 무관한 순수 UI 숨김이다.

---

## 2. ReviewItem 2종 카드

`item.type`에 따라 카드 본문과 액션 버튼 구성이 달라진다. `ReviewItem.type`은 `src/stores/review-store.ts` 기준 아래 2종뿐이다.

| type | 발생 시점 | 아이콘/색상 | 본문 컴포넌트 |
|------|-----------|--------------|----------------|
| `suggestion` | decomposition 실패, chunk 스킵(page_path 누락·빈 data-type 추출 포함) | Lightbulb / emerald | 없음 (description만) |
| `modification` | file write 중 `writeFileBlocks`의 `reconcileMarkdownV2` 섹션 단위 충돌 | GitMerge / orange | `ModificationDiff` |

공통 렌더링 요소:
- `item.title`, `item.description` (Markdown, `react-markdown` + `remark-gfm`)
- `item.affectedPages` — 영향받은 페이지 경로 목록

**주의**: graph assignment(`extractKnowledgeAssertionWrites()`)가 검증 실패(`VALIDATION_FAILED`)해도 review 카드는 생성되지 않는다 — `writeFileBlocks`가 이를 warnings/hardFailures로만 처리하고 activity panel에만 노출한다. 자세한 내용은 [ingest-current-state.md](ingest-current-state.md) §10 참고.

### 2-1. `suggestion` 카드

액션 버튼은 `item.options: ReviewOption[]`를 그대로 렌더링한다 (라벨/액션 문자열은 카드 생성 쪽에서 결정). `handleResolve()`의 범용 분기가 액션 문자열 접두사로 동작을 나눈다:

| 액션 접두사 | 동작 |
|---|---|
| `save:{base64}` | 인코딩된 내용을 `db/queries/{slug}-{date}.md`로 저장, `db/index.md`/`db/log.md` 갱신 |
| `open:{page}` | 해당 db 페이지를 읽어 에디터(wiki 화면)로 전환 |
| `delete:{path}` | 파일 삭제 후 파일 트리 갱신 |
| `__create_page__:...` 또는 기타(비-dismissal 텍스트) | `db/{queries,entities,concepts}/{slug}-{date}.md` 신규 생성 + index/log 갱신 |
| 그 외 (dismissal성 텍스트: skip/dismiss/ignore/approve/keep existing/no 등) | 파일 액션 없이 `resolveItem(id, action)`만 호출 |

### 2-2. `modification` 카드 — 2단계 결정 트리

`item.stage`가 버튼 구성을 결정한다 (`ModificationActions` 컴포넌트).

```text
stage: "primary"              stage: "rejection-handling"
  [Approve]                     [Discard]
  [Merge]                       [Pending]
  [Reject]  ──클릭──▶
```

- **Reject는 즉시 파일을 건드리지 않는다.** `transitionToRejectionHandling(id)`로 같은 카드의 `stage`만 `"rejection-handling"`으로 바꾸고, 버튼 세트를 교체한다. 카드는 여전히 미해결 상태로 남는다.
- 최종 파일 동작은 다음 5개 액션에서만 발생하며, 각각 `src/lib/modification-resolve.ts`의 함수를 호출한 뒤 `resolveItem()`으로 카드를 해결 처리한다:

| 액션 | 호출 함수 | 파일 동작 | Graph assignment 실행 |
|---|---|---|---|
| `modification:approve` | `approveModification` | proposal의 `pageId`/`sectionId`로 target을 Markdown v2 파싱, `spliceSectionById()`로 **그 섹션만** incoming 본문으로 교체(다른 섹션 보존), 직렬화해 파일에 직접 저장, draft 삭제 | 실행되지 않는다 — 이어서 호출되는 `reIngestDocument()`는 `commitMarkdownV2Page()`만 호출해 페이지/섹션 메타데이터만 knowledge.sqlite에 재커밋하고, assertion은 항상 빈 배열로 커밋된다. 승인된 섹션에서 새로 생긴 관계는 그래프에 반영되지 않는다 |
| `modification:merge` | 없음 (UI 전용) | draft를 읽어 에디터로 전환 (`setSelectedFile`/`setFileContent`/`setActiveView("wiki")`). **카드는 resolve되지 않고 그대로 남는다** — 사용자가 수동 편집 후 같은 카드의 Approve를 다시 눌러야 한다 | 없음 (Approve 재클릭 시에도 위와 동일하게 실행되지 않음) |
| `modification:reject` | 없음 | 없음 — `stage`만 전환 | 없음 |
| `modification:discard` | `discardModification` | `rejection-log.jsonl`에 사유 append, draft 삭제 | 실행 안 함 |
| `modification:pending` | `pendingModification` | draft를 `pending/{slug}.md`로 이동 | 실행 안 함 |

Approve/Discard/Pending 처리 후 공통으로 파일 트리를 새로고침한다 (`listDirectory` → `setFileTree` → `bumpDataVersion`).

`ModificationDiff` 컴포넌트는 카드 본문에 기존/신규 두 컬럼 diff(각 600자 truncate)를 표시한다.

자세한 배경(왜 Approve가 graph assignment를 재실행하지 않는지, `reIngestDocument()`의 현재 구현)은 [ingest-current-state.md](ingest-current-state.md) §8 참고.

### 2-3. `entity_confirmation` 카드 — 현재는 없음

이전에는 `EntityConfirmationView`가 fuzzy 매치된 후보 엔티티 목록을 보여주고 사용자가 확인하는 흐름이 있었으나, 현재 코드에는 존재하지 않는다.

엔티티 이름 매칭은 이제 정규화 문자열 완전일치로 자동 처리된다(`src-tauri/src/knowledge/commands.rs` — `resolve_or_create_ingest_entity`). 이름이 갈린 엔티티를 합치려면 Graph 화면의 `entity` 탭에서 수동으로 merge해야 한다. 자세한 내용은 [ingest-current-state.md](ingest-current-state.md) §7 참고.

---

## 3. 카드 중복 방지 (dedupe)

`useReviewStore.addItems()`가 배치 추가 시 다음 규칙을 적용한다 (`src/stores/review-store.ts`):

- `modification` 타입은 **항상 append** — 절대 병합하지 않는다. 각 proposal은 고유한 `incomingDraftPath`를 가지므로 병합하면 한쪽 draft 파일 참조를 잃는다.
- `suggestion` 타입은 `type::normalizeReviewTitle(title)` 키로 미해결 카드와 대조해 같은 키가 있으면 병합한다 (description은 최신 것으로 교체, `affectedPages`는 합집합). 같은 제안이 여러 파일에서 반복 발생하는 벌크 ingest 상황에서 카드 폭증을 막기 위함이다.

---

## 4. Pending 탭 (`PendingView`)

`pending/<slug>.md` 최상위 파일만 나열한다 — `pending/_proposals/`는 아직 미해결 modification draft이므로 제외한다 (`loadPendingItems()`, `src/lib/pending-resolve.ts`).

각 행은 `db/` 타겟 경로를 `pathToSlug()` 역산으로 복원해 함께 보여준다. 타겟이 이미 삭제되었으면 `targetExists: false`와 함께 카드에 "(target not found)"가 표시되고, naive 재구성 경로(`db/<slug의 _를 /로 치환>.md`)를 대신 보여준다.

| 버튼 | 함수 | 동작 |
|---|---|---|
| **Re-review** | `reReviewPending` | 파일을 `pending/_proposals/{timestamp}-rerev-{slug}.md`로 이동하고, reviews 탭에 새 `modification` 카드(`stage: "primary"`)를 추가한다. 이후 흐름은 2-2절과 동일 |
| **Promote to db/** | `promotePending` | pending 파일 내용을 target에 sources-merge한 뒤 `commitMarkdownV2Page()`로 페이지·섹션을 knowledge.sqlite에 재커밋(assertions는 없음), pending 파일 삭제 |
| **Discard** | `discardPending` | `rejection-log.jsonl`에 사유(`"discarded from pending-view"`) append 후 파일 삭제 |

각 액션 후 파일 트리 새로고침(`listDirectory` → `setFileTree` → `bumpDataVersion`) 및 목록 재조회(`refresh()`)가 이어진다. 액션 실패 시 `window.alert()`로 에러를 표시한다.

**Promote도 Approve와 마찬가지로 graph assertion을 생성하지 않는다** — `commitMarkdownV2Page()`는 항상 assertions를 빈 배열로 커밋한다(§2-2, [ingest-current-state.md](ingest-current-state.md) §8 참고). 이 내용에서 새로운 관계를 그래프에 반영하려면 Graph 화면에서 수동으로 assertion을 추가해야 한다.

---

## 5. 관련 코드 위치

| 역할 | 파일 |
|------|------|
| Review 화면 전체 (탭, 카드, handleResolve) | `src/components/review/review-view.tsx` |
| Pending 탭 화면 | `src/components/review/pending-view.tsx` |
| Review 상태 저장소 | `src/stores/review-store.ts` |
| Modification 액션 (Approve/Discard/Pending/Counterexample) | `src/lib/modification-resolve.ts` |
| Pending 액션 (Re-review/Promote/Discard) | `src/lib/pending-resolve.ts` |
| Markdown v2 파서·충돌 판정(sectionId 매칭) | `src/lib/markdown-v2/` — `parser.ts`, `reconcile.ts` |
| 백엔드 파이프라인 전체(decomposition/file write/graph assignment/원자적 커밋), 엔티티 매칭 상세 | [ingest-current-state.md](ingest-current-state.md) |
