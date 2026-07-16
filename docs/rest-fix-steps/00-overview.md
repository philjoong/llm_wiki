# rest-fix 개발 계획 — Step 개요

원본 계획: [rest-fix-plan.md](../rest-fix-plan.md)

## 전제 (2026-07-15 확정)

- **축적된 데이터 없음** — 기존 데이터와의 호환성·마이그레이션을 고려하지 않는다.
  스키마 CHECK 제약은 직접 수정하고(Step 12), LanceDB 재인덱싱 절차는 두지 않는다(Step 13).
- **Step 단위 빌드/런타임 테스트 없음** — 각 Step은 빌드 가능한 상태를 유지할 필요가 없다.
  각 Step의 완료 조건은 코드 상태로 정적 확인 가능한 항목만 담고,
  런타임 검증은 전부 **Step 14 (최종 빌드 + 통합 검증)** 로 이월한다.
- 각 Step 문서에 명시된 "Step 14 이월 검증" 항목은 Step 14에서 일괄 수행한다.

## Step 목록과 의존 관계

| Step | 내용 | 계획서 § | 선행 Step |
|------|------|---------|-----------|
| [01](step-01-predicate-filter-traversal.md) | predicate 필터 traversal (Rust + TS 미러) | §3.2 | 없음 |
| [02](step-02-graph-candidate-promotion.md) | 그래프 확장 retrieval — traversal hit 후보 승격 | §3.3 | 01 |
| [03](step-03-graph-paths-injection.md) | "Graph Paths" 경로 주입 (공백 D 해소) | §3.3 | 02 |
| [04](step-04-retrieval-hints-branching.md) | `QuestionType.retrieval` 파싱 + `handleSend` 분기 | §3.1 | 01–03 |
| [05](step-05-json-answer-unification.md) | 답변 형식 JSON 통일 (md 폐지) | §3.4 | 없음 (04와 독립) |
| [06](step-06-ingest-dependency-predicates.md) | ingest 프롬프트 의존/영향 predicate 추출 지시 | §2.1 | 없음 |
| [07](step-07-scope-control.md) | 답변 범위(scope) 통제 — UI + allowlist 확장 | §4 | 02, 04 |
| [08](step-08-git-history-retrieval.md) | 과거 버전 조회 커맨드 + 히스토리 컨텍스트 주입 | §5 작업 1–3 | 04 |
| [09](step-09-history-point-picker.md) | 비교 시점 선택 UI | §5 작업 4 | 08 |
| [10](step-10-required-info-contract.md) | `required_info` 입력 계약 + `information_requests` 출력 계약 | §6 설계 0–1 | 05 |
| [11](step-11-inline-info-forms.md) | 인라인 active 입력 폼 + unavailable 마킹 + ingest 완료 알림 | §6 설계 2–3 | 10 |
| [12](step-12-save-to-wiki.md) | 사용자 답 위키/그래프 축적 ("위키에 저장") | §6 설계 4 | 11 |
| [13](step-13-embedding-retrieval.md) | embedding 시맨틱 검색 — retrieval 병합 | §7 | 02 |
| [14](step-14-final-build-verification.md) | **최종 빌드 + 통합 검증** | 전체 | 01–13 |

## 진행 원칙

- Step 1→6이 Phase 1이며 이 순서가 의존 순서다(§3.5). Step 5, 6은 병렬 가능.
- Step 7 이후는 Phase 2~5로, Phase 1 완료 후 어느 순서로 진행해도 되나
  Step 10→11→12(Phase 4 내부)와 Step 8→9(Phase 3 내부)는 순서를 지킨다.
- 컴포넌트에 question type id 하드코딩 금지 — UI 분기는 항상 YAML 플래그
  (`retrieval.scope`, `retrieval.include_history`)로 한다 (§3.1).
- 각 Step에서 단위 테스트(vitest, `src/lib/**/*.test.ts`)를 **작성**하되
  실행은 Step 14에서 일괄 수행한다.

## Phase 1 구현 요약 (2026-07-16 완료)

Step 01–06 구현 완료. Step 14 이월 검증(실제 위키 데이터 대상 런타임 확인)은 계획대로 미수행.

