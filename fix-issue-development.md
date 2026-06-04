# Graph 품질 개선 — 현황 및 해결 방향

## 목표

raw 데이터를 ingest하면 문서 내용이 **여러 개의 지식그래프로 분산 표현**되어야 한다.

핵심 제약: **지식그래프 하나의 관계 타입은 최대 4개**. 관계 종류가 너무 많으면 사용자가 시각화된 그래프를 읽을 수 없다.

그래프명에 관계 성격을 반영 (`combat_weakness_graph`, `combat_combo_graph` 등) — 드롭다운에서 어떤 관계를 다루는 그래프인지 바로 파악 가능.

이 제약 안에서 다음을 동시에 달성하는 것이 목표다:

1. **기존 그래프 재활용** — ingest된 문서의 개념이 기존 그래프 도메인과 겹치면, 해당 그래프에 노드와 관계를 추가해서 문서 내용을 표현한다.
2. **새 그래프 생성** — 기존 어느 그래프에도 맞지 않는 도메인이라면, 새 그래프를 만들어 표현한다.
3. **문서 내용의 완전한 그래프 표현** — 모든 ingest 결과가 지식그래프에 누락 없이 담긴다.
4. **시각화 가독성 유지** — 그래프별 관계 타입을 4개 이하로 통제해서 사용자가 그래프를 쉽게 읽을 수 있다.

결과적으로: 문서 내용이 도메인별 그래프에 나뉘어 저장되고, 각 그래프는 해당 도메인에 특화된 소수의 관계 타입만 사용한다.

---

## 코드 구현 현황

| Fix 14 | 그래프 생성 2단계: 새 그래프 생성 시 relation type 정의 + policy 저장 | ✅ 완료 |
| Fix 15 | Stage 1/2 역할 분리 재설계: relation type 결정 책임을 Stage 2로 이전 | ✅ 완료 |

---

## Fix 14: 그래프 배정 구조 재설계 + 2단계(policy 등록) 추가

### 해결한 문제

**문제 A — 컨텍스트 오염: 그래프 선택 단계에 노드 목록이 주입됨**

`buildAnalysisPrompt()`(구 버전)에 `existingGraphSummary`(그래프별 노드 목록)가 주입됐다.
그래프를 선택하는 단계에서 필요한 정보는 **그래프명 + relation type 목록**뿐이다. 제거됨.

**문제 B — 배정 단위 오류: 그래프를 "페이지" 단위로 배정함**

구 버전은 LLM이 페이지 개요 수준에서 그래프 하나를 배정했다.
목표는 **관계 타입 묶음** 단위 배정이다.

예시: 고블린 전사 페이지
- 구: "전투 개념이므로 → `combat_weakness_graph` 하나 배정"
- 현재: "약점/저항 관계 → `combat_weakness_graph`, 스킬 사용 관계 → `enemy_tactic_graph`" → 두 페이지로 분리

**문제 C — 신규 그래프 policy 미등록**

새 그래프 이름이 Stage 2에서 나와도 `graphRelationTypes`에 등록되지 않아, 이후 처리에서 relation type 없이 동작하거나 전역 fallback을 사용했다.

**문제 D — wikilink 누락: Stage 3 LLM이 relations를 무시**

구 버전은 Stage 3 LLM이 Stage 2 `relations` 배열을 참고해 `[[target|TYPE]]`을 작성하도록 유도했으나, LLM이 이를 누락하는 경우가 발생했다. Stage 3 자체를 LLM 호출에서 코드 생성으로 교체해 구조적으로 해결했다.

### 구현된 파이프라인 구조 (2단계 + loop + 코드 생성)

#### ingest.ts (`autoIngestImpl`)

```
Stage 1: 문서 해체 (LLM)   → Stage1Concept[] (JSON)
Stage 2: 그래프 배정 (LLM) ◄─── loop: 검증 실패 개념만 재배정 (MAX_RETRIES=3)
  ↓ validateStage2() 통과
Stage 3: FILE 블록 코드 생성 (buildFileBlocksFromAssignments) → 디스크 기록
```

---

#### JSON mode

Stage 1, Stage 2는 `response_format: { type: "json_object" }` 오버라이드로 JSON 출력을 강제한다.
파싱 실패(`JSON.parse` 예외)는 Stage 2 loop 트리거에 포함된다.

