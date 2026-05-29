import { useEffect, useCallback, useState, useRef } from "react"
import Graph from "graphology"
import { SigmaContainer, useLoadGraph, useRegisterEvents, useSigma } from "@react-sigma/core"
import "@react-sigma/core/lib/style.css"
import forceAtlas2 from "graphology-layout-forceatlas2"
import { Network, RefreshCw, ZoomIn, ZoomOut, Maximize, Layers, Tag, Lightbulb, AlertTriangle, Link2, X } from "lucide-react"
import { ErrorBoundary } from "@/components/error-boundary"
import { Button } from "@/components/ui/button"
import { useWikiStore } from "@/stores/wiki-store"
import { readFile } from "@/commands/fs"
import { buildWikiGraph, type GraphNode, type GraphEdge, type CommunityInfo } from "@/lib/wiki-graph"
import { findSurprisingConnections, detectKnowledgeGaps, type SurprisingConnection, type KnowledgeGap } from "@/lib/graph-insights"
import { normalizePath } from "@/lib/path-utils"
import { loadGraphPolicy, saveGraphPolicy } from "@/lib/graph-policy"
import { createGraphDb, deleteGraphDb, listGraphDb } from "@/commands/graph-db"

const NODE_TYPE_COLORS: Record<string, string> = {
  entity: "#60a5fa",    // blue-400
  concept: "#c084fc",   // purple-400
  source: "#fb923c",    // orange-400
  query: "#4ade80",     // green-400
  synthesis: "#f87171",  // red-400
  overview: "#facc15",  // yellow-400
  comparison: "#2dd4bf", // teal-400
  other: "#94a3b8",     // slate-400
}

const NODE_TYPE_LABELS: Record<string, string> = {
  entity: "Entity",
  concept: "Concept",
  source: "Source",
  query: "Query",
  synthesis: "Synthesis",
  overview: "Overview",
  comparison: "Comparison",
  other: "Other",
}

const COMMUNITY_COLORS = [
  "#60a5fa",  // blue-400
  "#4ade80",  // green-400
  "#fb923c",  // orange-400
  "#c084fc",  // purple-400
  "#f87171",  // red-400
  "#2dd4bf",  // teal-400
  "#facc15",  // yellow-400
  "#f472b6",  // pink-400
  "#a78bfa",  // violet-400
  "#38bdf8",  // sky-400
  "#34d399",  // emerald-400
  "#fbbf24",  // amber-400
]

type ColorMode = "type" | "community"

const BASE_NODE_SIZE = 8
const MAX_NODE_SIZE = 28

