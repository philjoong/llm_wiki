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

## 문제 요약

게임 기획 문서를 ingest했을 때 지식 그래프가 의미 없이 생성됨:

1. **그래프 이름이 `main`** — `skill_graph`, `enemy_graph` 같은 도메인 이름이 없으면 모든 노드가 하나의 그래프에 섞임
2. **관계 타입이 `REQUIRES`, `RELATED_TO`** — 게임 특화 타입(`WEAK_AGAINST`, `DROPS_ITEM`, `UPGRADES_TO`)이 없으면 관계가 아무 정보를 전달하지 못함
3. **관계 타입이 그래프마다 달라야 하는데 전체 공유** — 전투 그래프와 퀘스트 그래프가 같은 4개 타입을 공유하면 도메인 의미가 손실됨
4. **노드 이름도 추상적** — 위 문제들이 해결되면 자연스럽게 개선됨 (LLM이 그래프 도메인을 알면 더 구체적인 이름을 붙임)

---

## 근본 원인

### graph-policy.json이 비어 있으면 LLM이 기본값만 씀

`graph-policy.json`이 없거나 `managedGraphs: []`이면:

- LLM은 `graph:` frontmatter 필드를 생성하지 않음 → 모든 노드가 `main`으로 분류
- LLM은 범용 타입(`REQUIRES`, `PART_OF` 등)만 사용 → 게임 도메인 관계가 표현되지 않음
- 전체 프로젝트에 relation types 4개만 공유 → 그래프마다 다른 의미 관계를 표현할 수 없음

### 구버전 코드의 타입 구조 한계

```ts
// 구버전: 전체 프로젝트에 4개 타입 공유
interface GraphPolicy {
  relationTypes: string[]   // ← 모든 그래프가 이걸 공유
  managedGraphs: string[]
  forbiddenTypes: string[]
}
```

### 관계 타입 상한 불일치 (수정됨)

구버전에서 `sanitize(..., 8)`로 그래프당 최대 8개를 허용했으나, 목표(4개)와 불일치했다.
→ `sanitize(..., 4)`로 통일, 기존 6개짜리 그래프를 4개 이하 두 그래프로 분리.

---

## 코드 구현 현황

| Fix | 내용 | 상태 |
|-----|------|------|
| Fix 1 | `buildAnalysisPrompt()`에 기존 그래프 현황(`existingGraphSummary`) 주입 | ✅ 완료 (`ingest.ts:988`) |
| Fix 2 | `buildGenerationPrompt()`에 `[[target\|TYPE]]` wikilink 지시 강화 | ✅ 완료 (`ingest.ts:1061`) |
| Fix 3 | `DEFAULT_POLICY`에 게임 특화 managedGraphs 40개 이상 + graphRelationTypes 추가 | ✅ 완료 (`graph-policy.ts`) |
| Fix 4 | `autoIngestImpl()`에서 `existingGraphSummary` 생성 및 주입 | ✅ 완료 (`ingest.ts:416`) |
| Fix 5 | `parseFalkorQueryResult()` 엣지 파싱 키 이름 검증 | ✅ 완료 (`falkor-visualization.ts:79`) |
| Fix 6 | `GraphPolicy` 타입에 `graphRelationTypes: Record<string, string[]>` 추가 | ✅ 완료 (`graph-policy.ts`) |
| Fix 7 | `buildGraphPolicyPrompt()`가 그래프별 relation types를 LLM에 전달 | ✅ 완료 (`graph-policy.ts`) |
| Fix 8 | `graph-view.tsx` UI — 선택된 그래프의 relation types 편집 | ✅ 완료 (`graph-view.tsx`) |
| Fix 9 | `schema-validation.ts` — 드리프트 검사를 전체 허용 타입 합집합으로 | ✅ 완료 (`schema-validation.ts`) |
| Fix 10 | `project-init.ts` — 신규 프로젝트에 `DEFAULT_POLICY` 직접 저장 (16개 → 40+개 그래프) | ✅ 완료 (`project-init.ts`) |

---

## 최종 구조

### GraphPolicy 타입 (`src/lib/graph-policy.ts`)

```ts
interface GraphPolicy {
  relationTypes: string[]                    // 전역 fallback (managed graph 없을 때)
  managedGraphs: string[]                    // 등록된 그래프 이름 목록
  forbiddenTypes: string[]                   // LLM이 절대 쓰면 안 되는 타입
  graphRelationTypes: Record<string, string[]> // 그래프별 relation types (핵심 추가)
}
```

### 기본 제공 Managed Graphs + Relation Types (40개 이상, 그래프당 최대 4개)

그래프명에 관계 성격을 반영 — 드롭다운에서 어떤 관계를 다루는지 바로 파악 가능.

