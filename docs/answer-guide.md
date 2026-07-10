# Chat 답변 파이프라인

Chat 탭에서 질문을 입력했을 때 답변이 출력되기까지의 전체 흐름.

---

## 흐름 요약

```
질문 입력
    │
    ├─▶ [0] 인사말 감지 (greeting-detector)
    │       단순 인사이면 검색 없이 짧은 답변으로 단락
    │
    ▼
[Step 1] 하이브리드 검색 — token + vector, RRF + threshold gate (search)
    │
    ▼
[Step 2] Knowledge Graph 컨텍스트 조회 (graph-qna — LLM 호출 + entity-dict 해석)
    │
    ▼
[Step 3] 페이지 예산 제어 → system prompt 조립 (chat-panel)
    │
    ▼
[Step 4] LLM 스트리밍 답변 생성 (llm-client)
    │
    ▼
[Step 5] 렌더링 — Markdown + References 패널 (chat-message)
```

`page-graph-index.ts` 기반의 별도 그래프 이웃 확장 단계(과거 "Step 2 Graph 확장")는 현재 Chat 답변 경로에서 더 이상 호출되지 않는다. 해당 인덱스는 Graph 탭 동기화(`graph-sync.ts`, `App.tsx`의 `rebuildPageGraphIndex()`)에서만 쓰인다.

---

## 각 단계 상세

### [0] 인사말 감지
- `src/lib/greeting-detector.ts` — `isGreeting()`.
- 순수 규칙 기반(정규식), LLM 호출 없음. 정규화(trim + 끝 구두점 제거 + lowercase) 후 전체 문자열이 인사 패턴과 정확히 일치할 때만 `true` (부분 문자열 매치 아님). 20자 초과 입력은 즉시 `false`.
- 영어/중국어(간체+번체)/일본어/한국어/유럽어 인사말을 커버.
- 인사말이면 검색 파이프라인 전체를 건너뛰고, "가볍게 답하되 위키 내용을 지어내지 말라"는 최소 system prompt만으로 응답한다. References 패널은 표시되지 않는다 (`queryRefs`가 비어 있음).

### [Step 1] 하이브리드 검색
- `src/lib/search.ts` — `searchWiki()`
- `db/` 디렉토리와 `raw/sources/` 아래 전체 파일(`db/`는 `.md`만, `raw/sources/`는 전체)을 후보로 스캔한다.
- **토큰/구문 점수** (`searchFiles`): 파일명 완전 일치, 제목/본문의 원문 구문(phrase) 포함, 토큰 매칭 빈도를 가중치별로 합산 (`FILENAME_EXACT_BONUS`, `PHRASE_IN_TITLE_BONUS`, `PHRASE_IN_CONTENT_PER_OCC`, `TITLE_TOKEN_WEIGHT`, `CONTENT_TOKEN_WEIGHT`). CJK 질의는 바이그램 + 개별 문자 단위로 추가 토큰화.
- **벡터 검색** (RAG 버튼 ON 시): `embeddingConfig.enabled`이고 `source === "builtin"`이거나 `model`이 설정된 경우 `searchByEmbedding()` 실행. 코사인 유사도로 상위 10개.
- **Relevance threshold 게이트**: RRF 융합 전에 raw 점수 기준으로 걸러낸다 — 토큰 점수가 `MIN_TOKEN_SCORE(1)` 미만이면 토큰 랭킹에서 제외, 벡터 유사도가 `MIN_VECTOR_SIMILARITY(0.3)` 미만이면 벡터 랭킹에서 제외. 두 리스트 모두에서 탈락한 결과는 최종 결과에서 완전히 제거된다 ("관련 없으면 아무것도 반환하지 않는다").
- 살아남은 결과를 RRF(Reciprocal Rank Fusion, K=60)로 결합해 상위 20개(`MAX_RESULTS`) 중 상위권을 채택한다.
- `searchPaths()`: 후보 파일 목록을 미리 제한한 채로 동일 로직을 적용하는 변형(제외 규칙이 적용된 Casemap/Persona 등에서 사용). 벡터 히트도 제한된 경로 집합 밖으로는 재진입하지 못하도록 막는다.

