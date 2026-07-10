import { getGraphBackend, type GraphSnapshot } from "@/lib/graph-backend"
import { loadGraphPolicy } from "@/lib/graph-policy"
import { loadEntityDict, findCandidates, resolveEntitySeeds, type EntityDict } from "@/lib/entity-dict"
import { filterSnapshotByHops } from "@/lib/graph-hop"
import type { LlmConfig } from "@/stores/wiki-store"
import { streamChat } from "./llm-client"
import { extractJsonObject } from "./sweep-reviews"

const RELATION_LIMIT = 80
const NODE_LIMIT = 20
const PATH_MAX_DEPTH = 6
// Indirect-impact expansion for entity node queries (e.g. "Entity A의 영향도").
// Separate from PATH_MAX_DEPTH — this bounds how far a single entity's
// neighborhood is walked, not the search for a connection between two.
const ENTITY_IMPACT_HOPS = 2

export interface GraphContextBlock {
  graphName: string
  reasoning: string
  lines: string[]
  truncated: boolean
}

interface GraphSelection {
  graph: string
  relationTypes: string[]
  entities: string[]
}

interface GraphSelectionResponse {
  selections: GraphSelection[]
  reasoning: string
}

/**
 * Identify relevant graphs/relation types/entities for a question, run the
 * corresponding relation/node/path queries, and format results as context
 * blocks. Returns [] if nothing is relevant — callers must not fabricate
 * context when this is empty.
 *
 * `graphPrefixFilter`, when given, narrows the candidate graphs to those
 * whose name starts with it (e.g. "casemap_", "persona_") before the LLM
 * even sees the list — used by per-tab queries that must only see their own
 * domain's graphs. Omitted (chat) means the full `managedGraphs` list.
 */
export async function getGraphContext(
  question: string,
  projectPath: string,
  projectName: string,
  llmConfig: LlmConfig,
  graphPrefixFilter?: string,
): Promise<GraphContextBlock[]> {
  const policy = await loadGraphPolicy(projectPath)
  const managedGraphs = graphPrefixFilter
    ? policy.managedGraphs.filter((g) => g.startsWith(graphPrefixFilter))
    : policy.managedGraphs
  if (managedGraphs.length === 0) return []
  const scopedPolicy = { ...policy, managedGraphs }

  const selections = await selectRelevantGraphs(question, scopedPolicy, llmConfig)
  if (selections.length === 0) return []

  const backend = await getGraphBackend(projectPath)
  const entityDict = await loadEntityDict(projectPath)
  const blocks: GraphContextBlock[] = []

  for (const selection of selections) {
    const lines: string[] = []
    let truncated = false

    for (const relationType of selection.relationTypes) {
      try {
        const snapshot = await backend.queryGraph(projectName, selection.graph, { type: "relation", relationType })
        lines.push(...formatSnapshotLines(snapshot))
        if (snapshot.edges.length >= RELATION_LIMIT) truncated = true
      } catch (err) {
        console.warn(`[GraphQna] relation query failed for ${selection.graph}/${relationType}:`, err)
      }
    }

    if (selection.entities.length > 0) {
      // Load the full graph once so entity names can be normalized via the
      // entity dictionary (canonicalName/aliases exact match) before
      // querying — the backend's own matching is a LIKE substring match,
      // which does not know about aliases.
      let graphSnapshot: GraphSnapshot | null = null
      try {
        graphSnapshot = await backend.queryGraph(projectName, selection.graph, { type: "all" })
      } catch (err) {
        console.warn(`[GraphQna] full-graph load failed for ${selection.graph}:`, err)
      }
      const resolvedNames = selection.entities.map((entity) =>
        resolveNodeName(entity, entityDict, selection.graph, graphSnapshot),
      )

      for (const nodeName of resolvedNames) {
        try {
          const snapshot = await backend.queryGraph(projectName, selection.graph, { type: "node", nodeName })
          lines.push(...formatSnapshotLines(snapshot))
          if (snapshot.nodes.length >= NODE_LIMIT) truncated = true
        } catch (err) {
          console.warn(`[GraphQna] node query failed for ${selection.graph}/${nodeName}:`, err)
        }
      }

      // Indirect-impact expansion: walk out from each resolved entity up to
      // ENTITY_IMPACT_HOPS so "Entity A의 영향도" questions also surface
      // A→B→C relations, not just A's direct edges from the node query above.
      if (graphSnapshot) {
        const seedIds = graphSnapshot.nodes
          .filter((n) => resolvedNames.includes(n.name))
          .map((n) => n.id)
        if (seedIds.length > 0) {
          const hopSnapshot = filterSnapshotByHops(graphSnapshot, seedIds, ENTITY_IMPACT_HOPS)
          lines.push(...formatSnapshotLines(hopSnapshot))
        }
      }

      if (resolvedNames.length >= 2) {
        try {
          const pathSnapshot = await backend.queryGraph(projectName, selection.graph, {
            type: "path",
            fromNode: resolvedNames[0],
            toNode: resolvedNames[1],
            maxDepth: PATH_MAX_DEPTH,
          })
          lines.push(...formatSnapshotLines(pathSnapshot))
        } catch (err) {
          console.warn(`[GraphQna] path query failed for ${selection.graph}/${resolvedNames[0]}-${resolvedNames[1]}:`, err)
        }
      }
    }

    const dedupedLines = Array.from(new Set(lines))
    if (dedupedLines.length === 0) continue

    blocks.push({
      graphName: selection.graph,
      reasoning: selection.relationTypes.length > 0 || selection.entities.length > 0
        ? "Selected by graph relevance prompt."
        : "Selected by graph relevance prompt (no relation types or entities extracted).",
      lines: dedupedLines,
      truncated,
    })
  }

  return blocks
}

