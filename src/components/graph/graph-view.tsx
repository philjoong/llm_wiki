import { useEffect, useCallback, useState, useRef } from "react"
import { Network, RefreshCw, Lightbulb, X, Info } from "lucide-react"
import { ErrorBoundary } from "@/components/error-boundary"
import { Button } from "@/components/ui/button"
import { useWikiStore } from "@/stores/wiki-store"
import { readFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { loadGraphPolicy, saveGraphPolicy } from "@/lib/graph-policy"
import { deleteGraphDb, listGraphDb, queryGraphDb } from "@/commands/graph-db"
import { FalkorCanvas } from "./falkor-canvas"
import { parseFalkorQueryResult, assignColors, type CanvasData } from "@/lib/falkor-visualization"

export function GraphView() {
  const project = useWikiStore((s) => s.project)
  const dataVersion = useWikiStore((s) => s.dataVersion)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setFileContent = useWikiStore((s) => s.setFileContent)
  const selectedGraph = useWikiStore((s) => s.selectedGraph)
  const setSelectedGraph = useWikiStore((s) => s.setSelectedGraph)
  const highlightSource = useWikiStore((s) => s.highlightSource)

  const [graphData, setGraphData] = useState<CanvasData>({ nodes: [], links: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showInsights, setShowInsights] = useState(false)
  const [relationTypes, setRelationTypes] = useState<string[]>([])
  const [managedGraphs, setManagedGraphs] = useState<string[]>([])
  const [forbiddenTypes, setForbiddenTypes] = useState<string[]>([])
  const [newRelationType, setNewRelationType] = useState("")
  const [newGraphName, setNewGraphName] = useState("")
  const [graphOpMessage, setGraphOpMessage] = useState<string | null>(null)
  const [selectedElement, setSelectedElement] = useState<any>(null)
  const lastLoadedVersion = useRef(-1)

  const loadGraph = useCallback(async () => {
    if (!project) return
    setLoading(true)
    setError(null)
    try {
      // Fetch all nodes and edges from the selected sub-graph
      const cypher = "MATCH (n) OPTIONAL MATCH (n)-[r]->(m) RETURN n, r"
      const result = await queryGraphDb(project.name, selectedGraph, cypher)
      
      const parsed = parseFalkorQueryResult(result)
      const colored = assignColors(parsed)
      
      // Apply highlighting if highlightSource is set
      if (highlightSource) {
        const fileName = highlightSource.split("/").pop() || highlightSource
        colored.nodes = colored.nodes.map(n => {
          const isHighlighted = n.data?.sources?.includes(fileName)
          return {
            ...n,
            highlighted: isHighlighted,
            size: isHighlighted ? 12 : 6,
            // If highlighted, use a bright yellow/gold or red. 
            // Let's use red for strong contrast.
            color: isHighlighted ? "#ef4444" : n.color
          }
        })
        colored.links = colored.links.map(l => {
          const isHighlighted = l.data?.sources?.includes(fileName)
          return {
            ...l,
            highlighted: isHighlighted,
            color: isHighlighted ? "#ef4444" : l.color
          }
        })
      }
      
      setGraphData(colored)
      
      lastLoadedVersion.current = useWikiStore.getState().dataVersion
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load graph from FalkorDB"
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [project, selectedGraph, highlightSource])

  useEffect(() => {
    if (dataVersion !== lastLoadedVersion.current || !graphData.nodes.length || highlightSource) {
      loadGraph()
    }
  }, [loadGraph, dataVersion, highlightSource])

  const handleNodeClick = useCallback(
    async (node: any) => {
      setSelectedElement(node)
      // If the node has a 'path' property, we can open the file
      if (node.data && node.data.path) {
        try {
          const content = await readFile(node.data.path)
          setSelectedFile(node.data.path)
          setFileContent(content)
        } catch (err) {
          console.error("Failed to open wiki page:", err)
        }
      }
    },
    [setSelectedFile, setFileContent],
  )

  const handleLinkClick = useCallback((link: any) => {
    setSelectedElement(link)
  }, [])

  useEffect(() => {
    if (!project) return
    void (async () => {
      const policy = await loadGraphPolicy(normalizePath(project.path))
      setRelationTypes(policy.relationTypes)
      setManagedGraphs(policy.managedGraphs)
      setForbiddenTypes(policy.forbiddenTypes)
    })()
  }, [project])

  const addRelationType = useCallback(async () => {
    if (!project || !newRelationType.trim()) return
    const nextRelations = [...new Set([...relationTypes, newRelationType.trim().toUpperCase()])]
    const saved = await saveGraphPolicy(normalizePath(project.path), {
      relationTypes: nextRelations,
      managedGraphs,
      forbiddenTypes,
    })
    setRelationTypes(saved.relationTypes)
    setNewRelationType("")
  }, [project, newRelationType, relationTypes, managedGraphs, forbiddenTypes])

  const removeRelationType = useCallback(async (value: string) => {
    if (!project) return
    const nextRelations = relationTypes.filter((t) => t !== value)
    const saved = await saveGraphPolicy(normalizePath(project.path), {
      relationTypes: nextRelations,
      managedGraphs,
      forbiddenTypes,
    })
    setRelationTypes(saved.relationTypes)
  }, [project, relationTypes, managedGraphs, forbiddenTypes])

  const addManagedGraph = useCallback(async () => {
    if (!project || !newGraphName.trim()) return
    const nextGraphs = [...new Set([...managedGraphs, newGraphName.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_")])]
    const saved = await saveGraphPolicy(normalizePath(project.path), {
      relationTypes,
      managedGraphs: nextGraphs,
      forbiddenTypes,
    })
    setManagedGraphs(saved.managedGraphs)
    setNewGraphName("")
    setGraphOpMessage(`Added graph: ${newGraphName}`)
  }, [project, newGraphName, relationTypes, managedGraphs, forbiddenTypes])

  const removeManagedGraph = useCallback(async (value: string) => {
    if (!project) return
    try {
      await deleteGraphDb(project.name, value)
    } catch (err) {
      console.error("Failed to delete graph:", err)
      return
    }
    const nextGraphs = managedGraphs.filter((g) => g !== value)
    const saved = await saveGraphPolicy(normalizePath(project.path), {
      relationTypes,
      managedGraphs: nextGraphs,
      forbiddenTypes,
    })
    setManagedGraphs(saved.managedGraphs)
    if (selectedGraph === value) setSelectedGraph("main")
  }, [project, relationTypes, managedGraphs, selectedGraph, setSelectedGraph, forbiddenTypes])

  const syncManagedGraphsFromDb = useCallback(async () => {
    if (!project) return
    try {
      const names = await listGraphDb(project.name)
      const next = [...new Set(names.filter(Boolean))]
      const saved = await saveGraphPolicy(normalizePath(project.path), {
        relationTypes,
        managedGraphs: next,
        forbiddenTypes,
      })
      setManagedGraphs(saved.managedGraphs)
    } catch (err) {
      console.error("Failed to sync graphs:", err)
    }
  }, [project, relationTypes, forbiddenTypes])

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
        <p className="text-sm">Loading from FalkorDB...</p>
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

  return (
    <div className="relative flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-2 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Network className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Knowledge Graph (FalkorDB)</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="rounded bg-muted px-1.5 py-0.5">{graphData.nodes.length} nodes</span>
            <span className="rounded bg-muted px-1.5 py-0.5">{graphData.links.length} links</span>
          </div>
          <select
            value={selectedGraph}
            onChange={(e) => setSelectedGraph(e.target.value)}
            className="h-6 rounded border bg-background px-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="main">main</option>
            {managedGraphs.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant={showInsights ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setShowInsights(!showInsights)}
            className="text-xs gap-1 h-7"
          >
            <Lightbulb className="h-3 w-3" />
            Insights
          </Button>
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
              {relationTypes.length === 0 && <span className="text-[11px] text-muted-foreground">No relation types</span>}
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
              <div className="text-xs font-medium">Managed Graphs</div>
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
              {managedGraphs.length === 0 && <span className="text-[11px] text-muted-foreground">No sub-graphs</span>}
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

      {/* Graph canvas + Side panel */}
      <div className="flex flex-1 min-h-0">
        <div className="relative flex-1 min-w-0 overflow-hidden bg-slate-50 dark:bg-slate-950">
          <ErrorBoundary>
            <FalkorCanvas 
              data={graphData} 
              onNodeClick={handleNodeClick}
              onLinkClick={handleLinkClick}
            />
          </ErrorBoundary>

          {/* Selection Info Overlay */}
          {selectedElement && (
            <div className="absolute top-3 left-3 w-64 rounded-lg border bg-background/90 backdrop-blur-sm shadow-lg overflow-hidden flex flex-col max-h-[80%]">
              <div className="px-3 py-2 border-b bg-muted/50 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Info className="h-3 w-3" />
                  {selectedElement.labels ? "Node Info" : "Edge Info"}
                </span>
                <button 
                  onClick={() => setSelectedElement(null)}
                  className="p-1 hover:bg-muted rounded text-muted-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              <div className="p-3 overflow-y-auto">
                <div className="mb-3">
                  <div className="text-[10px] text-muted-foreground uppercase font-bold mb-1">
                    {selectedElement.labels ? "Labels" : "Type"}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {selectedElement.labels ? (
                      selectedElement.labels.map((l: string) => (
                        <span key={l} className="px-1.5 py-0.5 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 rounded text-[10px] font-medium">
                          {l}
                        </span>
                      ))
                    ) : (
                      <span className="px-1.5 py-0.5 bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 rounded text-[10px] font-medium">
                        {selectedElement.relationship}
                      </span>
                    )}
                  </div>
                </div>
                
                {selectedElement.data && Object.keys(selectedElement.data).length > 0 && (
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase font-bold mb-1">Properties</div>
                    <div className="space-y-2">
                      {Object.entries(selectedElement.data).map(([key, value]: [string, any]) => (
                        <div key={key} className="text-xs">
                          <div className="text-muted-foreground font-medium">{key}</div>
                          <div className="text-foreground break-words">{String(value)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
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
                  onClick={() => setShowInsights(false)}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="p-3 flex flex-col gap-4 text-xs text-muted-foreground italic">
              Insights are currently disabled in FalkorDB view mode.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
