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

export const RELATION_COLORS = [
  "#f87171", // red-400
  "#fb923c", // orange-400
  "#facc15", // yellow-400
  "#4ade80", // green-400
  "#2dd4bf", // teal-400
  "#60a5fa", // blue-400
  "#a78bfa", // violet-400
  "#f472b6", // pink-400
]

export interface AssignColorsResult {
  data: CanvasData
  relationColorMap: Map<string, string>
}

export function assignColors(data: CanvasData): AssignColorsResult {
  const labelColorMap = new Map<string, string>()
  const relationColorMap = new Map<string, string>()
  let labelColorIdx = 0
  let relationColorIdx = 0

  const nodes = data.nodes.map((node) => {
    const primaryLabel = node.labels[0] || "Unknown"
    if (!labelColorMap.has(primaryLabel)) {
      labelColorMap.set(primaryLabel, LABEL_COLORS[labelColorIdx % LABEL_COLORS.length])
      labelColorIdx++
    }
    return { ...node, color: labelColorMap.get(primaryLabel) }
  })

  const links = data.links.map((link) => {
    const rel = link.relationship || "UNKNOWN"
    if (!relationColorMap.has(rel)) {
      relationColorMap.set(rel, RELATION_COLORS[relationColorIdx % RELATION_COLORS.length])
      relationColorIdx++
    }
    return { ...link, color: relationColorMap.get(rel) }
  })

  return { data: { nodes, links }, relationColorMap }
}
