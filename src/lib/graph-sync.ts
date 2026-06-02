import { invoke } from "@tauri-apps/api/core"
import { buildWikiGraph, type GraphNode, type GraphEdge } from "./wiki-graph"
import { createGraphDb, queryGraphDb, listGraphDb, deleteGraphDb } from "@/commands/graph-db"
import { useReviewStore } from "@/stores/review-store"
import { detectSchemaDrift } from "./schema-validation"

function debug(msg: string) {
  console.log(`[graph-sync] ${msg}`)
  invoke("app_debug", { message: `[graph-sync] ${msg}` }).catch(() => {})
}

/**
 * Synchronize the local Markdown-based graph with FalkorDB.
 * Each node and edge is routed to one or more managed graphs based on
 * the frontmatter `graph:` field.
 * Returns a summary string (e.g. "5 nodes, 3 edges synced to main") for logging.
 */
export async function syncGraphToFalkorDb(
  projectPath: string,
  projectName: string,
  onProgress?: (message: string) => void,
  allowedPaths?: Set<string>,
): Promise<string> {
  const { nodes, edges } = await buildWikiGraph(projectPath, onProgress, allowedPaths)
  debug(`buildWikiGraph done: ${nodes.length} nodes, ${edges.length} edges`)
  if (nodes.length === 0) {
    debug("0 nodes — nothing to sync")
    return "0 nodes (nothing to sync)"
  }

  onProgress?.("Validating schema...")
  // 0. Schema Validation
  const proposals = await detectSchemaDrift(projectPath, projectName, nodes, edges)
  debug(`detectSchemaDrift: ${proposals.length} proposals — [${proposals.map(p => p.name).join(", ")}]`)
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

  debug(`after schema filter: ${filteredNodes.length} nodes, ${filteredEdges.length} edges`)
  if (filteredNodes.length === 0) {
    debug("0 nodes after schema filtering — all types pending approval or forbidden")
    return "0 nodes after schema filtering (nothing to sync)"
  }

  // 1. Group nodes by their assigned graph
  const graphToNodes = new Map<string, GraphNode[]>()
  const DEFAULT_GRAPH = "main"

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

  const REPORT_EVERY = 20

  debug(`graphs to sync: [${managedGraphs.join(", ")}]`)

  // 3. For each graph, ensure it exists and sync data
  for (const gName of managedGraphs) {
    debug(`[${gName}] creating graph...`)
    await createGraphDb(projectName, gName)

    const nodesInGraph = graphToNodes.get(gName) ?? []
    const edgesInGraph = graphToEdges.get(gName) ?? []

    // Sync Nodes
    for (let i = 0; i < nodesInGraph.length; i++) {
      if (i % REPORT_EVERY === 0) {
        onProgress?.(`[${gName}] Syncing nodes... ${i}/${nodesInGraph.length}`)
      }
      const node = nodesInGraph[i]
      const safeLabel = node.label.replace(/'/g, "\\'")
      const safeId = node.id.replace(/'/g, "\\'")
      const safeType = node.type.replace(/'/g, "\\'")
      const safePath = node.path.replace(/\\/g, "/").replace(/'/g, "\\'")
      const cypherSources = `[${node.sources.map(s => `'${s.replace(/'/g, "\\'")}'`).join(", ")}]`

      const cypher = `MERGE (n:Page {id: '${safeId}'}) SET n.label = '${safeLabel}', n.type = '${safeType}', n.path = '${safePath}', n.sources = ${cypherSources}`
      try {
        await queryGraphDb(projectName, gName, cypher)
      } catch (err) {
        debug(`[${gName}] ERROR syncing node ${node.id}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    debug(`[${gName}] nodes done (${nodesInGraph.length})`)
    onProgress?.(`[${gName}] Nodes done (${nodesInGraph.length}). Syncing edges...`)

    // Sync Edges
    for (let i = 0; i < edgesInGraph.length; i++) {
      if (i % REPORT_EVERY === 0 && edgesInGraph.length > REPORT_EVERY) {
        onProgress?.(`[${gName}] Syncing edges... ${i}/${edgesInGraph.length}`)
      }
      const edge = edgesInGraph[i]
      const type = (edge.type || "LINKS_TO").toUpperCase().replace(/[^A-Z0-9_]/g, "_")
      const safeSource = edge.source.replace(/'/g, "\\'")
      const safeTarget = edge.target.replace(/'/g, "\\'")
      const cypherSources = `[${edge.sources.map(s => `'${s.replace(/'/g, "\\'")}'`).join(", ")}]`
      
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
        SET r.sources = ${cypherSources}
      `
      try {
        await queryGraphDb(projectName, gName, cypher)
      } catch (err) {
        debug(`[${gName}] ERROR syncing edge ${edge.source}->${edge.target}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    debug(`[${gName}] done — ${nodesInGraph.length} nodes, ${edgesInGraph.length} edges`)
    onProgress?.(`[${gName}] Done — ${nodesInGraph.length} nodes, ${edgesInGraph.length} edges`)
  }

  const summary = `${filteredNodes.length} nodes, ${filteredEdges.length} edges synced to [${managedGraphs.join(", ")}]`
  debug(summary)
  return summary
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
