import { createDirectory, fileExists, readFile, writeFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"

export interface GraphPolicy {
  /** Global fallback relation types (used when a graph has no per-graph entry). Max 4. */
  relationTypes: string[]
  managedGraphs: string[]
  /** Per-graph relation types. Key = graph name, value = allowed types (max 4 each). */
  graphRelationTypes: Record<string, string[]>
}

export const DEFAULT_POLICY: GraphPolicy = {
  relationTypes: ["UPGRADES_TO", "WEAK_AGAINST", "DROPS_ITEM", "UNLOCKS"],
  managedGraphs: [],
  graphRelationTypes: {},
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

    return {
      relationTypes: relationTypes.length > 0 ? relationTypes : DEFAULT_POLICY.relationTypes,
      managedGraphs,
      graphRelationTypes,
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

  return parts.join("\n")
}

/** Returns the allowed relation types for a specific graph (falls back to global). */
export function getRelationTypesForGraph(policy: GraphPolicy, graphName: string): string[] {
  const perGraph = policy.graphRelationTypes[graphName]
  if (perGraph && perGraph.length > 0) return perGraph
  return policy.relationTypes
}
