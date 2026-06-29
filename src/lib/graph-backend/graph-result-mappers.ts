import type { CanvasData } from "@/lib/falkor-visualization"
import type { GraphSnapshot } from "./types"

type Pair = [string, unknown]

function isPairArray(x: unknown): x is Pair[] {
  return (
    Array.isArray(x) &&
    x.length > 0 &&
    x.every((p) => Array.isArray(p) && p.length === 2 && typeof p[0] === "string")
  )
}

function pairsToObject(pairs: Pair[]): Record<string, unknown> {
  const obj: Record<string, unknown> = {}
  for (const [k, v] of pairs) obj[k] = v
  return obj
}

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

export function falkorRawExportToSnapshot(raw: any): GraphSnapshot {
  const nodes = new Map<string, GraphSnapshot["nodes"][number]>()
  const edges = new Map<string, GraphSnapshot["edges"][number]>()

  const addNode = (o: Record<string, any>): void => {
    const id = String(o.id ?? o.properties?.id ?? o.properties?.label ?? nodes.size + 1)
    if (nodes.has(id)) return
    const properties = isPairArray(o.properties) ? pairsToObject(o.properties) : (o.properties ?? {})
    const name = String(properties.label ?? properties.name ?? properties.id ?? id)
    nodes.set(id, {
      id,
      labels: Array.isArray(o.labels) ? o.labels : ["Page"],
      name,
      pagePath: typeof properties.page_path === "string" ? properties.page_path : undefined,
      properties,
    })
  }

  const addEdge = (o: Record<string, any>): void => {
    const id = String(o.id ?? edges.size + 1)
    if (edges.has(id)) return
    const properties = isPairArray(o.properties) ? pairsToObject(o.properties) : (o.properties ?? {})
    edges.set(id, {
      id,
      sourceId: String(o.src_node ?? o.sourceId ?? ""),
      targetId: String(o.dest_node ?? o.destinationId ?? o.targetId ?? ""),
      relationType: String(o.type ?? o.relationshipType ?? "RELATED"),
      properties,
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
    if (value && typeof value === "object") {
      if ("labels" in value && "id" in value) addNode(value)
      else if (("src_node" in value || "sourceId" in value) && "id" in value) addEdge(value)
      else for (const v of Object.values(value)) walk(v)
    }
  }

  walk(raw)
  return { nodes: Array.from(nodes.values()), edges: Array.from(edges.values()) }
}