---

#### Stage 1 — 문서 해체

- `ingest.ts`: `buildDecompositionPrompt()` — 배열 형식 `Stage1Concept[]`

**출력 형식 (JSON array):**

```json
[
  {
    "concept": "고블린 전사",
    "path": "db/enemies/goblin-warrior.md",
    "relations": [
      { "target": "불", "type": "WEAK_AGAINST" },
      { "target": "독침", "type": "USES_SKILL" }
    ],
    "source_range": "## 고블린 전사"
  }
]
```

**주입 컨텍스트:** db/ 인덱스 + dismissalContext. graphPolicyPrompt·노드 목록 없음.

---

#### Stage 2 — 그래프 배정

- `ingest.ts`: `buildGraphAssignmentPrompt()` 호출

**출력 형식 (JSON array):**

```json
[
  {
    "concept": "고블린 전사",
    "page_path": "db/enemies/goblin-warrior-weakness.md",
    "graph": "combat_weakness_graph",
    "relations": [{ "target": "불", "type": "WEAK_AGAINST" }],
    "new_graph": false
  }
]
```

신규 그래프 필드: `"new_graph": true` + `"graph_relation_types": ["TYPE_A", ...]` (최대 4개)

**신규 그래프 처리:**
```
Stage 2 결과 순회
  → new_graph: true 항목 발견 시
      → managedGraphs에 즉시 추가
      → graphRelationTypes에 등록
      → saveGraphPolicy() 호출 (디스크 저장)
      → 이후 항목부터 갱신된 policy로 validateStage2() 수행
```

**주입 컨텍스트:** graphPolicyPrompt만. 노드 목록 없음.

---

#### Loop — Stage 2 직후 코드 검증 + 재배정

`validateStage2(assignments, policy)` — `Stage2Failure[]` 반환. 빈 배열이면 통과.

| 조건 | 검증 방법 |
|------|----------|
| 필수 필드 누락 (`concept`, `page_path`, `graph`) | 필드 존재 체크 |
| `new_graph: false`인데 managedGraphs에 없는 graph | `managedGraphs.includes(graph)` |
| relation type이 해당 그래프 허용 타입 밖 | `graphRelationTypes[graph].includes(type)` |
| 같은 개념이 동일 그래프에 중복 배정 | `(concept, graph)` 쌍 중복 체크 |

- `new_graph: true` 항목은 방금 등록됐으므로 policy 검증 skip.
- 실패 개념만 추려 재배정 요청 (ingest는 `failingConcepts` Set 필터링, retro-graph는 단일 개념이므로 전체 재시도).
- `retryCount >= MAX_RETRIES(3)` 초과 시 남은 실패 무시하고 Stage 3 진행.

---

#### Stage 3 — 페이지 생성 (코드, LLM 없음)

`buildFileBlocksFromAssignments(assignments, stage1Concepts, fileName, sourceChunk)` — LLM 호출 없음.
- 각 Stage 2 assignment → FILE 블록 1개.
- frontmatter: `title`(concept), `status: draft`, `sources`(fileName + source_range), `graph` — Stage 2 데이터 직접 사용.
- 본문: Stage 1 `source_range` 헤딩에 해당하는 원문 섹션 발췌 (`extractSection()`).
- `## Related` 섹션: Stage 2 `relations` 배열 → `[[target|TYPE]]` — 100% 보장.

---

#### wiki-graph.ts — resolveTarget label 매칭 추가

wikilink target이 파일명이 아닌 개념 이름(label)으로 작성된 경우 엣지가 생성되지 않는 버그 수정.
`resolveTarget()`에 `node.label` 기준 매칭 추가 — id 매칭 실패 시 label로 fallback.

---

### 구현 파일

| 파일 | 변경 내용 |
|------|---------|
| `src/lib/llm-providers.ts` | `RequestOverrides`에 `response_format` 추가, provider별 JSON mode 파라미터 반영 |
| `src/lib/ingest.ts` | `buildDecompositionPrompt()` 신규, `buildGraphAssignmentPrompt()` 신규, Stage 3 LLM 제거 → `buildFileBlocksFromAssignments()` + `extractSection()` 신규, Stage 2 검증+loop+policy 등록 로직 추가. `buildAnalysisPrompt()` `@deprecated` 처리, `buildGenerationPrompt()` / `existingGraphSummary` 제거 |
| `src/lib/wiki-graph.ts` | `resolveTarget()`에 label 기준 매칭 추가 |

