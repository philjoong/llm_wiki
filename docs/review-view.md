# Review 화면

`ReviewView` (`src/components/review/review-view.tsx`)의 UI 상호작용을 정리한다. 백엔드 파이프라인(decomposition, file write, graph assignment, modification proposal, graph sync, entity-dict)의 상세 로직은 **[ingest-current-state.md](ingest-current-state.md)** 참고. 이 문서는 화면 자체의 탭 구성, 카드 종류별 액션, 상태 전이만 다룬다.

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

## 2. ReviewItem 3종 카드

`item.type`에 따라 카드 본문과 액션 버튼 구성이 달라진다.

| type | 발생 시점 | 아이콘/색상 | 본문 컴포넌트 |
|------|-----------|--------------|----------------|
| `suggestion` | graph assignment validation 실패, overflow 등 | Lightbulb / emerald | 없음 (description만) |
| `modification` | file write 중 `writeFileBlocks` 충돌 | GitMerge / orange | `ModificationDiff` |
| `entity_confirmation` | `checkEntityConflicts()` fuzzy 매치 | Users / teal | `EntityConfirmationView` |

공통 렌더링 요소:
- `item.title`, `item.description` (Markdown, `react-markdown` + `remark-gfm`)
- `item.affectedPages` — 영향받은 페이지 경로 목록
- `item.overflowEntries` — graph assignment relation-type overflow 상세 (그래프명, 새 타입, 기존 타입, 영향 페이지). 카드 액션에 `overflow:create:{sourceGraph}:{newGraph}:{types}` 형태의 "새 그래프 생성" 옵션이 함께 온다.

### 2-1. `suggestion` 카드

액션 버튼은 `item.options: ReviewOption[]`를 그대로 렌더링한다 (라벨/액션 문자열은 카드 생성 쪽에서 결정). `handleResolve()`의 범용 분기가 액션 문자열 접두사로 동작을 나눈다:

| 액션 접두사 | 동작 |
|---|---|
| `save:{base64}` | 인코딩된 내용을 `db/queries/{slug}-{date}.md`로 저장, `db/index.md`/`db/log.md` 갱신 |
| `open:{page}` | 해당 db 페이지를 읽어 에디터(wiki 화면)로 전환 |
| `delete:{path}` | 파일 삭제 후 파일 트리 갱신 |
| `overflow:create:{src}:{new}:{types}` | graph policy에 새 managed graph 추가 (`saveGraphPolicy`) |
| `__create_page__:...` 또는 기타(비-dismissal 텍스트) | `db/{queries,entities,concepts}/{slug}-{date}.md` 신규 생성 + index/log 갱신 |
| 그 외 (dismissal성 텍스트: skip/dismiss/ignore/approve/keep existing/no 등) | 파일 액션 없이 `resolveItem(id, action)`만 호출 |

### 2-2. `modification` 카드 — 2단계 결정 트리

`item.stage`가 버튼 구성을 결정한다 (`ModificationActions` 컴포넌트).

```text
stage: "primary"              stage: "rejection-handling"
  [Approve]                     [Discard]
  [Merge]                       [Pending]
  [Reject]  ──클릭──▶            [Counterexample]
```

- **Reject는 즉시 파일을 건드리지 않는다.** `transitionToRejectionHandling(id)`로 같은 카드의 `stage`만 `"rejection-handling"`으로 바꾸고, 버튼 세트를 교체한다. 카드는 여전히 미해결 상태로 남는다.
- 최종 파일 동작은 다음 5개 액션에서만 발생하며, 각각 `src/lib/modification-resolve.ts`의 함수를 호출한 뒤 `resolveItem()`으로 카드를 해결 처리한다:

| 액션 | 호출 함수 | 파일 동작 | Graph assignment 실행 |
|---|---|---|---|
| `modification:approve` | `approveModification` | draft → target 덮어쓰기 (sources merge), draft 삭제 | `pendingSections`가 있으면 `runGraphAssignmentForApprovedDoc()` 실행 후 graph sync |
| `modification:merge` | 없음 (UI 전용) | draft를 읽어 에디터로 전환 (`setSelectedFile`/`setFileContent`/`setActiveView("wiki")`). **카드는 resolve되지 않고 그대로 남는다** — 사용자가 수동 편집 후 같은 카드의 Approve를 다시 눌러야 한다 | 없음 (Approve 재클릭 시에만) |
| `modification:reject` | 없음 | 없음 — `stage`만 전환 | 없음 |
| `modification:discard` | `discardModification` | `rejection-log.jsonl`에 사유 append, draft 삭제 | 실행 안 함 |
| `modification:pending` | `pendingModification` | draft를 `pending/{slug}.md`로 이동 | 실행 안 함 |
| `modification:counterexample` | `counterexampleModification` | draft를 `counterexamples/{slug}.md`로 이동 | 실행 안 함 |

