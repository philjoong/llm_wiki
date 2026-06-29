import { invoke } from "@tauri-apps/api/core"
import type { Stage2Triple } from "./ingest"
import { getGraphBackend } from "@/lib/graph-backend"
import { upsertPageGraphIndex } from "@/lib/page-graph-index"

function debug(msg: string) {
  console.log(`[graph-sync] ${msg}`)
  invoke("app_debug", { message: `[graph-sync] ${msg}` }).catch(() => {})
}

/**
 * Synchronize Stage 2 triples to the configured graph backend.
 * The legacy name is retained so existing ingest code does not need to move.
 */
export async function syncGraphToFalkorDb(
  projectPath: string,
  projectName: string,
  triples: Stage2Triple[],
  onProgress?: (message: string) => void,
): Promise<string> {
  if (triples.length === 0) {
    debug("0 triples - nothing to sync")
    return "0 triples (nothing to sync)"
  }

  const graphToTriples = new Map<string, Stage2Triple[]>()
  for (const triple of triples) {
    if (!triple.graph || !triple.subject || !triple.predicate || !triple.object) continue
    const list = graphToTriples.get(triple.graph) ?? []
    list.push(triple)
    graphToTriples.set(triple.graph, list)
  }

  const managedGraphs = Array.from(graphToTriples.keys())
  debug(`graphs to sync: [${managedGraphs.join(", ")}]`)

  const backend = await getGraphBackend(projectPath)
  onProgress?.(`Syncing ${triples.length} triples to ${backend.kind} graph backend...`)
  const synced = await backend.upsertTriples(projectName, triples)

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

  const summary = `${synced} triples synced to ${backend.kind} backend [${managedGraphs.join(", ")}]`
  debug(summary)
  return summary
}

export async function cleanupOrphanGraphs(
  projectPath: string,
  projectName: string,
  activeGraphs: string[],
): Promise<void> {
  const backend = await getGraphBackend(projectPath)
  const existing = await backend.listGraphs(projectName)
  const toDelete = existing.filter((g) => !activeGraphs.includes(g))
  for (const g of toDelete) {
    try {
      await backend.deleteGraph(projectName, g)
    } catch {
      // ignore
    }
  }
}
