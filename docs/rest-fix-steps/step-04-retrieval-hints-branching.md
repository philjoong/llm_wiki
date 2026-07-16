# Step 04 — `QuestionType.retrieval` 파싱 + `handleSend` 분기

계획서 §3.1. 선행 Step: 01–03.

## 목표

question type YAML에 `retrieval:` 블록을 선언하고, `handleSend`가 이를 읽어
유형별 retrieval 전략(홉 수·predicate 축·seed 전략)으로 분기한다.
UI 분기 플래그(`scope`, `include_history`)도 여기서 함께 파싱한다(소비는 Step 07/09).

## 변경 대상

| 파일 | 변경 |
|------|------|
| `src/lib/question-types.ts` | `RetrievalHints` 타입 + `parseYamlQuestionType`(L83-93)에 `retrieval` 파싱 |
| `schema/question_types/*.yaml` (4개) | `retrieval:` 블록 추가 |
| `src/lib/knowledge/` (신규 상수) | `PREDICATE_AXES` 상수 |
| `src/components/chat/chat-panel.tsx` | `handleSend`에서 힌트 해석 → `searchSectionCandidates` options 전달 + LLM 엔티티 seed |

## 작업 내용

1. **타입/파서** — `QuestionType`에 `retrieval?: RetrievalHints` 추가.
   ```ts
   type RetrievalHints = {
     graphExpand?: number;          // YAML: graph_expand — 승격 홉 수
     predicateAxes?: string[];      // YAML: predicate_axes — 축 이름 목록
     seed?: "llm_entities";         // YAML: seed — seed 전략
     includeHistory?: boolean;      // YAML: include_history — Phase 3 (Step 08/09)
     scope?: "selectable";          // YAML: scope — Phase 2 (Step 07)
   };
   ```
   지원 플래그는 이 **닫힌 집합**뿐. 알 수 없는 키는 무시. 플래그 미지정 유형은
   현재와 동일 동작(회귀 안전).
2. **predicate 축 상수** — TS 상수 하나로 관리:
   `PREDICATE_AXES = { dependency: ["DEPENDS_ON","AFFECTS","MODIFIES","DERIVES_FROM"] }`.
   Step 06의 ingest 지시와 **같은 목록을 공유**해 축적·소비가 어긋나지 않게 한다
   (Step 06 문서에서 이 상수를 단일 출처로 참조).
3. **YAML 4개 갱신** (§3.1 표):
   - `related_content`: `graph_expand: 3`, `scope: selectable`
   - `change_impact`: `graph_expand: 2`, `predicate_axes: [dependency]`
   - `new_system_impact`: `graph_expand: 2`, `predicate_axes: [dependency]`,
     `seed: llm_entities`, `scope: selectable`
   - `version_comparison`: `graph_expand: 0`, `include_history: true`, `scope: selectable`
4. **handleSend 분기** — 선택된 유형의 힌트를 해석해:
   - `graphExpand`/`predicateAxes`(축 이름 → `PREDICATE_AXES`로 predicate 목록 확장)를
     `searchSectionCandidates`의 `options`(Step 02)로 전달.
   - Graph Paths 블록(Step 03)은 `graphExpand > 0`일 때만 생성.
5. **`seed: llm_entities` (new_system_impact)** — lexical seed 대신,
   `getGraphContext`가 이미 수행하는 LLM 엔티티 추출(`selectRelevantGraphs`의
   `entities`, graph-qna.ts L110/L145)을 **재사용**해 entity alias exact-match로
   resolve한 뒤 `TraversalRequest.seedEntityIds`(이미 존재, types.ts L109)로 넘긴다.
   LLM 호출 추가 없음 — 기존 호출 결과 재사용. `handleSend`에서 `getGraphContext`
   호출(L226)과 `searchSectionCandidates` 호출(L222)의 순서 조정이 필요하면 조정한다
   (엔티티 추출 결과가 seed로 먼저 필요하므로).
6. **하드코딩 금지** — 컴포넌트 어디에도 type id로 분기하지 않는다.
   시점 선택기·범위 선택기 노출은 각각 `includeHistory`/`scope` 플래그로만 분기(후속 Step).
7. **테스트 작성** — YAML 파싱(4개 로드 회귀 + retrieval 블록 값), 축 이름 → predicate
   목록 확장, 미지정 유형의 기본 동작.

## 완료 조건 (정적 확인)

- [ ] `RetrievalHints` 타입과 파서가 닫힌 플래그 집합만 받는다.
- [ ] YAML 4개에 §3.1 표와 일치하는 `retrieval:` 블록이 있다.
- [ ] `PREDICATE_AXES` 상수가 단일 파일에 정의되어 있다.
- [ ] `handleSend`가 힌트를 `searchSectionCandidates` options로 전달하고,
      `seed: llm_entities` 경로에서 `seedEntityIds`가 채워진다.
- [ ] type id 하드코딩으로 분기하는 코드가 없다.
- [ ] vitest 테스트가 작성되어 있다.

## Step 14 이월 검증

- 기존 4개 YAML 로드 회귀.
- `change_impact` 선택 시 traversal 요청에 dependency predicate 목록이 실리는지.
- `new_system_impact` 선택 시 LLM 추출 엔티티가 `seedEntityIds`로 실리는지.
- 플래그 미지정 유형(일반 질문)이 기존과 동일 동작인지.
