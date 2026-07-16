# 목표: 각 question type에 맞는 답변 파이프라인 구축

각 question type이 "출력 형식"뿐 아니라 "무엇을 검색하고 어떻게 답하는가"까지
차별화되도록 만든다. 지금은 모든 유형이 동일 retrieval을 쓰고, question type은
system prompt에 "Answer Format" 섹션 한 조각만 덧붙인다
([chat-panel.tsx `handleSend`](../src/components/chat/chat-panel.tsx) L271-290).

확정 방향 (2026-07-15):
1. 홉 통제는 일괄이 아니라 **question type별 retrieval 전략**으로 선언한다.
2. `graph_expand`(홉 수)만으로는 부족하다 — 홉은 "얼마나 멀리"만 통제하고
   "어떤 엣지를 따라가는가"를 통제하지 못한다. 유형별로 predicate 축·seed 전략·
   히스토리 주입이 달라야 한다 (§3.1 표).
3. `DEPENDS_ON`/`AFFECTS`를 쌓는 것에 그치지 않고 **검색(traversal)이 소비**한다
   — predicate 필터 traversal (§3.2).
4. question type 답변 형식은 **JSON으로 통일**한다. md 답변 허용은 폐지 (§3.4).
5. LLM이 부족한 정보를 사용자에게 **역질문**하고, 사용자의 답을 컨텍스트 주입 +
   위키/그래프에 축적하는 루프를 추가한다 (§6, Phase 4).
6. traversal **경로 자체를 프롬프트에 주입**한다 — 현재는 그래프 컨텍스트가 프롬프트에
   한 줄도 실리지 않아(공백 D) `related_content.relation_paths`가 구조적으로 불가능하다 (§3.3).
7. ingest 후 git **자동 커밋은 하지 않는다**. version_comparison은 Sync 커밋 granularity를
   수용하고, 비교 시점은 **사용자가 과거 커밋을 선택**한다 — 직전 변경 시점뿐 아니라
   더 이전 상태와의 비교가 요구사항이다 (§5).
8. 유형별 UI(시점 선택기·범위 선택기)는 type id가 아니라 **question type YAML 플래그로
   분기**한다. 답변 범위 선택은 **change_impact를 제외한 세 유형 전부**에 적용 (§3.1, §4).
9. question type YAML에 **`required_info`(입력 계약)**를 선언해 역질문 루프의 완료 조건으로
   쓴다. 미충족 항목은 **인라인** active 입력 폼(라디오/텍스트/파일/링크 + "없음/모름" 필수)으로
   수집하고, 사용자가 줄 정보가 없으면 가진 정보 안에서 답한다. unavailable 마킹은 대화
   단위로만 유지. `file`/`link`는 ingest 완료 알림 후 **사용자가 수동 재전송** (§6).
10. lexical 랭킹 공백은 간단 스코어링이 아니라 **embedding 시맨틱 검색**으로 해소한다 —
    축적(LanceDB 인덱싱)은 이미 있으므로 소비(retrieval 병합)를 Phase 5로 신설 (§7).
    scope 통제 단위는 그래프+페이지/엔티티(§4), traversal 방향 자르기는 v2 확정 과제(§3.2),
    시점 선택기는 날짜/시간 중심 표시(§5 작업 4).

---

## 0. 관련 코드

- Chat 파이프라인: [chat-panel.tsx](../src/components/chat/chat-panel.tsx) (`handleSend`)
- Question type 로더: [question-types.ts](../src/lib/question-types.ts)
- Question type 스키마 seed: [fs.rs `seed_question_types`](../src-tauri/src/commands/fs.rs)
- 검색 범위 해석: [graph-scope.ts `resolveAllowedGraphIds`](../src/lib/knowledge/graph-scope.ts)
- Section 검색: [section-search.ts `searchSectionCandidates`](../src/lib/knowledge/section-search.ts)
- 그래프 컨텍스트: [graph-qna.ts `getGraphContext`](../src/lib/graph-qna.ts)
- Traversal(Rust): [commands.rs `traverse_knowledge_graph`](../src-tauri/src/knowledge/commands.rs) L466
- 그래프 스키마: [schema.rs](../src-tauri/src/knowledge/schema.rs)
- Ingest 그래프 추출: [ingest.ts `extractKnowledgeAssertionWrites`](../src/lib/ingest.ts)
- 단일 섹션 재추출 경로: [ingest.ts `reIngestDocument`](../src/lib/ingest.ts) (Phase 4에서 재사용)

현재 question type 목록 (`schema/question_types/`):
`change_impact`, `new_system_impact`, `related_content`, `version_comparison`.

---

## 1. 데이터 축적 진단 — 각 유형이 답할 수 있게 데이터가 쌓이고 있는가

각 유형이 "적합하게 답하려면 무엇이 필요한가"를 실제 파이프라인이 쌓는 것과 대조한 결과.
결론: **데이터가 부족한 건 relation의 의미축과 시간축 두 곳뿐이고, 그 외는 충분하다.**

| 유형 | 필요한 데이터 | 현재 축적 | 판정 |
|------|--------------|-----------|------|
| `related_content` | 엔티티 간 typed relation + evidence quote | `assertions` + `assertion_evidence`(quote/section_id) 완비, `traverseKnowledgeGraph`로 경로 추적 | **적합** |
| `change_impact` | "A를 바꾸면 B로 전이"되는 의존/영향 관계 | 방향성 있는 assertion은 있으나 predicate가 도메인 서술형(`ATTACKS`)이라 **의존/영향 의미축이 없음** | **부분적** |
| `new_system_impact` | 신규 요소 ↔ 기존 생태계 충돌 지점 | 위와 동일 + "신규"라는 개념(시간축)이 그래프에 없음 | **부분적** |
| `version_comparison` | 과거 상태 | DB는 현재 스냅샷만(upsert, sections DELETE 후 INSERT). 과거는 **git 히스토리에만** 존재하고(그마저 Sync 커밋 단위 — §5 전제 수정) retrieval은 안 봄 | **부적합** |