Approve/Discard/Pending/Counterexample 처리 후 공통으로 파일 트리를 새로고침한다 (`listDirectory` → `setFileTree` → `bumpDataVersion`).

`ModificationDiff` 컴포넌트는 카드 본문에 기존/신규 두 컬럼 diff(각 600자 truncate)와, frontmatter의 `graph` 필드가 다르면 "기존 → 신규" 그래프 변경 배지를 표시한다.

### 2-3. `entity_confirmation` 카드

`EntityConfirmationView`가 fuzzy 매치된 후보 엔티티 목록(canonicalName, alias, 매치 종류, 연결 문서/그래프 노드 개수)과 보류 중인 triple 예시(최대 3개)를 보여준다. 액션은 고정 3종:

| 액션 | 동작 |
|---|---|
| `entity:same:{targetId}` | `incomingName`을 대상 엔티티의 alias로 추가, 보류된 triple의 subject/object를 대상 엔티티 canonicalName으로 치환 후 `syncGraphToBackend()` |
| `entity:new` | 사전에 `incomingName`으로 신규 엔티티 생성 후 원본 이름 그대로 sync |
| `entity:ignore` | 사전 변경 없이 원본 이름 그대로 sync (`syncEntityDict()`가 신규 이름 자동 등록) |

세 액션 모두 처리 후 `resolveItem(id, action)`으로 카드를 해결 상태로 만든다. 실패 시 `resolveItem(id, "Failed: ...")`로 에러 메시지를 카드에 남긴다 (재시도 UI는 없음 — 새로 ingest가 발생해야 카드가 다시 생성됨).

---

## 3. 카드 중복 방지 (dedupe)

`useReviewStore.addItems()`가 배치 추가 시 다음 규칙을 적용한다 (`src/stores/review-store.ts`):

- `modification`, `entity_confirmation` 타입은 **항상 append** — 절대 병합하지 않는다. 각 proposal은 고유한 `incomingDraftPath`를 가지므로 병합하면 한쪽 draft 파일 참조를 잃는다.
- 그 외 타입(`suggestion`)은 `type::normalizeReviewTitle(title)` 키로 미해결 카드와 대조해 같은 키가 있으면 병합한다 (description은 최신 것으로 교체, `affectedPages`는 합집합). 같은 제안이 여러 파일에서 반복 발생하는 벌크 ingest 상황에서 카드 폭증을 막기 위함이다.

---

## 4. Pending 탭 (`PendingView`)

`pending/<slug>.md` 최상위 파일만 나열한다 — `pending/_proposals/`는 아직 미해결 modification draft이므로 제외한다 (`loadPendingItems()`, `src/lib/pending-resolve.ts`).

각 행은 `db/` 타겟 경로를 `pathToSlug()` 역산으로 복원해 함께 보여준다. 타겟이 이미 삭제되었으면 `targetExists: false`와 함께 카드에 "(target not found)"가 표시되고, naive 재구성 경로(`db/<slug의 _를 /로 치환>.md`)를 대신 보여준다.

| 버튼 | 함수 | 동작 |
|---|---|---|
| **Re-review** | `reReviewPending` | 파일을 `pending/_proposals/{timestamp}-rerev-{slug}.md`로 이동하고, reviews 탭에 새 `modification` 카드(`stage: "primary"`)를 추가한다. 이후 흐름은 2-2절과 동일 |
| **Promote to db/** | `promotePending` | pending 파일 내용을 target에 sources-merge하여 직접 쓰고, pending 파일 삭제. **graph assignment/graph sync는 실행하지 않는다** |
| **Discard** | `discardPending` | `rejection-log.jsonl`에 사유(`"discarded from pending-view"`) append 후 파일 삭제 |

각 액션 후 파일 트리 새로고침(`listDirectory` → `setFileTree` → `bumpDataVersion`) 및 목록 재조회(`refresh()`)가 이어진다. 액션 실패 시 `window.alert()`로 에러를 표시한다.

**Promote는 Approve와 달리 graph assignment를 실행하지 않는다** — pending 경로로 보낸 시점에 이미 `pendingSections` 컨텍스트를 잃었기 때문에, graph에 반영하려면 Re-review를 거쳐 Approve해야 한다.

---

## 5. 관련 코드 위치

| 역할 | 파일 |
|------|------|
| Review 화면 전체 (탭, 카드, handleResolve) | `src/components/review/review-view.tsx` |
| Pending 탭 화면 | `src/components/review/pending-view.tsx` |
| Review 상태 저장소 | `src/stores/review-store.ts` |
| Modification 액션 (Approve/Discard/Pending/Counterexample) | `src/lib/modification-resolve.ts` |
| Pending 액션 (Re-review/Promote/Discard) | `src/lib/pending-resolve.ts` |
| 백엔드 파이프라인 전체(decomposition/file write/graph assignment/modification proposal), entity-dict 연동 상세 | [ingest-current-state.md](ingest-current-state.md) |
