import { createDirectory, fileExists, readFile, writeFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"

export interface GraphPolicy {
  managedGraphs: string[]
  /** Per-graph relation types. Key = graph name, value = allowed types (max 4 each). */
  graphRelationTypes: Record<string, string[]>
}

export const DEFAULT_POLICY: GraphPolicy = {
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
    return {
      managedGraphs: sanitize(Array.isArray(parsed.managedGraphs) ? parsed.managedGraphs : [], 200),
      graphRelationTypes: sanitizeGraphRelationTypes(parsed.graphRelationTypes),
    }
  } catch {
    return DEFAULT_POLICY
  }
}

export async function saveGraphPolicy(projectPath: string, policy: GraphPolicy): Promise<GraphPolicy> {
  const pp = normalizePath(projectPath)
  await createDirectory(`${pp}/.llm-wiki`)
  const normalized: GraphPolicy = {
    managedGraphs: sanitize(policy.managedGraphs, 200),
    graphRelationTypes: sanitizeGraphRelationTypes(policy.graphRelationTypes),
  }
  await writeFile(policyPath(pp), JSON.stringify(normalized, null, 2))
  return normalized
}

export function buildGraphPolicyPrompt(policy: GraphPolicy): string {
  const parts: string[] = []

  if (policy.managedGraphs.length > 0) {
    const prefixes = Array.from(
      new Set(policy.managedGraphs.filter((g) => g.includes("_")).map((g) => g.split("_")[0]))
    )
    parts.push(
      "## Managed Graphs (project-defined)",
      "For each triple, set its `graph` field to the graph whose domain best matches that relationship.",
      "If no existing graph fits, create a new graph assignment with `new_graph: true`.",
      "When naming a new graph, use a `{purpose}_{domain-or-action}` snake_case name (e.g. `casemap_use_item`, `playlog_move_server`).",
    )
    if (prefixes.length > 0) {
      parts.push(`Existing purpose prefixes already in use: ${prefixes.join(", ")}. Prefer reusing one of these over inventing a new prefix.`)
    }
    parts.push(
      `Available graphs: ${policy.managedGraphs.join(", ")}`,
      "",
      "## Per-Graph Relation Types (project-defined)",
      "Each graph may have at most 4 relation types.",
      "Prefer an existing graph when its domain matches the source relationship.",
      "If the matching graph already has the needed relation type, use it.",
      "If the matching graph has fewer than 4 relation types and needs a new type, you may extend that graph by returning the full expanded `graph_relation_types` list.",
      "If the matching graph already has 4 relation types and a new type is required, do not force the relationship into that graph; create a new graph instead.",
      "Use the relation type as the triple's `predicate`; do not encode relation types as wikilinks.",
      "Do not omit meaningful relation types from graph assignments; typed relationships are required for meaningful node/edge/node facts.",
    )

    for (const g of policy.managedGraphs) {
      const types = policy.graphRelationTypes[g]
      if (types && types.length > 0) {
        parts.push(`  ${g}: ${types.join(", ")}`)
      }
    }
  }
  // No managed graphs (first ingest of a new project) — no relation policy
  // block; graph assignment's base instructions (`new_graph` +
  // `graph_relation_types`) handle proposing graphs and their types.

  return parts.join("\n")
}