### 구조적 공백 두 가지

**공백 A — relation에 "영향/의존" 의미축이 없다** (change_impact / new_system_impact)
- assertion은 이미 유향 엣지다(`subject_entity_id → predicate → object_entity_id`,
  [schema.rs](../src-tauri/src/knowledge/schema.rs) `assertions`). `symmetric` 플래그로
  대칭/비대칭도 구분하고, traversal은 `TraversalStep.forward`로 엣지를 어느 방향으로
  탔는지까지 안다 ([model.rs](../src-tauri/src/knowledge/model.rs) L148). **방향성은 이미 있다.**
- 부족한 건 방향성이 아니라 **의미**다. `ATTACKS`/`GIVES`는 "무슨 행동인가"를 서술하지
  "변경이 전이되는가(DEPENDS_ON / AFFECTS / MODIFIES)"를 서술하지 않는다.
- 축적은 §2.1, **소비는 §3.2 predicate 필터 traversal** — 쌓기만 하고 안 쓰는 공백을 남기지 않는다.

**공백 B — 시간축이 없다** (version_comparison)
- `commit_ingest_plan`이 페이지를 upsert, 섹션을 DELETE 후 INSERT 한다
  (ingest-current-state §6). **이전 값은 DB에서 완전히 사라진다.**
- 유일한 과거 기록은 git 커밋. retrieval(`searchSectionCandidates`)은 `db/` 현재 파일만 파싱.
- 게다가 git 커밋은 ingest마다 생기지 않는다 — **사용자가 Sync를 누른 시점에만** 생긴다
  (§5 전제 수정). ingest-current-state.md §10의 "쓴 파일이 있으면 git commit 시도"는
  현재 코드와 다르다(문서가 오래됨).
- → 데이터 축적 방식을 바꾸거나 git을 읽지 않으면 version_comparison은 절대 못 답한다.
  프롬프트/플래그로 해결 불가.

**공백 C — retrieval이 그래프를 후보 확장에 쓰지 않는다** (검토에서 추가 발견)
- [section-search.ts](../src/lib/knowledge/section-search.ts) L85의 traversal은 이미
  lexical 매칭으로 찾은 후보의 `graphPath` 라벨(출처 메타데이터) 계산에만 쓰인다.
  **traversal hit이 새 후보 섹션을 추가하지 않는다.** 후보 집합은 오직
  `findMatchedRanges` 문자열 매칭으로 결정된다.
- [graph-qna.ts `getGraphContext`](../src/lib/graph-qna.ts)는 traversal 자체를 안 한다 —
  LLM이 고른 relation/entity로 스냅샷 assertion을 평면 필터링할 뿐, 홉 개념이 없다.
- → 어떤 홉 파라미터를 만들어도 **후보 승격(§3.3)이 먼저 구현되지 않으면 답변이 변하지 않는다.**

**공백 D — 그래프 컨텍스트가 프롬프트에 아예 주입되지 않는다** (related_content의 `relation_paths` 직격)
- [chat-panel.tsx](../src/components/chat/chat-panel.tsx) L224-228: `getGraphContext` 결과
  (graphBlocks)는 `noGraphContext` 플래그("관계를 못 찾았으면 솔직히 말하라" 규칙 추가 여부)
  계산에만 쓰이고 **내용은 버려진다** — 의도된 설계("uncitable second source 주입 금지" 주석).
- `citationPrompt`([chat-citations.ts](../src/lib/chat-citations.ts) L50)도 섹션 텍스트와
  표시 메타데이터만 담는다 — `SectionCandidate.assertionIds`/`graphPath`는 프롬프트에 실리지 않는다.
- → **LLM은 assertion을 한 줄도 보지 못한다.** `related_content.relation_paths`
  ("어떤 관계·경로로 연결되는지")는 섹션 prose에 관계 서술이 우연히 있을 때만 답할 수 있다.
  데이터(축적)는 §1 표대로 적합하지만, 소비 경로가 끊겨 있다. 해소는 §3.3의 경로 주입.

**공통 노트 — lexical 후보의 품질** (모든 유형의 seed에 영향)
- `findMatchedRanges`([chat-citations.ts](../src/lib/chat-citations.ts) L99)는 질문 토큰
  **아무거나 하나**만 매치돼도 후보로 삼는다(불용어 필터 없음 — "어떤", "시스템", "10초에서"도 토큰).
- 한국어는 조사가 붙은 토큰("결투장을")을 exact `indexOf`로 찾으므로 본문의 "결투장"과 매치 실패
  — 너무 느슨한 동시에 너무 깨지기 쉽다.
- 최종 후보는 relevance가 아니라 `ordinal` 정렬 후 12개 컷([section-search.ts](../src/lib/knowledge/section-search.ts) L88)
  — 매치 품질 랭킹이 없다. 위키가 커질수록 모든 유형의 답 품질이 이 지점에서 먼저 무너진다.
  Phase 1 범위에서는 §3.1의 seed 전략(new_system_impact의 LLM 엔티티 seed)으로 우회하고,
  근본 해소는 **embedding 시맨틱 검색 도입으로 확정**(2026-07-15) — Phase 5 (§7).

---

## 2. 아키텍처 판단 (확정)

### 2.1 edge 방향성 — 재축적 불필요, 의미축만 추가

