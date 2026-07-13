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
[Step 1] Section 후보 검색 + Knowledge Graph 컨텍스트 조회 (knowledge/section-search, graph-qna)
    │
    ▼
[Step 2] Citation 발급 + system prompt 조립 (chat-citations, chat-panel)
    │
    ▼
[Step 3] LLM 스트리밍 답변 생성 (llm-client)
    │
    ▼
[Step 4] 렌더링 — Markdown + Citation 파싱 + References 패널 (chat-message)
```

Chat이 받을 수 있는 문서 payload는 v2 knowledge DB의 section 후보(`SectionCandidate`)뿐이다. 과거의 파일 기반 하이브리드 검색(`search.ts`의 토큰/벡터 RRF 융합)과 `graph-policy.json`/`entity-dict.json` 기반 그래프 조회는 더 이상 존재하지 않는다 — 두 경로 모두 knowledge DB(`src-tauri/src/knowledge`)와 `src/lib/knowledge/`로 대체되었다.

---

## 각 단계 상세

### [0] 인사말 감지
- `src/lib/greeting-detector.ts` — `isGreeting()`.
- 순수 규칙 기반(정규식), LLM 호출 없음. 정규화(trim + 끝 구두점 제거 + lowercase) 후 전체 문자열이 인사 패턴과 정확히 일치할 때만 `true` (부분 문자열 매치 아님). 20자 초과 입력은 즉시 `false`.
- 영어/중국어(간체+번체)/일본어/한국어/유럽어 인사말을 커버.
- 인사말이면 검색 파이프라인 전체를 건너뛰고, "가볍게 답하되 위키 내용을 지어내지 말라"는 최소 system prompt만으로 응답한다. References 패널은 표시되지 않는다 (citation이 발급되지 않음).

### [Step 1] Section 검색 + Knowledge Graph 컨텍스트 조회
`src/components/chat/chat-panel.tsx`의 `handleSend`가 프로젝트 경로(`pp`)와 질문 텍스트로 두 조회를 순차 실행한다. `useEmbedding` 인자는 `ChatInput`의 RAG 토글 계약을 유지하기 위해 남아 있을 뿐, 현재 section 검색 경로에는 반영되지 않는다(`void useEmbedding`) — 과거의 파일 검색 폴백을 되살리지 않기 위한 의도적 처리.

1. **그래프 스코프 해석** — `src/lib/knowledge/graph-scope.ts`의 `resolveAllowedGraphIds(projectPath, graphPrefixFilter)`가 UI 접두사(예: `"casemap_"`)를 knowledge DB의 안정적인 `graphId` 목록으로 한 번만 변환한다. 이 동일한 `allowedGraphIds`가 아래 두 조회 모두에 전달되어, 문서 검색과 그래프 컨텍스트가 항상 같은 그래프 집합을 대상으로 하도록 보장한다.
2. **Section 후보 검색** — `src/lib/knowledge/section-search.ts`의 `searchSectionCandidates(projectPath, query, allowedGraphIds)`:
   - `db/` 아래 모든 `.md` 파일을 `parseMarkdownV2()`로 파싱하고, 각 section을 `getKnowledgePage()`/`getKnowledgeSection()`으로 knowledge DB의 현재 `pageId`/`sectionId`와 대조한다. 경로가 어긋나거나 DB에 없는 stale 문서는 후보에서 완전히 제외된다 (경로 기반 호환 레이어 없음).
   - `findMatchedRanges()`(`chat-citations.ts`)로 질의 토큰이 실제로 등장하는 section만 후보로 남긴다.
   - `allowedGraphIds`가 주어지면, knowledge DB의 그래프 스냅샷들을 조회해 각 section이 근거로 쓰인 assertion(`evidence.sectionId`)이 있는지 확인하고, 해당 그래프 범위 밖의 section은 제거한다.
   - `traverseKnowledgeGraph()`로 후보 페이지들에서 그래프를 따라가며(`maxCost=3`, `maxGraphSwitches=2`) 연결된 assertion의 `graphPath`를 채운다.
   - 최종적으로 각 후보에 `assertionIds`, `evidenceState`(`documented`/`manual`/`contradicted`), `graphPath`를 부여하고, section의 `ordinal` 순으로 정렬해 상위 12개만 반환한다.
3. **Knowledge Graph 컨텍스트** — `src/lib/graph-qna.ts`의 `getGraphContext(question, projectPath, projectName, llmConfig, allowedGraphIds)`:
   - `loadKnowledgeGraphContexts()`(`knowledge/graph-context.ts`)로 스코프 내 그래프들의 스냅샷과 relation type 목록을 knowledge DB에서 직접 로드한다 (`graph-policy.json` 같은 별도 설정 파일 없음).
   - LLM에게 질문과 그래프별 relation type 목록을 넘겨, 그래프별로 관련 `relationTypes`(열거형 질문용)와 `entities`(엔티티 중심 질문용)를 JSON으로 추출받는다 (`selectRelevantGraphs`).
   - 추출된 조건으로 그래프 스냅샷의 `assertions`를 필터링(최대 80개, `RELATION_LIMIT`)해 `주어 --predicate--> 목적어` 형태의 라인으로 조립한다.
   - 아무 그래프도 선택되지 않거나 결과가 없으면 `[]`를 반환하며, 호출부는 이를 "그래프 근거 없음"으로 취급해야 한다.
   - `formatGraphContextBlocks()`가 `## Knowledge Graph Context` 섹션으로 조립하지만, 현재 Chat은 이 텍스트를 system prompt에 직접 삽입하지 않는다 — 아래 Step 2 참고.