### [Step 2] Knowledge Graph 컨텍스트 조회
- `src/lib/graph-qna.ts` — `getGraphContext()`
- `graph-policy.json`에 등록된 관리 그래프(`managedGraphs`)가 1개 이상이어야 실행된다. `graphPrefixFilter`가 주어지면(Casemap/Persona 탭의 scoped ChatPanel) 해당 접두사로 시작하는 그래프만 후보로 좁힌다.
- **그래프/타입/엔티티 선택**: LLM에게 질문과 각 그래프의 relation type 목록을 넘겨, 관련 그래프별로 (a) 열거형 질문에 쓸 `relationTypes`와 (b) 엔티티 중심 질문에 쓸 `entities`를 JSON으로 추출받는다.
- 그래프별로 실제 쿼리 실행 (`GraphBackend.queryGraph`):
  - **relation 쿼리**: 선택된 relation type마다 해당 타입의 모든 edge 조회 (최대 80개, `RELATION_LIMIT`).
  - **node 쿼리**: 추출된 엔티티명을 먼저 `entity-dict.json`(`entity-dict.ts`)의 canonicalName/alias exact match로 정규화한 뒤(`resolveNodeName`), 정규화된 이름으로 `{ type: "node", nodeName }` 조회. Backend는 `name LIKE %nodeName%`로 매칭하고 이웃 1-hop까지 확장해서 반환한다 (최대 20개, `NODE_LIMIT`).
  - **간접 영향 확장** (`ENTITY_IMPACT_HOPS=2`): 해석된 엔티티에서 `graph-hop.ts`의 `filterSnapshotByHops()`로 최대 2-hop BFS 확장 — "Entity A의 영향도" 같은 질문에서 A→B→C 관계까지 노출.
  - **path 쿼리**: 엔티티가 2개 이상이면 첫 두 엔티티 사이 최단 경로를 BFS로 탐색 (`maxDepth=6`, `PATH_MAX_DEPTH`).
- 각 그래프의 결과 라인을 중복 제거 후 `GraphContextBlock[]`으로 반환. 아무것도 못 찾으면 `[]`.
- `formatGraphContextBlocks()`가 `## Knowledge Graph Context` 섹션으로 조립해 system prompt에 삽입. 빈 배열이면 `""` (섹션 자체가 생략됨).
- 과거에는 질문 문자열 전체를 그대로 노드 이름으로 사용해 사실상 항상 빈 결과였으나, 현재는 LLM이 추출한 개별 엔티티명 + entity-dict 정규화 + hop 확장 + path 탐색이 결합된 별도 파이프라인이다.

### [Step 3] System Prompt 조립
- `src/components/chat/chat-panel.tsx` — `handleSend(text, questionTypeId?, useEmbedding?)`
- 예산은 `context-budget.ts`의 `computeContextBudget(llmConfig.maxContextSize)`로 계산 (문자 수 기준). 컨텍스트 윈도우 대비 인덱스 5%, 페이지 50%, 나머지는 히스토리/system 여유분, 응답용으로 15% 예약.
- `useEmbedding === false`이면 이번 질의에 한해 `embeddingConfig.enabled`를 일시적으로 꺼서 벡터 검색을 건너뛴다(호출 후 원래 값 복원).
- `db/index.md`를 인덱스 예산 내로 넣되, 초과 시 질의 토큰과 관련된 라인(헤더 + 매칭 라인)만 남기고 트리밍.
- Step 1 검색 결과를 우선순위별로 페이지 예산에 채움: **P0 제목 일치 → P1 본문 일치**. 관련 문서가 하나도 없으면(`noRelevantDocs`) 폴백 페이지를 넣지 않고, 대신 system prompt에 "관련 문서를 찾지 못했다고 솔직히 답하라"는 지시를 추가한다.
- system prompt 구성 요소: 규칙 섹션(출처 기반 답변 강제, `## Sources` + `<!-- cited: ... -->` 형식 지시, 복수 질문 분리 답변 지시) → Step 2 Knowledge Graph 컨텍스트 → Wiki Index → Page List → Wiki Pages 본문 → 출력 언어 강제 지시.
- `questionTypeId`가 있으면 `loadQuestionTypes()`로 타입을 찾아 system prompt 끝에 `## Answer Format` 섹션(fields 목록 + promptTemplate)을 덧붙인다.
- 언어 리마인더(`buildLanguageReminder`)는 system prompt에 넣지 않고, 대화 히스토리 뒤 마지막 사용자 메시지 앞에 삽입한다 — 일부 로컬 백엔드(vLLM/llama.cpp의 Qwen3 계열 Jinja 템플릿)가 "system은 맨 앞에만" 규칙을 강제해 중간 system 메시지를 거부하기 때문.
- 대화 히스토리는 `maxHistoryMessages`로 최근 N개만 포함.