방향성은 이미 있으므로 다시 쌓을 필요 없다. 대신 **데이터가 지금 비어 있어 재축적 비용이 0**이므로,
graph assignment 프롬프트에 의존/영향 축 predicate를 추가해 처음부터 제대로 쌓는다.

- [ingest.ts `extractKnowledgeAssertionWrites`](../src/lib/ingest.ts) 프롬프트에
  "요소 간 의존·영향 관계는 `DEPENDS_ON` / `AFFECTS` / `MODIFIES` / `DERIVES_FROM`
  계열 predicate로 추출하라"는 지시 추가. 기존 명명 규칙(`{purpose}_{subj}_{action}_{obj}`)과 병행.
- 검증: `object_cardinality`·`ENTITY_TYPES`·quote substring 등 기존 검증 경로 재사용(무변경).
- **소비처**: §3.2 predicate 필터 traversal이 이 축을 검색에 사용한다. 축적과 소비가
  같은 Phase 1 안에 있다.

### 2.2 SQLite로 충분 — graph DB 불필요

| 기준 | 현재 상황 | 판단 |
|------|-----------|------|
| 규모 | 게임 위키 1프로젝트, 엔티티/assertion 수천~수만 | SQLite 충분 |
| traversal 깊이 | `maxCost:3`, `maxGraphSwitches:2` — 얕은 다중홉 | 재귀 CTE로 커버 |
| 원자성 | 파일+DB 한 트랜잭션 커밋이 핵심 요구 | **SQLite journal이 이미 보장. graph DB로 가면 오히려 깨짐** |
| 배포 | Tauri 데스크톱 임베디드 | 외부 graph DB 서버는 배포 부담 |
| 구현 상태 | traversal/방향성/cardinality/evidence 전부 SQLite 위에 이미 동작 | 유지 |

graph DB는 수백만 노드 + 임의 깊이 홉 + 그래프 알고리즘이 필요할 때 값을 한다.
이 프로젝트는 어느 것도 아니다. 깊은 전이 폐쇄가 필요해지면 재귀 CTE / 인덱스 테이블로 해결.

---

## 3. Phase 1 — 유형별 retrieval 전략 + JSON 답변 통일

### 3.1 유형별 retrieval 전략 (홉 수 하나가 아니라 전략 선언)

`graph_expand`(홉 수)만으로 유형별 답을 만들 수 없다는 것이 확정 판단이다.
각 유형이 원하는 답과 그에 필요한 retrieval:

| 유형 | 원하는 답 | retrieval 전략 | YAML 선언 |
|------|-----------|----------------|-----------|
| `related_content` | 연관된 것 전부 | lexical 후보 → traversal 확장 → evidence 섹션 승격, 모든 predicate, 넓은 홉 | `graph_expand: 3`<br>`scope: selectable` |
| `change_impact` | A 변경 시 영향받는 것 | 의존축 predicate**만** 따라가는 traversal. 서사 엣지(`ATTACKS` 등)는 배제해 노이즈 차단 | `graph_expand: 2`<br>`predicate_axes: [dependency]` |
| `new_system_impact` | 신규 요소 ↔ 기존 충돌 지점 | 신규 요소는 그래프에 없다. 질문이 언급한 **기존** 엔티티를 seed로 삼되, lexical 매칭이 아니라 **LLM 엔티티 추출 → `seedEntityIds`**로 seed(아래 노트), 거기서 의존축 traversal | `graph_expand: 2`<br>`predicate_axes: [dependency]`<br>`seed: llm_entities`<br>`scope: selectable` |
| `version_comparison` | 과거와의 차이 | 그래프 확장 불필요. 현재 섹션 후보 + git 과거 본문 주입 | `graph_expand: 0`<br>`include_history: true` (Phase 3)<br>`scope: selectable` |

question type YAML에 `retrieval:` 블록을 추가하고 `handleSend`가 읽어 분기한다.
지원 플래그는 닫힌 집합: `graph_expand`(승격 홉 수), `predicate_axes`(축 이름 목록),
`seed`(seed 전략), `include_history`(Phase 3), `scope`(Phase 2). 플래그 미지정 유형은
현재와 동일 동작(회귀 안전).

**UI 분기도 같은 플래그가 구동한다** — 컴포넌트에 type id 하드코딩 금지:
- 시점 선택기(§5 작업 4)는 `include_history: true`인 유형에서만 노출 — 현재는
  version_comparison뿐이지만, 분기 기준은 어디까지나 플래그다.
- 범위 선택기(§4)는 `scope: selectable`인 유형에서만 노출 — **change_impact를 제외한
  세 유형 전부**(확정, 2026-07-15). change_impact는 질문이 변경 대상을 지정하고
  영향은 전체에서 찾아야 의미가 있으므로 범위 UI를 두지 않는다.

- 로더 확장: [question-types.ts `parseYamlQuestionType`](../src/lib/question-types.ts)에
  `retrieval` 필드 파싱 추가. `QuestionType`에 `retrieval?: RetrievalHints`.
- predicate 축 정의는 TS 상수 하나로 관리:
  `PREDICATE_AXES = { dependency: ["DEPENDS_ON","AFFECTS","MODIFIES","DERIVES_FROM"] }`
  — §2.1 ingest 지시와 같은 목록을 공유해 축적·소비가 어긋나지 않게 한다.
