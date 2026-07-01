import { invoke } from "@tauri-apps/api/core"
import type { Stage2Triple } from "@/lib/ingest"
import type { GraphBackend, GraphQuery, GraphSnapshot } from "./types"

export function createSqliteGraphBackend(projectPath: string): GraphBackend {
  const base: Record<string, unknown> = { projectPath }

  return {
    kind: "sqlite",
    ping: () => invoke<void>("graph_sqlite_ping", base),
    listGraphs: (projectName) => invoke<string[]>("graph_sqlite_list", { ...base, projectName }),
    createGraph: (projectName, graphName) => invoke<void>("graph_sqlite_create", { ...base, projectName, graphName }),
    deleteGraph: (projectName, graphName) => invoke<void>("graph_sqlite_delete", { ...base, projectName, graphName }),
    upsertTriples: (projectName: string, triples: Stage2Triple[]) =>
      invoke<number>("graph_sqlite_upsert_triples", { ...base, projectName, triples }),
    queryGraph: (projectName: string, graphName: string, query: GraphQuery) =>
      invoke<GraphSnapshot>("graph_sqlite_query", { ...base, projectName, graphName, query }),
    exportGraph: (projectName: string, graphName: string) =>
      invoke<GraphSnapshot>("graph_sqlite_export", { ...base, projectName, graphName }),
    importGraph: (projectName: string, graphName: string, snapshot: GraphSnapshot) =>
      invoke<number>("graph_sqlite_import", { ...base, projectName, graphName, snapshot }),
    renameRelationType: (projectName: string, graphName: string, oldType: string, newType: string) =>
      invoke<number>("graph_sqlite_rename_relation_type", { ...base, projectName, graphName, oldType, newType }),
    deleteRelationType: (projectName: string, graphName: string, relationType: string) =>
      invoke<number>("graph_sqlite_delete_relation_type", { ...base, projectName, graphName, relationType }),
    addNode: (projectName: string, graphName: string, name: string) =>
      invoke<number>("graph_sqlite_add_node", { ...base, projectName, graphName, name }),
    deleteNode: (projectName: string, graphName: string, nodeId: string) =>
      invoke<void>("graph_sqlite_delete_node", { ...base, projectName, graphName, nodeId: parseInt(nodeId, 10) }),
    updateNodeName: (projectName: string, graphName: string, nodeId: string, newName: string) =>
      invoke<void>("graph_sqlite_update_node_name", { ...base, projectName, graphName, nodeId: parseInt(nodeId, 10), newName }),
    addEdge: (projectName: string, graphName: string, sourceNodeId: string, targetNodeId: string, relationType: string) =>
      invoke<number>("graph_sqlite_add_edge", { ...base, projectName, graphName, sourceNodeId: parseInt(sourceNodeId, 10), targetNodeId: parseInt(targetNodeId, 10), newRelationType: relationType }),
    deleteEdge: (projectName: string, graphName: string, edgeId: string) =>
      invoke<void>("graph_sqlite_delete_edge", { ...base, projectName, graphName, edgeId: parseInt(edgeId, 10) }),
    updateEdge: (projectName: string, graphName: string, edgeId: string, newRelationType: string, newTargetNodeId?: string) =>
      invoke<void>("graph_sqlite_update_edge", { ...base, projectName, graphName, edgeId: parseInt(edgeId, 10), newRelationType, newTargetNodeId: newTargetNodeId !== undefined ? parseInt(newTargetNodeId, 10) : null }),
    deleteEdgesByPagePath: (projectName: string, pagePath: string) =>
      invoke<number>("graph_sqlite_delete_edges_by_page_path", { ...base, projectName, pagePath }),
  }
}
