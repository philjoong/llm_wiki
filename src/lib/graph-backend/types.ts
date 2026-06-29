import type { Stage2Triple } from "@/lib/ingest"

export interface GraphNodeRecord {
  id: string
  labels: string[]
  name: string
  pagePath?: string
  properties: Record<string, unknown>
}

export interface GraphEdgeRecord {
  id: string
  sourceId: string
  targetId: string
  relationType: string
  properties: Record<string, unknown>
}

export interface GraphSnapshot {
  nodes: GraphNodeRecord[]
  edges: GraphEdgeRecord[]
}

export type GraphQuery =
  | { type: "all" }
  | { type: "neighbors"; pagePath: string; depth: 1 | 2 }
  | { type: "relation"; relationType: string }
  | { type: "node"; nodeName: string }

export interface GraphBackend {
  kind: "sqlite" | "falkordb"

  ping(): Promise<void>
  listGraphs(projectName: string): Promise<string[]>
  createGraph(projectName: string, graphName: string): Promise<void>
  deleteGraph(projectName: string, graphName: string): Promise<void>

  upsertTriples(projectName: string, triples: Stage2Triple[]): Promise<number>
  queryGraph(projectName: string, graphName: string, query: GraphQuery): Promise<GraphSnapshot>

  exportGraph(projectName: string, graphName: string): Promise<GraphSnapshot>
  importGraph(projectName: string, graphName: string, snapshot: GraphSnapshot): Promise<number>

  renameRelationType(projectName: string, graphName: string, oldType: string, newType: string): Promise<number>
  deleteRelationType(projectName: string, graphName: string, relationType: string): Promise<number>
}
