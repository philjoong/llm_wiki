import { createDirectory, fileExists, readFile, writeFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"

export interface GraphPolicy {
  /** Global fallback relation types (used when a graph has no per-graph entry). Max 4. */
  relationTypes: string[]
  managedGraphs: string[]
  forbiddenTypes: string[]
  /** Per-graph relation types. Key = graph name, value = allowed types (max 4 each). */
  graphRelationTypes: Record<string, string[]>
}

const DEFAULT_GRAPH_RELATION_TYPES: Record<string, string[]> = {
  // Combat: weakness/resistance relationships
  combat_weakness_graph: ["WEAK_AGAINST", "STRONG_AGAINST", "COUNTERS", "RESISTS"],
  // Combat: combo/interrupt chaining
  combat_combo_graph: ["COMBO_WITH", "INTERRUPTS", "CHAINS_INTO", "CANCELS"],

  // Skill: upgrade/unlock tree
  skill_upgrade_graph: ["UPGRADES_TO", "BRANCHES_INTO", "UNLOCKS", "PROMOTES_TO"],
  // Skill: resource/enhancement dependencies
  skill_require_graph: ["REQUIRES", "ENHANCED_BY", "CONSUMES", "MODIFIED_BY"],
  // Skill: tactical synergy & combos
  skill_synergy_graph: ["SYNERGIZES_WITH", "COMBOS_WITH", "REDUCES_CD", "BOOSTS"],
  // Skill: stat scaling & mathematical links
  skill_scaling_graph: ["SCALES_WITH", "REQUIRES_STAT", "CONVERTS_TO", "CAPPED_BY"],
  // Skill: taxonomy & categorization
  skill_tag_graph: ["HAS_TAG", "ELEMENT_OF", "WEAPON_TYPE", "CATEGORY_OF"],

  // Enemy: loot/guard behavior
  enemy_loot_graph: ["DROPS_ITEM", "GUARDS", "ENRAGES_AT", "DROPS_FROM"],
  // Enemy: spawn/variant location
  enemy_spawn_graph: ["SPAWNS_IN", "VARIANTS_OF", "PATROLS", "ALLIED_WITH"],
  // Enemy: tactic & behavior patterns
  enemy_tactic_graph: ["USES_SKILL", "TARGETS", "FLEES_AT", "PHASES_INTO"],

  // Dungeon: route/traversal
  dungeon_route_graph: ["CONNECTS_TO", "LEADS_TO", "BRANCHES_INTO", "LOOPS_BACK"],
  // Dungeon: unlock/boss gate
  dungeon_unlock_graph: ["REQUIRES_ITEM", "HAS_BOSS", "UNLOCKS", "BLOCKS"],

  // Item: crafting/consumption
  item_craft_graph: ["CRAFTS_INTO", "REQUIRES", "CONSUMED_BY", "PRICED_BY"],
  // Item: enhancement/drop source
  item_enhance_graph: ["ENHANCES", "DROPS_FROM", "UPGRADES_TO", "DISMANTLES_INTO"],
  // Item: equipment & set bonuses
  item_set_graph: ["PART_OF_SET", "SYNERGIZES_WITH", "REQUIRED_FOR", "EQUIPPED_BY"],

  // Quest: narrative flow
  quest_flow_graph: ["NEXT", "TRIGGERS", "BLOCKS", "BRANCHES_INTO"],
  // Quest: requirements/rewards
  quest_reward_graph: ["REQUIRES", "UNLOCKS", "REWARDS", "PART_OF"],

  // UI: screen navigation
  ui_nav_graph: ["NAVIGATES_TO", "OPENS", "CLOSES", "PARENT_OF"],
  // UI: state triggers
  ui_trigger_graph: ["TRIGGERS", "REQUIRES", "BLOCKS", "CHILD_OF"],

  // Progression: unlock/grant tree
  progression_unlock_graph: ["UPGRADES_TO", "UNLOCKS", "GRANTS", "CAPS_AT"],
  // Progression: prerequisite chain
  progression_require_graph: ["REQUIRES", "PREREQUISITES", "PART_OF", "LEADS_TO"],

  // Stat: attribute relationship & formulas
  stat_relation_graph: ["INFLUENCES", "DERIVED_FROM", "CAPS", "AUGMENTS"],

  // System: high-level game loops & mechanics
  system_loop_graph: ["FEEDS_INTO", "PROVIDES_RESOURCE_FOR", "GATED_BY", "CONSUMES"],
  // System: logic gates & overrides
  system_logic_graph: ["OVERRIDES", "TRIGGERS", "BLOCKS", "REQUIRES"],

  // NPC: faction/alignment relations
  npc_relation_graph: ["ALLIED_WITH", "HOSTILE_TO", "MEMBER_OF", "RIVALS"],
  // NPC: services/location
  npc_service_graph: ["SELLS", "GIVES_QUEST", "LOCATED_IN", "GUARDS"],

  // Faction: war/alliance politics
  faction_war_graph: ["ALLIED_WITH", "AT_WAR_WITH", "RIVALS", "CONTROLS"],
  // Faction: trade/governance
  faction_trade_graph: ["TRADES_WITH", "GOVERNS", "DOMINATES", "TRIBUTE_TO"],

  // Map: connectivity/traversal
  map_connect_graph: ["CONNECTS_TO", "ADJACENT_TO", "LEADS_TO", "PART_OF"],
  // Map: ownership/containment
  map_contain_graph: ["CONTAINS", "OWNED_BY", "SPAWNS", "BORDERS"],

  // Economy: trade/pricing
  economy_trade_graph: ["TRADES_WITH", "PRICED_BY", "COMPETES_WITH", "MONOPOLIZES"],
  // Economy: production/consumption
  economy_produce_graph: ["PRODUCES", "REQUIRES", "CONSUMED_BY", "CRAFTS_INTO"],

  // Ability: stacking/override interactions
  ability_stack_graph: ["STACKS_WITH", "OVERRIDES", "EXTENDS", "MODIFIED_BY"],
  // Ability: trigger/application
  ability_trigger_graph: ["ENHANCES", "REQUIRES", "TRIGGERS", "APPLIED_BY"],

  // Buff: counter/override interactions
  buff_counter_graph: ["COUNTERS", "OVERRIDES", "STACKS_WITH", "EXTENDS"],
  // Buff: application/removal lifecycle
  buff_apply_graph: ["APPLIED_BY", "REMOVED_BY", "TRIGGERED_BY", "GRANTS"],

  // Class: promotion/specialization tree
  class_promote_graph: ["PROMOTES_TO", "SPECIALIZES_INTO", "BRANCHES_INTO", "RIVALS"],
  // Class: synergy/shared skills
  class_synergy_graph: ["REQUIRES", "SHARES_SKILL_WITH", "SYNERGIZES_WITH", "COUNTERS"],

  // Achievement: tracking/chain
  achievement_track_graph: ["TRACKS", "PART_OF", "LEADS_TO", "CHAINS_INTO"],
  // Achievement: requirements/rewards
  achievement_reward_graph: ["REQUIRES", "UNLOCKS", "REWARDS", "PREREQUISITES"],

  // Event: narrative sequence/branching
  event_chain_graph: ["TRIGGERS", "FOLLOWS", "BRANCHES_INTO", "CANCELS"],
  // Event: conditions/participation
  event_condition_graph: ["REQUIRES", "EXCLUDES", "REWARDS", "PART_OF"],

  // Pet: evolution/bonding
  pet_evolve_graph: ["EVOLVES_INTO", "BONDS_WITH", "HATCHES_FROM", "VARIANT_OF"],
  // Pet: skills/synergy
  pet_skill_graph: ["TEACHES", "SYNERGIZES_WITH", "REQUIRES", "ENHANCES"],

  // Mount: unlock/speed tier
  mount_unlock_graph: ["UNLOCKS", "UPGRADES_TO", "REQUIRES", "OBTAINABLE_FROM"],
  // Mount: terrain/ability
  mount_terrain_graph: ["TRAVERSES", "BLOCKED_BY", "ENHANCED_BY", "PART_OF"],

  // Guild: rank/permission hierarchy
  guild_rank_graph: ["PROMOTES_TO", "GRANTS", "REQUIRES", "OVERSEES"],
  // Guild: alliance/rivalry
  guild_alliance_graph: ["ALLIED_WITH", "AT_WAR_WITH", "MERGED_WITH", "RIVALS"],

  // Dialogue: conversation flow
  dialogue_flow_graph: ["LEADS_TO", "BRANCHES_INTO", "TRIGGERS", "REQUIRES"],
  // Dialogue: relationship/reputation impact
  dialogue_impact_graph: ["INCREASES", "DECREASES", "LOCKS", "UNLOCKS"],

  // Lore: world-building connections
  lore_reference_graph: ["REFERENCES", "CONTRADICTS", "EXPANDS_ON", "PART_OF"],
  // Lore: timeline/causality
  lore_timeline_graph: ["PRECEDES", "CAUSES", "CONCURRENT_WITH", "RETCONNED_BY"],

  // Status effect: application/immunity
  status_apply_graph: ["INFLICTED_BY", "CURED_BY", "IMMUNE_TO", "TRIGGERS"],
  // Status effect: interaction/escalation
  status_interact_graph: ["COMBINES_WITH", "OVERRIDES", "EXTENDS", "COUNTERS"],

  // Zone: level/danger tier
  zone_tier_graph: ["HIGHER_TIER_THAN", "CONNECTS_TO", "UNLOCKS", "PART_OF"],
  // Zone: resource/spawn distribution
  zone_resource_graph: ["CONTAINS", "EXCLUSIVE_TO", "SHARED_WITH", "SEASONAL_IN"],
}

export const DEFAULT_POLICY: GraphPolicy = {
  relationTypes: ["UPGRADES_TO", "WEAK_AGAINST", "DROPS_ITEM", "UNLOCKS"],
  managedGraphs: Object.keys(DEFAULT_GRAPH_RELATION_TYPES),
  forbiddenTypes: [],
  graphRelationTypes: DEFAULT_GRAPH_RELATION_TYPES,
}

function policyPath(projectPath: string): string {
  return `${normalizePath(projectPath)}/.llm-wiki/graph-policy.json`
}

function sanitize(items: string[], max: number): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of items) {
    const value = String(raw ?? "").trim()
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
    if (out.length >= max) break
  }
  return out
}