### [Step 2] Citation 발급 + System Prompt 조립
- `src/lib/chat-citations.ts`의 `issueCitationMap(sectionCandidates)`가 Step 1의 section 후보마다 짧은 랜덤 키(`[CIT:xxxxx...]`)를 발급한다. 같은 `pageId:sectionId` 조합은 한 번만 citation entry가 된다.
- 그래프 컨텍스트(`graphBlocks`)는 두 번째 인용 불가능한 문서 소스로 프롬프트에 주입되지 않는다 — `noGraphContext = graphBlocks.length === 0` 플래그만 system prompt의 규칙 문구를 조건부로 바꾸는 데 쓰인다. 즉, 그래프 정보는 "관련 그래프 근거 없음" 여부 판단에만 관여하고, section 후보만이 실제로 인용 가능한 컨텍스트다.
- `citationPrompt(citationEntries)`가 각 entry를 `[CIT:key] page_id=... section_id=... assertions=... evidence=... graph_path=...\n{section 본문}` 형태로 나열해 `## Citation Sections`로 삽입한다. 후보가 없으면 `"(No relevant wiki sections were found.)"`.
- system prompt 구성 순서: 규칙 섹션(citation 섹션에만 근거해 답변하라, `noRelevantDocs`/`noGraphContext` 조건부 경고, 복수 질문 분리 답변 지시, `[[CIT:key]]` 마커만 사용하고 키를 지어내지 말라는 지시) → `## Citation Sections` → 출력 언어 강제 지시(`## ⚠️ MANDATORY OUTPUT LANGUAGE`).
- `questionTypeId`가 있으면 `loadQuestionTypes()`로 타입을 찾아 system prompt 끝에 `## Answer Format` 섹션(fields 목록 + promptTemplate)을 덧붙인다.
- 언어 리마인더(`buildLanguageReminder`)는 system prompt에 넣지 않고, 대화 히스토리 뒤 마지막 사용자 메시지 앞에 삽입한다 — 일부 로컬 백엔드(vLLM/llama.cpp의 Qwen3 계열 Jinja 템플릿)가 "system은 맨 앞에만" 규칙을 강제해 중간 system 메시지를 거부하기 때문.
- 대화 히스토리는 `maxHistoryMessages`로 최근 N개만 포함.
- 인사말 경로(`greetingOnly`)에서는 위 전체를 건너뛰고 최소 system prompt만 사용하며, `citationEntries`는 빈 배열로 유지된다.