- **seed 노트 (new_system_impact)**: 신규 시스템을 길게 서술하는 질문에서 lexical seed는
  공통 노트(§1)의 이유로 취약하다(ANY-token 매치 + 조사 붙은 토큰 매치 실패 + 랭킹 없음).
  대신 `getGraphContext`가 이미 수행하는 LLM 엔티티 추출(`selectRelevantGraphs`의 `entities`,
  [graph-qna.ts](../src/lib/graph-qna.ts))을 재사용해 entity alias exact-match로 resolve한 뒤
  `TraversalRequest.seedEntityIds`([types.ts](../src/lib/knowledge/types.ts) L109 — **이미 존재**)로
  넘긴다. LLM 호출 추가 없이(기존 호출 결과 재사용) seed 품질만 올라간다.

### 3.2 predicate 필터 traversal (공백 A의 소비처)

`DEPENDS_ON`/`AFFECTS`를 저장만 하지 않고 검색이 사용한다.

- Rust: `TraversalRequest`에 `allowed_predicates: Option<Vec<String>>` 추가
  ([model.rs](../src-tauri/src/knowledge/model.rs) L144).
  [commands.rs](../src-tauri/src/knowledge/commands.rs) L494의 assertion 확장 SQL에
  `AND predicate IN (...)` 조건 추가 — 확장 지점이 한 곳이라 변경 규모가 작다.
  `graph_switch` 스텝은 predicate가 없으므로 필터와 무관(기존 동작 유지).
- TS 미러: [types.ts `TraversalRequest`](../src/lib/knowledge/types.ts) +
  [commands/knowledge.ts](../src/commands/knowledge.ts).
- 방향 처리: traversal은 양방향 확장이지만 `TraversalStep.forward`가 경로에 남으므로,
  경로를 컨텍스트로 줄 때 `A --DEPENDS_ON--> B` 형태로 방향을 보존해 LLM이
  영향 방향을 판단하게 한다. 방향 자체를 traversal에서 자르는 것(예: `DEPENDS_ON`은
  역방향만, `AFFECTS`는 순방향만 확장)은 **v2 확정 과제**(2026-07-15) — Phase 1은
  양방향+방향 라벨로 가고, v2에서 predicate별 의미 방향 선언과 함께 반드시 구현한다.

### 3.3 그래프 확장 retrieval — traversal hit을 후보로 승격 (공백 C 해소, 선행 작업)

이것이 없으면 `graph_expand`도 `predicate_axes`도 답변을 바꾸지 못한다.

- `searchSectionCandidates`에 `options?: { graphExpand?: number; allowedPredicates?: string[] }`
  추가. 내부 traversal(L85)의 `maxCost`를 `graphExpand`로 치환하고 `allowedPredicates`를 전달.
- **승격**: traversal hit 경로상의 assertion들에 대해 `assertion_evidence.section_id`를 역참조해,
  lexical 후보에 없던 섹션을 `SectionCandidate`로 추가한다. `matchedRanges`는 evidence quote
  위치(quote를 섹션 본문에서 재탐색)로 채우고, 실패 시 빈 배열(citation은 key만으로 동작).
- 승격 후보는 별도 상한(예: 8개)을 두고 기존 lexical 상한 12개와 분리 — lexical 결과를
  밀어내지 않는다. `graph_expand: 0`이면 승격 없음(현재 동작).

**경로 주입 (공백 D 해소)** — 섹션 승격과 별개의 필수 작업:
- traversal hit의 경로를 `A --DEPENDS_ON--> B --AFFECTS--> C` 형태(§3.2의 방향 보존)로
  system prompt에 "Graph Paths" 블록으로 주입한다. 승격이 "근거 섹션 본문"을 주는 것이라면,
  이것은 "관계 구조 자체"를 준다 — `related_content.relation_paths`와
  `change_impact`의 전이 경로 설명은 이 블록 없이는 근거 있게 채울 수 없다.
- citation 정합성: 경로상 assertion의 evidence 섹션이 승격(위)으로 후보에 함께 들어가므로,
  경로 라인 옆에 해당 섹션의 `[CIT:key]`를 병기해 "uncitable second source" 문제
  (chat-panel.tsx L224 주석의 원래 우려)를 해소한다 — 인용 불가능한 소스가 아니게 된다.
- `graph_expand: 0`(version_comparison 등)이면 이 블록도 생성하지 않는다.

### 3.4 답변 형식: JSON으로 통일 (md 답변 폐지)

여러 LLM 호환을 위해 md 답변을 허용하던 것을 폐지하고, question type 선택 시
**항상 YAML `fields` 계약대로 JSON을 강제**한다.

- **프롬프트 충돌 제거**: 유형 선택 시 base 프롬프트의 "Use markdown formatting" 줄을
  제거하고 "Return ONLY a single JSON object with these keys" 지시로 대체.
  ([chat-panel.tsx](../src/components/chat/chat-panel.tsx) L250과 Answer Format 병합부).
- **템플릿 플레이스홀더 정리**: 현재 `qt.promptTemplate`는 치환 없이 그대로 붙어
  리터럴 `{{context}}`/`{{question}}`이 프롬프트에 들어간다(기존 버그). context는
  Citation Sections로, question은 user 메시지로 이미 전달되므로 **치환을 구현하지 않고
  YAML seed에서 플레이스홀더를 삭제**한다 — 템플릿은 지시문 전용.
- **파싱은 렌더 타임**: 메시지는 raw 문자열로 저장하고, 렌더러가 매번
  코드펜스 스트리핑([ingest.ts](../src/lib/ingest.ts) L1302 패턴 재사용) 후 `JSON.parse`.
  onDone 일회성 교체가 아니므로 대화 리로드 후에도 카드가 유지된다.
- **스트리밍 중**: 원본 텍스트 그대로 표시. 완료 후 파싱 성공 시 필드별 카드,
  **실패 시 원본 텍스트 fallback**(로컬 모델의 JSON 이탈 대비 최후 안전망).
