import type { GraphSnapshot, GraphNodeRecord, GraphEdgeRecord } from "@/lib/graph-backend"

/**
 * Undirected BFS from `seedNodeIds` up to `maxHops` steps. `maxHops = Infinity`
 * returns the seeds' full connected component (BFS naturally stops once
 * reachable nodes are exhausted). Nodes without a `pagePath` are included
 * when reached but do not expand the frontier further (mirrors Phase F's
 * "don't traverse through undocumented concept hubs" principle, applied
 * client-side).
 */
export function filterSnapshotByHops(
  snapshot: GraphSnapshot,
  seedNodeIds: string[],
  maxHops: number,
): GraphSnapshot {
  const nodesById = new Map(snapshot.nodes.map((n) => [n.id, n]))
  const neighbors = new Map<string, { edge: GraphEdgeRecord; otherId: string }[]>()
  for (const edge of snapshot.edges) {
    if (!nodesById.has(edge.sourceId) || !nodesById.has(edge.targetId)) continue
    if (!neighbors.has(edge.sourceId)) neighbors.set(edge.sourceId, [])
    if (!neighbors.has(edge.targetId)) neighbors.set(edge.targetId, [])
    neighbors.get(edge.sourceId)!.push({ edge, otherId: edge.targetId })
    neighbors.get(edge.targetId)!.push({ edge, otherId: edge.sourceId })
  }

  const visited = new Set<string>()
  let frontier = seedNodeIds.filter((id) => nodesById.has(id))
  for (const id of frontier) visited.add(id)

  let hop = 0
  while (frontier.length > 0 && hop < maxHops) {
    const nextFrontier: string[] = []
    for (const id of frontier) {
      const node = nodesById.get(id)
      if (!node?.pagePath) continue // undocumented node — don't expand past it
      for (const { otherId } of neighbors.get(id) ?? []) {
        if (visited.has(otherId)) continue
        visited.add(otherId)
        nextFrontier.push(otherId)
      }
    }
    frontier = nextFrontier
    hop++
  }

  const nodes = snapshot.nodes.filter((n) => visited.has(n.id))
  const edges = snapshot.edges.filter((e) => visited.has(e.sourceId) && visited.has(e.targetId))
  return { nodes, edges }
}

/**
 * Merge multiple graphs' snapshots into one. Node/edge ids may collide across
 * graphs (SQLite row ids), so every id is prefixed with `${graphName}:`.
 * Each node's `properties.graphName` records its graph of origin for UI use
 * (badges, SelectionOverlay routing).
 */
export function mergeSnapshots(
  parts: { graphName: string; snapshot: GraphSnapshot }[],
): GraphSnapshot {
  const nodes: GraphNodeRecord[] = []
  const edges: GraphEdgeRecord[] = []

  for (const { graphName, snapshot } of parts) {
    for (const node of snapshot.nodes) {
      nodes.push({
        ...node,
        id: `${graphName}:${node.id}`,
        properties: { ...node.properties, graphName, rawId: node.id },
      })
    }
    for (const edge of snapshot.edges) {
      edges.push({
        ...edge,
        id: `${graphName}:${edge.id}`,
        sourceId: `${graphName}:${edge.sourceId}`,
        targetId: `${graphName}:${edge.targetId}`,
        properties: { ...edge.properties, rawId: edge.id },
      })
    }
  }

  return { nodes, edges }
}
