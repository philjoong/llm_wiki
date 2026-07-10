import { invoke } from "@tauri-apps/api/core"
import type { GraphAssignmentTriple } from "./ingest"
import { getGraphBackend } from "@/lib/graph-backend"
import { upsertPageGraphIndex } from "@/lib/page-graph-index"
import {
  loadEntityDict,
  saveEntityDict,
  findCandidates,
  upsertEntity,
  addEntityPagePath,
  linkGraphNode,
} from "@/lib/entity-dict"

function debug(msg: string) {
  console.log(`[graph-sync] ${msg}`)
  invoke("app_debug", { message: `[graph-sync] ${msg}` }).catch(() => {})
}

/**
 * Synchronize graph assignment triples to the configured graph backend.
 */
export async function syncGraphToBackend(
  projectPath: string,
  projectName: string,
  triples: GraphAssignmentTriple[],
  onProgress?: (message: string) => void,
): Promise<string> {
  if (triples.length === 0) {
    debug("0 triples - nothing to sync")
    return "0 triples (nothing to sync)"
  }

  const graphToTriples = new Map<string, GraphAssignmentTriple[]>()
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

  try {
    await syncEntityDict(projectPath, projectName, triples, graphToTriples)
  } catch (err) {
    debug(`entity-dict sync failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`)
  }

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

/**
 * Upsert triple subjects/objects into the entity dictionary. Only exact
 * name matches are auto-merged here — fuzzy near-duplicates are handled
 * upstream by ingest.ts's checkEntityConflicts() before triples reach sync.
 */
async function syncEntityDict(
  projectPath: string,
  projectName: string,
  triples: GraphAssignmentTriple[],
  graphToTriples: Map<string, GraphAssignmentTriple[]>,
): Promise<void> {
  const backend = await getGraphBackend(projectPath)
  let dict = await loadEntityDict(projectPath)

  // Resolve nodeId per (graphName, entityName) via exact-name match against
  // the graph's current snapshot (stable_key guarantees name is verbatim).
  const nodeIdByGraphAndName = new Map<string, string>()
  for (const graphName of graphToTriples.keys()) {
    const snapshot = await backend.queryGraph(projectName, graphName, { type: "all" })
    for (const node of snapshot.nodes) {
      nodeIdByGraphAndName.set(`${graphName}\u0000${node.name}`, node.id)
    }
  }

  for (const triple of triples) {
    if (!triple.graph || !triple.subject || !triple.object) continue
    for (const name of [triple.subject, triple.object]) {
      const nodeId = nodeIdByGraphAndName.get(`${triple.graph}\u0000${name}`)
      if (!nodeId) continue

      const candidates = findCandidates(name, dict)
      const exact = candidates.find((c) => c.match === "exact")
      const entityId = exact ? exact.entry.id : crypto.randomUUID()

      dict = upsertEntity({ id: entityId, canonicalName: name }, dict)
      dict = linkGraphNode(entityId, { graphName: triple.graph, nodeId, pagePath: triple.page_path }, dict)
      if (triple.page_path) {
        dict = addEntityPagePath(entityId, triple.page_path, dict)
      }
    }
  }

  await saveEntityDict(projectPath, dict)
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