/**
 * Resolve an LLM-extracted entity name to the node name to query. Looks up
 * the name in the entity dictionary (exact canonicalName/alias match), then
 * uses `resolveEntitySeeds()` against the graph's current snapshot to find
 * the matching node's actual stored name. Falls back to the raw extracted
 * name when there is no dictionary match or no snapshot — the backend's own
 * LIKE matching then takes over.
 */
function resolveNodeName(
  entity: string,
  entityDict: EntityDict,
  graphName: string,
  snapshot: GraphSnapshot | null,
): string {
  if (!snapshot) return entity
  const exact = findCandidates(entity, entityDict).find((c) => c.match === "exact")
  if (!exact) return entity
  const seeds = resolveEntitySeeds(exact.entry, graphName, snapshot)
  return seeds[0] ?? entity
}

/** Join GraphContextBlock[] into a single "## Knowledge Graph Context" section for an LLM prompt. Empty input yields "". */
export function formatGraphContextBlocks(blocks: GraphContextBlock[]): string {
  if (blocks.length === 0) return ""
  return [
    "## Knowledge Graph Context",
    ...blocks.map((b) => {
      const limitNote = b.truncated ? "\n(Result limit reached — this list may be incomplete.)" : ""
      return `### Graph: ${b.graphName}\nReasoning: ${b.reasoning}\n${b.lines.join("\n")}${limitNote}`
    }),
  ].join("\n\n")
}

function formatSnapshotLines(snapshot: GraphSnapshot): string[] {
  return snapshot.edges.map((edge) => {
    const subject = String(edge.properties.subject ?? "")
    const object = String(edge.properties.object ?? "")
    const pagePath = edge.properties.page_path ? String(edge.properties.page_path) : undefined
    const source = pagePath ? ` (source: ${pagePath})` : ""
    return `- ${subject} --${edge.relationType}--> ${object}${source}`
  })
}

async function selectRelevantGraphs(
  question: string,
  policy: { managedGraphs: string[]; graphRelationTypes: Record<string, string[]> },
  llmConfig: LlmConfig,
): Promise<GraphSelection[]> {
  const graphLines = policy.managedGraphs.map((g) => {
    const types = policy.graphRelationTypes[g] ?? []
    return types.length > 0 ? `${g}: ${types.join(", ")}` : g
  })

  const prompt = [
    "You are a graph selection assistant for a knowledge base.",
    "Available managed graphs and their relation types:",
    ...graphLines.map((l) => `- ${l}`),
    "",
    "User question:",
    question,
    "",
    "For each graph relevant to answering the question, identify:",
    "1. Which of that graph's relation types are relevant (for enumeration-style questions, e.g. \"which skills have a cooldown\").",
    "2. Which specific named entities mentioned in the question are relevant (for entity-focused questions, e.g. \"what does Skill A do\").",
    "If the question names two or more entities and asks how they relate, include all of them in `entities`.",
    "If a graph is not relevant, omit it entirely. If nothing is relevant, return an empty array for selections.",
    "Respond with ONLY a JSON object in this shape:",
    '{"selections":[{"graph":"...","relationTypes":["HAS_COOLDOWN"],"entities":["Skill A"]}],"reasoning":"short explanation"}',
    "Do not wrap in markdown fences.",
  ].join("\n")

  const response = await callLlmJson<GraphSelectionResponse>(llmConfig, prompt)
  if (!response?.selections) return []
  return response.selections
    .filter((s) => s && typeof s.graph === "string" && policy.managedGraphs.includes(s.graph))
    .map((s) => ({
      graph: s.graph,
      relationTypes: Array.isArray(s.relationTypes) ? s.relationTypes.filter((t) => typeof t === "string") : [],
      entities: Array.isArray(s.entities) ? s.entities.filter((e) => typeof e === "string" && e.trim()) : [],
    }))
}

async function callLlmJson<T>(llmConfig: LlmConfig, prompt: string): Promise<T | null> {
  let raw = ""
  try {
    await streamChat(
      llmConfig,
      [{ role: "user", content: prompt }],
      {
        onToken: (token) => {
          raw += token
        },
        onDone: () => {},
        onError: (err) => {
          console.warn("[GraphQna] LLM JSON call error:", err)
        },
      },
    )
    const cleaned = extractJsonObject(raw)
    if (!cleaned) return null
    return JSON.parse(cleaned) as T
  } catch (err) {
    console.error("[GraphQna] LLM call failed:", err)
    return null
  }
}