function nodeColor(type: string): string {
  return NODE_TYPE_COLORS[type] ?? NODE_TYPE_COLORS.other
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function mixColor(color1: string, color2: string, ratio: number): string {
  const hex = (c: string) => parseInt(c, 16)
  const r1 = hex(color1.slice(1, 3)), g1 = hex(color1.slice(3, 5)), b1 = hex(color1.slice(5, 7))
  const r2 = hex(color2.slice(1, 3)), g2 = hex(color2.slice(3, 5)), b2 = hex(color2.slice(5, 7))
  const r = Math.round(r1 + (r2 - r1) * ratio)
  const g = Math.round(g1 + (g2 - g1) * ratio)
  const b = Math.round(b1 + (b2 - b1) * ratio)
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`
}

function nodeSize(linkCount: number, maxLinks: number): number {
  if (maxLinks === 0) return BASE_NODE_SIZE
  const ratio = linkCount / maxLinks
  return BASE_NODE_SIZE + Math.sqrt(ratio) * (MAX_NODE_SIZE - BASE_NODE_SIZE)
}

// --- Inner components ---

// Cache computed node positions so re-renders don't re-layout
const positionCache = new Map<string, { x: number; y: number }>()
let lastLayoutDataKey = ""

function GraphLoader({ nodes, edges, colorMode }: { nodes: GraphNode[]; edges: GraphEdge[]; colorMode: ColorMode }) {
  const loadGraph = useLoadGraph()

  useEffect(() => {
    const dataKey = nodes.map((n) => n.id).sort().join(",") + "|" + edges.length
    const needsLayout = dataKey !== lastLayoutDataKey

    const graph = new Graph()
    const maxLinks = Math.max(...nodes.map((n) => n.linkCount), 1)

    for (const node of nodes) {
      const cached = positionCache.get(node.id)
      const color = colorMode === "community"
        ? COMMUNITY_COLORS[node.community % COMMUNITY_COLORS.length]
        : nodeColor(node.type)
      graph.addNode(node.id, {
        x: cached?.x ?? Math.random() * 100,
        y: cached?.y ?? Math.random() * 100,
        size: nodeSize(node.linkCount, maxLinks),
        color,
        label: node.label,
        nodeType: node.type,
        nodePath: node.path,
        community: node.community,
      })
    }

    // Calculate max weight for normalization
    const maxWeight = Math.max(...edges.map((e) => e.weight), 1)

    for (const edge of edges) {
      if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
        const edgeKey = `${edge.source}->${edge.target}`
        if (!graph.hasEdge(edgeKey) && !graph.hasEdge(`${edge.target}->${edge.source}`)) {
          const normalizedWeight = edge.weight / maxWeight // 0..1
          const size = 0.5 + normalizedWeight * 3.5 // 0.5..4
          // Stronger relationships → darker color
          const alpha = Math.round(40 + normalizedWeight * 180) // 40..220
          const color = `rgba(100,116,139,${alpha / 255})` // slate-500 with variable opacity
          graph.addEdgeWithKey(edgeKey, edge.source, edge.target, {
            color,
            size,
            weight: edge.weight,
          })
        }
      }
    }

    // Only run expensive ForceAtlas2 layout when data actually changed
    if (needsLayout && nodes.length > 1) {
      const settings = forceAtlas2.inferSettings(graph)
      forceAtlas2.assign(graph, {
        iterations: 150,
        settings: {
          ...settings,
          gravity: 1,
          scalingRatio: 2,
          strongGravityMode: true,
          barnesHutOptimize: nodes.length > 50,
        },
      })
      lastLayoutDataKey = dataKey

      // Cache computed positions
      graph.forEachNode((nodeId, attrs) => {
        positionCache.set(nodeId, { x: attrs.x, y: attrs.y })
      })
    }

    loadGraph(graph)
  }, [loadGraph, nodes, edges, colorMode])

  return null
}

function HighlightManager({ highlightedNodes }: { highlightedNodes: Set<string> }) {
  const sigma = useSigma()

  useEffect(() => {
    const graph = sigma.getGraph()
    if (highlightedNodes.size === 0) {
      graph.forEachNode((n) => {
        graph.removeNodeAttribute(n, "insightHighlight")
        graph.removeNodeAttribute(n, "dimmed")
      })
      graph.forEachEdge((e) => {
        graph.removeEdgeAttribute(e, "dimmed")
        graph.removeEdgeAttribute(e, "highlighted")
      })
    } else {
      graph.forEachNode((n) => {
        if (highlightedNodes.has(n)) {
          graph.setNodeAttribute(n, "insightHighlight", true)
          graph.removeNodeAttribute(n, "dimmed")
        } else {
          graph.setNodeAttribute(n, "dimmed", true)
          graph.removeNodeAttribute(n, "insightHighlight")
        }
      })
      graph.forEachEdge((e, _attrs, source, target) => {
        if (highlightedNodes.has(source) && highlightedNodes.has(target)) {
          graph.setEdgeAttribute(e, "highlighted", true)
          graph.removeEdgeAttribute(e, "dimmed")
        } else {
          graph.setEdgeAttribute(e, "dimmed", true)
          graph.removeEdgeAttribute(e, "highlighted")
        }
      })
    }
    sigma.refresh()
  }, [sigma, highlightedNodes])

  return null
}

function EventHandler({ onNodeClick }: { onNodeClick: (nodeId: string) => void }) {
  const registerEvents = useRegisterEvents()
  const sigma = useSigma()

  useEffect(() => {
    registerEvents({
      clickNode: ({ node }) => onNodeClick(node),
      enterNode: ({ node }) => {
        const container = sigma.getContainer()
        container.style.cursor = "pointer"
        const graph = sigma.getGraph()
        graph.setNodeAttribute(node, "hovering", true)
        const neighbors = new Set(graph.neighbors(node))
        neighbors.add(node)
        graph.forEachNode((n) => {
          if (!neighbors.has(n)) graph.setNodeAttribute(n, "dimmed", true)
        })
        graph.forEachEdge((e, _attrs, source, target) => {
          if (source !== node && target !== node) {
            graph.setEdgeAttribute(e, "dimmed", true)
          } else {
            graph.setEdgeAttribute(e, "highlighted", true)
          }
        })
        sigma.refresh()
      },
      leaveNode: () => {
        const container = sigma.getContainer()
        container.style.cursor = "default"
        const graph = sigma.getGraph()
        graph.forEachNode((n) => {
          graph.removeNodeAttribute(n, "hovering")
          graph.removeNodeAttribute(n, "dimmed")
        })
        graph.forEachEdge((e) => {
          graph.removeEdgeAttribute(e, "dimmed")
          graph.removeEdgeAttribute(e, "highlighted")
        })
        sigma.refresh()
      },
    })
  }, [registerEvents, sigma, onNodeClick])

  return null
}

function ZoomControls() {
  const sigma = useSigma()

  return (
    <div className="absolute top-3 right-3 flex flex-col gap-1">
      <Button
        variant="outline"
        size="icon"
        className="h-7 w-7 bg-background/80 backdrop-blur-sm"
        onClick={() => {
          const camera = sigma.getCamera()
          camera.animatedZoom({ duration: 200 })
        }}
      >
        <ZoomIn className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="h-7 w-7 bg-background/80 backdrop-blur-sm"
        onClick={() => {
          const camera = sigma.getCamera()
          camera.animatedUnzoom({ duration: 200 })
        }}
      >
        <ZoomOut className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="h-7 w-7 bg-background/80 backdrop-blur-sm"
        onClick={() => {
          const camera = sigma.getCamera()
          camera.animatedReset({ duration: 300 })
        }}
      >
        <Maximize className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

// --- Main component ---

export function GraphView() {
  const project = useWikiStore((s) => s.project)
  const dataVersion = useWikiStore((s) => s.dataVersion)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setFileContent = useWikiStore((s) => s.setFileContent)

  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [edges, setEdges] = useState<GraphEdge[]>([])
  const [communities, setCommunities] = useState<CommunityInfo[]>([])
  const [surprisingConns, setSurprisingConns] = useState<SurprisingConnection[]>([])
  const [knowledgeGaps, setKnowledgeGaps] = useState<KnowledgeGap[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hoveredType, setHoveredType] = useState<string | null>(null)
  const [colorMode, setColorMode] = useState<ColorMode>("type")
  const [showInsights, setShowInsights] = useState(false)
  const [highlightedNodes, setHighlightedNodes] = useState<Set<string>>(new Set())
  const [dismissedInsights, setDismissedInsights] = useState<Set<string>>(new Set())
  const [sigmaKey, setSigmaKey] = useState(0)
  const [isResizing, setIsResizing] = useState(false)
  const [relationTypes, setRelationTypes] = useState<string[]>([])
  const [managedGraphs, setManagedGraphs] = useState<string[]>([])
  const [newRelationType, setNewRelationType] = useState("")
  const [newGraphName, setNewGraphName] = useState("")
  const [graphOpMessage, setGraphOpMessage] = useState<string | null>(null)
  const [graphFilter, setGraphFilter] = useState<string>("__all__")
  const graphContainerRef = useRef<HTMLDivElement>(null)
  const lastLoadedVersion = useRef(-1)

  const loadGraph = useCallback(async () => {
    if (!project) return
    setLoading(true)
    setError(null)
    try {
      const result = await buildWikiGraph(normalizePath(project.path))
      setNodes(result.nodes)
      setEdges(result.edges)
      setCommunities(result.communities)
      setSurprisingConns(findSurprisingConnections(result.nodes, result.edges, result.communities))
      setKnowledgeGaps(detectKnowledgeGaps(result.nodes, result.edges, result.communities))
      setGraphFilter("__all__")
      lastLoadedVersion.current = useWikiStore.getState().dataVersion
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to build graph"
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [project])

  useEffect(() => {
    if (dataVersion !== lastLoadedVersion.current) {
      loadGraph()
    }
  }, [loadGraph, dataVersion])

  const handleNodeClick = useCallback(
    async (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId)
      if (!node) return
      try {
        const content = await readFile(node.path)
        setSelectedFile(node.path)
        setFileContent(content)
      } catch (err) {
        console.error("Failed to open wiki page:", err)
      }
    },
    [nodes, setSelectedFile, setFileContent],
  )

  // Unmount sigma when panels resize or toggle to prevent WebGL crash.
  // Sigma crashes with "could not find suitable program for node type circle"
  // when its canvas is resized by external layout changes.

  // 1. Detect panel open/close (selectedFile, insights)
  const selectedFileForLayout = useWikiStore((s) => s.selectedFile)
  const layoutKey = `${!!selectedFileForLayout}-${showInsights}`
  const prevLayoutKey = useRef(layoutKey)

  useEffect(() => {
    if (prevLayoutKey.current !== layoutKey) {
      prevLayoutKey.current = layoutKey
      setIsResizing(true)
      const timer = setTimeout(() => {
        setSigmaKey((k) => k + 1)
        setIsResizing(false)
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [layoutKey])

  // 2. Detect panel drag resize via data-panel-resizing attribute on body
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const dragging = document.body.dataset.panelResizing === "true"
      if (dragging && !isResizing) {
        setIsResizing(true)
      }
      if (!dragging && isResizing) {
        // Drag ended — remount sigma after a tick
        setTimeout(() => {
          setSigmaKey((k) => k + 1)
          setIsResizing(false)
        }, 50)
      }
    })
    observer.observe(document.body, { attributes: true, attributeFilter: ["data-panel-resizing"] })
    return () => observer.disconnect()
  }, [isResizing])

  useEffect(() => {
    if (!project) return
    void (async () => {
      const policy = await loadGraphPolicy(normalizePath(project.path))
      setRelationTypes(policy.relationTypes)
      setManagedGraphs(policy.managedGraphs)
    })()
  }, [project])

  useEffect(() => {
    return () => {
      if (graphOpMessageTimer.current) clearTimeout(graphOpMessageTimer.current)
    }
  }, [])

  const persistPolicy = useCallback(async (nextRelations: string[], nextGraphs: string[]) => {
    if (!project) return
    const saved = await saveGraphPolicy(normalizePath(project.path), {
      relationTypes: nextRelations,
      managedGraphs: nextGraphs,
    })
    setRelationTypes(saved.relationTypes)
    setManagedGraphs(saved.managedGraphs)
  }, [project])

  const addRelationType = useCallback(async () => {
    const value = newRelationType.trim()
    if (!value) return
    if (relationTypes.length >= 4) return
    if (relationTypes.some((t) => t.toLowerCase() === value.toLowerCase())) return
    const next = [...relationTypes, value]
    await persistPolicy(next, managedGraphs)
    setNewRelationType("")
  }, [newRelationType, relationTypes, persistPolicy, managedGraphs])

  const removeRelationType = useCallback(async (value: string) => {
    const next = relationTypes.filter((t) => t !== value)
    await persistPolicy(next, managedGraphs)
  }, [relationTypes, persistPolicy, managedGraphs])

  const graphOpMessageTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showGraphOpMessage = useCallback((msg: string) => {
    setGraphOpMessage(msg)
    if (graphOpMessageTimer.current) clearTimeout(graphOpMessageTimer.current)
    graphOpMessageTimer.current = setTimeout(() => setGraphOpMessage(null), 4000)
  }, [])

  const addManagedGraph = useCallback(async () => {
    const value = newGraphName.trim()
    if (!value) return
    if (managedGraphs.some((g) => g.toLowerCase() === value.toLowerCase())) return
    try {
      await createGraphDb(value)
    } catch (err) {
      showGraphOpMessage(err instanceof Error ? err.message : String(err))
      return
    }
    const next = [...managedGraphs, value]
    await persistPolicy(relationTypes, next)
    setNewGraphName("")
    showGraphOpMessage(`Graph created: ${value}`)
  }, [newGraphName, managedGraphs, persistPolicy, relationTypes, showGraphOpMessage])

  const removeManagedGraph = useCallback(async (value: string) => {
    try {
      await deleteGraphDb(value)
    } catch (err) {
      showGraphOpMessage(err instanceof Error ? err.message : String(err))
      return
    }
    const next = managedGraphs.filter((g) => g !== value)
    await persistPolicy(relationTypes, next)
    showGraphOpMessage(`Graph deleted: ${value}`)
  }, [managedGraphs, persistPolicy, relationTypes, showGraphOpMessage])

  const syncManagedGraphsFromDb = useCallback(async () => {
    try {
      const names = await listGraphDb()
      const next = [...new Set(names.filter(Boolean))]
      await persistPolicy(relationTypes, next)
      showGraphOpMessage(`Synced ${next.length} graph(s) from FalkorDB`)
    } catch (err) {
      showGraphOpMessage(err instanceof Error ? err.message : String(err))
    }
  }, [persistPolicy, relationTypes, showGraphOpMessage])

  // Apply graph filter
  const filteredNodes = graphFilter === "__all__"
    ? nodes
    : graphFilter === "__unassigned__"
      ? nodes.filter((n) => !n.graph)
      : nodes.filter((n) => n.graph === graphFilter)

  const filteredNodeIds = new Set(filteredNodes.map((n) => n.id))
  const filteredEdges = graphFilter === "__all__"
    ? edges
    : edges.filter((e) => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target))

  // Count nodes by type for legend
  const typeCounts = filteredNodes.reduce<Record<string, number>>((acc, n) => {
    acc[n.type] = (acc[n.type] ?? 0) + 1
    return acc
  }, {})

  if (!project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Network className="h-10 w-10 opacity-30" />
        <p className="text-sm">Open a project to view the graph</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <RefreshCw className="h-8 w-8 animate-spin opacity-50" />
        <p className="text-sm">Building graph...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Network className="h-10 w-10 opacity-30" />
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={loadGraph}>Retry</Button>
      </div>
    )
  }

  if (!loading && nodes.length === 0 && !error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Network className="h-10 w-10 opacity-30" />
        <p className="text-sm">No pages yet</p>
        <p className="text-xs">Import sources to start building the knowledge graph</p>
      </div>
    )
  }

  return (
    <div className="relative flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-2 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Network className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Knowledge Graph</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="rounded bg-muted px-1.5 py-0.5">{filteredNodes.length} pages</span>
            <span className="rounded bg-muted px-1.5 py-0.5">{filteredEdges.length} links</span>
          </div>
          {managedGraphs.length > 0 && (
            <select
              value={graphFilter}
              onChange={(e) => setGraphFilter(e.target.value)}
              className="h-6 rounded border bg-background px-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="__all__">All graphs</option>
              {managedGraphs.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
              <option value="__unassigned__">Unassigned</option>
            </select>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant={colorMode === "type" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setColorMode("type")}
            className="text-xs gap-1 h-7"
          >
            <Tag className="h-3 w-3" />
            Type
          </Button>
          <Button
            variant={colorMode === "community" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setColorMode("community")}
            className="text-xs gap-1 h-7"
          >
            <Layers className="h-3 w-3" />
            Community
          </Button>
          {(surprisingConns.filter((c) => !dismissedInsights.has(c.key)).length > 0 || knowledgeGaps.length > 0) && (
            <Button
              variant={showInsights ? "secondary" : "ghost"}
              size="sm"
              onClick={() => {
                setShowInsights((v) => {
                  if (v) setHighlightedNodes(new Set())
                  return !v
                })
              }}
              className="text-xs gap-1 h-7"
            >
              <Lightbulb className="h-3 w-3" />
              Insights
              <span className="rounded bg-muted px-1 text-[10px]">
                {surprisingConns.filter((c) => !dismissedInsights.has(c.key)).length + knowledgeGaps.length}
              </span>
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={loadGraph} className="text-xs gap-1 h-7">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="border-b px-4 py-2 shrink-0 bg-muted/20">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded border bg-background p-2">
            <div className="mb-2 text-xs font-medium">LLM Relation Types (max 4)</div>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {relationTypes.map((rel) => (
                <button
                  key={rel}
                  type="button"
                  onClick={() => { void removeRelationType(rel) }}
                  className="rounded border px-2 py-0.5 text-[11px] hover:bg-accent"
                  title="Remove"
                >
                  {rel} ×
                </button>
              ))}
              {relationTypes.length === 0 && <span className="text-[11px] text-muted-foreground">No relation type set</span>}
            </div>
            <div className="flex gap-2">
              <input
                value={newRelationType}
                onChange={(e) => setNewRelationType(e.target.value)}
                placeholder="e.g. REQUIRES"
                className="h-7 flex-1 rounded border bg-transparent px-2 text-xs"
                onKeyDown={(e) => { if (e.key === "Enter") void addRelationType() }}
              />
              <Button size="sm" className="h-7 text-xs" onClick={() => { void addRelationType() }} disabled={relationTypes.length >= 4}>
                Add
              </Button>
            </div>
          </div>

          <div className="rounded border bg-background p-2">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-medium">Managed Graphs (user-created)</div>
              <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={() => { void syncManagedGraphsFromDb() }}>
                Sync
              </Button>
            </div>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {managedGraphs.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => { void removeManagedGraph(name) }}
                  className="rounded border px-2 py-0.5 text-[11px] hover:bg-accent"
                  title="Remove"
                >
                  {name} ×
                </button>
              ))}
              {managedGraphs.length === 0 && <span className="text-[11px] text-muted-foreground">No graph registered</span>}
            </div>
            <div className="flex gap-2">
              <input
                value={newGraphName}
                onChange={(e) => setNewGraphName(e.target.value)}
                placeholder="e.g. ui_graph"
                className="h-7 flex-1 rounded border bg-transparent px-2 text-xs"
                onKeyDown={(e) => { if (e.key === "Enter") void addManagedGraph() }}
              />
              <Button size="sm" className="h-7 text-xs" onClick={() => { void addManagedGraph() }}>
                Add
              </Button>
            </div>
            {graphOpMessage && <div className="mt-2 text-[11px] text-muted-foreground">{graphOpMessage}</div>}
          </div>
        </div>
      </div>

      {/* Graph canvas + Insights side panel */}
      <div className="flex flex-1 min-h-0">
        {/* Graph canvas */}
        <div ref={graphContainerRef} className="relative flex-1 min-w-0 overflow-hidden bg-slate-50 dark:bg-slate-950">
          {isResizing ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              Resizing...
            </div>
          ) : (
          <ErrorBoundary>
          <SigmaContainer
            key={sigmaKey}
            style={{ width: "100%", height: "100%", background: "transparent" }}
            settings={{
              renderEdgeLabels: true,
              defaultEdgeColor: "#cbd5e1",
              defaultNodeColor: "#94a3b8",
              labelSize: 13,
              labelWeight: "bold",
              labelColor: { color: "#1e293b" },
              labelDensity: 0.4,
              labelRenderedSizeThreshold: 6,
              stagePadding: 30,
              nodeReducer: (_node, attrs) => {
                const result = { ...attrs }
                if (attrs.insightHighlight) {
                  result.size = (attrs.size ?? BASE_NODE_SIZE) * 1.5
                  result.zIndex = 10
                  result.forceLabel = true
                }
                if (attrs.hovering) {
                  result.size = (attrs.size ?? BASE_NODE_SIZE) * 1.4
                  result.zIndex = 10
                  result.forceLabel = true
                }
                if (attrs.dimmed) {
                  result.color = mixColor(attrs.color ?? "#94a3b8", "#e2e8f0", 0.75)
                  result.label = ""
                  result.size = (attrs.size ?? BASE_NODE_SIZE) * 0.6
                }
                return result
              },
              edgeReducer: (_edge, attrs) => {
                const result = { ...attrs }
                if (attrs.dimmed) {
                  result.color = "#f1f5f9"
                  result.size = 0.3
                }
                if (attrs.highlighted) {
                  const w = attrs.weight ?? 1
                  result.color = "#1e293b"
                  result.size = Math.max(2, (attrs.size ?? 1) * 1.5)
                  result.label = `relevance: ${w.toFixed(1)}`
                  result.forceLabel = true
                }
                return result
              },
            }}
          >
            <GraphLoader nodes={filteredNodes} edges={filteredEdges} colorMode={colorMode} />
            <EventHandler onNodeClick={handleNodeClick} />
            <HighlightManager highlightedNodes={highlightedNodes} />
            <ZoomControls />
          </SigmaContainer>
          </ErrorBoundary>
          )}

          {/* Legend */}
          <div className="absolute bottom-3 left-3 rounded-lg border bg-background/90 backdrop-blur-sm px-3 py-2 text-xs shadow-sm max-w-[260px]">
            {colorMode === "type" ? (
              <>
                <div className="mb-1.5 font-semibold text-foreground">Node Types</div>
                <div className="flex flex-col gap-0.5">
                  {Object.entries(NODE_TYPE_LABELS)
                    .filter(([type]) => (typeCounts[type] ?? 0) > 0)
                    .map(([type, label]) => (
                      <div
                        key={type}
                        className="flex items-center gap-2 rounded px-1 py-0.5 transition-colors hover:bg-accent/50"
                        onMouseEnter={() => setHoveredType(type)}
                        onMouseLeave={() => setHoveredType(null)}
                      >
                        <span
                          className="inline-block h-3 w-3 rounded-full shrink-0 shadow-sm"
                          style={{
                            backgroundColor: NODE_TYPE_COLORS[type],
                            boxShadow: `0 0 4px ${hexToRgba(NODE_TYPE_COLORS[type] ?? "#94a3b8", 0.4)}`,
                          }}
                        />
                        <span className={hoveredType === type ? "text-foreground font-medium" : "text-muted-foreground"}>
                          {label}
                        </span>
                        <span className="text-muted-foreground/60 ml-auto">{typeCounts[type]}</span>
                      </div>
                    ))}
                </div>
              </>
            ) : (
              <>
                <div className="mb-1.5 font-semibold text-foreground">Communities</div>
                <div className="flex flex-col gap-0.5">
                  {communities.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center gap-2 rounded px-1 py-0.5 transition-colors hover:bg-accent/50"
                    >
                      <span
                        className="inline-block h-3 w-3 rounded-full shrink-0 shadow-sm"
                        style={{
                          backgroundColor: COMMUNITY_COLORS[c.id % COMMUNITY_COLORS.length],
                          boxShadow: `0 0 4px ${hexToRgba(COMMUNITY_COLORS[c.id % COMMUNITY_COLORS.length], 0.4)}`,
                        }}
                      />
                      <span className="text-muted-foreground truncate" title={c.topNodes.join(", ")}>
                        {c.topNodes[0] ?? `Cluster ${c.id}`}
                      </span>
                      <span className="text-muted-foreground/60 ml-auto shrink-0">{c.nodeCount}</span>
                      {c.cohesion < 0.15 && c.nodeCount >= 3 && (
                        <span className="text-amber-500 shrink-0" title={`Low cohesion: ${c.cohesion.toFixed(2)}`}>!</span>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Insights Side Panel */}
        {showInsights && (
          <div className="w-80 shrink-0 border-l bg-background overflow-y-auto">
            <div className="px-4 py-3 border-b">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Lightbulb className="h-4 w-4 text-amber-500" />
                  <span className="text-sm font-medium">Insights</span>
                </div>
                <button
                  className="p-1 rounded hover:bg-muted text-muted-foreground"
                  onClick={() => {
                    setShowInsights(false)
                    setHighlightedNodes(new Set())
                  }}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="p-3 flex flex-col gap-4">
              {/* Surprising Connections */}
              {surprisingConns.filter((c) => !dismissedInsights.has(c.key)).length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold text-foreground">
                    <Link2 className="h-3.5 w-3.5 text-blue-500" />
                    Surprising Connections
                  </div>
                  <div className="flex flex-col gap-2">
                    {surprisingConns
                      .filter((conn) => !dismissedInsights.has(conn.key))
                      .map((conn, i) => {
                        const ids = new Set([conn.source.id, conn.target.id])
                        const isActive = highlightedNodes.size === ids.size &&
                          [...ids].every((id) => highlightedNodes.has(id))
                        return (
                          <div
                            key={i}
                            className={`rounded-lg border p-3 text-sm cursor-pointer transition-colors ${isActive ? "bg-blue-500/10 border-blue-500/40" : "hover:bg-muted/50"}`}
                            onClick={() => setHighlightedNodes(isActive ? new Set() : ids)}
                          >
                            <div className="flex items-start justify-between gap-2 mb-1">
                              <span className="font-medium text-foreground text-xs">
                                {conn.source.label} ↔ {conn.target.label}
                              </span>
                              <button
                                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setDismissedInsights((prev) => new Set([...prev, conn.key]))
                                  if (isActive) setHighlightedNodes(new Set())
                                }}
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {conn.reasons.join(", ")}
                            </p>
                          </div>
                        )
                      })}
                  </div>
                </div>
              )}

              {/* Knowledge Gaps */}
              {knowledgeGaps.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold text-foreground">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                    Knowledge Gaps
                  </div>
                  <div className="flex flex-col gap-2">
                    {knowledgeGaps.map((gap, i) => {
                      const ids = new Set(gap.nodeIds)
                      const isActive = highlightedNodes.size > 0 &&
                        [...ids].every((id) => highlightedNodes.has(id)) &&
                        [...highlightedNodes].every((id) => ids.has(id))
                      return (
                        <div
                          key={i}
                          className={`rounded-lg border p-3 text-sm cursor-pointer transition-colors ${isActive ? "bg-amber-500/10 border-amber-500/40" : "hover:bg-muted/50"}`}
                          onClick={() => setHighlightedNodes(isActive ? new Set() : ids)}
                        >
                          <div className="font-medium text-xs text-foreground mb-1">{gap.title}</div>
                          <p className="text-xs text-muted-foreground mb-2">{gap.description}</p>
                          <p className="text-xs text-muted-foreground/80 italic">{gap.suggestion}</p>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

    </div>
  )
}
