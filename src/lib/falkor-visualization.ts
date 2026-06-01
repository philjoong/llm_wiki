/**
 * Simplified data structures for FalkorDB visualization,
 * inspired by falkordb-browser.
 */

export interface FalkorNode {
  id: number
  labels: string[]
  properties: Record<string, any>
}

export interface FalkorEdge {
  id: number
  type: string
  sourceId: number
  targetId: number
  properties: Record<string, any>
}

export interface CanvasNode {
  id: number
  labels: string[]
  color?: string
  visible: boolean
  size?: number
  data: Record<string, any>
  highlighted?: boolean
}

export interface CanvasEdge {
  id: number
  relationship: string
  color?: string
  visible: boolean
  source: number
  target: number
  data: Record<string, any>
  highlighted?: boolean
}

export interface CanvasData {
  nodes: CanvasNode[]
  links: CanvasEdge[]
}

/**
 * Parses the generic JSON response from graph_db_query into CanvasData.
 * 
 * Our Rust backend returns redis_value_to_json(res), which for GRAPH.QUERY
 * typically looks like an array of rows, where each row is an array of cells.
 * Each cell can be a Node (Map/Object) or Edge (Map/Object).
 */
export function parseFalkorQueryResult(result: any): CanvasData {
  const nodesMap = new Map<number, CanvasNode>()
  const edgesMap = new Map<number, CanvasEdge>()

  if (!Array.isArray(result)) return { nodes: [], links: [] }

  // FalkorDB returns data in rows. Each row is an array of cells.
  for (const row of result) {
    if (!Array.isArray(row)) continue
    
    for (const cell of row) {
      if (!cell || typeof cell !== "object") continue

      // Detect Node
      if ("labels" in cell && "properties" in cell && "id" in cell) {
        const node = cell as any
        if (!nodesMap.has(node.id)) {
          nodesMap.set(node.id, {
            id: node.id,
            labels: node.labels,
            visible: true,
            data: node.properties,
          })
        }
      } 
      // Detect Edge
      else if ("relationshipType" in cell && "properties" in cell && "id" in cell && "sourceId" in cell) {
        const edge = cell as any
        if (!edgesMap.has(edge.id)) {
          edgesMap.set(edge.id, {
            id: edge.id,
            relationship: edge.relationshipType,
            source: edge.sourceId,
            target: edge.destinationId,
            visible: true,
            data: edge.properties,
          })
        }
      }
    }
  }

  return {
    nodes: Array.from(nodesMap.values()),
    links: Array.from(edgesMap.values()),
  }
}

/**
 * Assigns colors based on node labels.
 */
export const LABEL_COLORS = [
  "#60a5fa", // blue-400
  "#4ade80", // green-400
  "#fb923c", // orange-400
  "#c084fc", // purple-400
  "#f87171", // red-400
  "#2dd4bf", // teal-400
  "#facc15", // yellow-400
  "#f472b6", // pink-400
  "#a78bfa", // violet-400
  "#38bdf8", // sky-400
]

export function assignColors(data: CanvasData): CanvasData {
  const labelColorMap = new Map<string, string>()
  let colorIdx = 0

  const nodes = data.nodes.map(node => {
    const primaryLabel = node.labels[0] || "Unknown"
    if (!labelColorMap.has(primaryLabel)) {
      labelColorMap.set(primaryLabel, LABEL_COLORS[colorIdx % LABEL_COLORS.length])
      colorIdx++
    }
    return {
      ...node,
      color: labelColorMap.get(primaryLabel)
    }
  })

  const links = data.links.map(link => ({
    ...link,
    color: "#94a3b8" // Default slate-400 for links
  }))

  return { nodes, links }
}
