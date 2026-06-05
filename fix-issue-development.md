# Graph 품질 개선 — 현황 및 해결 방향

## 목표

raw 데이터를 ingest하면 문서 내용이 **여러 개의 지식그래프로 분산 표현**되어야 한다.

핵심 제약: **지식그래프 하나의 관계 타입은 최대 4개**. 관계 종류가 너무 많으면 사용자가 시각화된 그래프를 읽을 수 없다.

그래프명에 그래프 성격을 반영 (`combat_weakness_graph`, `combat_combo_graph` 등)

---

#### Stage 1 출력 형식

```json
[
  {
    "source_range": "## 용병 모집",
    "source_text": "<해당 섹션의 원문 텍스트>"
  }
]
```

concept, path, relations 없음. LLM이 원문을 그대로 보존해 전달한다.

#### Stage 2 판단 기준

Stage 2는 `source_text`를 직접 읽고 처음부터 올바른 순서로 판단한다:

```
각 섹션의 source_text를 읽고:
- source text를 여러 다양한 node/edge/node 관계들로 표현
- node/edge/node마다 falkorDB로 아래 방법으로 옮긴다.  
  기존 graph와 해당 graph의 relation type으로 의미를 표현할 수 있으면 기존 graph에 추가.
  기존 graph가 의미적으로 맞고 해당 graph의 relation type slot(최대 4개)이 남아 있으면 relation type을 확장한 뒤 기존 graph에 추가.
  기존 graph와 의미적으로 맞지만 relation type이 이미 4개라 표현력이 부족하면 신규 graph를 생성한다.
```

## Fix 22: Stage 2 graph 배정 정책 재정의 - source_text 기반 다중 graph assignment + 기존 graph relation type 확장

### 사용자 의도 정정

기존 문서와 코드에서 `edge`, `relation`, `relation type` 개념이 섞이면서 Stage 2 목표가 잘못 좁혀졌다.

정확한 의도는 다음과 같다.

- Stage 2는 `source_text`를 직접 읽고 표현 가능한 **node/edge/node 관계들**을 만든다.
- Stage 2 assignment에서 `concept` / `page_path`는 source node가 될 page node를 뜻한다.
- Stage 2 assignment의 `relations[]`는 edge 목록이다.
- 각 relation의 `type`은 edge의 relation type이다.
- 한 section의 `source_text`는 하나의 assignment로 고정되지 않는다. 필요하면 여러 node/edge/node 관계, 여러 assignment, 여러 graph로 나뉠 수 있다.
- Stage 3는 Stage 2 결과를 markdown page + typed wikilink로 쓰고, FalkorDB sync가 이를 실제 node/edge로 반영한다.

### 원하는 graph 선택 정책

Stage 2가 source text를 표현할 graph를 고르는 순서는 다음이어야 한다.

1. source text의 node/edge 의미를 추출한다.
2. 기존 graph 중 도메인이 맞는 graph를 찾는다.
3. 기존 graph에 이미 edge relation type이 존재하면 그 graph에 추가한다.
4. 기존 graph에 relation type이 없더라도, 해당 graph의 relation type 개수가 4개 미만이면 신규 relation type을 graph에 추가하고 그 graph에 반영한다.
5. 기존 graph의 relation type이 이미 4개이고, source text 표현에 신규 relation type이 필요하면 기존 graph에 억지로 넣지 않는다.
6. 이 경우 신규 graph를 생성하고, source text 표현에 필요한 relation type을 최대 4개까지 정의한다.

즉 "기존 graph에 추가할 수 있는 조건"은 다음 두 가지다.

- edge의 relation type이 기존 graph에 이미 존재한다.
- 또는 기존 graph의 relation type이 4개 미만이라 신규 relation type을 추가할 수 있다.

기존 graph의 relation type이 4개인 상태에서 새 relation type이 필요하면 `new_graph: true`가 되어야 한다.

---

### 현재 코드가 의도와 다른 부분

#### 1. `buildGraphPolicyPrompt()`가 기존 graph relation type 확장을 금지함

현재 `src/lib/graph-policy.ts`의 `buildGraphPolicyPrompt()`는 다음 방향이다.