### [Step 4] LLM 스트리밍 답변 생성
- `src/lib/llm-client.ts` — `streamChat()`
- system + history + 사용자 질문 메시지를 LLM에 전달, 토큰 단위로 스트리밍.
- LLM은 응답 끝에 `## Sources` 섹션과 숨겨진 `<!-- cited: 1, 3, 5 -->` 주석을 작성하도록 지시된다.
- 완료 후 `finalizeStream()`이 호출돼 메시지가 확정되고 대화 히스토리에 저장된다.

### [Step 5] 렌더링
- `src/components/chat/chat-message.tsx`
- **본문**: `MarkdownContent` 컴포넌트가 렌더링한다.
  - `<!-- ... -->` 주석 제거, `## Sources` 섹션 제거 (References 패널과 중복이므로).
  - `<think>`/`<thinking>` 블록은 접힌 "Thinking" 섹션으로 분리해서 표시 (스트리밍 중 미완성 블록도 처리).
  - JSON 형태 응답은 key-value 카드 레이아웃으로 렌더링.
  - `[[wikilink]]` 구문을 클릭 가능한 링크로 변환하고, LaTeX(`\begin{...}...\end{...}`)를 자동으로 `$$...$$`로 감싸 수식 렌더링.
- **References 패널** (`CitedReferencesPanel`): `<!-- cited: 1, 3, 5 -->` 주석을 파싱해 인용된 페이지를 아이콘(entity/concept/source/query/synthesis/comparison/overview/clip)과 함께 목록으로 표시.
  - 저장된 메시지는 `message.references`를 우선 사용하고, 없으면 주석 파싱 → `[N]` 표기 파싱 → `[[wikilink]]` 파싱 순서로 폴백.
  - 클릭 시 인용 위치 주변 텍스트를 스니펫으로 추출해 `chatReferencePreview`(우측 인라인 미리보기 패널, `ChatReferencePanel`)를 연다.

---

## 질문 타입 시스템

`src/lib/question-types.ts` — 2계층 구조 (상위가 하위를 덮어씀):
1. `{project}/question_types/` — 프로젝트 공유, git 커밋 대상. 프로젝트 생성 시 `schema/question_types/*.yaml`이 여기로 시딩된다.
2. `{project}/.llm-wiki/question-types/` — 사용자 개인 오버라이드. `_deleted: true` 항목(tombstone)은 상위 타입을 제거한다.

각 항목은 `.yaml`/`.yml`(신규 포맷: `name`, `description`, `fields`, `prompt_template`) 또는 `.md`(레거시 포맷: frontmatter title + `## Input`/`## Output`/`## Zero residue` 섹션 파싱)로 정의 가능. 파일명(확장자 제외)이 `id`가 된다.

```yaml
# question_types/my_type.yaml
name: "타입 이름"
description: "이 타입의 질문 예시 및 특징"
fields:
  cause: "원인 설명"
  solution: "해결 방법"
prompt_template: |
  Respond with each field listed above clearly labeled.
```

- **채팅 입력창**: `src/components/chat/chat-input.tsx`. 검색창 아래 우측에 RAG 버튼과 Question Type 드롭다운이 표시된다. 프로젝트가 없으면 숨겨진다.
  - **RAG 버튼**: `⚡ RAG` 버튼으로 벡터 검색 ON/OFF 토글. `embeddingConfig.enabled`가 true이고 (`source === "builtin"` 이거나 `model`이 설정된 경우) 활성화 가능. 미설정 시 버튼이 비활성화되고 이유가 툴팁으로 표시된다.
  - **Question Type 드롭다운**: 선택지 "None" + 로드된 질문 타입 목록. 고정 폭(`w-36`) 우측 정렬.
  - 선택한 타입 id와 RAG 여부가 `onSend(text, questionTypeId?, useEmbedding?)`로 전달된다.
- **Answer Format 주입**: Step 3 참고.
- 미선택 시 기존 자유 형식 답변이 유지된다.

---

## Casemap / Persona 탭의 scoped Chat

`ChatPanel`은 `useStore`(별도 conversation store)와 `graphPrefixFilter`를 props로 받아 재사용된다. `casemap-view.tsx`/`persona-view.tsx`는 자신만의 store와 `"casemap_"`/`"persona_"` 접두사를 넘겨, Step 2 그래프 선택 범위를 해당 도메인 그래프로 제한한 질의 위젯을 띄운다. 메인 Chat 탭은 `graphPrefixFilter` 없이 전체 `managedGraphs`를 사용한다.
