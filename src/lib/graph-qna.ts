import { getGraphBackend, type GraphSnapshot } from "@/lib/graph-backend"
import { loadGraphPolicy } from "@/lib/graph-policy"
import type { LlmConfig } from "@/stores/wiki-store"
import { streamChat } from "./llm-client"
import { extractJsonObject } from "./sweep-reviews"

export interface CypherQueryResult {
  graphName: string
  query: string
  result: GraphSnapshot
  reasoning: string
}

export interface GraphSelectionResponse {
  relevantGraphs: string[]
  reasoning: string
}

/**
 * Identify relevant graphs and generate Cypher queries to answer a question.
 */
export async function getGraphContext(
  question: string,
  projectPath: string,
  projectName: string,
  llmConfig: LlmConfig,
): Promise<CypherQueryResult[]> {
  const policy = await loadGraphPolicy(projectPath)
  if (policy.managedGraphs.length === 0) return []

  // 1. Select relevant graphs
  const selectedGraphs = await selectRelevantGraphs(question, policy.managedGraphs, llmConfig)
  if (selectedGraphs.length === 0) return []

  const backend = await getGraphBackend(projectPath)
  const results: CypherQueryResult[] = []
  for (const graphName of selectedGraphs) {
    try {
      const result = await backend.queryGraph(projectName, graphName, { type: "node", nodeName: question })
      results.push({
        graphName,
        query: `GraphQuery.node(${question})`,
        result,
        reasoning: "Selected by graph relevance prompt; queried through the active graph backend.",
      })
    } catch (err) {
      console.warn(`[GraphQna] graph query failed for graph ${graphName}:`, err)
    }
  }

  return results
}

async function selectRelevantGraphs(
  question: string,
  availableGraphs: string[],
  llmConfig: LlmConfig,
): Promise<string[]> {
  const prompt = [
    "You are a graph selection assistant for a knowledge base.",
    `Available managed graphs: ${availableGraphs.join(", ")}`,
    "",
    "User question:",
    question,
    "",
    "Identify which of the available graphs are relevant to answer the user's question.",
    "Respond with ONLY a JSON object in this shape:",
    '{"relevantGraphs": ["graph1", "graph2"], "reasoning": "short explanation"}',
    "If none are relevant, return an empty array for relevantGraphs.",
    "Do not wrap in markdown fences.",
  ].join("\n")

  const response = await callLlmJson<GraphSelectionResponse>(llmConfig, prompt)
  return response?.relevantGraphs ?? []
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
