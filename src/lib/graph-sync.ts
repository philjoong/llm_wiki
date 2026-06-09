import { invoke } from "@tauri-apps/api/core"
import type { Stage2Triple } from "./ingest"
import { createGraphDb, queryGraphDb, listGraphDb, deleteGraphDb } from "@/commands/graph-db"
import { upsertPageGraphIndex } from "@/lib/page-graph-index"

function debug(msg: string) {
  console.log(`[graph-sync] ${msg}`)
  invoke("app_debug", { message: `[graph-sync] ${msg}` }).catch(() => {})
}

/**
 * Synchronize Stage 2 triples directly to FalkorDB.
 * Each triple { subject, predicate, object, graph } is routed to its assigned
 * FalkorDB graph. Both subject and object nodes are MERGEd, then the edge.
 * Returns a summary string for logging.
 */
export async function syncGraphToFalkorDb(
  projectPath: string,
  projectName: string,
  triples: Stage2Triple[],
  onProgress?: (message: string) => void,
): Promise<string> {
  if (triples.length === 0) {
    debug("0 triples — nothing to sync")
    return "0 triples (nothing to sync)"
  }

  // Group triples by graph name
  const graphToTriples = new Map<string, Stage2Triple[]>()
  for (const triple of triples) {
    if (!triple.graph || !triple.subject || !triple.predicate || !triple.object) continue
    const list = graphToTriples.get(triple.graph) ?? []
    list.push(triple)
    graphToTriples.set(triple.graph, list)
  }

  const managedGraphs = Array.from(graphToTriples.keys())
  debug(`graphs to sync: [${managedGraphs.join(", ")}]`)

  const REPORT_EVERY = 20
  let totalNodes = 0
  let totalEdges = 0

  for (const gName of managedGraphs) {
    debug(`[${gName}] creating graph...`)
    await createGraphDb(projectName, gName)

    const triplesInGraph = graphToTriples.get(gName) ?? []

    for (let i = 0; i < triplesInGraph.length; i++) {
      if (i % REPORT_EVERY === 0) {
        onProgress?.(`[${gName}] Syncing triples... ${i}/${triplesInGraph.length}`)
      }
      const triple = triplesInGraph[i]
      const safeSubject = triple.subject.replace(/'/g, "\\'")
      const safeObject = triple.object.replace(/'/g, "\\'")
      const safePagePath = (triple.page_path ?? "").replace(/'/g, "\\'")
      const relType = triple.predicate.toUpperCase().replace(/[^A-Z0-9_]/g, "_")

      // MERGE subject node
      try {
        await queryGraphDb(projectName, gName, `MERGE (n:Page {id: '${safeSubject}'}) SET n.label = '${safeSubject}', n.page_path = '${safePagePath}'`)
        totalNodes++
      } catch (err) {
        debug(`[${gName}] ERROR merging subject node ${triple.subject}: ${err instanceof Error ? err.message : String(err)}`)
      }

      // MERGE object node
      try {
        await queryGraphDb(projectName, gName, `MERGE (n:Page {id: '${safeObject}'}) SET n.label = '${safeObject}'`)
        totalNodes++
      } catch (err) {
        debug(`[${gName}] ERROR merging object node ${triple.object}: ${err instanceof Error ? err.message : String(err)}`)
      }

      // MERGE edge
      try {
        const cypher = `
          MATCH (a:Page {id: '${safeSubject}'}), (b:Page {id: '${safeObject}'})
          MERGE (a)-[r:${relType}]->(b)
        `
        await queryGraphDb(projectName, gName, cypher)
        totalEdges++
      } catch (err) {
        debug(`[${gName}] ERROR merging edge ${triple.subject}-[${triple.predicate}]->${triple.object}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    debug(`[${gName}] done — ${triplesInGraph.length} triples`)
    onProgress?.(`[${gName}] Done — ${triplesInGraph.length} triples`)
  }

  // Build page_path → graph[] index from the synced triples and persist it.
  // This lets Files tab look up related graphs instantly without querying FalkorDB.
  const pageGraphUpdates: Record<string, string[]> = {}
  for (const triple of triples) {
    if (!triple.page_path || !triple.graph) continue
    const existing = pageGraphUpdates[triple.page_path] ?? []
    if (!existing.includes(triple.graph)) existing.push(triple.graph)
    pageGraphUpdates[triple.page_path] = existing
  }
  if (Object.keys(pageGraphUpdates).length > 0) {
    try {
      await upsertPageGraphIndex(projectPath, pageGraphUpdates)
      debug(`page-graph-index updated for ${Object.keys(pageGraphUpdates).length} page(s)`)
    } catch (err) {
      debug(`page-graph-index update failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const summary = `${triples.length} triples synced to [${managedGraphs.join(", ")}]`
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
