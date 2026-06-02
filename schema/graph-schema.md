# Graph Schema Reference

## 1. 개요

이 문서는 LLM Wiki 프로젝트에서 Knowledge Graph를 정의할 때 따르는 스키마 규칙이다.
프로젝트 내 `.llm-wiki/graph-policy.json`에 저장된 `managedGraphs`와 `relationTypes`가
이 규칙에 따라 작동한다.

---

## 2. Graph 명명 규칙

```
<domain>_graph
```

- 소문자 + 언더스코어 + `_graph` 접미사
- 문자, 숫자, `_`, `-`만 허용 (최대 128자)
- 예: `ui_graph`, `skill_graph`, `enemy_graph`, `quest_graph`

---

## 3. DB 페이지에서 Graph 지정

`db/` 페이지의 frontmatter에 `graph` 필드를 추가한다.

```md
---
title: 스킬 트리 — 전사
type: entity
graph: skill_graph
sources:
  - file: skill_design.docx
    range: section 2.1
---
```

- `graph`: 소속 managed graph 이름. `.llm-wiki/graph-policy.json`의 `managedGraphs` 목록 중 하나.
- 미지정이면 해당 페이지는 "그래프 미지정" 상태로 lint 경고 대상이 될 수 있다.

---

## 4. Relation Types (Edge Types)

각 graph는 **최대 4개**의 edge type을 사용한다. `.llm-wiki/graph-policy.json`의
`relationTypes`에 등록된 타입만 ingest 프롬프트에서 허용된다.

### 4.1 권장 명명 패턴

```
VERB_NOUN   (대문자, 언더스코어 구분)

예:
  REQUIRES
  UPGRADES_TO
  NAVIGATES_TO
  WEAK_AGAINST
```

### 4.2 도메인별 추천 Edge Types

| Graph | 추천 Edge Types |
|---|---|
| `ui_graph` | `NAVIGATES_TO`, `CONTAINS`, `TRIGGERS` |
| `skill_upgrade_graph` | `UPGRADES_TO`, `BRANCHES_INTO`, `UNLOCKS`, `PROMOTES_TO` |
| `skill_synergy_graph` | `SYNERGIZES_WITH`, `COMBOS_WITH`, `REDUCES_CD`, `BOOSTS` |
| `skill_scaling_graph` | `SCALES_WITH`, `REQUIRES_STAT`, `CONVERTS_TO`, `CAPPED_BY` |
| `skill_tag_graph` | `HAS_TAG`, `ELEMENT_OF`, `WEAPON_TYPE`, `CATEGORY_OF` |
| `enemy_tactic_graph` | `USES_SKILL`, `TARGETS`, `FLEES_AT`, `PHASES_INTO` |
| `item_set_graph` | `PART_OF_SET`, `SYNERGIZES_WITH`, `REQUIRED_FOR`, `EQUIPPED_BY` |
| `stat_relation_graph` | `INFLUENCES`, `DERIVED_FROM`, `CAPS`, `AUGMENTS` |
| `system_loop_graph` | `FEEDS_INTO`, `PROVIDES_RESOURCE_FOR`, `GATED_BY`, `CONSUMES` |
| `system_logic_graph` | `OVERRIDES`, `TRIGGERS`, `BLOCKS`, `REQUIRES` |
| `quest_graph` | `NEXT`, `REQUIRES`, `UNLOCKS` |
| `economy_graph` | `GENERATES`, `CONSUMES`, `EXCHANGES` |
| `faction_graph` | `ALLY`, `ENEMY`, `NEUTRAL` |
| `event_graph` | `TRIGGERS`, `CONDITIONAL`, `CHAINED_TO` |
| `progression_graph` | `LEVELS_TO`, `UNLOCKS`, `REQUIRES_XP` |

---

## 5. graph-policy.json 구조

`.llm-wiki/graph-policy.json` 예시:

```json
{
  "relationTypes": ["REQUIRES", "UPGRADES_TO", "WEAK_AGAINST", "SPAWNS"],
  "managedGraphs": ["skill_graph", "enemy_graph"]
}
```

| 필드 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `relationTypes` | `string[]` | 최대 4개, 중복 불가 | ingest 시 허용 edge type 목록 |
| `managedGraphs` | `string[]` | 최대 200개, 중복 불가 | FalkorDB에 생성된 그래프 목록 |

---

## 6. 검증 규칙 (Lint)

`graph-policy.json`이 존재하고 `managedGraphs`가 1개 이상일 때:

1. **미등록 graph 참조**: frontmatter의 `graph` 값이 `managedGraphs`에 없으면 경고
2. **edge type 초과**: `relationTypes`가 4개를 초과하면 경고 (저장 시 자동 제한되지만 직접 편집 시 발생 가능)
3. **미지정 graph**: `managedGraphs`가 있는데 페이지에 `graph` 필드가 없으면 info

---

## 7. Ingest 프롬프트 주입

`relationTypes`가 1개 이상이면 ingest 시 LLM에 다음 지시가 주입된다:

```
## Graph Relation Policy (project-defined)
When proposing/generated knowledge links or relationships, use ONLY the relation types below.
If a relationship does not fit one of them, do not invent a new relation type; rewrite or omit it.
Allowed relation types (N/4): TYPE1, TYPE2, ...
```

`managedGraphs`가 1개 이상이면 추가로:

```
## Managed Graphs
Assign each generated db/ page to one of the following graphs using a `graph:` frontmatter field.
If the page does not clearly belong to any graph, omit the field.
Available graphs: graph1, graph2, ...
```

---

## 8. Cross-Graph Reference

서로 다른 graph 소속 페이지 간 [[wikilink]]는 허용된다. Cross-graph 참조는:

- lint에서 별도 경고로 분류되지 않는다
- graph-insights의 "Surprising Connections"에서 cross-community 신호로 처리된다
- ID 기반 참조(`[[page-id]]`)로만 연결한다 (URL이나 외부 링크 X)
