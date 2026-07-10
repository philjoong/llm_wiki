# UI 구조와 파이프라인 안내

앱의 화면 구조를 기준으로, 각 화면이 어떤 파이프라인에 연결되는지와 해당 파이프라인을 자세히 다루는 문서를 안내한다.

---

## 1. 최상위 구조

```text
App.tsx
  ├─ selectedBranch 없음 → ProjectBranchSelector   (서버/프로젝트 선택)
  └─ selectedBranch 있음 → AppLayout
        ├─ IconSidebar        (좌측 아이콘 네비게이션 + inject + sync 버튼)
        ├─ ContentArea        (activeView에 따라 화면 전환)
        ├─ ActivityPanel      (우하단 플로팅, 진행 중 작업 표시)
        └─ PreviewPanel       (파일 미리보기 다이얼로그)
```

`activeView` 상태는 [wiki-store.ts](../src/stores/wiki-store.ts)에서 관리하며, [content-area.tsx](../src/components/layout/content-area.tsx)가 다음 6개 화면 중 하나로 스위칭한다: `wiki`(기본값), `graph`, `review`, `history`, `casemap`, `persona`. `settings`는 별도 오버레이 화면이다.

---

## 2. 서버(프로젝트) 선택 화면

- **파일**: [project-branch-selector.tsx](../src/components/project/project-branch-selector.tsx)
- **역할**: 원격 git 브랜치 목록 조회, 로컬 프로젝트 열기/생성, **프로젝트 import/export(.llmwiki zip)**
- **연결 파이프라인**: import/export 흐름 → **[import-export-status.md](import-export-status.md)** 참고

---

## 3. Wiki / Chat 화면 (기본 화면)

- **파일**: [chat-panel.tsx](../src/components/chat/chat-panel.tsx) (+ `chat-message.tsx`, `chat-input.tsx`, `chat-reference-panel.tsx`, `file-tree.tsx`)
- **역할**: 질문 입력 → 검색·그래프 확장·LLM 답변 스트리밍. 좌측에 프로젝트 파일 트리 표시.
- **연결 파이프라인**: 질의응답 전체 흐름(검색 → 그래프 확장 → Cypher 컨텍스트 → LLM 스트리밍) → **[answer-guide.md](answer-guide.md)** 참고

### Raw data injection (IconSidebar에서 트리거)

- **파일**: [icon-sidebar.tsx](../src/components/layout/icon-sidebar.tsx) — 파일/URL inject 버튼, data-type 선택 다이얼로그
- **연결 파이프라인**: ingest 큐 등록 → Stage 1~3 → 그래프 sync → **[ingest-current-state.md](ingest-current-state.md)** 참고
- 승인/거부 검토는 아래 4번 Review 화면에서 이어진다.

---

## 4. Review 화면

- **파일**: [review-view.tsx](../src/components/review/review-view.tsx) (탭: `reviews`, `pending` → [pending-view.tsx](../src/components/review/pending-view.tsx))
- **역할**:
  - `reviews` 탭: ingest 제안(suggestion), 문서 수정 제안(modification), 엔티티 확인(entity_confirmation) 카드를 승인/거부
  - `pending` 탭: `pending/*.md` 대기 문서를 재검토(re-review) / 승격(promote) / 폐기(discard)
- **연결 파이프라인**: [ingest.ts](../src/lib/ingest.ts)의 Stage 2/4 승인 처리, [entity-dict.ts](../src/lib/entity-dict.ts) 엔티티 확인 — **[ingest-current-state.md](ingest-current-state.md)** 참고
- **화면 UI 상호작용**: 카드 종류별 액션(suggestion/modification/entity_confirmation), modification 2단계 결정 트리, pending 탭 승격 흐름 → **[review-view.md](review-view.md)** 참고

---

## 5. Graph 화면

- **파일**: [graph-view.tsx](../src/components/graph/graph-view.tsx) (탭: `knowledge`, `files`, `graphs`, `entity`)
- **역할**:
  - `knowledge`: 그래프 시각화 캔버스([falkor-canvas.tsx](../src/components/graph/falkor-canvas.tsx)), 노드/엣지 탐색, hop 필터([graph-hop.ts](../src/lib/graph-hop.ts))
  - `files`: 그래프에 연결된 문서 파일 탐색, [wiki-editor.tsx](../src/components/editor/wiki-editor.tsx)로 편집
  - `graphs`: 그래프 정책([graph-policy.ts](../src/lib/graph-policy.ts)) 관리 ([graphs-tab.tsx](../src/components/layout/graphs-tab.tsx))
  - `entity`: 엔티티 사전 관리 ([entity-view.tsx](../src/components/entity/entity-view.tsx)) — canonical name/alias 편집, merge/split
- **연결 파이프라인**: [graph-backend](../src/lib/graph-backend/) → Rust `graph_sqlite.rs` 커맨드
- **미문서화**: Graph 화면 전체를 다루는 문서가 없다. 아래를 다루는 문서가 필요:
  - knowledge 탭의 시각화/hop 필터 동작
  - graphs 탭의 그래프 정책 편집이 ingest 파이프라인(Stage 2)에 미치는 영향
  - entity 탭의 사전 편집(rename/merge/split)이 [entity-develop.md](entity-develop.md) 계획과 실제 구현 간 어떻게 대응하는지 (entity-develop.md는 설계 문서라 "현재 상태" 스냅샷이 아님)