| 그래프 | Relation Types |
|--------|---------------|
| `combat_weakness_graph` | WEAK_AGAINST, STRONG_AGAINST, COUNTERS, RESISTS |
| `combat_combo_graph` | COMBO_WITH, INTERRUPTS, CHAINS_INTO, CANCELS |
| `skill_upgrade_graph` | UPGRADES_TO, BRANCHES_INTO, UNLOCKS, PROMOTES_TO |
| `skill_require_graph` | REQUIRES, ENHANCED_BY, CONSUMES, MODIFIED_BY |
| `skill_synergy_graph` | SYNERGIZES_WITH, COMBOS_WITH, REDUCES_CD, BOOSTS |
| `skill_scaling_graph` | SCALES_WITH, REQUIRES_STAT, CONVERTS_TO, CAPPED_BY |
| `skill_tag_graph` | HAS_TAG, ELEMENT_OF, WEAPON_TYPE, CATEGORY_OF |
| `enemy_loot_graph` | DROPS_ITEM, GUARDS, ENRAGES_AT, DROPS_FROM |
| `enemy_spawn_graph` | SPAWNS_IN, VARIANTS_OF, PATROLS, ALLIED_WITH |
| `enemy_tactic_graph` | USES_SKILL, TARGETS, FLEES_AT, PHASES_INTO |
| `dungeon_route_graph` | CONNECTS_TO, LEADS_TO, BRANCHES_INTO, LOOPS_BACK |
| `dungeon_unlock_graph` | REQUIRES_ITEM, HAS_BOSS, UNLOCKS, BLOCKS |
| `item_craft_graph` | CRAFTS_INTO, REQUIRES, CONSUMED_BY, PRICED_BY |
| `item_enhance_graph` | ENHANCES, DROPS_FROM, UPGRADES_TO, DISMANTLES_INTO |
| `item_set_graph` | PART_OF_SET, SYNERGIZES_WITH, REQUIRED_FOR, EQUIPPED_BY |
| `quest_flow_graph` | NEXT, TRIGGERS, BLOCKS, BRANCHES_INTO |
| `quest_reward_graph` | REQUIRES, UNLOCKS, REWARDS, PART_OF |
| `ui_nav_graph` | NAVIGATES_TO, OPENS, CLOSES, PARENT_OF |
| `ui_trigger_graph` | TRIGGERS, REQUIRES, BLOCKS, CHILD_OF |
| `progression_unlock_graph` | UPGRADES_TO, UNLOCKS, GRANTS, CAPS_AT |
| `progression_require_graph` | REQUIRES, PREREQUISITES, PART_OF, LEADS_TO |
| `stat_relation_graph` | INFLUENCES, DERIVED_FROM, CAPS, AUGMENTS |
| `system_loop_graph` | FEEDS_INTO, PROVIDES_RESOURCE_FOR, GATED_BY, CONSUMES |
| `system_logic_graph` | OVERRIDES, TRIGGERS, BLOCKS, REQUIRES |
| `npc_relation_graph` | ALLIED_WITH, HOSTILE_TO, MEMBER_OF, RIVALS |
| `npc_service_graph` | SELLS, GIVES_QUEST, LOCATED_IN, GUARDS |
| `faction_war_graph` | ALLIED_WITH, AT_WAR_WITH, RIVALS, CONTROLS |
| `faction_trade_graph` | TRADES_WITH, GOVERNS, DOMINATES, TRIBUTE_TO |
| `map_connect_graph` | CONNECTS_TO, ADJACENT_TO, LEADS_TO, PART_OF |
| `map_contain_graph` | CONTAINS, OWNED_BY, SPAWNS, BORDERS |
| `economy_trade_graph` | TRADES_WITH, PRICED_BY, COMPETES_WITH, MONOPOLIZES |
| `economy_produce_graph` | PRODUCES, REQUIRES, CONSUMED_BY, CRAFTS_INTO |
| `ability_stack_graph` | STACKS_WITH, OVERRIDES, EXTENDS, MODIFIED_BY |
| `ability_trigger_graph` | ENHANCES, REQUIRES, TRIGGERS, APPLIED_BY |
| `buff_counter_graph` | COUNTERS, OVERRIDES, STACKS_WITH, EXTENDS |
| `buff_apply_graph` | APPLIED_BY, REMOVED_BY, TRIGGERED_BY, GRANTS |
| `class_promote_graph` | PROMOTES_TO, SPECIALIZES_INTO, BRANCHES_INTO, RIVALS |
| `class_synergy_graph` | REQUIRES, SHARES_SKILL_WITH, SYNERGIZES_WITH, COUNTERS |
| `achievement_track_graph` | TRACKS, PART_OF, LEADS_TO, CHAINS_INTO |
| `achievement_reward_graph` | REQUIRES, UNLOCKS, REWARDS, PREREQUISITES |
| `event_chain_graph` | TRIGGERS, FOLLOWS, BRANCHES_INTO, CANCELS |
| `event_condition_graph` | REQUIRES, EXCLUDES, REWARDS, PART_OF |
| `pet_evolve_graph` | EVOLVES_INTO, BONDS_WITH, HATCHES_FROM, VARIANT_OF |
| `pet_skill_graph` | TEACHES, SYNERGIZES_WITH, REQUIRES, ENHANCES |
| `mount_unlock_graph` | UNLOCKS, UPGRADES_TO, REQUIRES, OBTAINABLE_FROM |
| `mount_terrain_graph` | TRAVERSES, BLOCKED_BY, ENHANCED_BY, PART_OF |
| `guild_rank_graph` | PROMOTES_TO, GRANTS, REQUIRES, OVERSEES |
| `guild_alliance_graph` | ALLIED_WITH, AT_WAR_WITH, MERGED_WITH, RIVALS |
| `dialogue_flow_graph` | LEADS_TO, BRANCHES_INTO, TRIGGERS, REQUIRES |
| `dialogue_impact_graph` | INCREASES, DECREASES, LOCKS, UNLOCKS |
| `lore_reference_graph` | REFERENCES, CONTRADICTS, EXPANDS_ON, PART_OF |
| `lore_timeline_graph` | PRECEDES, CAUSES, CONCURRENT_WITH, RETCONNED_BY |
| `status_apply_graph` | INFLICTED_BY, CURED_BY, IMMUNE_TO, TRIGGERS |
| `status_interact_graph` | COMBINES_WITH, OVERRIDES, EXTENDS, COUNTERS |
| `zone_tier_graph` | HIGHER_TIER_THAN, CONNECTS_TO, UNLOCKS, PART_OF |
| `zone_resource_graph` | CONTAINS, EXCLUSIVE_TO, SHARED_WITH, SEASONAL_IN |