| Step | 구현 파일 | 비고 |
|------|-----------|------|
| 01 | `src-tauri/src/knowledge/{model.rs, commands.rs}`, `src/lib/knowledge/types.ts` | `allowed_predicates` 필드 + 이웃 확장 SQL 조건부 `predicate IN (...)`. 미지정 시 무필터 분기 동일. |
| 02 | `src/lib/knowledge/section-search.ts` | `options`(`graphExpand`/`allowedPredicates`) 추가, traversal hit→evidence 섹션 승격(상한 8, lexical 12 분리). |
| 03 | `src/lib/knowledge/section-search.ts`, `src/lib/chat-citations.ts`, `src/components/chat/chat-panel.tsx` | 방향·predicate 보존 경로 반환 + `buildGraphPathsBlock`(경로별 `[CIT:key]` 병기). |
| 04 | `src/lib/question-types.ts`, `src/lib/knowledge/predicate-axes.ts`, `schema/question_types/*.yaml`(4개), `src/components/chat/chat-panel.tsx`, `src/lib/graph-qna.ts` | `RetrievalHints` 파서 + `PREDICATE_AXES` 단일 상수 + `handleSend` 분기. `seed: llm_entities`는 graph context의 추출 엔티티 재사용. |
| 05 | `src/lib/json-answer.ts`, `src/components/chat/{chat-panel.tsx, chat-message.tsx}`, `schema/question_types/*.yaml`(4개) | 유형 선택 시 JSON-only 강제, 렌더 타임 파싱(코드펜스 스트리핑 공유 유틸), 실패 시 원본 fallback. |
| 06 | `src/lib/ingest.ts` | graph assignment 프롬프트에 `PREDICATE_AXES.dependency` 참조 의존/영향 추출 지시 추가(기존 규칙 병행). |

### 주요 설계 결정

- **Step 02/03 반환 타입** — 기존 단일 프로덕션 호출부·테스트를 깨지 않기 위해
  `searchSectionCandidates`(배열 반환)를 유지하고, 경로 포함 변형
  `searchSectionCandidatesWithPaths`(`{ candidates, graphPaths }`)를 신설했다.
  chat-panel은 경로 포함 버전을 사용한다. (계획서 §3.3의 "별도 필드/반환 형태" 허용 범위)
- **Step 03 경로 직렬화** — assertion 단위 엣지로 직렬화(`forward:false`면 `A <--PRED-- B`).
  citation key는 chat-panel에서 발급되므로, 경로 구조 데이터(엔티티명·predicate·방향·evidence sectionId)는
  section-search가 반환하고 `[CIT:key]` 병기는 chat-citations 유틸이 수행한다.
- **Step 04 `seed: llm_entities`** — `getGraphContextWithEntities`를 신설해 기존
  `getGraphContext`가 delegate하도록 하고, 추출 엔티티명을 `findKnowledgeEntities`
  exact-match로 resolve해 `seedEntityIds`로 전달한다(추가 LLM 호출 없음).

### 검증 상태

- TS 타입체크 통과, 관련 vitest 7파일 82테스트 통과.
- Rust `cargo check`/test 컴파일 통과, traversal 테스트 5개(신규 predicate 필터 포함) 통과.

## Phase 2 구현 요약 (2026-07-16)

Step 07 구현 완료. Step 14 이월 검증(실제 retrieval 결과 관찰)은 계획대로 미수행.

| Step | 구현 파일 | 비고 |
|------|-----------|------|
| 07 | `src/lib/knowledge/section-search.ts`, `src/lib/graph-qna.ts`, `src/components/chat/{chat-scope-selector.tsx(신규), chat-input.tsx, chat-panel.tsx}`, `src/i18n/{en,ko}.json` | `SectionSearchOptions`에 `allowedPageIds`/`allowedEntityIds` 추가(lexical+승격 공통 `inContentScope`). `getGraphContext(WithEntities)`에 `GraphContentScope` 인자. 범위 선택기는 `retrieval.scope === "selectable"` 플래그로만 노출(type id 하드코딩 없음), 범위는 대화 단위 상태. |

### 주요 설계 결정

- **콘텐츠 필터 규칙** — page/entity 필터는 OR 결합: 후보의 page가 `allowedPageIds`에
  있거나, 그 evidence assertion이 `allowedEntityIds`의 엔티티(subject/object)를 건드리면 통과.
  두 리스트 모두 비면 무필터(기존 whole-graph 동작). section-search와 graph-qna가 같은 규칙을 미러.
- **그래프 단위 범위** — 별도 필터 없이 기존 `allowedGraphIds`를 chat-panel에서
  선택 graphIds로 교집합해 좁힌다(§4 "기존 경로로 바로").
- **범위 상태 보존** — `Record<conversationId, ChatScopeSelection>` in-memory(세션 한정,
  영속화는 미도입). 대화 전환 시 해당 대화의 범위로 복원, 새 대화는 무제한.

### 검증 상태

- TS 타입체크 통과, section-search/graph-qna vitest 콘텐츠 스코프 테스트 추가·통과.

