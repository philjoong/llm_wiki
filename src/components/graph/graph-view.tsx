import { useEffect, useCallback, useState, useRef } from "react"
import { Network, RefreshCw, X, Info, FileText } from "lucide-react"
import { ErrorBoundary } from "@/components/error-boundary"
import { Button } from "@/components/ui/button"
import { useWikiStore } from "@/stores/wiki-store"
import { readFile, listDirectory } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { queryGraphDb, findRelatedGraphs, listGraphDb } from "@/commands/graph-db"
import { listDbFiles } from "@/lib/wiki-graph"
import type { FileNode } from "@/types/wiki"
import { FalkorCanvas } from "./falkor-canvas"
import { parseFalkorQueryResult, assignColors, type CanvasData } from "@/lib/falkor-visualization"
import { WikiEditor } from "@/components/editor/wiki-editor"

type TabId = "knowledge" | "files"

function nonEmptyGraphsCacheKey(projectName: string): string {
  return `llm-wiki:non-empty-graphs:${projectName}`
}

function loadCachedGraphs(projectName: string): string[] {
  try {
    const raw = localStorage.getItem(nonEmptyGraphsCacheKey(projectName))
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

function saveCachedGraphs(projectName: string, graphs: string[]): void {
  try {
    localStorage.setItem(nonEmptyGraphsCacheKey(projectName), JSON.stringify(graphs))
  } catch {}
}

function extractFrontmatterGraph(content: string): string | null {
  const match = content.match(/^---\n[\s\S]*?^graph:\s*["']?(.+?)["']?\s*$/m)
  return match?.[1]?.trim() || null
}

function dbFileId(fileName: string): string {
  return fileName.replace(/\.md$/i, "")
}

export function GraphView() {
  const project = useWikiStore((s) => s.project)
  const dataVersion = useWikiStore((s) => s.dataVersion)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setFileContent = useWikiStore((s) => s.setFileContent)
  const selectedGraph = useWikiStore((s) => s.selectedGraph)
  const setSelectedGraph = useWikiStore((s) => s.setSelectedGraph)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const bumpDataVersion = useWikiStore((s) => s.bumpDataVersion)

  const [activeTab, setActiveTab] = useState<TabId>("knowledge")

  // Graph data & state
  const [graphData, setGraphData] = useState<CanvasData>({ nodes: [], links: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedElement, setSelectedElement] = useState<any>(null)
  const lastLoadedVersion = useRef(-1)

  // Live graphs from FalkorDB (only graphs that actually have nodes)
  const [liveGraphs, setLiveGraphs] = useState<string[]>(() =>
    project ? loadCachedGraphs(project.name) : []
  )

  const allGraphs = liveGraphs

  // Files tab state
  const [dbFiles, setDbFiles] = useState<FileNode[]>([])
  const [dbFilesLoaded, setDbFilesLoaded] = useState(false)
  const [selectedDbFile, setSelectedDbFile] = useState<FileNode | null>(null)
  const [selectedDbFileContent, setSelectedDbFileContent] = useState<string>("")
  const [relatedGraphs, setRelatedGraphs] = useState<string[]>([])
  const [loadingRelated, setLoadingRelated] = useState(false)
  const [selectedRelatedGraph, setSelectedRelatedGraph] = useState<string | null>(null)

  const loadGraph = useCallback(async (graphName?: string) => {
    if (!project) return
    const target = graphName ?? selectedGraph
    setLoading(true)
    setError(null)
    try {
      const cypher = "MATCH (n) OPTIONAL MATCH (n)-[r]->(m) RETURN n, r"
      const result = await queryGraphDb(project.name, target, cypher)
      const parsed = parseFalkorQueryResult(result)
      const colored = assignColors(parsed)
      setGraphData(colored)
      lastLoadedVersion.current = useWikiStore.getState().dataVersion
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load graph from FalkorDB")
    } finally {
      setLoading(false)
    }
  }, [project, selectedGraph])

  useEffect(() => {
    if (activeTab === "knowledge" && (dataVersion !== lastLoadedVersion.current || !graphData.nodes.length)) {
      loadGraph()
    }
  }, [loadGraph, dataVersion, activeTab])

  // Reload when selectedGraph changes (Knowledge tab)
  useEffect(() => {
    if (activeTab === "knowledge") {
      lastLoadedVersion.current = -1
      loadGraph(selectedGraph)
    }
  }, [selectedGraph]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleNodeClick = useCallback(async (node: any) => {
    setSelectedElement(node)
    if (node.data?.path) {
      try {
        const content = await readFile(node.data.path)
        setSelectedFile(node.data.path)
        setFileContent(content)
      } catch (err) {
        console.error("Failed to open wiki page:", err)
      }
    }
  }, [setSelectedFile, setFileContent])

  const handleLinkClick = useCallback((link: any) => {
    setSelectedElement(link)
  }, [])

  const refreshLiveGraphs = useCallback(async (forceAll = false) => {
    if (!project) return
    try {
      const allGraphs = await listGraphDb(project.name, false)
      const cached = forceAll ? [] : loadCachedGraphs(project.name)
      const cachedSet = new Set(cached)

      // Start with cached non-empty graphs that still exist
      const stillExist = cached.filter((g) => allGraphs.includes(g))
      if (stillExist.length !== cached.length) {
        // Some cached graphs were deleted — update cache immediately
        saveCachedGraphs(project.name, stillExist)
        setLiveGraphs(stillExist)
      } else if (forceAll) {
        setLiveGraphs([])
      } else {
        setLiveGraphs(stillExist)
      }

      // Check uncached graphs in background and add them as found
      const unchecked = allGraphs.filter((g) => !cachedSet.has(g))
      if (unchecked.length === 0) return

      const results = await Promise.all(
        unchecked.map(async (g) => {
          try {
            const res = await queryGraphDb(project.name, g, "MATCH (n) RETURN n LIMIT 1")
            const parsed = parseFalkorQueryResult(res)
            return parsed.nodes.length > 0 ? g : null
          } catch {
            return null
          }
        })
      )
      const newNonEmpty = results.filter((g): g is string => g !== null)
      if (newNonEmpty.length > 0) {
        setLiveGraphs((prev) => {
          const merged = [...new Set([...prev, ...newNonEmpty])]
          saveCachedGraphs(project.name, merged)
          return merged
        })
      }
    } catch {
      setLiveGraphs(loadCachedGraphs(project.name))
    }
  }, [project])

  // Keep selectedGraph valid whenever liveGraphs changes
  useEffect(() => {
    if (liveGraphs.length > 0 && !liveGraphs.includes(selectedGraph)) {
      setSelectedGraph(liveGraphs[0])
    }
  }, [liveGraphs, selectedGraph, setSelectedGraph])

  useEffect(() => {
    void refreshLiveGraphs()
  }, [project, dataVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleFullRefresh = useCallback(async () => {
    if (!project) return
    try {
      const tree = await listDirectory(normalizePath(project.path))
      setFileTree(tree)
    } catch (err) {
      console.error("Failed to refresh file tree:", err)
    }
    bumpDataVersion()
    await refreshLiveGraphs(true)
    await loadGraph()
  }, [project, setFileTree, bumpDataVersion, refreshLiveGraphs, loadGraph])

  // Files tab handlers
  const loadDbFiles = useCallback(async () => {
    if (!project || dbFilesLoaded) return
    const files = await listDbFiles(normalizePath(project.path))
    setDbFiles(files)
    setDbFilesLoaded(true)
  }, [project, dbFilesLoaded])

  useEffect(() => {
    if (activeTab === "files") {
      void loadDbFiles()
    }
  }, [activeTab, loadDbFiles])

  const handleDbFileSelect = useCallback(async (file: FileNode) => {
    if (!project) return
    setSelectedDbFile(file)
    setSelectedRelatedGraph(null)
    setGraphData({ nodes: [], links: [] })
    setSelectedDbFileContent("")
    setLoadingRelated(true)
    try {
      const content = await readFile(file.path).catch(() => "")
      const assignedGraph = extractFrontmatterGraph(content)
      const graphs = await findRelatedGraphs(project.name, file.name, file.path, assignedGraph)
      setRelatedGraphs(graphs)
      setSelectedDbFileContent(content)
    } catch (err) {
      console.error("Failed to find related graphs:", err)
      setRelatedGraphs([])
    } finally {
      setLoadingRelated(false)
    }
  }, [project])

  const handleRelatedGraphSelect = useCallback(async (graphName: string) => {
    if (!project) return
    setSelectedRelatedGraph(graphName)
    setSelectedElement(null)
    setLoading(true)
    setError(null)
    try {
      const safeId = dbFileId(selectedDbFile!.name).replace(/\\/g, "\\\\").replace(/'/g, "\\'")
      const safePath = selectedDbFile!.path.replace(/\\/g, "/").replace(/'/g, "\\'")
      const cypher = `MATCH (n) WHERE n.id = '${safeId}' OR n.path = '${safePath}' OPTIONAL MATCH (n)-[r]-(m) RETURN n, r, m`
      const result = await queryGraphDb(project.name, graphName, cypher)
      const parsed = parseFalkorQueryResult(result)

      const colored = assignColors(parsed)
      colored.nodes = colored.nodes.map((n) => ({
        ...n,
        highlighted: n.data?.id === dbFileId(selectedDbFile!.name) || n.data?.path === selectedDbFile!.path.replace(/\\/g, "/"),
        size: n.data?.id === dbFileId(selectedDbFile!.name) ? 12 : n.size,
        color: n.data?.id === dbFileId(selectedDbFile!.name) ? "#ef4444" : n.color,
      }))
      setGraphData(colored)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load graph")
    } finally {
      setLoading(false)
    }
  }, [project, selectedDbFile])

  if (!project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Network className="h-10 w-10 opacity-30" />
        <p className="text-sm">Open a project to view the graph</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div className="flex shrink-0 items-center border-b">
        {(["knowledge", "files"] as TabId[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              activeTab === tab
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab === "knowledge" ? "Knowledge" : "Files"}
          </button>
        ))}
        <div className="ml-auto pr-2">
          <Button variant="ghost" size="sm" onClick={() => { void handleFullRefresh() }} disabled={loading} className="h-7 gap-1 text-xs" title="Refresh">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {activeTab === "knowledge" ? (
        <div className="flex h-full min-h-0 flex-col">
          {/* Graph selector + stats */}
          <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
            <select
              value={selectedGraph}
              onChange={(e) => setSelectedGraph(e.target.value)}
              className="h-7 rounded border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {allGraphs.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground">
              {graphData.nodes.length} nodes - {graphData.links.length} links
            </span>
          </div>

          {/* Canvas */}
          <div className="relative flex-1 min-h-0 overflow-hidden bg-slate-50 dark:bg-slate-950">
            {loading ? (
              <div className="flex h-full items-center justify-center gap-3 text-muted-foreground">
                <RefreshCw className="h-6 w-6 animate-spin opacity-50" />
                <span className="text-sm">Loading...</span>
              </div>
            ) : error ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
                <p className="text-sm text-destructive">{error}</p>
                <Button variant="outline" size="sm" onClick={() => loadGraph()}>Retry</Button>
              </div>
            ) : (
              <ErrorBoundary>
                <FalkorCanvas data={graphData} onNodeClick={handleNodeClick} onLinkClick={handleLinkClick} />
              </ErrorBoundary>
            )}
            <SelectionOverlay element={selectedElement} onClose={() => setSelectedElement(null)} />
          </div>
        </div>
      ) : (
        /* Files tab */
        <div className="flex h-full min-h-0">
          {/* File list */}
          <div className="flex w-56 shrink-0 flex-col border-r">
            <div className="shrink-0 border-b px-3 py-2 text-xs font-medium text-muted-foreground">
              db/ files
            </div>
            <div className="flex-1 overflow-y-auto">
              {dbFiles.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground">No files found</div>
              ) : (
                dbFiles.map((f) => {
                  const dbIdx = f.path.replace(/\\/g, "/").indexOf("/db/")
                  const label = dbIdx >= 0 ? f.path.slice(dbIdx + 4) : f.name
                  return (
                    <button
                      key={f.path}
                      onClick={() => { void handleDbFileSelect(f) }}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-accent ${
                        selectedDbFile?.path === f.path ? "bg-accent text-accent-foreground" : "text-muted-foreground"
                      }`}
                    >
                      <FileText className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate" title={label}>{label}</span>
                    </button>
                  )
                })
              )}
            </div>
          </div>

          {/* Related graphs + canvas */}
          <div className="flex flex-1 min-w-0 flex-col">
            {!selectedDbFile ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Select a file to see related knowledge graphs
              </div>
            ) : (
              <>
                {/* Related graph list */}
                <div className="shrink-0 border-b px-4 py-2">
                  <div className="mb-2 text-xs font-medium text-muted-foreground">
                    Related graphs for <span className="text-foreground">{selectedDbFile.name}</span>
                  </div>
                  {loadingRelated ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <RefreshCw className="h-3 w-3 animate-spin" /> Searching...
                    </div>
                  ) : relatedGraphs.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No related graphs found</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {relatedGraphs.map((g) => (
                        <button
                          key={g}
                          onClick={() => { void handleRelatedGraphSelect(g) }}
                          className={`rounded border px-2.5 py-1 text-xs transition-colors ${
                            selectedRelatedGraph === g
                              ? "border-primary bg-primary/10 text-primary"
                              : "hover:bg-accent"
                          }`}
                        >
                          {g}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Canvas + preview */}
                <div className="flex flex-1 min-h-0">
                  <div className="relative flex-1 min-w-0 overflow-hidden bg-slate-50 dark:bg-slate-950">
                    {!selectedRelatedGraph ? (
                      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                        Select a graph to visualize
                      </div>
                    ) : loading ? (
                      <div className="flex h-full items-center justify-center gap-3 text-muted-foreground">
                        <RefreshCw className="h-6 w-6 animate-spin opacity-50" />
                        <span className="text-sm">Loading...</span>
                      </div>
                    ) : error ? (
                      <div className="flex h-full items-center justify-center text-sm text-destructive">{error}</div>
                    ) : (
                      <ErrorBoundary>
                        <FalkorCanvas data={graphData} onNodeClick={handleNodeClick} onLinkClick={handleLinkClick} />
                      </ErrorBoundary>
                    )}
                    <SelectionOverlay element={selectedElement} onClose={() => setSelectedElement(null)} />
                  </div>

                  {/* Markdown preview */}
                  <div className="w-80 shrink-0 border-l flex flex-col overflow-hidden">
                    <div className="shrink-0 border-b px-3 py-1.5 text-xs font-medium text-muted-foreground truncate" title={selectedDbFile.name}>
                      {selectedDbFile.name}
                    </div>
                    <div className="flex-1 overflow-auto">
                      <WikiEditor
                        key={selectedDbFile.path}
                        content={selectedDbFileContent}
                        onSave={() => {}}
                      />
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function SelectionOverlay({ element, onClose }: { element: any; onClose: () => void }) {
  if (!element) return null
  return (
    <div className="absolute left-3 top-3 flex max-h-[80%] w-64 flex-col overflow-hidden rounded-lg border bg-background/90 shadow-lg backdrop-blur-sm">
      <div className="flex items-center justify-between border-b bg-muted/50 px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <Info className="h-3 w-3" />
          {element.labels ? "Node Info" : "Edge Info"}
        </span>
        <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted">
          <X className="h-3 w-3" />
        </button>
      </div>
      <div className="overflow-y-auto p-3">
        <div className="mb-3">
          <div className="mb-1 text-[10px] font-bold uppercase text-muted-foreground">
            {element.labels ? "Labels" : "Type"}
          </div>
          <div className="flex flex-wrap gap-1">
            {element.labels ? (
              element.labels.map((l: string) => (
                <span key={l} className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">{l}</span>
              ))
            ) : (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">{element.relationship}</span>
            )}
          </div>
        </div>
        {element.data && Object.keys(element.data).length > 0 && (
          <div>
            <div className="mb-1 text-[10px] font-bold uppercase text-muted-foreground">Properties</div>
            <div className="space-y-2">
              {Object.entries(element.data).map(([key, value]: [string, any]) => (
                <div key={key} className="text-xs">
                  <div className="font-medium text-muted-foreground">{key}</div>
                  <div className="break-words text-foreground">{String(value)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