---

## 6. Persona 화면

- **파일**: [persona-view.tsx](../src/components/persona/persona-view.tsx) (탭: `manage`, `scenarios`, `ask` — `ask` 탭은 `ChatPanel`을 별도 store 인스턴스로 재사용)
- **역할**: 페르소나 정의 관리, 시나리오 생성([lib/persona/generate.ts](../src/lib/persona/generate.ts)), 시나리오 export([lib/persona/export.ts](../src/lib/persona/export.ts))
- **미문서화**: 이 화면과 생성/export 파이프라인을 다루는 문서가 없다. 다뤄야 할 내용:
  - 페르소나 데이터 구조와 저장 위치([lib/persona/storage.ts](../src/lib/persona/storage.ts))
  - 시나리오 생성 시 LLM 호출 흐름 (`generateScenarios`)과 사용하는 스키마([schema/data_types/persona.yaml](../schema/data_types/persona.yaml))
  - export 포맷과 용도

---

## 7. Casemap 화면

- **파일**: [casemap-view.tsx](../src/components/casemap/casemap-view.tsx) (7단계 생성 스텝, `ask` 탭에서 `ChatPanel` 재사용)
- **역할**: 테스트 축(axis)/조합(candidate) 생성 → 규칙 필터링([lib/casemap/rule-filter.ts](../src/lib/casemap/rule-filter.ts)) → 리스크 등급 → 테스트케이스 생성, export
- **미문서화**: 이 화면과 생성 파이프라인을 다루는 문서가 없다. 다뤄야 할 내용:
  - 7단계 생성 스텝(abstraction → axis recommendation → candidate generation → impossible filter → risk grading → case generation) 각각의 입출력과 LLM 호출 지점([lib/casemap/generate.ts](../src/lib/casemap/generate.ts))
  - 규칙(Rule) 정의와 필터링 로직
  - 테스트 플랜 저장 구조([lib/casemap/storage.ts](../src/lib/casemap/storage.ts))와 export 포맷([lib/casemap/export.ts](../src/lib/casemap/export.ts)), 사용 스키마([schema/data_types/casemap.yaml](../schema/data_types/casemap.yaml))

---

## 8. History 화면

- **파일**: [history-view.tsx](../src/components/history/history-view.tsx)
- **역할**: git 커밋 목록/상세 diff 조회, 파일 복원(restore), 커밋 되돌리기(revert)
- **연결 파이프라인**: [lib/git-history.ts](../src/lib/git-history.ts) → `commands/git.ts` → Rust `git_ops.rs`
- **관련 문서**: 커밋이 발생하는 시점(sync/init)은 **[git-sync-guide.md](git-sync-guide.md)**가 다루지만, History 화면에서의 조회/복원/revert UI 동작은 별도로 다루지 않는다.
- **미문서화**: History 화면의 restore/revert 동작 및 diff 조회 흐름. 필요 시 git-sync-guide.md에 "History 화면" 절을 추가하거나 별도 문서화.

---

## 9. Git Sync (다이얼로그, 전용 화면 없음)

- **트리거**: `IconSidebar`의 sync 버튼([app-layout.tsx](../src/components/layout/app-layout.tsx) `handleSync`), 종료 시 [sync-on-exit-dialog.tsx](../src/components/project/sync-on-exit-dialog.tsx), 충돌 시 [sync-conflict-dialog.tsx](../src/components/project/sync-conflict-dialog.tsx)
- **연결 파이프라인**: 그래프 스냅샷 export → git commit → pull --rebase → push → **[git-sync-guide.md](git-sync-guide.md)** 참고
- **미문서화**: rebase 충돌 발생 시 `sync-conflict-dialog.tsx`가 제공하는 해결 UX는 git-sync-guide.md에 없다. 필요 시 보강할 것.

---

## 10. Settings 화면

- **파일**: [settings-view.tsx](../src/components/settings/settings-view.tsx) (카테고리: llm, embedding, output, interface, question-types, data-types, about)
- **역할**: LLM/임베딩 provider 설정, 출력 언어, 인터페이스(언어/테마), question-types·data-types 스키마 관리, 앱 정보/업데이트 확인
- **미문서화**: 전담 문서 없음. 특히 question-types/data-types 섹션은 ingest 파이프라인(Stage 1 structured extraction)과 casemap/persona 화면이 사용하는 스키마 소스이므로, 설정 변경이 각 파이프라인에 미치는 영향을 정리한 문서가 필요.

---

## 11. 문서 매핑 요약

| 화면/기능 | 담당 문서 |
|---|---|
| Raw data injection (ingest) | [ingest-current-state.md](ingest-current-state.md) |
| 서버 선택 화면의 import/export | [import-export-status.md](import-export-status.md) |
| Wiki/Chat 질의응답 | [answer-guide.md](answer-guide.md) |
| Git sync | [git-sync-guide.md](git-sync-guide.md) |
| Graph 화면 (knowledge/files/graphs/entity) | 없음 — 작성 필요 |
| Review 화면 UI 상호작용 | [review-view.md](review-view.md) |
| Persona 화면/생성 파이프라인 | 없음 — 작성 필요 |
| Casemap 화면/생성 파이프라인 | 없음 — 작성 필요 |
| History 화면 (restore/revert) | 없음 — git-sync-guide.md 보강 또는 신규 작성 필요 |
| Settings 화면 | 없음 — 작성 필요 |