## Phase 3 구현 요약 (2026-07-16)

Step 08–09 구현 완료. Step 14 이월 검증(실제 프롬프트 주입·zero_residue 시나리오 관찰)은 계획대로 미수행.

| Step | 구현 파일 | 비고 |
|------|-----------|------|
| 08 | `src-tauri/src/commands/git_ops.rs`, `src-tauri/src/lib.rs`, `src/commands/git.ts`, `src/lib/git-history.ts`, `src/components/chat/chat-panel.tsx` | `git_show_file` 신설(파일 부재는 `exists:false`로 에러와 구분) + `git_log`에 path 필터 추가(`git log -- <path>`). `findDefaultComparisonVersion`(working tree와 내용이 달라지는 가장 최근 커밋), `collectPreviousVersions`(sectionId 대응) + `buildPreviousVersionsBlock`("Previous Versions" 블록, 커밋 날짜 명시). 주입은 `retrieval.includeHistory` 플래그로만 분기. |
| 09 | `src/components/chat/{chat-history-picker.tsx(신규), chat-input.tsx, chat-panel.tsx}`, `src/lib/git-history.ts`, `src/i18n/{en,ko}.json` | repo 커밋 목록(`loadCommitPage` 재사용) 기반 시점 선택기. 상대+절대 시간 표시, 해시 숨김, sync 커밋(`sync:` prefix) 메시지 비노출. 선택 시점은 대화 단위 in-memory 상태(Step 07 scope 패턴 공유), 미선택 시 Step 08 기본값. |

### 주요 설계 결정

- **기본 시점의 전량 일치 fallback** — 파일을 건드린 모든 커밋의 내용이 working tree와
  같으면(추가 후 무변경) null 대신 **가장 오래된 커밋**을 반환한다. "과거 정보 없음"
  오답 대신 "해당 시점 이후 변화 없음"을 정직하게 답할 수 있게 하기 위함.
- **과거 본문의 섹션 대응** — 과거 파일을 `parseMarkdownV2`로 파싱해 stable
  `{#sec-ULID}`로 현재 후보 섹션과 대응. 파일 부재는 "file-absent", 파일은 있으나
  섹션이 없으면 "section-absent"로 구분 주입. v2 파싱 실패 시(레거시 데이터 없음
  전제라 사실상 불가) 해당 페이지는 조용히 제외 → 기존 "과거 정보 없음" 규칙.
- **선택 시점은 repo 단위, 조회는 파일 단위** — 질문 시점엔 retrieval 전이라 대상
  페이지를 모르므로 선택기는 repo 커밋 목록을 보여주고, 선택된 해시를 retrieval이
  찾은 각 후보 파일의 `git_show_file` 기준으로 사용한다(Step 09 작업 2).

### 검증 상태

- TS 타입체크 통과, `git-history.test.ts` 12테스트 통과(기본 시점 결정 5, 수집 5, 블록 2).
- Rust `git_show_file` 테스트(과거 내용·부재 플래그·읽기 전용·path 필터 log) 통과.
  기존 `git_checkout_path`/`git_revert` 테스트 2개는 Windows `core.autocrlf` 환경에서
  CRLF 변환("v1\r\n" != "v1\n")으로 실패 — 이번 변경과 무관한 기존 환경 이슈.
- 기존 `section-search.test.ts`의 타입 오류 2건(mock의 `sectionType:"detail"`이
  vocabulary에 없음)을 `"behavior"`로 수정 — 타입체크 통과를 막고 있던 기존 결함.

## Phase 4 구현 요약 (2026-07-16)

Step 10–12 구현 완료. Step 14 이월 검증(실제 역질문 생성·루프 종료·새 대화 재검색 관찰)은 계획대로 미수행.