### LLM 프롬프트 구조 (`buildGraphPolicyPrompt`)

managed graphs가 있을 때:
```
## Managed Graphs (project-defined)
Available graphs: combat_graph, skill_graph, enemy_graph, ...

## Per-Graph Relation Types (project-defined)
  combat_graph: WEAK_AGAINST, STRONG_AGAINST, COUNTERS, ...
  skill_graph: UPGRADES_TO, REQUIRES, ENHANCED_BY, ...
  ...
```

managed graphs가 없을 때 (fallback):
```
## Graph Relation Policy (project-defined)
Allowed relation types: UPGRADES_TO, WEAK_AGAINST, DROPS_ITEM, UNLOCKS
```

### UI 동작 (`graph-view.tsx`)

- Knowledge 탭 상단 드롭다운에서 그래프 선택
- **Relation Types 패널이 선택된 그래프의 타입으로 즉시 전환**
  - `skill_graph` 선택 → UPGRADES_TO, REQUIRES, ENHANCED_BY, ... 표시
  - `combat_graph` 선택 → WEAK_AGAINST, STRONG_AGAINST, COUNTERS, ... 표시
  - `main` 선택 → 전역 fallback 타입 표시
- Add/Remove로 해당 그래프의 타입만 편집 (다른 그래프에 영향 없음)

---

## 사용 방법

새 프로젝트를 만들면 위 40개 이상의 그래프와 각각의 relation types가 자동으로 적용됨.
기존 프로젝트는 `.llm-wiki/graph-policy.json`을 삭제하면 DEFAULT_POLICY로 재초기화됨.

### 재ingest

설정 저장 후 기존 ingest된 파일을 다시 ingest하면 LLM이 새 설정을 반영:
- 각 db/ 파일 frontmatter에 `graph: skill_graph` 같은 값 생성
- 본문에 `[[대상노드|WEAK_AGAINST]]` 같은 그래프 특화 wikilink 생성

Raw 탭 또는 사이드바 하단 `DatabaseZap` 버튼으로 파일 선택 → ingest 큐에 등록.

### 확인

1. 생성된 `db/` 파일의 frontmatter에 `graph: <graph_name>` 값이 있는지 확인
2. 본문에 해당 그래프의 relation type이 사용된 wikilink가 있는지 확인
3. Graph 탭 > Knowledge 탭에서 그래프 드롭다운을 변경하며 각 도메인 그래프 시각화 확인

---

## 참고: graph-schema.md

`schema/graph-schema.md`에 도메인별 추천 Edge Types 전체 목록이 정리되어 있음.
