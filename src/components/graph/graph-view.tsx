import { useEffect, useCallback, useState, useRef, useMemo } from "react"
import { Network, RefreshCw, X, Info, FileText, ChevronRight, ChevronDown, Folder, FolderOpen, Trash2, Pencil } from "lucide-react"
import { openPath } from "@tauri-apps/plugin-opener"
import { ErrorBoundary } from "@/components/error-boundary"
import { Button } from "@/components/ui/button"
import { useWikiStore, type NavSnapshot } from "@/stores/wiki-store"
import { readFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { loadPageGraphIndex, lookupPageGraphs } from "@/lib/page-graph-index"
import { listDbFiles } from "@/lib/wiki-graph"
import type { FileNode } from "@/types/wiki"
import { FalkorCanvas } from "./falkor-canvas"
import { assignColors, type CanvasData } from "@/lib/falkor-visualization"
import { getGraphBackend } from "@/lib/graph-backend"
import { graphSnapshotToCanvas } from "@/lib/graph-backend/graph-result-mappers"
import { cleanupOrphanGraphs } from "@/lib/graph-sync"
import { loadGraphPolicy, type GraphPolicy } from "@/lib/graph-policy"
import { removePageFromIndex } from "@/lib/page-graph-index"
import { loadEntityDict, saveEntityDict, findEntityByGraphNode, renameEntity, unlinkGraphNode, resolveEntitySeeds, type EntityDict } from "@/lib/entity-dict"
import { filterSnapshotByHops, mergeSnapshots } from "@/lib/graph-hop"
import type { GraphSnapshot } from "@/lib/graph-backend"
import { cn } from "@/lib/utils"
import { WikiEditor } from "@/components/editor/wiki-editor"
import { GraphsTab } from "@/components/layout/graphs-tab"
import { EntityView } from "@/components/entity/entity-view"

type HopValue = 1 | 2 | 3 | typeof Infinity

type TabId = "knowledge" | "files" | "graphs" | "entity"

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


export function GraphView() {
  const project = useWikiStore((s) => s.project)
  const dataVersion = useWikiStore((s) => s.dataVersion)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setFileContent = useWikiStore((s) => s.setFileContent)
  const selectedGraph = useWikiStore((s) => s.selectedGraph)
  const setSelectedGraph = useWikiStore((s) => s.setSelectedGraph)
  const pendingOpenFile = useWikiStore((s) => s.pendingOpenFile)
  const setPendingOpenFile = useWikiStore((s) => s.setPendingOpenFile)
  const pendingGraphRestore = useWikiStore((s) => s.pendingGraphRestore)
  const setPendingGraphRestore = useWikiStore((s) => s.setPendingGraphRestore)

  const pushNav = useCallback((snap: NavSnapshot) => {
    useWikiStore.setState((s) => ({ navHistory: [...s.navHistory, snap].slice(-5) }))
  }, [])

  const [activeTab, setActiveTab] = useState<TabId>("knowledge")

  // Graph data & state
  const [graphData, setGraphData] = useState<CanvasData>({ nodes: [], links: [] })
  const [relationColorMap, setRelationColorMap] = useState<Map<string, string>>(new Map())
  const [selectedRelationType, setSelectedRelationType] = useState<string>("all")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedElement, setSelectedElement] = useState<any>(null)
  const [graphPolicy, setGraphPolicy] = useState<GraphPolicy | null>(null)
  const lastLoadedVersion = useRef(-1)

  // Entity-centric merged view (Phase G)
  const [entityDict, setEntityDict] = useState<EntityDict>({})
  const [selectedEntityId, setSelectedEntityId] = useState<string>("")
  const [maxHops, setMaxHops] = useState<HopValue>(Infinity)
  const [rawSnapshots, setRawSnapshots] = useState<{ graphName: string; snapshot: GraphSnapshot }[]>([])
  const [entityLoading, setEntityLoading] = useState(false)

  // Live graphs from the graph backend (only graphs that actually have nodes)
  const [liveGraphs, setLiveGraphs] = useState<string[]>(() =>
    project ? loadCachedGraphs(project.name) : []
  )

  const allGraphs = liveGraphs

  const filteredGraphData = useMemo(() => {
    if (selectedRelationType === "all") return graphData
    const links = graphData.links.filter((l) => l.relationship === selectedRelationType)
    const connectedIds = new Set(links.flatMap((l) => [l.source, l.target]))
    const nodes = graphData.nodes.filter((n) => connectedIds.has(n.id))
    return { nodes, links }
  }, [graphData, selectedRelationType])

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
      const [backend, policy] = await Promise.all([
        getGraphBackend(project.path),
        loadGraphPolicy(project.path),
      ])
      const parsed = graphSnapshotToCanvas(await backend.queryGraph(project.name, target, { type: "all" }))
      const { data: colored, relationColorMap: colorMap } = assignColors(parsed)
      setGraphData(colored)
      setRelationColorMap(colorMap)
      setSelectedRelationType("all")
      setGraphPolicy(policy)
      lastLoadedVersion.current = useWikiStore.getState().dataVersion
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load graph")
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
    if (activeTab === "knowledge" && !selectedEntityId) {
      lastLoadedVersion.current = -1
      loadGraph(selectedGraph)
    }
  }, [selectedGraph]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load entity dictionary for the entity dropdown (Phase G)
  useEffect(() => {
    if (!project) return
    loadEntityDict(project.path).then(setEntityDict).catch(() => setEntityDict({}))
  }, [project, dataVersion])

  const entityOptions = useMemo(() => {
    return Object.values(entityDict)
      .filter((e) => e.graphNodes.length > 0)
      .sort((a, b) => a.canonicalName.localeCompare(b.canonicalName))
  }, [entityDict])

  // Fetch every graph the selected entity appears in (Phase G — entity-centric merged view)
  const loadEntitySnapshots = useCallback(async (entityId: string) => {
    if (!project) return
    const entry = entityDict[entityId]
    if (!entry) return
    setEntityLoading(true)
    setError(null)
    try {
      const backend = await getGraphBackend(project.path)
      const graphNames = Array.from(new Set(entry.graphNodes.map((r) => r.graphName)))
      const parts = await Promise.all(
        graphNames.map(async (graphName) => ({
          graphName,
          snapshot: await backend.queryGraph(project.name, graphName, { type: "all" }),
        }))
      )
      setRawSnapshots(parts)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load entity graphs")
      setRawSnapshots([])
    } finally {
      setEntityLoading(false)
    }
  }, [project, entityDict])

  useEffect(() => {
    if (activeTab === "knowledge" && selectedEntityId) {
      void loadEntitySnapshots(selectedEntityId)
    }
  }, [activeTab, selectedEntityId, loadEntitySnapshots])

  // hop filter -> merge -> canvas conversion, derived without re-querying (Phase G)
  const entityCanvasData = useMemo(() => {
    if (!selectedEntityId || rawSnapshots.length === 0) return null
    const entry = entityDict[selectedEntityId]
    if (!entry) return null
    const filteredParts = rawSnapshots.map(({ graphName, snapshot }) => ({
      graphName,
      snapshot: filterSnapshotByHops(snapshot, resolveEntitySeeds(entry, graphName, snapshot), maxHops),
    }))
    const merged = mergeSnapshots(filteredParts)
    const { data: colored, relationColorMap: colorMap } = assignColors(graphSnapshotToCanvas(merged))
    return { colored, colorMap }
  }, [selectedEntityId, rawSnapshots, entityDict, maxHops])

  useEffect(() => {
    if (entityCanvasData) {
      setGraphData(entityCanvasData.colored)
      setRelationColorMap(entityCanvasData.colorMap)
      setSelectedRelationType("all")
    }
  }, [entityCanvasData])

  const handleEntitySelect = useCallback((entityId: string) => {
    setSelectedElement(null)
    setSelectedEntityId(entityId)
    if (!entityId) {
      setRawSnapshots([])
      lastLoadedVersion.current = -1
      void loadGraph(selectedGraph)
    }
  }, [selectedGraph, loadGraph])

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
      const backend = await getGraphBackend(project.path)
      const allGraphs = await backend.listGraphs(project.name)
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
            const parsed = graphSnapshotToCanvas(await backend.queryGraph(project.name, g, { type: "all" }))
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

  const handleCleanupOrphans = useCallback(async () => {
    if (!project) return
    const policy = await loadGraphPolicy(project.path)
    await cleanupOrphanGraphs(project.path, project.name, policy.managedGraphs)
    await refreshLiveGraphs(true)
    await loadGraph()
  }, [project, refreshLiveGraphs, loadGraph])

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

  const handleDbFileSelect = useCallback(async (file: FileNode, skipHistory = false) => {
    if (!project) return
    if (!skipHistory) {
      pushNav({ view: "graph", selectedFile: useWikiStore.getState().selectedFile, graphTab: "files", graphDbFile: selectedDbFile?.path ?? null })
    }
    setSelectedDbFile(file)
    setSelectedRelatedGraph(null)
    setGraphData({ nodes: [], links: [] })
    setSelectedDbFileContent("")
    setLoadingRelated(true)
    try {
      const [content, index] = await Promise.all([
        readFile(file.path).catch(() => ""),
        loadPageGraphIndex(project.path),
      ])
      // Derive the page_path relative to the project root (e.g. "db/enemies/goblin.md")
      const normalizedProjectPath = project.path.replace(/\\/g, "/").replace(/\/$/, "")
      const normalizedFilePath = file.path.replace(/\\/g, "/")
      const relPath = normalizedFilePath.startsWith(normalizedProjectPath + "/")
        ? normalizedFilePath.slice(normalizedProjectPath.length + 1)
        : file.name
      const graphs = lookupPageGraphs(index, relPath)
      setRelatedGraphs(graphs)
      setSelectedDbFileContent(content)
    } catch (err) {
      console.error("Failed to find related graphs:", err)
      setRelatedGraphs([])
    } finally {
      setLoadingRelated(false)
    }
  }, [project])

  // When a Reference link is clicked in ChatPanel, pendingOpenFile is set.
  // Switch to Files tab and select the file, then clear the pending flag.
  useEffect(() => {
    if (!pendingOpenFile || !project) return
    setPendingOpenFile(null)
    setActiveTab("files")
    // Ensure db/ files are loaded before selecting
    const doOpen = async () => {
      const files = await listDbFiles(normalizePath(project.path))
      setDbFiles(files)
      setDbFilesLoaded(true)
      const match = files.find((f) => normalizePath(f.path) === normalizePath(pendingOpenFile))
      if (match) {
        void handleDbFileSelect(match)
      }
    }
    void doOpen()
  }, [pendingOpenFile]) // eslint-disable-line react-hooks/exhaustive-deps

  // Restore tab/file state when goBack() targets the graph view
  useEffect(() => {
    if (!pendingGraphRestore || !project) return
    setPendingGraphRestore(null)
    setActiveTab(pendingGraphRestore.graphTab)
    if (pendingGraphRestore.graphTab === "files") {
      const targetPath = pendingGraphRestore.graphDbFile
      if (!targetPath) {
        setSelectedDbFile(null)
        return
      }
      const doRestore = async () => {
        const files = dbFilesLoaded ? dbFiles : await listDbFiles(normalizePath(project.path))
        if (!dbFilesLoaded) { setDbFiles(files); setDbFilesLoaded(true) }
        const match = files.find((f) => normalizePath(f.path) === normalizePath(targetPath))
        if (match) void handleDbFileSelect(match, true)
        else setSelectedDbFile(null)
      }
      void doRestore()
    }
  }, [pendingGraphRestore]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRelatedGraphSelect = useCallback(async (graphName: string) => {
    if (!project) return
    setSelectedRelatedGraph(graphName)
    setSelectedElement(null)
    setLoading(true)
    setError(null)
    try {
      const backend = await getGraphBackend(project.path)
      const parsed = graphSnapshotToCanvas(await backend.queryGraph(project.name, graphName, { type: "all" }))
      const { data: colored, relationColorMap: colorMap } = assignColors(parsed)
      setGraphData(colored)
      setRelationColorMap(colorMap)
      setSelectedRelationType("all")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load graph")
    } finally {
      setLoading(false)
    }
  }, [project])

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
        {(["knowledge", "files", "graphs", "entity"] as TabId[]).map((tab) => (
          <button
            key={tab}
            onClick={() => {
              if (tab === activeTab) return
              if (activeTab === "knowledge" || activeTab === "files") {
                pushNav({ view: "graph", selectedFile: useWikiStore.getState().selectedFile, graphTab: activeTab, graphDbFile: selectedDbFile?.path ?? null })
              }
              setActiveTab(tab)
            }}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              activeTab === tab
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab === "knowledge" ? "Knowledge" : tab === "files" ? "Files" : tab === "graphs" ? "Graphs" : "Entity"}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1 pr-2">
          <Button variant="ghost" size="sm" onClick={() => { void handleCleanupOrphans() }} disabled={loading} className="h-7 gap-1 text-xs" title="Cleanup orphan graphs">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {activeTab === "graphs" ? (
        <GraphsTab onPolicySaved={(managedGraphs) => {
          setLiveGraphs((prev) => prev.filter((g) => managedGraphs.includes(g)))
        }} />
      ) : activeTab === "entity" ? (
        <EntityView />
      ) : activeTab === "knowledge" ? (
        <div className="flex h-full min-h-0 flex-col">
          {/* Graph selector + stats */}
          <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
            <select
              value={selectedEntityId ? "" : selectedGraph}
              onChange={(e) => setSelectedGraph(e.target.value)}
              disabled={Boolean(selectedEntityId)}
              className="h-7 rounded border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
            >
              {selectedEntityId ? (
                <option value="">전체 그래프</option>
              ) : (
                allGraphs.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))
              )}
            </select>
            <select
              value={selectedEntityId}
              onChange={(e) => handleEntitySelect(e.target.value)}
              className="h-7 rounded border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">엔티티: (없음)</option>
              {entityOptions.map((e) => (
                <option key={e.id} value={e.id}>{e.canonicalName}</option>
              ))}
            </select>
            {selectedEntityId && (
              <select
                value={maxHops === Infinity ? "all" : String(maxHops)}
                onChange={(e) => setMaxHops(e.target.value === "all" ? Infinity : (Number(e.target.value) as HopValue))}
                className="h-7 rounded border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="1">hop: 1</option>
                <option value="2">hop: 2</option>
                <option value="3">hop: 3</option>
                <option value="all">hop: 전체</option>
              </select>
            )}
            <span className="text-xs text-muted-foreground">
              {graphData.nodes.length} nodes - {graphData.links.length} links
            </span>
          </div>

          {/* Canvas */}
          <div className="relative flex-1 min-h-0 overflow-hidden bg-slate-50 dark:bg-slate-950">
            {loading || entityLoading ? (
              <div className="flex h-full items-center justify-center gap-3 text-muted-foreground">
                <RefreshCw className="h-6 w-6 animate-spin opacity-50" />
                <span className="text-sm">Loading...</span>
              </div>
            ) : error ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
                <p className="text-sm text-destructive">{error}</p>
                <Button variant="outline" size="sm" onClick={() => (selectedEntityId ? loadEntitySnapshots(selectedEntityId) : loadGraph())}>Retry</Button>
              </div>
            ) : (
              <ErrorBoundary>
                <FalkorCanvas data={filteredGraphData} onNodeClick={handleNodeClick} onLinkClick={handleLinkClick} />
              </ErrorBoundary>
            )}
            <SelectionOverlay
              element={selectedElement}
              onClose={() => setSelectedElement(null)}
              project={project}
              graphName={(selectedElement?.data?.graphName as string | undefined) ?? selectedGraph}
              graphPolicy={graphPolicy}
              onGraphChanged={() => { selectedEntityId ? void loadEntitySnapshots(selectedEntityId) : void loadGraph(selectedGraph) }}
            />
            {relationColorMap.size > 1 && (
              <div className="absolute top-2 right-2 z-10 flex flex-col gap-1 rounded-md border bg-background/90 p-2 text-xs backdrop-blur-sm">
                <button
                  className={cn("flex items-center gap-1.5 rounded px-1.5 py-0.5 text-left hover:bg-muted", selectedRelationType === "all" && "bg-muted font-medium")}
                  onClick={() => setSelectedRelationType("all")}
                >
                  <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full" style={{ background: "#94a3b8" }} />
                  전체
                </button>
                {Array.from(relationColorMap.entries()).map(([rel, color]) => (
                  <button
                    key={rel}
                    className={cn("flex items-center gap-1.5 rounded px-1.5 py-0.5 text-left hover:bg-muted", selectedRelationType === rel && "bg-muted font-medium")}
                    onClick={() => setSelectedRelationType(rel)}
                  >
                    <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full" style={{ background: color }} />
                    {rel}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Files tab */
        <div className="flex h-full min-h-0">
          {/* File list */}
          <div className="flex w-56 shrink-0 flex-col border-r">
            <div className="flex shrink-0 items-center justify-between border-b px-3 py-2 text-xs font-medium text-muted-foreground">
              <span>db/ files</span>
              <button
                onClick={() => { void openPath(`${normalizePath(project.path)}/db`) }}
                title="Reveal in Explorer"
                className="text-muted-foreground hover:text-accent-foreground"
              >
                <FolderOpen className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {dbFiles.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground">No files found</div>
              ) : (
                <DbFileTree
                  files={dbFiles}
                  selectedFile={selectedDbFile}
                  onSelect={(f) => { void handleDbFileSelect(f) }}
                />
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
                        <FalkorCanvas data={filteredGraphData} onNodeClick={handleNodeClick} onLinkClick={handleLinkClick} />
                      </ErrorBoundary>
                    )}
                    <SelectionOverlay
              element={selectedElement}
              onClose={() => setSelectedElement(null)}
              project={project}
              graphName={selectedRelatedGraph ?? selectedGraph}
              graphPolicy={graphPolicy}
              onGraphChanged={() => { void loadGraph(selectedRelatedGraph ?? undefined) }}
            />
                    {relationColorMap.size > 1 && (
                      <div className="absolute top-2 right-2 z-10 flex flex-col gap-1 rounded-md border bg-background/90 p-2 text-xs backdrop-blur-sm">
                        <button
                          className={cn("flex items-center gap-1.5 rounded px-1.5 py-0.5 text-left hover:bg-muted", selectedRelationType === "all" && "bg-muted font-medium")}
                          onClick={() => setSelectedRelationType("all")}
                        >
                          <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full" style={{ background: "#94a3b8" }} />
                          전체
                        </button>
                        {Array.from(relationColorMap.entries()).map(([rel, color]) => (
                          <button
                            key={rel}
                            className={cn("flex items-center gap-1.5 rounded px-1.5 py-0.5 text-left hover:bg-muted", selectedRelationType === rel && "bg-muted font-medium")}
                            onClick={() => setSelectedRelationType(rel)}
                          >
                            <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full" style={{ background: color }} />
                            {rel}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Markdown preview */}
                  <div className="w-80 shrink-0 border-l flex flex-col overflow-hidden">
                    <div className="shrink-0 flex items-center justify-between border-b px-3 py-1.5">
                      <span className="text-xs font-medium text-muted-foreground truncate" title={selectedDbFile.name}>
                        {selectedDbFile.name}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="ml-2 h-6 shrink-0 px-2 text-xs"
                        onClick={() => {
                          if (!selectedDbFile) return
                          useWikiStore.getState().setEditingFile(selectedDbFile.path)
                        }}
                      >
                        Edit in Wiki
                      </Button>
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

interface SelectionOverlayProps {
  element: any
  onClose: () => void
  project: { path: string; name: string } | null
  graphName: string
  graphPolicy: GraphPolicy | null
  onGraphChanged: () => void
}

function SelectionOverlay({ element, onClose, project, graphName, graphPolicy, onGraphChanged }: SelectionOverlayProps) {
  const isNode = Boolean(element?.labels)
  const [editMode, setEditMode] = useState(false)
  const [nodeName, setNodeName] = useState("")
  const [edgeRelType, setEdgeRelType] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset edit state when selection changes
  useEffect(() => {
    setEditMode(false)
    setError(null)
    if (element) {
      setNodeName(element.data?.label ?? element.label ?? "")
      setEdgeRelType(element.relationship ?? "")
    }
  }, [element])

  if (!element) return null

  const allowedRelTypes: string[] = graphPolicy?.graphRelationTypes?.[graphName] ?? []

  async function handleDelete() {
    if (!project) return
    setSaving(true)
    setError(null)
    try {
      const backendId = String(element.data?.rawId ?? element.data?.id ?? element.id)
      const pagePath = element.data?.page_path as string | undefined
      const backend = await getGraphBackend(project.path)
      if (isNode) {
        await backend.deleteNode(project.name, graphName, backendId)
      } else {
        await backend.deleteEdge(project.name, graphName, backendId)
      }
      // Disconnect from page-graph-index if this edge had a page_path
      if (pagePath) {
        const remaining = await backend.deleteEdgesByPagePath(project.name, pagePath)
        if (remaining === 0) {
          await removePageFromIndex(project.path, pagePath)
        }
      }
      if (isNode) {
        try {
          const dict = await loadEntityDict(project.path)
          await saveEntityDict(project.path, unlinkGraphNode(graphName, backendId, dict))
        } catch { /* non-fatal */ }
      }
      onClose()
      onGraphChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete")
    } finally {
      setSaving(false)
    }
  }

  async function handleSave() {
    if (!project) return
    setSaving(true)
    setError(null)
    try {
      const backendId = String(element.data?.rawId ?? element.data?.id ?? element.id)
      const pagePath = element.data?.page_path as string | undefined
      const backend = await getGraphBackend(project.path)
      if (isNode) {
        await backend.updateNodeName(project.name, graphName, backendId, nodeName.trim())
        try {
          const dict = await loadEntityDict(project.path)
          const entry = findEntityByGraphNode(graphName, backendId, dict)
          if (entry) {
            await saveEntityDict(project.path, renameEntity(entry.id, nodeName.trim(), dict))
          }
        } catch { /* non-fatal */ }
      } else {
        await backend.updateEdge(project.name, graphName, backendId, edgeRelType)
      }
      // Manual edit severs the document link — remove from page-graph-index
      if (pagePath) {
        await removePageFromIndex(project.path, pagePath)
      }
      setEditMode(false)
      onGraphChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="absolute left-3 top-3 flex max-h-[80%] w-64 flex-col overflow-hidden rounded-lg border bg-background/90 shadow-lg backdrop-blur-sm">
      <div className="flex items-center justify-between border-b bg-muted/50 px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <Info className="h-3 w-3" />
          {isNode ? "Node" : "Edge"}
        </span>
        <div className="flex items-center gap-1">
          {!editMode && (
            <button onClick={() => setEditMode(true)} className="rounded p-1 text-muted-foreground hover:bg-muted" title="Edit">
              <Pencil className="h-3 w-3" />
            </button>
          )}
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted">
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div className="overflow-y-auto p-3">
        {editMode ? (
          <div className="space-y-3">
            {isNode ? (
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-muted-foreground">Name</label>
                <input
                  className="w-full rounded border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                  value={nodeName}
                  onChange={(e) => setNodeName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { void handleSave() } }}
                  autoFocus
                />
              </div>
            ) : (
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-muted-foreground">Relation Type</label>
                {allowedRelTypes.length > 0 ? (
                  <select
                    className="w-full rounded border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                    value={edgeRelType}
                    onChange={(e) => setEdgeRelType(e.target.value)}
                  >
                    {allowedRelTypes.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="w-full rounded border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                    value={edgeRelType}
                    onChange={(e) => setEdgeRelType(e.target.value)}
                  />
                )}
                <p className="mt-2 text-[10px] text-muted-foreground">
                  이 변경은 그래프에만 반영됩니다. 원본 문서(db/*.md)는 변경되지 않습니다.
                </p>
              </div>
            )}
            {error && <p className="text-[10px] text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button size="sm" className="h-6 flex-1 text-xs" onClick={() => { void handleSave() }} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
              <Button size="sm" variant="outline" className="h-6 flex-1 text-xs" onClick={() => { setEditMode(false); setError(null) }} disabled={saving}>
                Cancel
              </Button>
            </div>
            <Button
              size="sm"
              variant="destructive"
              className="h-6 w-full text-xs"
              onClick={() => { void handleDelete() }}
              disabled={saving}
            >
              <Trash2 className="mr-1 h-3 w-3" />
              Delete {isNode ? "Node" : "Edge"}
            </Button>
          </div>
        ) : (
          <>
            <div className="mb-3">
              <div className="mb-1 text-[10px] font-bold uppercase text-muted-foreground">
                {isNode ? "Labels" : "Type"}
              </div>
              <div className="flex flex-wrap gap-1">
                {isNode ? (
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
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// DbFileTree — groups db/ files by folder with collapsible sections
// ---------------------------------------------------------------------------

interface DbFileTreeProps {
  files: FileNode[]
  selectedFile: FileNode | null
  onSelect: (f: FileNode) => void
}

function DbFileTree({ files, selectedFile, onSelect }: DbFileTreeProps) {
  const groups = useMemo(() => {
    const map = new Map<string, { file: FileNode; name: string }[]>()
    for (const f of files) {
      const rel = (() => {
        const norm = f.path.replace(/\\/g, "/")
        const idx = norm.indexOf("/db/")
        return idx >= 0 ? norm.slice(idx + 4) : f.name
      })()
      const slashIdx = rel.indexOf("/")
      const folder = slashIdx >= 0 ? rel.slice(0, slashIdx) : ""
      const name = slashIdx >= 0 ? rel.slice(slashIdx + 1) : rel
      if (!map.has(folder)) map.set(folder, [])
      map.get(folder)!.push({ file: f, name })
    }
    return map
  }, [files])

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const toggle = (folder: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(folder)) next.delete(folder)
      else next.add(folder)
      return next
    })
  }

  return (
    <>
      {Array.from(groups.entries()).map(([folder, items]) => {
        const isCollapsed = collapsed.has(folder)
        return (
          <div key={folder || "__root__"}>
            {folder && (
              <button
                onClick={() => toggle(folder)}
                className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs font-medium text-foreground hover:bg-accent transition-colors"
              >
                {isCollapsed
                  ? <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                  : <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                }
                <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{folder}</span>
                <span className="ml-auto text-muted-foreground font-normal">{items.length}</span>
              </button>
            )}
            {!isCollapsed && items.map(({ file, name }) => (
              <button
                key={file.path}
                onClick={() => onSelect(file)}
                className={`flex w-full items-center gap-2 py-1.5 text-left text-xs transition-colors hover:bg-accent ${
                  folder ? "pl-7 pr-3" : "px-3"
                } ${
                  selectedFile?.path === file.path ? "bg-accent text-accent-foreground" : "text-muted-foreground"
                }`}
              >
                <FileText className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate" title={name}>{name}</span>
              </button>
            ))}
          </div>
        )
      })}
    </>
  )
}
