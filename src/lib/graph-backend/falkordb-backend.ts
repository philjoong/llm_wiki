import type { Stage2Triple } from "@/lib/ingest"
import {
  createGraphDb,
  deleteGraphDb,
  exportGraphDb,
  importGraphDb,
  listGraphDb,
  pingGraphDb,
  queryGraphDb,
} from "@/commands/graph-db"
import { parseFalkorQueryResult } from "@/lib/falkor-visualization"
import { falkorRawExportToSnapshot } from "./graph-result-mappers"
import type { GraphBackend, GraphQuery, GraphSnapshot } from "./types"

function safeString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

function safeRelation(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9_]/g, "_") || "RELATED"
}

function queryToCypher(query: GraphQuery): string {
  switch (query.type) {
    case "all":
      return "MATCH (n) OPTIONAL MATCH (n)-[r]->(m) RETURN n, r, m"
    case "relation":
      return `MATCH (n)-[r:${safeRelation(query.relationType)}]->(m) RETURN n, r, m`
    case "node":
      return `MATCH (n) WHERE n.label = '${safeString(query.nodeName)}' OR n.id = '${safeString(query.nodeName)}' OPTIONAL MATCH (n)-[r]-(m) RETURN n, r, m`
    case "neighbors":
      return [
        `MATCH (seed)-[r]-(m)`,
        `WHERE seed.page_path = '${safeString(query.pagePath)}'`,
        "RETURN seed, r, m",
        query.depth === 2 ? "UNION MATCH (seed)-[]-(mid)-[r]-(m) WHERE seed.page_path = '" + safeString(query.pagePath) + "' RETURN mid, r, m" : "",
      ].filter(Boolean).join(" ")
  }
}

function canvasToSnapshot(data: ReturnType<typeof parseFalkorQueryResult>): GraphSnapshot {
  return {
    nodes: data.nodes.map((node) => ({
      id: String(node.id),
      labels: node.labels,
      name: String(node.data.label ?? node.data.name ?? node.data.id ?? node.id),
      pagePath: typeof node.data.page_path === "string" ? node.data.page_path : undefined,
      properties: node.data,
    })),
    edges: data.links.map((edge) => ({
      id: String(edge.id),
      sourceId: String(edge.source),
      targetId: String(edge.target),
      relationType: edge.relationship,
      properties: edge.data,
    })),
  }
}

export function createFalkorDbBackend(): GraphBackend {
  return {
    kind: "falkordb",
    ping: pingGraphDb,
    listGraphs: listGraphDb,
    createGraph: createGraphDb,
    deleteGraph: deleteGraphDb,
    async upsertTriples(projectName: string, triples: Stage2Triple[]): Promise<number> {
      let count = 0
      const graphToTriples = new Map<string, Stage2Triple[]>()
      for (const triple of triples) {
        if (!triple.graph || !triple.subject || !triple.predicate || !triple.object) continue
        graphToTriples.set(triple.graph, [...(graphToTriples.get(triple.graph) ?? []), triple])
      }

      for (const [graphName, triplesInGraph] of graphToTriples) {
        await createGraphDb(projectName, graphName)
        for (const triple of triplesInGraph) {
          const subject = safeString(triple.subject)
          const object = safeString(triple.object)
          const pagePath = safeString(triple.page_path ?? "")
          const relType = safeRelation(triple.predicate)
          await queryGraphDb(projectName, graphName, `MERGE (n:Page {id: '${subject}'}) SET n.label = '${subject}', n.page_path = '${pagePath}'`)
          await queryGraphDb(projectName, graphName, `MERGE (n:Page {id: '${object}'}) SET n.label = '${object}'`)
          await queryGraphDb(projectName, graphName, `MATCH (a:Page {id: '${subject}'}), (b:Page {id: '${object}'}) MERGE (a)-[r:${relType}]->(b)`)
          count++
        }
      }
      return count
    },
    async queryGraph(projectName: string, graphName: string, query: GraphQuery): Promise<GraphSnapshot> {
      const raw = await queryGraphDb(projectName, graphName, queryToCypher(query))
      return canvasToSnapshot(parseFalkorQueryResult(raw))
    },
    async exportGraph(projectName: string, graphName: string): Promise<GraphSnapshot> {
      return falkorRawExportToSnapshot(await exportGraphDb(projectName, graphName))
    },
    async importGraph(projectName: string, graphName: string, snapshot: GraphSnapshot): Promise<number> {
      const nodes = snapshot.nodes.map((node) => ({
        id: Number(node.id) || snapshot.nodes.indexOf(node) + 1,
        labels: node.labels,
        properties: { ...node.properties, label: node.name, page_path: node.pagePath },
      }))
      const nodeIdMap = new Map(snapshot.nodes.map((node, index) => [node.id, Number(node.id) || index + 1]))
      const edges = snapshot.edges.map((edge) => ({
        id: Number(edge.id) || snapshot.edges.indexOf(edge) + 1,
        type: edge.relationType,
        src_node: nodeIdMap.get(edge.sourceId) ?? 0,
        dest_node: nodeIdMap.get(edge.targetId) ?? 0,
        properties: edge.properties,
      }))
      return importGraphDb(projectName, graphName, nodes, edges)
    },
    async renameRelationType(projectName: string, graphName: string, oldType: string, newType: string): Promise<number> {
      await queryGraphDb(projectName, graphName, `MATCH (a)-[r:${safeRelation(oldType)}]->(b) MERGE (a)-[:${safeRelation(newType)}]->(b) DELETE r`)
      return 0
    },
    async deleteRelationType(projectName: string, graphName: string, relationType: string): Promise<number> {
      await queryGraphDb(projectName, graphName, `MATCH ()-[r:${safeRelation(relationType)}]->() DELETE r`)
      return 0
    },
    addNode: (_projectName, _graphName, _name) => Promise.reject(new Error("Not implemented for FalkorDB")),
    deleteNode: (_projectName, _graphName, _nodeId) => Promise.reject(new Error("Not implemented for FalkorDB")),
    updateNodeName: (_projectName, _graphName, _nodeId, _newName) => Promise.reject(new Error("Not implemented for FalkorDB")),
    addEdge: (_projectName, _graphName, _sourceNodeId, _targetNodeId, _relationType) => Promise.reject(new Error("Not implemented for FalkorDB")),
    deleteEdge: (_projectName, _graphName, _edgeId) => Promise.reject(new Error("Not implemented for FalkorDB")),
    updateEdge: (_projectName, _graphName, _edgeId, _newRelationType, _newTargetNodeId) => Promise.reject(new Error("Not implemented for FalkorDB")),
    deleteEdgesByPagePath: (_projectName, _pagePath) => Promise.reject(new Error("Not implemented for FalkorDB")),
  }
}