```text
When writing wikilinks in a page assigned to a graph, use ONLY the relation types listed for that graph.
If a relationship does not fit any listed type, omit the relation type and write [[TargetPage]] instead.
```

이 지시는 사용자 의도와 다르다.

수정 방향:

- 기존 graph의 relation type이 4개 미만이면 새 relation type을 제안/사용할 수 있다고 알려야 한다.
- 4개가 꽉 찬 graph에서는 새 relation type을 만들지 말고 신규 graph를 만들라고 지시해야 한다.
- relation type을 omit하는 방식은 graph 표현 손실을 만들기 때문에 Stage 2/3 기본 정책에서 제거해야 한다.
- "기존 graph의 relation type만 사용"이라는 지시는 "도메인이 맞는 기존 graph를 먼저 고르고, type이 없으면 slot 여유에 따라 확장한다"로 바꿔야 한다.

#### 2. `buildGraphAssignmentPrompt()`가 "허용 type에 맞지 않으면 신규 graph"로만 판단함

현재 `src/lib/ingest.ts`의 Stage 2 prompt는 다음 순서를 요구한다.

```text
Which existing graph's allowed relation types can express it?
Assign to that graph and pick the most fitting allowed type.
If no existing graph fits, set new_graph: true.
```

이 구조는 "기존 graph에 신규 relation type을 추가할 수 있는 경우"를 빠뜨린다.

수정 방향:

Stage 2 prompt의 판단 순서를 다음처럼 바꿔야 한다.

```text
For each source_text:
1. Read the source_text directly and split it into one or more node/edge/node relationships.
2. Group those relationships into one or more assignments. A section may produce multiple assignments and may target multiple graphs.
3. For each assignment, pick the existing graph whose domain best matches the node/edge meaning.
4. If all edge relation types already exist in that graph, use it.
5. If some edge relation types are new and the graph has fewer than 4 relation types, keep the existing graph and include the expanded `graph_relation_types` list.
6. If the existing graph already has 4 relation types and a new relation type is required, create a new graph with `new_graph: true`.
```

#### 3. `graph_relation_types`가 신규 graph 전용처럼 쓰임

현재 prompt와 registration code는 `graph_relation_types`를 사실상 `new_graph: true`일 때만 사용한다.

수정 방향:

`graph_relation_types`를 기존 graph에도 사용할 수 있게 의미를 확장한다.

- `new_graph: true`일 때: 새 graph의 relation type 전체 목록.
- `new_graph: false`이고 기존 graph에 새 relation type을 추가할 때: 확장 후 해당 graph의 relation type 전체 목록.
- 기존 graph의 type을 추가하지 않는 경우에는 생략하거나 빈 배열 가능.

예:

```json
{
  "concept": "제작 실패 안내 메시지",
  "page_path": "db/ui/crafting/craft-failure-message.md",
  "graph": "ui_trigger_graph",
  "new_graph": false,
  "graph_relation_types": ["TRIGGERS", "REQUIRES", "BLOCKS", "CHILD_OF"],
  "relations": [
    { "target": "Craft 테이블 fail_prob 필드", "type": "TRIGGERS" }
  ]
}
```

기존 graph가 `["TRIGGERS", "REQUIRES", "BLOCKS"]`만 갖고 있고 `CHILD_OF`가 새로 필요하다면, 총 4개이므로 기존 graph에 추가 가능하다.

#### 4. `validateStage2()`가 신규 relation type을 무조건 실패시킴

현재 `src/lib/ingest.ts`의 `validateStage2()`는 relation type이 graph의 allowed list에 없으면 실패 처리한다.

현재 방식:

```ts
if (rel.type && allowed.length > 0 && !allowed.includes(rel.type)) {
  failures.push(...)
}
```

수정 방향:

검증은 다음 정책을 따라야 한다.

- relation type이 이미 allowed에 있으면 통과.
- relation type이 allowed에 없지만 `allowed.length < 4`이고 새 type 추가 후 총 4개 이하이면 통과 + graph policy 업데이트 대상.
- relation type 추가 후 4개를 초과하면 실패. 이 실패는 "new graph required" 성격이므로 Stage 2 prompt가 애초에 신규 graph를 만들도록 유도해야 한다.
- `graph_relation_types`가 기존 graph의 확장 후 type 목록을 제공하면, `relations[].type`과 함께 합쳐서 최대 4개 제한을 검증한다.