| Step | 구현 파일 | 비고 |
|------|-----------|------|
| 10 | `src/lib/question-types.ts`, `schema/question_types/*.yaml`(4개), `src/lib/json-answer.ts`, `src/components/chat/chat-panel.tsx`, 테스트(`json-answer.test.ts`, `__tests__/question-types.test.ts`) | `QuestionType.requiredInfo` 파서 + 4개 YAML `required_info:` 블록. `information_requests` 예약 키 파서(`parseInformationRequests` — 닫힌 `input_type` 집합·`info_key` 유효성 검증, 위반 요청 폐기) + 프롬프트 빌더(`buildRequiredInfoPrompt` — 판정 지시·스키마·unavailable 스킵). 프롬프트는 유형 선택 시(`if(qt)`)만 주입. |
| 11 | `src/components/chat/{chat-info-forms.tsx(신규), chat-panel.tsx, chat-message.tsx}`, `src/lib/chat-info-injection.ts(신규)`, `src/i18n/{en,ko}.json`, 테스트(`chat-info-injection.test.ts`) | `input_type`별 인라인 폼(choice 라디오+기타/text/file/link) + 모든 폼 "없음/모름" 버튼. 제출→`[info_key: k] 답` user 메시지(`formatInfoAnswer`)로 다음 턴 컨텍스트. file/link는 기존 injection 큐 재사용(`injectFileAnswers`/`injectLinkAnswer` — icon-sidebar 경로 미러). unavailable은 대화·유형 단위 in-memory, 프롬프트에 실어 재질문 차단. ingest 완료 폴링→"반영 완료" 배지+재전송. |
| 12 | `src-tauri/src/knowledge/{schema.rs, model.rs, commands.rs}`, `src/commands/knowledge.ts`, `src/lib/ingest-v2/execute.ts`, `src/lib/knowledge/types.ts`, `src/lib/{chat-save.ts(신규), ingest.ts}`, `src/components/chat/chat-message.tsx`, `src/i18n/{en,ko}.json`, 테스트(`chat-save.test.ts`, Rust `tests.rs`) | origin CHECK에 `'user_chat'` 직접 추가(마이그레이션 없음). `CommitIngestPlanInput.origin`(기본 `ingest`) → `commitIngestPlan`/`commitMarkdownV2Pages`/`executeIngestPlan`까지 스레드. `suggestSaveLocation`(LLM 위치 제안+dbIndex 재사용, fallback) + `saveChatAnswerToWiki`(신규/기존 페이지 v2 빌드→`extractKnowledgeAssertionWrites`→`commitMarkdownV2Pages(...,"user_chat")`). 사용자 답 카드에 "위키에 저장"→위치 승인/변경 UI. |

### 주요 설계 결정

- **역질문 루프 = 대화 히스토리** — 폼 제출은 별도 주입 채널 없이 `info_key` 태그를 단
  일반 user 메시지로 대화에 들어간다(§6 설계 3). 다음 턴 LLM이 자기 역질문(직전 assistant
  JSON) + 사용자 답을 히스토리로 보고 마저 답한다. unavailable 마킹 + Step 10 프롬프트의
  "재질문 금지" 규칙이 종료 조건.
- **file/link는 수동 재개** — ingest 완료가 원 질문을 자동 재실행하지 않는다(§5).
  큐 완료를 폴링해 "반영 완료" 배지+재전송 버튼만 띄우고, 재전송 시 **원 질문**(태그된
  답이 아닌)을 같은 유형으로 replay. 이를 위해 `handleSend`는 info-answer send일 때
  `lastQuestion`을 덮어쓰지 않는다.
- **origin 스레딩 최소화** — 공유 커밋 경로(`commit_ingest_plan`)에 `origin` 파라미터
  하나만 추가(기본 `ingest`). 기존 모든 호출부는 무변경, 저장 경로만 `user_chat` 전달.
  Rust에서 CHECK 밖 값은 INSERT 전에 거부.
- **저장 위치 제안 재사용** — decomposition의 page_path 결정을 그대로 쓰지 않고, 경량
  프롬프트에 기존 페이지 목록(`listKnowledgePages`)을 주입해 기존 페이지 재사용/신규 생성을
  제안. 검수 단계 없음(위치 승인만). assertion 추출 실패는 best-effort로 내용만 저장.

### 검증 상태

- TS 타입체크 통과, 전체 vitest 838 통과(신규 `json-answer`/`chat-info-injection`/`chat-save`
  테스트 포함).
- Rust `cargo check` 통과. 신규 `ingest_plan_records_user_chat_origin_and_rejects_unknown_origin`
  테스트 통과(user_chat 기록·CHECK 밖 값 거부), 기존 ingest_plan 테스트에 default origin 검증 추가.
  knowledge 스위트 6개 실패는 Windows `remove_dir_all` 파일 잠금(code 32) — 무변경 코드에서도
  동일 재현되는 기존 환경 이슈(이번 변경과 무관).

## Phase 5 구현 요약 (2026-07-16)

Step 13 구현 완료. Step 14 이월 검증(실제 동의어/개념 질문의 embedding 경유 후보 상위 노출,
off 회귀, 페이지 삭제 시 embedding 연동)은 계획대로 미수행.