- **citation**: 각 JSON 필드 값은 마크다운 문자열이고 `[[CIT:key]]` 마커를 유지.
  `finalizeCitations`는 regex 기반이라 raw JSON 전체에도, 필드별 재실행에도 동작(확인됨).
  별도 sources 배열 필드는 두지 않는다.

```json
{
  "affected_pages": "- 스킬 A [[CIT:3]]\n- 시스템 B [[CIT:7]]",
  "update_candidates": "- 밸런스 시트 [[CIT:3]]"
}
```

### 3.5 Phase 1 작업 항목 (의존 순서)

1. **predicate 필터 traversal** (Rust + TS 미러, §3.2)
   → verify: Rust 테스트 — `allowed_predicates:["DEPENDS_ON"]`일 때 `REL` 엣지 미확장.
2. **그래프 확장 retrieval — 후보 승격** (§3.3)
   → verify: lexical 매칭 안 되는 섹션이 traversal 경유로 후보에 추가되는지,
   `graph_expand: 0`이면 기존과 동일한지(회귀).
3. **경로 주입 — "Graph Paths" 블록** (§3.3 경로 주입, 공백 D)
   → verify: `related_content` 질문에서 프롬프트에 방향 보존 경로 라인이 실리고,
   답변의 `relation_paths`가 그 경로를 citation과 함께 서술하는지.
   그래프에 관계가 없으면 블록이 비고 기존 empty-state 규칙이 유지되는지.
4. **`QuestionType.retrieval` 파싱 + `handleSend` 분기** (§3.1, `seed: llm_entities` 포함)
   → verify: 기존 4개 YAML 로드 회귀 + `change_impact` 선택 시 traversal 요청에
   dependency predicate 목록이 실리는지 + `new_system_impact` 선택 시 LLM 추출 엔티티가
   `seedEntityIds`로 실리는지.
5. **JSON 통일** (§3.4: 프롬프트 교체 + YAML seed 플레이스홀더 삭제 + 렌더 타임 파싱 +
   필드 카드 + 필드별 citation)
   → verify: 파싱 성공/실패 두 경로 실제 렌더, 카드 안 citation 링크 동작,
   대화 리로드 후 카드 유지.
6. **ingest 프롬프트에 의존/영향 predicate 추출 지시** (§2.1)
   → verify: 샘플 문서 ingest 후 `DEPENDS_ON`류 assertion이 graph 탭에 생성,
   `change_impact` 질문에서 해당 엣지가 traversal 경로에 나타나는지.

---

## 4. Phase 2 — 답변 범위(scope) 통제 (별도, 나중)

**change_impact를 제외한 세 유형 전부**가 사용자에게서 답변 범위를 받는다(확정, 2026-07-15):
`related_content`는 "이 범위 안에서만 연관을 찾아라", `new_system_impact`는 "기존 생태계 중
어디를 점검할지", `version_comparison`은 "어떤 콘텐츠를 비교할지"가 범위다.
노출 여부는 §3.1의 `scope: selectable` 플래그로 분기한다(type id 하드코딩 금지).
이를 실제로 강제하려면 UI + retrieval 필터가 필요 — 지금은 프롬프트로 부탁하는 수준.

### 현재 한계
- 검색 범위는 [graph-scope.ts `resolveAllowedGraphIds`](../src/lib/knowledge/graph-scope.ts)로
  **그래프 이름 프리픽스 단위**로만 좁힐 수 있다. 대화 중 특정 시스템/콘텐츠를 지목하는 UI가 없다.
- `handleSend`는 allowlist를 `searchSectionCandidates`와 `getGraphContext`에 동일하게 넘긴다
  — 통제 지점 자체는 존재한다.

### 작업 (규모: 중)
1. **범위 선택 UI** — Chat 입력/참조 패널에 범위 선택기. 후보는 그래프(system) 또는
   엔티티/페이지(content). 다중 선택. 소스: `listKnowledgeGraphs`, entity/page 조회 커맨드.
2. **allowlist 확장** — 그래프 단위는 기존 경로로 바로. **콘텐츠(페이지/엔티티) 단위는
   `searchSectionCandidates`에 page/entity 필터 인자 추가 필요** (현재 `db/` 전체 순회 후
   allowedGraphIds로만 거름) — 시그니처 변경이라 범위가 커진다. §3.3에서 `options` 인자를
   이미 도입하므로 같은 자리에 얹는다.
3. **상태 보존** — 선택 범위를 대화 단위로 유지(권장), 사용자가 바꿀 때까지.

### 검증
- 범위를 시스템 A로 한정 시 시스템 B 페이지가 citation 후보/그래프 컨텍스트에서 제외되는지
  (실제 retrieval 결과 관찰, 프롬프트 지시가 아니라).
- 범위 미선택 시 기존 동작(전체 그래프)과 동일한지 회귀 확인.

### 확정 (2026-07-15)
- 통제 단위는 **그래프 + 페이지/엔티티까지** — related_content description의
  "특정 시스템·콘텐츠" 지정을 충족한다. 작업 2의 콘텐츠 단위 필터가 필수 범위에 포함된다.

---

## 5. Phase 3 — 과거 버전 비교 (별도, 나중)

`version_comparison`이 과거 상태를 답하려면 git 히스토리를 retrieval에 끌어와야 한다(§1 공백 B).
데이터 축적 방식은 바꾸지 않고 **git에서 읽기 전용 조회**로 조달한다(확정).

### 전제 수정 — git 커밋은 Sync 시점에만 생긴다 (검토에서 발견)

