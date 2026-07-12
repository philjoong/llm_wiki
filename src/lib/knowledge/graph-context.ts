import { getKnowledgeGraphSnapshot, listKnowledgeGraphs } from "@/commands/knowledge"
import type { GraphRecord, KnowledgeGraphSnapshot } from "./types"

export interface KnowledgeGraphContext {
  graph: GraphRecord
  snapshot: KnowledgeGraphSnapshot
  relationTypes: string[]
}

/** Loads graph context exclusively from the authoritative knowledge DB. */
export async function loadKnowledgeGraphContexts(projectPath: string, prefix?: string): Promise<KnowledgeGraphContext[]> {
  const graphs = await listKnowledgeGraphs(projectPath)
  const scoped = prefix ? graphs.filter((graph) => graph.graphName.startsWith(prefix)) : graphs
  return Promise.all(scoped.map(async (graph) => {
    const snapshot = await getKnowledgeGraphSnapshot(projectPath, graph.graphId)
    return { graph, snapshot, relationTypes: Array.from(new Set(snapshot.assertions.map((a) => a.predicate))).sort() }
  }))
}
