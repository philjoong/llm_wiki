import { listKnowledgeGraphs } from "@/commands/knowledge"

/** Resolve a UI prefix once, then pass stable graph IDs to every retriever. */
export async function resolveAllowedGraphIds(projectPath: string, prefix?: string): Promise<string[]> {
  const graphs = await listKnowledgeGraphs(projectPath)
  return graphs
    .filter((graph) => !prefix || graph.graphName.startsWith(prefix))
    .map((graph) => graph.graphId)
}