- ingest-current-state.md §1/§10은 "쓴 파일이 있으면 git commit 시도"라고 하지만,
  **현재 코드의 ingest 경로에는 git 호출이 없다**(`ingest.ts`/`ingest-queue.ts`에서
  `gitCommit` 참조 0건 — `ingest.dismissal-context.test.ts`의 mock은 과거 잔재).
  커밋이 생기는 곳은 (a) 사용자가 Sync를 눌렀을 때
  [App.tsx `handleSync`](../src/App.tsx)의 `gitSyncCommit`("sync: update knowledge database"
  일괄 커밋), (b) restore/revert([git-history.ts](../src/lib/git-history.ts))뿐이다.
- → 과거 상태의 해상도가 "ingest 단위"가 아니라 "Sync 단위"다. Sync를 안 누르면
  과거가 전혀 안 남고, Sync 사이의 여러 ingest는 한 커밋으로 뭉개진다.
- **확정 (2026-07-15)**: ingest 후 자동 커밋은 **하지 않는다**. Sync granularity를 수용한다.
  결과적으로 "비교 가능한 과거 시점 목록" = 커밋 목록이며, 사용자가 그중 하나를 골라
  그 시점과 비교하는 것이 이 유형의 핵심 UX다(작업 3·4). Sync를 한 번도 안 한 프로젝트는
  비교할 과거가 없으므로 "과거 정보를 확인할 수 없다"고 답한다(프롬프트 규칙 기존 유지).

### 작업 (규모: 중~대)
1. **과거 버전 조회 커맨드 신설** — `git show <hash>:<path>`에 해당하는 읽기 전용
   Tauri 커맨드가 **현재 없다**. [git-history.ts](../src/lib/git-history.ts)의
   `loadFileDiff`는 diff만 반환하고 `restoreFileFromCommit`은 working tree를 변경+커밋하므로
   재사용 불가. 새 커맨드(예: `git_show_file`) + TS 래퍼를 만든다.
2. **컨텍스트 주입** — `retrieval.include_history: true`인 유형이 선택됐을 때만(§3.1 플래그),
   현재 section 후보에 대응하는 과거 버전 본문을 system prompt에 함께 넣는다.
3. **비교 대상 시점 — 기본값** — 사용자가 시점을 고르지 않았을 때는 리포지토리 HEAD~1이
   아니라 **그 파일 내용이 현재와 달라지는 가장 최근 커밋**을 쓴다(`git log -- <path>`를
   따라가며 working tree 내용과 비교). HEAD~1은 마지막 커밋이 다른 페이지만 바꿨을 때
   "변화 없음"(zero_residue) 오답을 낸다. 또한 비교의 "현재"는 HEAD가 아니라
   **working tree 파일**이다 — 수동 Sync 구조상 working tree가 HEAD보다 앞서 있는 것이 보통이다.
4. **비교 시점 선택 UI** (확정 요구사항 — "직전"만이 아니라 더 이전 상태와의 비교가 필요) —
   `include_history: true`인 유형(§3.1 플래그 분기 — 현재는 version_comparison뿐)을
   선택했을 때만 Chat 입력부에 시점 선택기를 노출한다.
   - 후보 목록은 **repo 커밋 목록**(기존 `listCommits`/`gitLog` 재사용, Sync 커밋이 대부분)
     — "그 시점의 위키 전체"와 비교하는 의미론. 파일별 커밋 목록이 아닌 이유: 질문 시점에는
     retrieval이 아직 안 돌아서 **어느 페이지가 대상인지 모른다**. 시점을 먼저 고르고,
     retrieval이 찾은 후보 파일들을 그 커밋 기준으로 `git_show_file` 조회한다
     (그 시점에 파일이 없으면 "당시 존재하지 않음"으로 주입).
   - 선택 없으면 작업 3의 기본값(파일별 최근 변경 커밋).
   - 선택한 시점은 대화 단위로 유지(Phase 2의 scope 상태 보존과 같은 원칙).
   - 표시 형식(확정, 2026-07-15): **날짜/시간 중심 목록** — 상대 시간("3일 전") +
     절대 날짜로 표시하고 해시는 숨긴다. Sync 커밋은 메시지가 전부 동일하므로,
     커밋 메시지는 sync가 아닌 커밋(restore 등)에만 보조로 노출한다.

### 미결정
- 페이지 rename/split이 있었던 경우 과거-현재 대응을 어떻게 맞출지.
  단서: `sectionId`(`{#sec-ULID}`)가 본문에 박혀 있어 과거 버전에서도 같은 섹션을 ID로
  찾을 수 있다 — rename은 `git log --follow`, split은 `git log -S "sec-..."`로 추적 가능.

---

## 6. Phase 4 — 정보 역질문 루프: 답변하면서 DB를 쌓는다

사용자가 질문했을 때 retrieval된 컨텍스트로 부족하면, LLM이 **필요한 정보를 사용자에게
역질문**한다. 사용자가 답하면 (a) 그 답이 다음 턴 컨텍스트로 주입되어 원래 질문에 답하고,
(b) 같은 답을 위키/그래프에 축적한다. 질문 응대가 곧 DB 구축이 되는 루프.

### 설계

