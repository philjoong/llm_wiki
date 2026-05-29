import { buildWikiGraph, type GraphNode, type GraphEdge } from "./wiki-graph"
import { createGraphDb, queryGraphDb, listGraphDb, deleteGraphDb } from "@/commands/graph-db"
import { useReviewStore } from "@/stores/review-store"
import { detectSchemaDrift } from "./schema-validation"
import { normalizePath } from "./path-utils"

/**
 * Synchronize the local Markdown-based graph with FalkorDB.
 * Each node and edge is routed to one or more managed graphs based on 
 * the frontmatter `graph:` field.
 */
export async function syncGraphToFalkorDb(projectPath: string, projectName: string): Promise<void> {
  const { nodes, edges } = await buildWikiGraph(projectPath)
  if (nodes.length === 0) return

  // 0. Schema Validation
  const proposals = await detectSchemaDrift(projectPath, projectName, nodes, edges)
  if (proposals.length > 0) {
    const reviewItems = proposals.map(p => ({
      type: "schema" as const,
      title: `New ${p.type === "node_type" ? "Node Type" : "Relationship Type"}: ${p.name}`,
      description: `The AI wants to introduce a new ${p.type === "node_type" ? "label" : "relationship type"} '${p.name}' to the graph. Approve to allow this type, or Reject to forbid it.`,
      schemaProposal: p,
      options: [
        { label: "Approve", action: "schema:approve" },
        { label: "Reject", action: "schema:reject" },
      ],
    }))
    useReviewStore.getState().addItems(reviewItems)
  }

  // Filter out elements that use unapproved schema types
  const pendingTypeNames = new Set(proposals.map(p => p.name.toLowerCase()))
  
  const policy = await (await import("./graph-policy")).loadGraphPolicy(projectPath)
  const forbiddenTypeNames = new Set(policy.forbiddenTypes.map(t => t.toLowerCase()))

  const filteredNodes = nodes.filter(n => 
    !pendingTypeNames.has(n.type.toLowerCase()) && 
    !forbiddenTypeNames.has(n.type.toLowerCase())
  )
  const filteredEdges = edges.filter(e => {
    const type = (e.type || "LINKS_TO").toLowerCase()
    return !pendingTypeNames.has(type) && !forbiddenTypeNames.has(type)
  })

  if (filteredNodes.length === 0) return

  // 1. Group nodes by their assigned graph
  const graphToNodes = new Map<string, GraphNode[]>()
  const DEFAULT_GRAPH = "main_graph"

  for (const node of filteredNodes) {
    const g = node.graph || DEFAULT_GRAPH
    const list = graphToNodes.get(g) ?? []
    list.push(node)
    graphToNodes.set(g, list)
  }

  // 2. Group edges by their source node's graph
  const graphToEdges = new Map<string, GraphEdge[]>()
  const nodeToGraph = new Map(filteredNodes.map(n => [n.id, n.graph || DEFAULT_GRAPH]))

  for (const edge of filteredEdges) {
    const g = nodeToGraph.get(edge.source) || DEFAULT_GRAPH
    const list = graphToEdges.get(g) ?? []
    list.push(edge)
    graphToEdges.set(g, list)
  }

  const managedGraphs = Array.from(new Set([...graphToNodes.keys(), ...graphToEdges.keys()]))

  // 3. For each graph, ensure it exists and sync data
  for (const gName of managedGraphs) {
    // Ensure graph exists (creation is idempotent in the backend usually, 
    // but here we might want to clear it first or just MERGE)
    // For now, we use MERGE for idempotency without full wipe.
    await createGraphDb(projectName, gName)

    const nodesInGraph = graphToNodes.get(gName) ?? []
    const edgesInGraph = graphToEdges.get(gName) ?? []

    // Sync Nodes
    for (const node of nodesInGraph) {
      const safeLabel = node.label.replace(/'/g, "\\'")
      const safeId = node.id.replace(/'/g, "\\'")
      const safeType = node.type.replace(/'/g, "\\'")
      const safePath = node.path.replace(/\\/g, "/").replace(/'/g, "\\'")
      
      const cypher = `MERGE (n:Page {id: '${safeId}'}) SET n.label = '${safeLabel}', n.type = '${safeType}', n.path = '${safePath}'`
      try {
        await queryGraphDb(projectName, gName, cypher)
      } catch (err) {
        console.error(`[graph-sync] Failed to sync node ${node.id} to ${gName}:`, err)
      }
    }

    // Sync Edges
    for (const edge of edgesInGraph) {
      const type = (edge.type || "LINKS_TO").toUpperCase().replace(/[^A-Z0-9_]/g, "_")
      const safeSource = edge.source.replace(/'/g, "\\'")
      const safeTarget = edge.target.replace(/'/g, "\\'")
      
      // Ensure target node exists in this graph too (as a shell if it's from another graph)
      const targetNode = nodes.find(n => n.id === edge.target)
      if (targetNode) {
        const safeTargetLabel = targetNode.label.replace(/'/g, "\\'")
        const safeTargetType = targetNode.type.replace(/'/g, "\\'")
        const mergeTarget = `MERGE (n:Page {id: '${safeTarget}'}) SET n.label = '${safeTargetLabel}', n.type = '${safeTargetType}'`
        await queryGraphDb(projectName, gName, mergeTarget)
      }

      const cypher = `
        MATCH (a:Page {id: '${safeSource}'}), (b:Page {id: '${safeTarget}'})
        MERGE (a)-[r:${type}]->(b)
      `
      try {
        await queryGraphDb(projectName, gName, cypher)
      } catch (err) {
        console.error(`[graph-sync] Failed to sync edge ${edge.source}->${edge.target} to ${gName}:`, err)
      }
    }
  }
}

/**
 * Cleanup graphs that are no longer in the policy and have no data.
 * (Optional/Advanced)
 */
export async function cleanupOrphanGraphs(projectName: string, activeGraphs: string[]): Promise<void> {
  const existing = await listGraphDb(projectName)
  const toDelete = existing.filter(g => !activeGraphs.includes(g))
  for (const g of toDelete) {
    try {
      await deleteGraphDb(projectName, g)
    } catch {
      // ignore
    }
  }
}