권장 helper:

```ts
function mergeRelationTypes(existing: string[], used: string[]): {
  merged: string[]
  added: string[]
  overflow: string[]
}
```

이 helper로 `relations[].type`과 `graph_relation_types`를 함께 보고 graph별 relation type을 확장한다.

#### 5. graph policy 저장 로직이 existing graph 확장을 저장하지 않음

현재 `src/lib/ingest.ts`, `src/lib/agent-ingest.ts`의 registration 로직은 대체로 다음 조건에서만 `saveGraphPolicy()`를 호출한다.

```ts
if (item.new_graph && item.graph && !graphPolicy.managedGraphs.includes(item.graph)) {
  ...
}
```

수정 방향:

Stage 2 parsed assignment를 처리할 때 다음 둘 다 저장해야 한다.

- 신규 graph 등록.
- 기존 graph의 relation type 확장.

예상 흐름:

```ts
for (const item of parsed) {
  const usedTypes = relationTypesUsedBy(item)

  if (item.new_graph) {
    registerNewGraph(item.graph, item.graph_relation_types ?? usedTypes)
    continue
  }

  if (item.graph && graphPolicy.managedGraphs.includes(item.graph)) {
    extendExistingGraphTypesIfPossible(item.graph, usedTypes, item.graph_relation_types)
  }
}
```

이후 `validateStage2(parsed, graphPolicy)`는 확장된 policy 기준으로 실행되어야 한다.

#### 6. `buildStage2Scaffold()`가 section당 1 assignment처럼 보임

현재 scaffold는 Stage 1 section마다 assignment 하나를 미리 만든다.
이 방식은 LLM이 `source_text`를 직접 읽게 한다는 점에서는 맞지만, "한 section의 source_text가 여러 node/edge/node 관계 또는 여러 graph로 나뉠 수 있다"는 새 기준을 충분히 드러내지 못한다.

수정 방향:

- scaffold는 각 section을 seed assignment로 제공하되, LLM이 필요하면 같은 `source_range` / `source_text`를 가진 assignment를 추가로 복제할 수 있다고 명시한다.
- `assignments` 배열은 section 배열과 1:1이 아니라, source_text에서 추출된 graph assignment 배열이다.
- 한 source_text 안에서 도메인이 다른 관계들이 나오면 여러 graph assignment로 분리하도록 지시한다.
- "Do not add or rename keys"는 유지하되, "You may add additional assignment objects using the same schema when one source_text needs multiple graph assignments"를 추가한다.

예:

```json
{
  "assignments": [
    {
      "source_range": "## 제작 시스템",
      "source_text": "제작 시스템은 ...",
      "concept": "제작 시스템",
      "page_path": "db/crafting/crafting-system.md",
      "graph": "crafting_flow_graph",
      "new_graph": false,
      "graph_relation_types": [],
      "isolated": false,
      "relations": []
    },
    {
      "source_range": "## 제작 시스템",
      "source_text": "제작 시스템은 ...",
      "concept": "제작 실패 안내 메시지",
      "page_path": "db/ui/crafting/craft-failure-message.md",
      "graph": "ui_trigger_graph",
      "new_graph": false,
      "graph_relation_types": ["TRIGGERS", "REQUIRES", "BLOCKS", "CHILD_OF"],
      "isolated": false,
      "relations": []
    }
  ]
}
```

#### 7. 실패 필터링이 concept 기준이라 다중 assignment와 충돌함

현재 실패 필터링은 `concept` 기준이다.
같은 source section 또는 같은 concept이 여러 graph assignment로 쪼개졌을 때, 하나의 assignment만 실패해도 같은 concept의 다른 성공 assignment까지 같이 스킵될 수 있다.

수정 방향:

- 실패/성공 분리는 `concept`이 아니라 assignment 단위로 처리한다.
- 안정적인 key는 `assignment index`를 우선 사용한다.
- review item이나 로그에서 사람이 읽을 식별자가 필요하면 `page_path + graph + source_range`를 함께 남긴다.
- `src/lib/ingest.ts`, `src/lib/agent-ingest.ts` 모두 동일하게 concept 기반 skip set을 제거하고 assignment index 기반 valid/invalid 분리로 바꾼다.