0. **유형별 필요 정보 목록 (`required_info`) — 역질문의 완료 조건** —
   question type YAML에 "이 유형에 답하려면 무엇이 필요한가" 체크리스트를 선언한다.
   `fields`가 출력 계약이라면 `required_info`는 **입력 계약**이며, 이것이 없으면
   LLM이 무엇을 물을지·언제 그만 물을지 판단할 기준이 없다.
   ```yaml
   required_info:
     change_target: 변경 대상 요소 (질문에서 특정)
     change_detail: 변경 내용 — 전/후 값 또는 규칙 (질문 또는 역질문)
     dependency_map: 대상 요소의 의존/영향 관계 (위키/그래프에서 조달)
   ```
   유형별 초안 (조달처: 질문 텍스트 / retrieval / 사용자):
   | 유형 | required_info 후보 |
   |------|-------------------|
   | `change_impact` | 변경 대상 요소(질문) / 변경 내용 전·후(질문·역질문) / 의존·영향 관계(그래프) |
   | `new_system_impact` | 신규 시스템의 핵심 동작·규칙(질문·역질문) / 점검할 기존 시스템·콘텐츠(범위 선택·그래프) |
   | `related_content` | 대상 콘텐츠(질문) / 답변 범위(범위 선택, 선택사항) |
   | `version_comparison` | 대상 콘텐츠(질문) / 비교 시점(시점 선택 UI 또는 기본값) / 과거 본문(git) |
   Phase 2의 범위 선택과 Phase 3의 시점 선택은 required_info 중 일부를 **질문 전에
   미리 수집하는 특수 UI**로 볼 수 있다 — 같은 개념의 두 시점(사전/사후) 수집이다.
   **완료 조건**: 모든 항목이 충족(fulfilled)이거나 사용자 제공 불가(unavailable)로
   마킹되면 더 묻지 않는다. unavailable 항목이 있어도 **가진 정보 안에서 답하고
   한계를 명시**한다 — "정보가 없어서 답변 불가"로 끝내지 않는다.
1. **역질문 출력 계약** — §3.4 JSON 계약에 예약 키 `information_requests`를 추가.
   각 요청은 required_info의 어느 항목인지(`info_key`)와 입력 방식 힌트(`input_type`)를 갖는다:
   ```json
   {
     "affected_pages": "...(아는 만큼 답변)...",
     "information_requests": [
       { "info_key": "change_detail",
         "question": "스킬 A의 재사용 대기시간 상한이 어디에 정의되어 있나요?",
         "reason": "영향 범위 판단에 필요하나 위키에 없음",
         "input_type": "text",
         "options": [] }
     ]
   }
   ```
   `input_type`은 `"choice" | "text" | "file" | "link"` 닫힌 집합, `options`는
   `choice`일 때 라디오 후보. 프롬프트 지시: "required_info 각 항목의 충족 여부를
   판정하라. 컨텍스트에 없는 정보가 답변에 필요하면 추측하지 말고 미충족 항목만
   `information_requests`에 담아라. 아는 부분은 답하고, 모르는 부분만 물어라.
   사용자가 이미 '없다'고 답한 항목은 다시 묻지 말라."
   기존 "정직하게 없다고 말하라" 규칙의 구조화 버전이다.
2. **UI — active 입력 폼** — `information_requests`가 있으면 답변 카드 아래에 요청별
   입력 폼을 활성 상태로 렌더한다. **확정: 모달이 아니라 인라인 폼** — 대화 흐름을
   차단하지 않고, 사용자는 폼을 무시하고 그냥 채팅으로 답할 수도 있다. `input_type`별:
   - `choice`: 라디오 버튼(`options`) + "기타(직접 입력)" 항목
   - `text`: 텍스트 박스
   - `file`: 파일 업로드 — **기존 raw file injection 큐로 그대로 투입**
     (icon-sidebar의 ingest 경로 재사용). ingest되면 다음 턴 retrieval이 자연히 찾는다.
   - `link`: URL 입력 — 기존 URL injection 경로 재사용.
   - 공통: **"이 정보는 없음/모름" 버튼(필수)** — 해당 `info_key`를 unavailable로 마킹하는
     구조화 응답을 대화에 넣는다. 이것이 루프의 종료 조건을 만든다(§0).
     **확정: unavailable 마킹은 대화 단위로만 유지** — 영속화하지 않는다. 위키에 정보가
     나중에 추가되면 새 대화에서 다시 조달된다.
   폼 제출 결과는 `info_key`를 명시한 일반 user 메시지로 대화에 들어간다 —
   별도 주입 채널 불필요(아래 3과 동일 원리).
   **`file`/`link`의 재개는 수동(확정)** — ingest가 끝나도 원 질문을 자동 재실행하지
   않는다. 대신 **ingest 완료 알림**을 보낸다:
   - 인앱(기본): ingest 큐 완료를 [activity-panel.tsx](../src/components/layout/activity-panel.tsx)의
     기존 큐 상태에 더해, 해당 역질문 카드에 "반영 완료 — 다시 질문" 배지 + 재전송 버튼으로 표시.
     재전송 버튼은 원 질문을 같은 question type으로 다시 보낸다.
   - OS 알림(윈도우 토스트): `tauri-plugin-notification`이 **현재 미설치**라 플러그인
     추가가 선행 — 인앱 알림 이후의 후속 작업으로 둔다.
3. **주입** — 별도 메커니즘 불필요: 사용자의 답은 대화 히스토리로 다음 턴에 자연히
   포함된다(`maxHistoryMessages` 내). LLM은 이전 턴의 자기 역질문 + 사용자 답을 보고
   원래 질문에 마저 답한다.