### [Step 3] LLM 스트리밍 답변 생성
- `src/lib/llm-client.ts` — `streamChat()`
- system + history + 사용자 질문 메시지를 LLM에 전달, 토큰 단위로 스트리밍.
- LLM은 답변 본문 중에 발급된 `[CIT:key]` 키를 정확히 `[[CIT:key]]` 마커로 인용하도록 지시된다 (과거의 `## Sources` + `<!-- cited: ... -->` 주석 방식은 폐기됨).
- 완료 후 `finalizeStream(accumulated, finalizeCitations(accumulated, citationEntries))`가 호출된다. `finalizeCitations()`(`chat-citations.ts`)가 답변 텍스트에서 `[[CIT:key]]` 마커를 스캔해, 발급된 키만 `StructuredCitation[]`으로 확정하고(미발급 키는 경고 로그 후 무시), 첫 매치 위치의 앞뒤 48자를 `prefix`/`suffix`로 저장해 나중에 원문에서 재위치를 찾을 수 있게 한다. 메시지의 `references` 필드로 저장된다.

### [Step 4] 렌더링
- `src/components/chat/chat-message.tsx`
- **본문**: `MarkdownContent` 컴포넌트가 렌더링한다.
  - `<!-- ... -->` 주석 제거, `## Sources` 섹션 제거(레거시 응답 호환).
  - `<think>`/`<thinking>` 블록은 접힌 "Thinking" 섹션으로 분리해서 표시 (스트리밍 중 미완성 블록도 처리).
  - JSON 형태 응답은 key-value 카드 레이아웃으로 렌더링.
  - `[[wikilink]]` 구문을 클릭 가능한 링크로 변환하고, LaTeX(`\begin{...}...\end{...}`)를 자동으로 `$$...$$`로 감싸 수식 렌더링. `[[CIT:key]]` 마커 자체는 본문에 남아 그대로 보이며 별도 제거 처리는 없다.
- **References 패널** (`CitedReferencesPanel`): `message.references`(`StructuredCitation[]`)를 그대로 번호 목록(`[1]`, `[2]`, ...)으로 표시한다. 과거처럼 페이지 타입별 아이콘(entity/concept/source/query 등)을 구분하지 않고, 각 항목은 인용된 `quotedText`만 보여준다.
  - 클릭 시 `setChatReferencePreview(citation)`으로 `chatReferencePreview` 상태를 설정해 우측 `ChatReferencePanel`을 연다.
  - `ChatReferencePanel`(`chat-reference-panel.tsx`)은 `getKnowledgePage()`로 현재 페이지 경로를 찾고, 해당 파일을 다시 파싱해 citation이 가리키는 section을 `locateCitation()`(quotedText + prefix/suffix 매칭, 실패 시 근거 없음 처리)으로 재위치시켜 하이라이트(`<mark>`)와 함께 보여준다. "그래프에서 열기" 버튼으로 Graph 탭에서 해당 파일을 열 수도 있다.

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
  - **RAG 버튼**: `⚡ RAG` 버튼으로 벡터 검색 ON/OFF 토글 UI는 남아 있다. `embeddingConfig.enabled`가 true이고 (`source === "builtin"` 이거나 `model`이 설정된 경우) 활성화 가능. 다만 현재 `handleSend`는 이 값을 section 검색에 반영하지 않는다(Step 1 참고) — RAG용 임베딩 검색 provider가 v2 retrieval에 아직 연결되지 않은 상태.
  - **Question Type 드롭다운**: 선택지 "None" + 로드된 질문 타입 목록. 고정 폭(`w-36`) 우측 정렬.
  - 선택한 타입 id와 RAG 여부가 `onSend(text, questionTypeId?, useEmbedding?)`로 전달된다.
- **Answer Format 주입**: Step 2 참고.
- 미선택 시 기존 자유 형식 답변이 유지된다.

---

## Casemap / Persona 탭의 scoped Chat

`ChatPanel`은 `useStore`(별도 conversation store)와 `graphPrefixFilter`를 props로 받아 재사용된다. `casemap-view.tsx`/`persona-view.tsx`는 자신만의 store와 `"casemap_"`/`"persona_"` 접두사를 넘겨, Step 1의 `resolveAllowedGraphIds()`가 해당 접두사로 시작하는 그래프만 허용 목록에 남기도록 한다 — 이 목록이 section 검색과 그래프 컨텍스트 조회 모두를 동일하게 제한한다. 메인 Chat 탭(`chat-bar.tsx`)은 `graphPrefixFilter` 없이 전체 그래프를 사용한다.