function sanitizeGraphRelationTypes(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const result: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = String(k).trim()
    if (!key) continue
    result[key] = sanitize(Array.isArray(v) ? v : [], 4)
  }
  return result
}

export async function loadGraphPolicy(projectPath: string): Promise<GraphPolicy> {
  const path = policyPath(projectPath)
  try {
    if (!(await fileExists(path))) return DEFAULT_POLICY
    const raw = await readFile(path)
    const parsed = JSON.parse(raw) as Partial<GraphPolicy>
    const relationTypes = sanitize(Array.isArray(parsed.relationTypes) ? parsed.relationTypes : [], 4)
    const managedGraphs = sanitize(Array.isArray(parsed.managedGraphs) ? parsed.managedGraphs : [], 200)
    const graphRelationTypes = sanitizeGraphRelationTypes(parsed.graphRelationTypes)

    // Fill in defaults for managed graphs that have no per-graph types yet
    for (const g of managedGraphs) {
      if (!graphRelationTypes[g] || graphRelationTypes[g].length === 0) {
        graphRelationTypes[g] = DEFAULT_GRAPH_RELATION_TYPES[g] ?? []
      }
    }

    return {
      relationTypes: relationTypes.length > 0 ? relationTypes : DEFAULT_POLICY.relationTypes,
      managedGraphs: managedGraphs.length > 0 ? managedGraphs : DEFAULT_POLICY.managedGraphs,
      forbiddenTypes: sanitize(Array.isArray(parsed.forbiddenTypes) ? parsed.forbiddenTypes : [], 50),
      graphRelationTypes: Object.keys(graphRelationTypes).length > 0 ? graphRelationTypes : DEFAULT_POLICY.graphRelationTypes,
    }
  } catch {
    return DEFAULT_POLICY
  }
}