4. **축적** — 사용자의 답 카드에 "위키에 저장" 액션:
   - **저장 위치는 LLM 자동 제안 + 사용자 승인(확정, 2026-07-15)** — LLM이 기존 페이지의
     섹션 추가 또는 신규 페이지 생성을 제안하고(둘 다 허용), 사용자는 승인하거나 다른
     위치로 변경한다. 제안 로직은 decomposition이 이미 하는 page_path 결정(dbIndex를
     프롬프트에 주입해 기존 페이지 재사용 유도)을 재사용한다.
   - **저장 전 검수 단계는 두지 않는다(확정, 2026-07-15)** — 답한 사람 = 저장하는
     사람이라 검수가 자기 확인에 불과하다. 대신 assertion `origin`을 `user_chat`으로
     남겨 추적 가능하게 한다. `origin` 컬럼은 이미 존재하나
     ([schema.rs](../src-tauri/src/knowledge/schema.rs) L13 `CHECK(origin IN ('ingest','manual'))`)
     허용값에 `user_chat` 추가가 필요 — SQLite CHECK 변경이라 마이그레이션(테이블 재생성) 필요.
   - 승인 후 기존 ingest 경로로 커밋 — 섹션 저장 + `extractKnowledgeAssertionWrites`로
     assertion 추출까지 기존 파이프라인 재사용
     ([reIngestDocument](../src/lib/ingest.ts) L1390의 sectionId 경로 참고).
   - 채팅 메시지 "Save to Wiki" 버튼([chat-message.tsx](../src/components/chat/chat-message.tsx))이
     이미 있으므로 UX·코드 모두 그 연장선에 둔다.
   - 이렇게 저장된 내용은 다음 질문부터 일반 retrieval로 검색된다 — 루프 완성.

### 검증
- 위키에 없는 정보를 요구하는 질문 → `information_requests`가 생성되는지(환각으로
  채우지 않는지), 각 요청이 그 유형의 `required_info` 항목에 대응하는지.
- 사용자 답 → 다음 턴 답변에 반영되는지, 같은 항목을 다시 묻지 않는지.
- **모든 미충족 항목을 "없음/모름"으로 마킹** → 재질문 없이 가진 정보 안에서 답하고
  한계를 명시하는지 (종료 조건 검증).
- `file`/`link` 응답 → ingest 완료 후 재질문 시 해당 내용이 citation으로 반영되는지.
- "위키에 저장" → 페이지/섹션 + assertion 생성 → **새 대화에서** 같은 질문 시
  역질문 없이 citation과 함께 답하는지 (루프의 end-to-end 검증).

### 미결정
- 없음 — Phase 4의 모든 설계 결정이 확정됐다.

(2026-07-15 확정으로 이동: 인라인 폼(모달 아님)·"없음/모름" 버튼 필수 — 설계 2,
`file`/`link` 재개는 수동 재전송 + ingest 완료 알림(인앱 기본, OS 토스트는 플러그인 추가 후) — 설계 2,
unavailable 마킹은 대화 단위로만 유지 — 설계 2,
저장 위치는 LLM 자동 제안 + 사용자 승인(신규 페이지 제안 허용) — 설계 4,
저장 전 검수 없음 + `origin: user_chat` 태그 — 설계 4.)

---

## 7. Phase 5 — embedding 시맨틱 검색 (lexical 랭킹 공백 해소)

§1 공통 노트의 랭킹 공백을 간단 스코어링이 아니라 **embedding 검색 도입**으로 해소한다
(확정, 2026-07-15). new_system_impact의 개념 매칭(이름이 다른 유사 시스템 찾기)도 함께 좋아진다.

### 이미 있는 것 — 축적은 완료, 소비만 끊겨 있다

- 인덱싱: [embedding.ts `embedPage`](../src/lib/embedding.ts) — 페이지를 chunk 단위로
  LanceDB에 업서트. ingest가 `IngestPlan.embeddingJobs`로 이미 호출한다(설정 on일 때).
  `embedAllPages`(일괄 재인덱싱)·`removePageEmbedding`(삭제 연동)도 있다.
- 검색: [embedding.ts `searchByEmbedding`](../src/lib/embedding.ts) — chunk 검색 후
  페이지 단위 blended score로 랭킹, `matchedChunks`(top 3 chunk 텍스트/headingPath) 포함.
- UI 계약: ChatInput의 `useEmbedding` 인자가 이미 있고 handleSend가 void 처리 중
  ([chat-panel.tsx](../src/components/chat/chat-panel.tsx) L178-182).

### 작업 (규모: 중)

1. **ID 정합** — LanceDB의 `page_id`는 경로 기반(`pageIdFromRelPath` — 경로를 `_`로
   이어붙인 문자열)이고 v2 페이지의 `page_id`는 frontmatter ULID다. `embedPage` 호출부가
   v2 `page_id`를 쓰도록 통일한다(일괄 재인덱싱 1회 필요 — `embedAllPages` 재사용, 권장).
2. **chunk → 섹션 대응** — LanceDB chunk는 `chunkMarkdown` 청크라 sectionId를 모른다.
   `matchedChunks` 텍스트를 섹션 본문에서 재탐색해 섹션을 결정한다(§3.3 승격의 quote
   재탐색과 같은 패턴, 실패 시 페이지 첫 섹션 폴백).
3. **retrieval 병합** — `searchSectionCandidates`에 embedding provider 추가:
   lexical 후보 + embedding 후보(+ §3.3 graph 승격 후보)를 병합하고, embedding score를
   1차 정렬 키로 써서 12개 컷. embedding 설정 off거나 인덱스가 비면 기존 lexical-only
   동작(회귀 안전) — `useEmbedding` 인자가 이 분기를 다시 살린다.

### 검증

- lexical로 안 잡히는 동의어/개념 질문(명칭이 다른 유사 시스템)이 embedding 경유로
  후보에 들어오는지 — new_system_impact 질문에서 관련 기존 시스템이 상위에 오는지.
- embedding off 시 기존과 완전히 동일한지(회귀).
- ID 통일 후 재인덱싱된 인덱스에서 삭제 연동(`removePageEmbedding`)이 여전히 동작하는지.

### 미결정

- 인덱스를 처음부터 섹션 단위로 재구성할지 — chunk 재탐색(작업 2)으로 시작하고,
  재탐색 실패율이 실측으로 문제가 되면 그때 재구성.