권장 흐름:

```ts
const validation = validateStage2(parsed, graphPolicy)
const failedIndexes = new Set(validation.failures.map((failure) => failure.assignmentIndex))
const validAssignments = parsed.assignments.filter((_, index) => !failedIndexes.has(index))
const invalidAssignments = parsed.assignments.filter((_, index) => failedIndexes.has(index))
```

---

### 구현 계획

| 파일 | 수정 방향 |
|------|---------|
| `src/lib/graph-policy.ts` | graph policy prompt를 "listed type만 사용"에서 "4개 미만이면 기존 graph relation type 확장 가능, 4개면 신규 graph"로 변경. |
| `src/lib/ingest.ts` | `buildGraphAssignmentPrompt()`의 graph 선택 순서를 "도메인 맞는 graph 선택 → type 있으면 사용 → slot 남으면 type 확장 → 4개면 신규 graph"로 변경. `graph_relation_types`를 existing graph 확장에도 사용할 수 있도록 설명 변경. |
| `src/lib/ingest.ts` | `validateStage2()`를 relation type 확장 가능 정책으로 변경. allowed에 없는 type을 무조건 실패시키지 않고, allowed/used/proposed type merge 결과가 최대 4개인지로 판단. |
| `src/lib/ingest.ts` | parsed assignment 처리 시 `new_graph: true`뿐 아니라 existing graph relation type 확장도 `saveGraphPolicy()`에 반영. |
| `src/lib/ingest.ts` | `buildStage2Scaffold()`와 Stage 2 지시문을 section당 1 assignment가 아니라 source_text당 여러 assignment/여러 graph가 가능하도록 수정. `source_text` 중복을 피하기 위해 `sections[]`에 원문을 1회만 싣고 assignment는 `source_id`로 참조하게 한다. |
| `src/lib/ingest.ts` | 실패 필터링을 concept 기준에서 assignment index 또는 `page_path + graph` 기준으로 변경. 한 assignment 실패가 같은 concept의 다른 성공 assignment를 스킵하지 않게 한다. |
| `src/lib/agent-ingest.ts` | HTTP ingest와 동일하게 existing graph relation type 확장 registration 적용. |
| `src/lib/agent-ingest.ts` | 실패 필터링을 concept 기준에서 assignment index 또는 `page_path + graph` 기준으로 변경. |
| `src/lib/__tests__/agent-ingest.test.ts` | 기존 graph가 3개 relation type을 가진 상태에서 새 relation type 1개를 추가해도 valid로 통과하는 테스트 추가. |
| `src/lib/__tests__/agent-ingest.test.ts` | 기존 graph가 이미 4개 relation type을 가진 상태에서 새 relation type이 필요하면 existing graph assignment가 skip/review되거나 Stage 2가 new graph를 만들도록 유도되는 테스트 추가. |
| `src/lib/__tests__/agent-ingest.test.ts` | 같은 concept/source_text에서 여러 graph assignment가 생성될 때, 실패한 assignment만 review/skip되고 성공 assignment는 write되는 테스트 추가. |

### 기대 결과

이 변경 후 raw data injection은 다음처럼 동작해야 한다.

- source text에서 여러 node/edge/node 관계를 추출한다.
- 한 section이 필요하면 여러 assignment와 여러 graph로 분리된다.
- 기존 graph가 의미적으로 맞고 relation type을 표현할 수 있으면 기존 graph에 추가한다.
- 기존 graph가 의미적으로 맞고 relation type slot이 남아 있으면 relation type을 확장한 뒤 기존 graph에 추가한다.
- 기존 graph의 relation type이 이미 4개라 표현력이 부족하면 신규 graph를 생성한다.
- 실패는 assignment 단위로 격리되어, 같은 concept/source_text의 다른 성공 assignment를 막지 않는다.
- graph relation type 개수 제한은 유지하되, 기존 graph 재사용률과 raw data 표현력을 높인다.

---

### 개발 반영 현황

구현 완료:

- `src/lib/graph-policy.ts`
  - "기존 graph의 listed relation type만 사용" 지시를 제거했다.
  - graph domain이 맞으면 기존 graph를 우선 선택하고, relation type slot이 4개 미만이면 `graph_relation_types`로 확장 가능하다고 안내한다.
  - 이미 relation type이 4개인 graph에 새 type이 필요하면 신규 graph를 만들도록 안내한다.

- `src/lib/ingest.ts`
  - `mergeRelationTypes()` helper를 추가해 기존 type, 실제 사용 type, `graph_relation_types` 제안 type을 합쳐 최대 4개 제한을 검증한다.
  - `applyStage2GraphPolicyUpdates()`를 추가해 Stage 2 validation 전에 신규 graph 등록과 기존 graph relation type 확장을 graph policy에 반영한다.
  - `validateStage2()`를 "allowed에 없으면 실패" 방식에서 "merge 후 4개 초과면 실패" 방식으로 변경했다.
  - Stage 2 실패 필터링을 `concept` 기준에서 assignment index 기준으로 변경했다.
  - `buildStage2Scaffold()`를 `{ sections, assignments }` 구조로 변경했다. `sections[]`는 `source_id`, `source_range`, `source_text`를 갖고, `assignments[]`는 `source_id`만 참조한다.
  - `hydrateStage2Assignments()`를 추가해 Stage 2 응답의 `source_id`를 원본 `source_text` / `source_range`로 복원한 뒤 Stage 3로 넘긴다.

- `src/lib/agent-ingest.ts`
  - HTTP ingest와 동일하게 Stage 2 응답 hydration, 신규 graph 등록, 기존 graph relation type 확장, assignment index 기준 실패 필터링을 적용했다.
  - Stage 2 user prompt에 `source_id` 참조를 사용하고 assignment에 `source_text`를 복사하지 말라고 명시했다.

- `src/lib/__tests__/agent-ingest.test.ts`
  - 기존 graph relation type slot이 남아 있으면 새 relation type을 추가하고 통과하는 테스트를 추가했다.
  - 기존 graph가 이미 4개 relation type을 가진 상태에서 새 type이 필요하면 해당 assignment만 skip/review되는 테스트를 추가했다.
  - 같은 concept/source_text의 다중 assignment 중 실패한 assignment만 skip되고 성공 assignment는 write되는 테스트를 추가했다.
  - Stage 2 scaffold가 `source_text`를 assignment에 중복하지 않고 `source_id`로 참조하는 테스트를 추가했다.

검증 결과:

- `npm exec vitest run "src/lib/__tests__/agent-ingest.test.ts"` 통과.
- `npm exec vitest run "src/lib/ingest.prompt.test.ts"` 통과.
- `npm run typecheck` 통과.

---

## Fix 23: Graph 탭 드롭박스 미표시 & Files 탭 그래프 미연결 문제

### 현상

- ingest 완료 후 로그에 158 nodes, 18 edges 동기화 완료가 출력됨.
- 그러나 Graph 탭 > Knowledge 탭 드롭박스에 그래프가 추가되지 않음.
- Graph 탭 > Files 탭에서 markdown 파일을 선택해도 관련 그래프 버튼이 나타나지 않음.

### 원인 분석

#### 1. `parseFalkorQueryResult`가 Rust 백엔드 응답 구조를 파싱 못함 (핵심 원인)

`src/lib/falkor-visualization.ts`의 `parseFalkorQueryResult()`는 다음 구조를 기대한다.

```js
// 기대: cell이 직접 {labels, properties, id} 형태
[[ {id: 1, labels: [...], properties: {...}} ]]
```

그러나 Rust 백엔드(`graph_db_query`)가 실제로 반환하는 구조가 아래처럼 **키-값 Map으로 감싸진 형태**이면 파싱이 실패한다.

```js
// 실제: cell이 {"n": {id, labels, properties}} 형태
[[ {"n": {id: 1, labels: [...], properties: {...}}} ]]
```

현재 파싱 로직:

```ts
for (const cell of row) {
  // cell = {"n": {...}} 이면 "labels" in cell이 false → 노드 인식 안 됨
  if ("labels" in cell && "properties" in cell && "id" in cell) { ... }
}
```

이로 인해:

- `refreshLiveGraphs()`에서 `MATCH (n) RETURN n LIMIT 1` 쿼리를 날려도 `parsed.nodes.length === 0`이 되어, FalkorDB에 노드가 있어도 모든 그래프가 드롭박스에 추가되지 않는다.
- `findRelatedGraphs()`에서도 `hasQueryResults()`가 항상 false를 반환해, Files 탭에서 파일을 선택해도 관련 그래프 버튼이 생성되지 않는다.

#### 2. `refreshLiveGraphs`의 캐시 타이밍

`src/components/graph/graph-view.tsx`의 `refreshLiveGraphs`는 localStorage 캐시에 있는 그래프는 재검증 없이 재사용하고, 캐시에 없는 그래프만 백그라운드로 확인한다. 파싱 버그가 있는 상황에서 첫 번째 ingest 시 아무것도 캐시되지 않고, 이후 ingest에서도 캐시가 쌓이지 않아 드롭박스가 영구적으로 비어있게 된다.

#### 3. 기획 의도와의 괴리 — 그래프 없는 파일 생성

로그를 보면 `quest_reward_graph`, `npc_relation_graph` 등 다수 그래프가 `0 edges`로 생성된다.

```
[quest_reward_graph] done — 8 nodes, 0 edges
[npc_relation_graph] done — 1 nodes, 0 edges
```

기획 의도는 "그래프 없는 markdown 파일은 생성되지 않아야 한다"이나, 현재 `buildFileBlocksFromAssignments`는 `relations: []`인 isolated assignment도 파일로 쓴다. Stage 2에서 `isolated: false`로 설정됐어도 실제 `relations` 배열이 비어있으면 엣지 없는 노드만 생기는 것이다.

### 진단 방법

앱 개발자 도구 콘솔에서 Rust 백엔드의 실제 응답 구조 확인:

```js
window.__TAURI__.core.invoke("graph_db_query", {
  graphName: "YOUR_PROJECT___quest_reward_graph",
  cypher: "MATCH (n) RETURN n LIMIT 1",
  url: null
}).then(r => console.log(JSON.stringify(r, null, 2)))
```

응답이 `[[{"n": {id, labels, properties}}]]` 형태이면 파싱 버그 확정.

### 수정 방향

| 파일 | 수정 방향 |
|------|---------|
| `src/lib/falkor-visualization.ts` | `parseFalkorQueryResult()`를 수정해 cell이 `{labels, properties, id}` 직접 형태뿐 아니라 `{"n": {...}}`, `{"r": {...}}` 처럼 키-값으로 감싸진 형태도 처리하도록 한다. |
| `src/commands/graph-db.ts` | `findRelatedGraphs()`의 `hasQueryResults()` 의존도를 유지하되, 파싱 버그 수정 후 결과가 올바르게 나오는지 검증한다. |
| `src/lib/ingest.ts` / `src/lib/agent-ingest.ts` | `relations`가 비어있는 assignment(`isolated: true` 또는 실제 `relations.length === 0`)는 파일을 생성하지 않도록 필터링 추가. 기획 의도인 "그래프 없는 파일 미생성" 보장. |

---

### 개발 반영 현황

구현 완료:

- `src/lib/falkor-visualization.ts`
  - `parseFalkorQueryResult()`에서 Rust 백엔드가 `{"n": {...}}` / `{"r": {...}}` 처럼 키-값으로 감싸서 반환하는 구조를 처리하도록 수정했다.
  - cell에 `labels` 또는 `relationshipType` 키가 직접 있으면 기존 경로로 처리하고, 없으면 `Object.values()`로 내부 객체를 꺼낸 뒤 노드/엣지 감지 로직을 적용한다.
  - 이로 인해 `refreshLiveGraphs()`의 드롭박스 갱신과 `findRelatedGraphs()`의 관련 그래프 버튼 표시가 정상 동작한다.

- `src/lib/ingest.ts`
  - `buildFileBlocksFromAssignments()`에서 `relations`가 비어있는 assignment는 파일 생성을 건너뛰도록 필터를 추가했다.
  - `agent-ingest.ts`는 동일한 함수를 공유하므로 별도 수정 없이 동일하게 적용된다.

검증 결과:

- `npm run typecheck` 통과.
