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
[Step 1] 하이브리드 검색 — token + vector (search)
    │
    ▼
[Step 2] Graph 확장 — FalkorDB Cypher (page-graph-index + queryGraphDb)
    │
    ▼
[Step 3] Cypher 컨텍스트 조회 (graph-qna — LLM 호출)
    │
    ▼
[Step 4] 페이지 예산 제어 → system prompt 조립 (chat-panel)
    │
    ▼
[Step 5] LLM 스트리밍 답변 생성 (llm-client)
    │
    ▼
[Step 6] 렌더링 — Markdown + References 패널 (chat-message)
```

---

## 각 단계 상세

### [0] 인사말 감지
- `src/lib/greeting-detector.ts` — 질문이 단순 인사("hi", "안녕" 등)이면 `true` 반환.
- 검색 파이프라인 전체를 건너뛰고 짧은 환영 응답을 즉시 생성한다.
- References 패널이 표시되지 않는다 (queryRefs가 비어 있음).

### [Step 1] 하이브리드 검색
- `src/lib/search.ts` — `searchWiki()`
- `db/` 디렉토리와 `raw/sources/` 아래 전체 `.md` 파일을 후보로 검색한다.
- **토큰 매칭**: 질문을 토큰화하고 파일명/본문에서 매칭 빈도로 점수 산정.
- **벡터 검색** (설정 시): 질문을 임베딩하고 코사인 유사도로 순위 매김.
- 두 점수를 RRF(Reciprocal Rank Fusion)로 결합해 상위 10개 결과(`topSearchResults`)를 선택한다.

### [Step 2] Graph 확장 (FalkorDB 기반)
- `src/lib/page-graph-index.ts` — `loadPageGraphIndex()` + `lookupPageGraphs()`
- `src/commands/graph-db.ts` — `queryGraphDb()`
- 검색 결과 파일(`page_path`)에서 출발해 FalkorDB Cypher로 이웃 노드를 탐색한다.
  1. `page-graph-index.json`에서 파일이 속한 graph 목록 조회
  2. 각 graph에서 `MATCH (src:Page {page_path})--(nb:Page)` Cypher 실행
  3. 반환된 `nb.page_path` 중 `keptPathSet`에 있고 검색 결과에 없는 것을 확장 후보로 추가
- 아직 `page_path` 속성이 없는 기존 노드(이전 sync분)는 Cypher 결과가 비어 graphExpansions가 없는 채로 진행한다.

### [Step 3] Cypher 컨텍스트 조회
- `src/lib/graph-qna.ts` — `getGraphContext()`
- 프로젝트에 `graph-policy` 설정이 있고 관리 그래프가 1개 이상이면 실행된다.
- LLM에게 질문과 FalkorDB 그래프 목록을 넘겨 관련 그래프와 Cypher 쿼리를 생성받는다.
- 실제 FalkorDB에 Cypher를 실행해 JSON 결과를 얻는다.
- 이 결과는 `## Knowledge Graph Context` 블록으로 system prompt에 삽입된다.

### [Step 4] System Prompt 조립
- `src/components/chat/chat-panel.tsx` — `handleSend(text, questionTypeId?)`
- 기본 wiki assistant 프롬프트를 조립하며 아래 내용을 포함한다:
  - Cypher 컨텍스트 (Step 3 결과)
  - Wiki 인덱스(`db/index.md`) — 예산 초과 시 관련 항목만 트리밍
  - 검색·확장된 페이지 본문 (우선순위: 제목 일치 > 본문 일치 > graph 확장 > overview 폴백)
  - 출력 언어 강제 지시
  - `questionTypeId`가 있으면 `## Answer Format` 섹션을 system prompt 끝에 추가 (fields 목록 + promptTemplate)
- 페이지 예산은 `context-budget.ts`로 계산하며, LLM 컨텍스트 윈도우 크기에 비례해 조정된다.
- 대화 히스토리(설정된 max 턴 수)를 system 메시지 뒤에 이어 붙인다.

### [Step 5] LLM 스트리밍 답변 생성
- `src/lib/llm-client.ts` — `streamChat()`
- system + history + 사용자 질문 메시지를 LLM에 전달한다.
- 응답을 토큰 단위로 스트리밍해서 화면에 실시간 출력한다.
- LLM은 응답 끝에 `## Sources` 섹션과 숨겨진 `<!-- cited: 1, 3, 5 -->` 주석을 작성하도록 지시된다.
- 완료 후 `finalizeStream()`이 호출돼 메시지가 확정되고 대화 히스토리에 저장된다.

### [Step 6] 렌더링
- `src/components/chat/chat-message.tsx`
- **본문**: `MarkdownContent` 컴포넌트가 렌더링한다.
  - `<!-- ... -->` 주석 제거.
  - `## Sources` 섹션 제거 (References 패널과 중복이므로).
  - `<think>` 블록은 접힌 "Thinking" 섹션으로 분리해서 표시.
  - JSON 형태 응답은 key-value 카드 레이아웃으로 렌더링.
- **References 패널**: `CitedReferencesPanel`이 `<!-- cited: 1, 3, 5 -->` 주석을 파싱해 인용된 페이지를 클릭 가능한 목록으로 표시한다.
  - 클릭 시 Graph 탭 > Files 탭으로 이동해 해당 파일을 선택한다.

---

## 질문 타입 시스템

`question_types/` 아래 `.md` 또는 `.yaml` 파일로 정의한다.

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

- `src/lib/question-types.ts` — `loadQuestionTypes(projectPath)` 로 로드.
- **채팅 입력창 드롭다운**: `src/components/chat/chat-input.tsx`의 입력창 상단에 질문 타입 드롭다운이 표시된다. 프로젝트가 없거나 타입이 0개이면 숨겨진다.
  - 선택지: "None" (미선택) + 로드된 질문 타입 목록.
  - 선택한 타입 id가 `onSend(text, questionTypeId?)` 로 전달된다.
- **Answer Format 주입**: `handleSend`에서 `questionTypeId`가 있으면 `loadQuestionTypes()`로 해당 타입을 찾아 system prompt 끝에 `## Answer Format` 섹션을 추가한다.
  - `fields`가 있으면 각 key와 설명을 열거.
  - `promptTemplate`이 있으면 그 내용을 지시사항으로 추가.
- 미선택 시 기존 자유 형식 답변이 유지된다.