| Step | 구현 파일 | 비고 |
|------|-----------|------|
| 13 | `src/lib/ingest.ts`, `src/lib/wiki-page-delete.ts`, `src/lib/knowledge/section-search.ts`, `src/components/chat/chat-panel.tsx`, 테스트(`section-search.test.ts`, `wiki-page-delete.test.ts`, `ingest-queue.test.ts`) | 인덱싱 `page_id`를 v2 ULID로 통일(ingest는 written 파일 frontmatter ULID, delete는 삭제 전 파일 읽어 ULID로 cascade). `SectionSearchOptions.embeddingConfig` 추가 → `searchSectionCandidatesWithPaths` 내부에서 `searchByEmbedding` 호출, chunk 텍스트를 섹션 본문에서 재탐색(실패 시 페이지 첫 섹션 폴백)해 후보 병합. embedding 후보 존재 시 `embeddingScore` 1차 정렬 + 12개 컷, 없거나 off면 기존 lexical-only 경로 무변경. `void useEmbedding` 제거 → 토글이 embedding 병합만 게이트(파일검색 부활 아님). |

### 주요 설계 결정

- **ID 정합 지점** — ingest는 written 파일을 어차피 다시 읽으므로 그 자리에서 `parseMarkdownV2`로
  ULID를 얻어 `embedPage`에 넘긴다(`pageIdFromRelPath` 호출부 제거). 삭제는 `deleteFile` 전에
  파일을 읽어 ULID를 확보하고, v2 파싱 실패/파일 부재면 ULID 없음 → cascade 스킵(빈 키로 삭제 금지).
  `embedAllPages`(Settings 일괄 색인)는 계획 확정대로 기존 path-기반 ID 유지.
- **embedding provider 위치** — `searchSectionCandidatesWithPaths` 내부에 `mergeEmbedding` 헬퍼로
  두었다. graphExpand<=0 조기 반환과 최종 반환 두 지점에서 동일 병합. `embeddingConfig` 미지정/disabled/
  빈 결과/검색 예외면 base를 그대로 반환해 lexical-only 경로가 완전히 동일(회귀 안전).
- **chunk→섹션 대응** — LanceDB chunk는 sectionId를 모르므로 chunk 텍스트 head 120자를 페이지
  섹션 본문에서 `includes`로 재탐색(Step 02 quote 재탐색 패턴). 미스면 페이지 최소 ordinal 섹션 폴백.
  디스크에 없는 page_id(고아 chunk)는 섹션 해석 불가로 조용히 제외.
- **콘텐츠 스코프 적용** — embedding으로 새로 병합되는 섹션도 Step 07 `inContentScope`를 통과해야
  한다(스코프 우회 금지). graph 증거 요구(`allowedGraphIds` 시 provenance 필수)는 embedding 후보에
  적용하지 않음 — embedding은 graph와 직교한 시맨틱 경로라 lexical/graph가 놓친 섹션을 살리는 것이 목적.

### 검증 상태

- TS 타입체크 통과, 전체 vitest 846 통과(신규 embedding 병합 9테스트 + 재작성된 delete/queue 테스트 포함).
  skip 41개는 실 LLM/embedding 엔드포인트 필요 테스트(`RUN_LLM_TESTS` 게이트)로 기존과 동일.

## 남은 작업과 진행 방침 (2026-07-16 확정)

Step 01–13 구현 완료. **Step 14 개발 측(§1 빌드 + §2 자동 테스트) 완료. §3 런타임
통합 검증만 사용자 몫으로 남음.**

- **Windows 환경 기인 기존 테스트 실패 8건 수정 완료** —
  `git_checkout_path`/`git_revert` CRLF 2건은 개행 정규화로, knowledge 스위트
  `remove_dir_all`(code 32) 6건은 **정리 직전 SQLite 연결 drop**(근본 원인은 연결 누수)
  + 재시도 `cleanup` 헬퍼 + orphan 경로 OS-네이티브 결합으로 수정. 상세는
  [step-14](step-14-final-build-verification.md#2-자동-테스트-일괄-실행) 참고.
  이 머신에서 `cargo test` 전체 통과(66/0/1) 실제 달성.
- **추가로 발견한 ingest-queue 통합 테스트 flaky 3개소 수정** — 전체 스위트 병렬
  실행에서만 재현되던 truncate-read 레이스. 테스트 하네스만 수정(프로덕션 무변경).
  vitest 840/0, 전체 스위트 12연속 반복 0 실패로 확인.
- **Step 14 런타임 통합 검증(§3)은 사용자가 앱에서 직접 수행한다** —
  샘플 프로젝트(게임 문서 ingest + Sync 2회) 준비 포함. Tauri dev 앱 기동 확인도
  §3 런타임 세션에서 함께 수행(앱 바이너리 링크 + 프론트 번들은 통과 확인됨).
- 커밋은 사용자가 직접 관리한다.