---

## Fix 15: Stage 1/2 역할 분리 재설계

### 발견된 문제

**문제 E — Stage 1이 relation type을 자유롭게 발명함**

`buildDecompositionPrompt()`에 graph-policy가 주입되지 않아 Stage 1 LLM이 `relations[].type`을 자유롭게 만들어냈다 (`JOINS_GUILD`, `RECRUITS_INTO` 등).
Stage 2는 이 타입을 허용 타입에 억지 매핑했고, 실패 시 policy에 없는 타입이 통과되어 `detectSchemaDrift`에서 잡혔다.

**문제 F — Stage 1이 target만 전달해도 Stage 2가 관계 성격을 파악할 맥락 부족**

type을 제거하고 `{ target }` 만 남기면, Stage 2는 target 이름만 보고 graph/type을 결정해야 한다.
관계의 성격을 알 수 없어 relations를 빈 배열로 반환 → 파일에 `## Related` 섹션 없음 → wikilink 없음 → 0 edges.

**근본 원인: Stage 1의 역할 정의 오류**

Stage 1의 올바른 역할은 문서를 **의미 단위 섹션으로 분해**하는 것이다. concept 추출, relation target 파악, type 결정은 모두 Stage 2의 책임이다. Stage 1은 "어디에 무엇이 있는가"(source_range + source_text)만 전달하면 충분하다.

---

### 최종 구현

#### 재설계된 파이프라인

```
Stage 1: 문서를 의미 단위 섹션으로 분해 (LLM)
  출력: Stage1Section[] = [{ source_range, source_text }]
  — concept, relations, type 없음. 원문 텍스트만.

Stage 2: 각 섹션의 source_text를 읽어 전부 결정 (LLM)
  입력: Stage1Section[] (source_range + source_text)
  출력: Stage2Assignment[] (concept, page_path, graph, relations with type, source_range)

Stage 3: Stage2Assignment에서 FILE 블록 생성 (코드, LLM 없음)
  source_text를 본문으로, relations를 wikilink로 사용
```

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
1. concept과 다른 개념과의 관계를 파악
2. 각 관계를 어느 그래프의 relation type으로 표현할 수 있는가? 판단
3. 표현 가능한 그래프가 있으면 → 해당 그래프 배정 + 허용 타입 중 가장 적합한 것 선택
4. 어느 그래프로도 표현 불가능하면 → new_graph: true + graph_relation_types 정의 (최대 4개)
```

#### `Stage2Assignment` 필드 추가

`source_range`와 `source_text`를 Stage 2 출력에 포함해 Stage 3(코드)가 이를 직접 활용한다.

#### retro-graph 단순화

단일 페이지를 처리하는 retro-graph는 Stage 1 LLM 호출이 불필요하다.
페이지 content를 `Stage1Section`으로 직접 구성해 Stage 2에 전달한다.
`buildExistingGraphContext()` 함수 및 관련 FalkorDB import 제거.

---

### 구현 파일

| 파일 | 변경 내용 |
|------|---------|
| `src/lib/ingest.ts` | `Stage1Concept` 인터페이스 삭제 → `Stage1Section { source_range, source_text }` 신규. `Stage2Assignment`에 `source_range?`, `source_text?` 필드 추가. `buildDecompositionPrompt()` 섹션 분해기로 완전 재작성 (concept/relations 제거). `buildGraphAssignmentPrompt()` source_text 기반 판단으로 업데이트. `buildFileBlocksFromAssignments()` `stage1Concepts`/`sourceChunk` 파라미터 제거, assignment의 `source_text` 직접 사용. Stage 2 retry loop를 `Stage1Section` 기준으로 수정. |
| `src/lib/retro-graph.ts` | Stage 1 LLM 호출 완전 제거. `content`를 `Stage1Section`으로 직접 구성해 Stage 2에 전달. `buildGraphAssignmentPrompt()` 재사용. `buildExistingGraphContext()` 함수 및 `listGraphDb`, `queryGraphDb`, `parseFalkorQueryResult` import 제거. |

---