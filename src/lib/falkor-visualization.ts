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

type Pair = [string, unknown]

/**
 * A FalkorDB graph entity (node/edge) in the verbose (non-compact) GRAPH.QUERY
 * reply is an array of [key, value] pairs, e.g.
 *   [["id", 0], ["labels", ["Page"]], ["properties", [["path","..."], ...]]]
 * Our Rust `redis_value_to_json` only emits arrays/scalars/strings (no maps),
 * so this pair-array form is exactly what reaches JS. See Fix 26.
 */
function isPairArray(x: unknown): x is Pair[] {
  return (
    Array.isArray(x) &&
    x.length > 0 &&
    x.every((p) => Array.isArray(p) && p.length === 2 && typeof p[0] === "string")
  )
}

function pairsToObject(pairs: Pair[]): Record<string, any> {
  const obj: Record<string, any> = {}
  for (const [k, v] of pairs) obj[k] = v
  return obj
}

/**
 * Parses the JSON response from graph_db_query into CanvasData.
 *
 * Ground truth (captured from the live FalkorDB via raw GRAPH.QUERY):
 *   - Full reply: [ header, rows, stats ]
 *       header = ["n"] / ["n","r","m"]   (column names)
 *       rows   = [ [ cell, ... ], ... ]  (each cell is a node/edge entity)
 *       stats  = ["Cached execution: 1", "Query internal ... time ..."]
 *   - Node entity: [["id",0],["labels",["Page"]],["properties",[[k,v],...]]]
 *   - Edge entity: [["id",0],["type","REL"],["src_node",0],["dest_node",1],["properties",[...]]]
 *
 * Strategy: deep-walk the whole reply and pick up any array that has the
 * structural signature of a node or edge entity. Header/stats are arrays of
 * strings (not pair-arrays), so they never match — no fragile index math.
 * A defensive object-shape branch is kept in case a future backend switch to
 * RESP3 maps emits {id, labels, properties} objects directly.
 */
export function parseFalkorQueryResult(result: any): CanvasData {
  const nodesMap = new Map<number, CanvasNode>()
  const edgesMap = new Map<number, CanvasEdge>()

  const addNode = (o: Record<string, any>): void => {
    const id = Number(o.id)
    if (Number.isNaN(id) || nodesMap.has(id)) return
    const props = isPairArray(o.properties)
      ? pairsToObject(o.properties)
      : (o.properties ?? {})
    nodesMap.set(id, {
      id,
      labels: Array.isArray(o.labels) ? o.labels : [],
      visible: true,
      data: props,
    })
  }

  const addEdge = (o: Record<string, any>): void => {
    const id = Number(o.id)
    if (Number.isNaN(id) || edgesMap.has(id)) return
    const props = isPairArray(o.properties)
      ? pairsToObject(o.properties)
      : (o.properties ?? {})
    edgesMap.set(id, {
      id,
      relationship: String(o.type ?? o.relationshipType ?? ""),
      source: Number(o.src_node ?? o.sourceId),
      target: Number(o.dest_node ?? o.destinationId),
      visible: true,
      data: props,
    })
  }

  const walk = (value: any): void => {
    if (Array.isArray(value)) {
      if (isPairArray(value)) {
        const keys = new Set(value.map((p) => p[0]))
        if (keys.has("labels") && keys.has("id")) {
          addNode(pairsToObject(value))
          return
        }
        if (keys.has("src_node") && keys.has("dest_node")) {
          addEdge(pairsToObject(value))
          return
        }
      }
      for (const item of value) walk(item)
      return
    }
    // Defensive object-shape fallback (not produced by the current backend).
    if (value && typeof value === "object") {
      if ("labels" in value && "id" in value) {
        addNode(value)
      } else if (("src_node" in value || "sourceId" in value) && "id" in value) {
        addEdge(value)
      } else {
        for (const v of Object.values(value)) walk(v)
      }
    }
  }

  walk(result)

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