export async function saveGraphPolicy(projectPath: string, policy: GraphPolicy): Promise<GraphPolicy> {
  const pp = normalizePath(projectPath)
  await createDirectory(`${pp}/.llm-wiki`)
  const normalized: GraphPolicy = {
    relationTypes: sanitize(policy.relationTypes, 4),
    managedGraphs: sanitize(policy.managedGraphs, 200),
    forbiddenTypes: sanitize(policy.forbiddenTypes, 50),
    graphRelationTypes: sanitizeGraphRelationTypes(policy.graphRelationTypes),
  }
  await writeFile(policyPath(pp), JSON.stringify(normalized, null, 2))
  return normalized
}

export function buildGraphPolicyPrompt(policy: GraphPolicy): string {
  const parts: string[] = []

  if (policy.managedGraphs.length > 0) {
    parts.push(
      "## Managed Graphs (project-defined)",
      "For each Stage 2 triple, set its `graph` field to the graph whose domain best matches that relationship.",
      "If no existing graph fits, create a new graph assignment with `new_graph: true`.",
      `Available graphs: ${policy.managedGraphs.join(", ")}`,
      "",
      "## Per-Graph Relation Types (project-defined)",
      "Each graph may have at most 4 relation types.",
      "Prefer an existing graph when its domain matches the source relationship.",
      "If the matching graph already has the needed relation type, use it.",
      "If the matching graph has fewer than 4 relation types and needs a new type, you may extend that graph by returning the full expanded `graph_relation_types` list.",
      "If the matching graph already has 4 relation types and a new type is required, do not force the relationship into that graph; create a new graph instead.",
      "Use the relation type as the triple's `predicate`; do not encode relation types as wikilinks.",
      "Do not omit meaningful relation types from Stage 2 assignments; typed relationships are required for meaningful node/edge/node facts.",
    )

    for (const g of policy.managedGraphs) {
      const types = policy.graphRelationTypes[g]
      if (types && types.length > 0) {
        parts.push(`  ${g}: ${types.join(", ")}`)
      }
    }
  } else {
    // No managed graphs — fall back to global relation types
    if (policy.relationTypes.length > 0) {
      parts.push(
        "## Graph Relation Policy (project-defined)",
        "Use these relation types when they fit the relationship.",
        "If the target graph has fewer than 4 relation types, Stage 2 may propose a new relation type by returning an expanded `graph_relation_types` list.",
        "If a graph already has 4 relation types and a new type is required, create a new graph instead of omitting the relationship.",
        `Allowed relation types: ${policy.relationTypes.join(", ")}`,
        "Use the selected relation type as the triple's `predicate`; do not encode relation types as wikilinks.",
      )
    }
  }

  if (policy.forbiddenTypes.length > 0) {
    parts.push(
      `NEVER use the following forbidden relation types: ${policy.forbiddenTypes.join(", ")}`,
    )
  }

  return parts.join("\n")
}

/** Returns the allowed relation types for a specific graph (falls back to global). */
export function getRelationTypesForGraph(policy: GraphPolicy, graphName: string): string[] {
  const perGraph = policy.graphRelationTypes[graphName]
  if (perGraph && perGraph.length > 0) return perGraph
  return policy.relationTypes
}
