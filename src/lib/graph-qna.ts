import { queryGraphDb } from "@/commands/graph-db"
import { loadGraphPolicy } from "@/lib/graph-policy"
import type { LlmConfig } from "@/stores/wiki-store"
import { streamChat } from "./llm-client"
import { extractJsonObject } from "./sweep-reviews"

export interface CypherQueryResult {
  graphName: string
  query: string
  result: any
  reasoning: string
}

export interface GraphSelectionResponse {
  relevantGraphs: string[]
  reasoning: string
}

export interface CypherGenerationResponse {
  queries: Array<{
    graphName: string
    cypher: string
    reasoning: string
  }>
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

  // 2. Generate Cypher queries
  const queryPlan = await generateCypherQueries(question, selectedGraphs, llmConfig)
  
  // 3. Execute queries
  const results: CypherQueryResult[] = []
  for (const plan of queryPlan.queries) {
    try {
      const result = await queryGraphDb(projectName, plan.graphName, plan.cypher)
      results.push({
        graphName: plan.graphName,
        query: plan.cypher,
        result,
        reasoning: plan.reasoning,
      })
    } catch (err) {
      console.warn(`[GraphQna] Cypher execution failed for graph ${plan.graphName}:`, err)
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

async function generateCypherQueries(
  question: string,
  selectedGraphs: string[],
  llmConfig: LlmConfig,
): Promise<CypherGenerationResponse> {
  const prompt = [
    "You are a Cypher query generator for FalkorDB.",
    "Generate Cypher queries to answer the user's question using the selected graphs.",
    "The graphs use standard knowledge graph nodes (Page, Entity, Concept) and relationships.",
    `Selected graphs: ${selectedGraphs.join(", ")}`,
    "",
    "User question:",
    question,
    "",
    "Respond with ONLY a JSON object in this shape:",
    '{"queries": [{"graphName": "name", "cypher": "MATCH ... RETURN ...", "reasoning": "..."}]}',
    "Do NOT prefix graph names in the Cypher query itself; the system handles isolation.",
    "Do not wrap in markdown fences.",
  ].join("\n")

  const response = await callLlmJson<CypherGenerationResponse>(llmConfig, prompt)
  return response ?? { queries: [] }
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
