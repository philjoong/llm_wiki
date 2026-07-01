import type { CanvasData } from "@/lib/falkor-visualization"
import type { GraphSnapshot } from "./types"

export function graphSnapshotToCanvas(snapshot: GraphSnapshot): CanvasData {
  const nodeIdMap = new Map<string, number>()
  const nodes = snapshot.nodes.map((node, index) => {
    const numericId = index + 1
    nodeIdMap.set(node.id, numericId)
    return {
      id: numericId,
      labels: node.labels,
      visible: true,
      data: {
        ...node.properties,
        id: node.id,
        label: node.name,
        name: node.name,
        path: node.pagePath,
        page_path: node.pagePath,
      },
    }
  })

  const links = snapshot.edges.map((edge, index) => ({
    id: index + 1,
    relationship: edge.relationType,
    source: nodeIdMap.get(edge.sourceId) ?? 0,
    target: nodeIdMap.get(edge.targetId) ?? 0,
    visible: true,
    data: {
      ...edge.properties,
      id: edge.id,
      relation_type: edge.relationType,
    },
  })).filter((edge) => edge.source !== 0 && edge.target !== 0)

  return { nodes, links }
}
