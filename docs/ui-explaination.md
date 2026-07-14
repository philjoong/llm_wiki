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
        └─ PreviewPanel       (`editingFile` 설정 시 뜨는 편집 다이얼로그, wiki-editor.tsx/file-preview.tsx로 렌더링)
```

`activeView` 상태는 [wiki-store.ts](../src/stores/wiki-store.ts)에서 관리하며, [content-area.tsx](../src/components/layout/content-area.tsx)가 다음 6개 화면 중 하나로 스위칭한다: `wiki`(기본값), `graph`, `review`, `history`, `casemap`, `persona`. `settings`는 별도 오버레이 화면이다.

---

## 2. 서버(프로젝트) 선택 화면

- **파일**: [project-branch-selector.tsx](../src/components/project/project-branch-selector.tsx)
- **역할**: 원격 git 브랜치 목록 조회, 로컬 프로젝트 열기/생성, **프로젝트 import/export(.llmwiki zip)**
- **연결 파이프라인**: import/export 흐름 → **[import-export-status.md](import-export-status.md)** 참고

---

## 3. Wiki / Chat 화면 (기본 화면)

- **파일**: [chat-panel.tsx](../src/components/chat/chat-panel.tsx) (+ `chat-message.tsx`, `chat-input.tsx`, `chat-reference-panel.tsx`)
- **역할**: 질문 입력 → 검색·그래프 확장·LLM 답변 스트리밍. 좌측에는 대화 목록 사이드바(`ConversationSidebar`)만 있고 프로젝트 파일 트리는 없다. 생성된 문서를 파일 단위로 브라우징하려면 아래 5번 Graph 화면의 `files` 탭을 쓴다.
- **연결 파이프라인**: 질의응답 전체 흐름(검색 → 그래프 확장 → Cypher 컨텍스트 → LLM 스트리밍) → **[answer-guide.md](answer-guide.md)** 참고

### Raw data injection (IconSidebar에서 트리거)

- **파일**: [icon-sidebar.tsx](../src/components/layout/icon-sidebar.tsx) — 파일/URL inject 버튼, data-type 선택 다이얼로그
- **연결 파이프라인**: ingest 큐 등록 → decomposition → file write → graph assignment → 그래프 sync → **[ingest-current-state.md](ingest-current-state.md)** 참고
- 승인/거부 검토는 아래 4번 Review 화면에서 이어진다.

---

## 4. Review 화면

- **파일**: [review-view.tsx](../src/components/review/review-view.tsx) (탭: `reviews`, `pending` → [pending-view.tsx](../src/components/review/pending-view.tsx))
- **역할**:
  - `reviews` 탭: ingest 제안(suggestion), 문서 수정 제안(modification) 카드를 승인/거부. `ReviewItem.type`은 [review-store.ts](../src/stores/review-store.ts) 기준 이 2종뿐이다.
  - `pending` 탭: `pending/*.md` 대기 문서를 재검토(re-review) / 승격(promote) / 폐기(discard) — [pending-resolve.ts](../src/lib/pending-resolve.ts)
- **연결 파이프라인**: [ingest.ts](../src/lib/ingest.ts)의 decomposition/file write/graph assignment, modification 카드의 승인·병합·거부는 [modification-resolve.ts](../src/lib/modification-resolve.ts) — **[ingest-current-state.md](ingest-current-state.md)** 참고
- **화면 UI 상호작용**: 카드 종류별 액션(suggestion/modification), modification 2단계 결정 트리(Approve/Merge/Reject → Discard/Pending), pending 탭 승격 흐름 → **[review-view.md](review-view.md)** 참고

---

## 5. Graph 화면

- **파일**: [graph-view.tsx](../src/components/graph/graph-view.tsx) (탭: `knowledge`, `graphs`, `entity`, `files`)
- **역할**:
  - `knowledge`: 그래프 시각화 캔버스([falkor-canvas.tsx](../src/components/graph/falkor-canvas.tsx), `@falkordb/canvas` 래퍼). **기본 진입 시 Entity 모드**로, 엔티티를 선택하면 그 엔티티가 등장하는 **모든 그래프의 관계를 병합**해 하나의 캔버스로 보여준다(`get_entity_neighborhood` Rust 커맨드). Graph 모드로 토글하면 특정 그래프 하나만 골라 노드/수동 assertion 추가·삭제 등 편집이 가능하다(편집은 그래프 컨텍스트가 필요하므로 Graph 모드 전용). 우측 패널에는 relation type 리스트가 색상칩과 함께 뜨며, relation type을 클릭하면 해당 관계만 캔버스·Facts에 필터링된다. 노드·엣지 클릭으로 상세/삭제, review 상태 assertion의 승인·거부, 근거(evidence) 페이지를 Wiki 화면에서 열기도 지원한다. assertion은 `주어 predicate 목적어` 문장 형태로 표시하며 raw ID는 hover 툴팁으로만 노출한다. 사용하지 않는 디폴트 `main` 그래프는 셀렉터/목록에서 숨겨진다(`isUserVisibleGraph`)
  - `graphs`: 그래프 목록 등록/이름변경/삭제, 그래프별 relation type 관리([graphs-tab.tsx](../src/components/layout/graphs-tab.tsx)) — "Graph administration is deliberately backed by knowledge.sqlite only"
  - `entity`: 엔티티 관리([entity-view.tsx](../src/components/entity/entity-view.tsx)) — 검색/생성, canonical name rename, alias 추가/삭제, **merge**(엔티티 ID 입력 병합), **split**(신규 이름 + node-id 목록으로 분할), 삭제 시 영향받는 projection/assertion/page 개수 확인
  - `files`: `db/` 하위 생성 문서 목록(`listDbFiles`) → 문서 선택 시 그 문서가 근거(evidence)로 쓰인 관련 그래프 목록(`listGraphsForPage` = Rust `list_graphs_for_page`, `page_path`로 `assertion_evidence→assertions→graphs` 역추적) → 그래프 선택 시 `getKnowledgeGraphSnapshot`을 `knowledge` 탭과 동일한 캔버스로 조회 표시(읽기 전용). `FilesTab` 컴포넌트가 담당
- **연결 파이프라인**: [commands/knowledge.ts](../src/commands/knowledge.ts) (Tauri invoke 바인딩) → `src-tauri/src/knowledge/` 모듈(`commands.rs`, `db.rs`, `model.rs`, `queries.rs`, `schema.rs` 등, SQLite `knowledge.sqlite` 기반). 캔버스 데이터 변환은 [falkor-visualization.ts](../src/lib/falkor-visualization.ts)가 담당한다.
- **미문서화**: Graph 화면 전체를 다루는 문서가 없다. 아래를 다루는 문서가 필요:
  - knowledge 탭의 그래프 스냅샷 조회/수동 편집/assertion review 승인 흐름
  - graphs 탭에서 등록한 그래프·relation type이 ingest 파이프라인의 graph assignment(§4, [ingest-current-state.md](ingest-current-state.md))가 쓰는 카탈로그와 어떻게 연결되는지 — `src/lib/graph-policy.ts`는 더 이상 존재하지 않으며, 그래프·relation type은 파일이 아니라 knowledge.sqlite 레코드로 관리된다
  - entity 탭의 merge/split이 ingest 쪽 엔티티 연동과 어떻게 대응하는지
  - files 탭의 문서→관련 그래프 역추적(`list_graphs_for_page`)이 evidence 링크에 의존한다는 점 — 문서가 어떤 assertion의 근거로도 쓰이지 않았으면 "No related graphs"가 뜬다

---

## 6. Persona 화면

- **파일**: [persona-view.tsx](../src/components/persona/persona-view.tsx) (탭: `manage`, `scenarios`, `ask` — `ask` 탭은 `<ChatPanel useStore={usePersonaAskStore} graphPrefixFilter="persona_" />` 형태로 `ChatPanel`을 별도 store 인스턴스로 재사용)
- **역할**:
  - `manage`: 페르소나 정의(이름/설명) 관리. 저장은 [lib/persona/storage.ts](../src/lib/persona/storage.ts) — `.llm-wiki/personas.json`. 최초 로드 시 기본 페르소나 3종(숙련 유저/신규 유저/불안정 네트워크 유저) 시드
  - `scenarios`: 기능 입력 → `generateScenarios()`([lib/persona/generate.ts](../src/lib/persona/generate.ts))로 LLM 시나리오 생성 → export
  - `ask`: 페르소나 관점에서 질의응답 (persona_ 그래프 prefix로 필터된 ChatPanel)
- **연결 파이프라인**:
  - `generateScenarios(persona, featureInput, count, llmConfig, projectPath, projectName, signal?)` — `persona_` 접두사 그래프 컨텍스트 조회 → 공용 `callModel()` 호출(HTTP 프로바이더는 `streamChat`, CLI 프로바이더는 `streamClaudeCodeCli`/`streamGeminiCli`/`streamCodexCli`) → `parseScenarioResponse()`로 파싱
  - `exportScenario()`([lib/persona/export.ts](../src/lib/persona/export.ts)) — `qa/scenarios/<title>.md`(마크다운)와 `db/persona/<title>.md`(`reIngestDocument()`로 그래프 파이프라인에 재수집되는 필드) 동시 생성
  - 시나리오 저장: `.llm-wiki/scenarios.json` ([lib/persona/storage.ts](../src/lib/persona/storage.ts))
  - 스키마: [schema/data_types/persona.yaml](../schema/data_types/persona.yaml) — 필드는 `페르소나`(이름+설명), `시나리오`(제목+스텝 시퀀스) 2개
- **미문서화**: 이 화면과 생성/export 파이프라인을 다루는 전담 문서가 없다.

---

## 7. Casemap 화면

- **파일**: [casemap-view.tsx](../src/components/casemap/casemap-view.tsx) (`STEP_COUNT = 7`인 7단계 생성 스텝)
- **역할**: 7단계 스텝과 각 단계 함수(모두 [lib/casemap/generate.ts](../src/lib/casemap/generate.ts)):
  1. `StepFeatureInput` — 기능 입력
  2. `StepAbstraction` — `runAbstraction()` 결과인 추상화 태그 편집
  3. `StepAxes` — 축/값 편집 후 `generateCandidates()`(LLM 미사용, 순수 페어와이즈 조합, `COMBINATION_CAP=200`)로 조합 생성
  4. `StepCombinations` — 조합 표시 + IF-THEN 규칙 편집, `applyRules()`([lib/casemap/rule-filter.ts](../src/lib/casemap/rule-filter.ts), 규칙 기반 필터)를 적용한 뒤 `runImpossibleFilter()`(LLM, 배치 20개씩)로 불가능 조합 표시
  5. `StepImpossibleReview` — 불가능 조합 검토/토글 후 `runRiskGrading()`(LLM, 배치 20개씩) 실행
  6. `StepRiskReview` — 위험도 검토/수정 후 `runCaseGeneration()`(LLM, 배치 8개씩) 실행
  7. `StepQaReview` — 테스트케이스 검토/편집/제외 후 `exportTestPlan()`로 확정
- **연결 파이프라인**:
  - 저장: `.llm-wiki/casemap/<planId>.json`(플랜별), `.llm-wiki/casemap/rules.json`(규칙, 기본 3종 시드) — [lib/casemap/storage.ts](../src/lib/casemap/storage.ts)
  - export: `exportTestPlan()`([lib/casemap/export.ts](../src/lib/casemap/export.ts))이 `qa/test-plans/<name>.md`(마크다운)와 `db/casemap/<name>.md`(그래프 재수집용) 동시 생성
  - 스키마: [schema/data_types/casemap.yaml](../schema/data_types/casemap.yaml) — 필드는 `기능 정보`, `특성`, `테스트케이스` 3개
- **미문서화**: 이 화면과 생성 파이프라인을 다루는 전담 문서가 없다. 4단계의 "impossible filter"는 규칙 필터(`applyRules`)와 LLM 필터(`runImpossibleFilter`)가 하나의 스텝 안에서 순차 결합된 구조라는 점에 유의.

---

## 8. History 화면

- **파일**: [history-view.tsx](../src/components/history/history-view.tsx)
- **역할**: git 커밋 목록(페이지네이션) → 커밋 선택 시 상세(파일별 변경 목록) → 파일 선택 시 diff 조회. 파일 복원(restore, 특정 커밋 시점 내용으로 되돌림), 커밋 되돌리기(revert, 충돌 시 자동 해결 없이 사용자에게 표시)
- **연결 파이프라인**: [lib/git-history.ts](../src/lib/git-history.ts)의 `loadCommitPage`/`loadCommitDetail`/`loadFileDiff`/`restoreFileFromCommit`/`revertCommit` → [commands/git.ts](../src/commands/git.ts) → Rust [git_ops.rs](../src-tauri/src/commands/git_ops.rs) (libgit2 대신 git CLI를 subprocess로 직접 호출)
- **관련 문서**: 커밋이 발생하는 시점(sync/init)은 **[git-sync-guide.md](git-sync-guide.md)**가 다루지만, History 화면에서의 조회/복원/revert UI 자체는 별도로 다루지 않는다.
- **미문서화**: History 화면의 restore/revert UI 동작(버튼 배치, 확인 절차, 실패 처리)은 코드상 이미 구현되어 있으나 문서화된 곳이 없다. 필요 시 git-sync-guide.md에 "History 화면" 절을 추가하거나 별도 문서화.

---

## 9. Git Sync (다이얼로그, 전용 화면 없음)

- **트리거**: `IconSidebar`의 sync 버튼(`handleSync`는 [App.tsx](../src/App.tsx)에 정의되어 `AppLayout`에 `onSync` prop으로 주입됨 — `app-layout.tsx` 자체에는 없음), 종료 시 [sync-on-exit-dialog.tsx](../src/components/project/sync-on-exit-dialog.tsx)("Sync to Remote" / "Exit without Sync" / "Cancel"), 충돌 시 [sync-conflict-dialog.tsx](../src/components/project/sync-conflict-dialog.tsx)(충돌 파일 목록 + diff, "Abort Rebase" 또는 "Resolved & Continue")
- **연결 파이프라인**: 그래프 스냅샷 export → git commit → pull --rebase → push → **[git-sync-guide.md](git-sync-guide.md)** 참고

---

## 10. Settings 화면

- **파일**: [settings-view.tsx](../src/components/settings/settings-view.tsx) (카테고리: llm, embedding, output, interface, question-types, data-types, about)
- **역할**: LLM/임베딩 provider 설정, 출력 언어, 인터페이스(언어/테마), question-types·data-types 스키마 관리, 앱 정보/업데이트 확인
- **미문서화**: 전담 문서 없음. 특히 question-types/data-types 섹션은 ingest 파이프라인의 decomposition 대체 경로(§3 Data Type 구조화 추출, [ingest-current-state.md](ingest-current-state.md))와 casemap/persona 화면이 사용하는 스키마 소스이므로, 설정 변경이 각 파이프라인에 미치는 영향을 정리한 문서가 필요.

---

## 11. 문서 매핑 요약

| 화면/기능 | 담당 문서 |
|---|---|
| Raw data injection (ingest) | [ingest-current-state.md](ingest-current-state.md) |
| 서버 선택 화면의 import/export | [import-export-status.md](import-export-status.md) |
| Wiki/Chat 질의응답 | [answer-guide.md](answer-guide.md) |
| Git sync | [git-sync-guide.md](git-sync-guide.md) |
| Graph 화면 (knowledge/graphs/entity) | 없음 — 작성 필요 |
| Review 화면 UI 상호작용 | [review-view.md](review-view.md)|
| Persona 화면/생성 파이프라인 | 없음 — 작성 필요 |
| Casemap 화면/생성 파이프라인 | 없음 — 작성 필요 |
| History 화면 (restore/revert) | 없음 — git-sync-guide.md 보강 또는 신규 작성 필요 |
| Settings 화면 | 없음 — 작성 필요 |
