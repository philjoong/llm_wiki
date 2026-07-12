import { loadKnowledgeGraphContexts } from "@/lib/knowledge"
import { resolveAllowedGraphIds } from "@/lib/knowledge/graph-scope"
import type { LlmConfig } from "@/stores/wiki-store"
import { streamChat } from "./llm-client"
import { extractJsonObject } from "./sweep-reviews"

const RELATION_LIMIT = 80

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
 * Chat resolves UI prefixes to stable graph IDs once and passes that same
 * allowlist to every retrieval path. The string form remains for isolated
 * non-Chat callers and is resolved before snapshots are loaded.
 */
export async function getGraphContext(
  question: string,
  projectPath: string,
  projectName: string,
  llmConfig: LlmConfig,
  graphScope?: readonly string[] | string,
): Promise<GraphContextBlock[]> {
  void projectName
  const allowedGraphIds = typeof graphScope === "string"
    ? await resolveAllowedGraphIds(projectPath, graphScope)
    : graphScope
  const contexts = await loadKnowledgeGraphContexts(projectPath, allowedGraphIds)
  if (contexts.length === 0) return []
  const scopedPolicy = {
    managedGraphs: contexts.map((context) => context.graph.graphName),
    graphRelationTypes: Object.fromEntries(contexts.map((context) => [context.graph.graphName, context.relationTypes])),
  }

  const selections = await selectRelevantGraphs(question, scopedPolicy, llmConfig)
  if (selections.length === 0) return []

  const blocks: GraphContextBlock[] = []

  for (const selection of selections) {
    const lines: string[] = []
    let truncated = false

    const context = contexts.find((item) => item.graph.graphName === selection.graph)
    if (!context) continue
    const requestedRelations = new Set(selection.relationTypes)
    const requestedEntities = selection.entities.map((value) => value.toLocaleLowerCase())
    const assertions = context.snapshot.assertions.filter((assertion) => {
      if (requestedRelations.size && requestedRelations.has(assertion.predicate)) return true
      if (!requestedEntities.length) return requestedRelations.size === 0
      const subject = context.snapshot.nodes.find((node) => node.entity.entityId === assertion.subjectEntityId)?.entity.canonicalName ?? ""
      const object = context.snapshot.nodes.find((node) => node.entity.entityId === assertion.objectEntityId)?.entity.canonicalName ?? ""
      return requestedEntities.some((entity) => subject.toLocaleLowerCase().includes(entity) || object.toLocaleLowerCase().includes(entity))
    }).slice(0, RELATION_LIMIT)
    truncated = assertions.length >= RELATION_LIMIT
    lines.push(...assertions.map((assertion) => {
      const subject = context.snapshot.nodes.find((node) => node.entity.entityId === assertion.subjectEntityId)?.entity.canonicalName ?? assertion.subjectEntityId
      const object = context.snapshot.nodes.find((node) => node.entity.entityId === assertion.objectEntityId)?.entity.canonicalName ?? assertion.objectEntityId
      return `- ${subject} --${assertion.predicate}--> ${object}`
    }))

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
