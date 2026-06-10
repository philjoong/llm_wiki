import { useEffect, useState } from "react"
import { confirm, message } from "@tauri-apps/plugin-dialog"
import { useWikiStore } from "@/stores/wiki-store"
import {
  loadGraphPolicy,
  saveGraphPolicy,
  type GraphPolicy,
} from "@/lib/graph-policy"
import { loadPageGraphIndex, findPagesByGraph } from "@/lib/page-graph-index"
import { deleteGraphDb, queryGraphDb } from "@/commands/graph-db"

interface GraphsTabProps {
  onPolicySaved?: (managedGraphs: string[]) => void
}

export function GraphsTab({ onPolicySaved }: GraphsTabProps = {}) {
  const project = useWikiStore((s) => s.project)
  const projectPath = project?.path ?? ""
  const projectName = project?.name ?? ""

  const [policy, setPolicy] = useState<GraphPolicy | null>(null)
  const [expandedGraphs, setExpandedGraphs] = useState<Set<string>>(new Set())

  // Rename state
  const [renamingGraph, setRenamingGraph] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")

  // Relation type editing state
  const [editingRelation, setEditingRelation] = useState<{
    graph: string
    index: number
  } | null>(null)
  const [editingRelationValue, setEditingRelationValue] = useState("")

  // Relation type adding state
  const [addingRelationGraph, setAddingRelationGraph] = useState<string | null>(null)
  const [addingRelationValue, setAddingRelationValue] = useState("")

  // New graph state
  const [addingGraph, setAddingGraph] = useState(false)
  const [newGraphName, setNewGraphName] = useState("")

  useEffect(() => {
    if (!projectPath) return
    loadGraphPolicy(projectPath).then(setPolicy)
  }, [projectPath])

  if (!projectPath || !policy) {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        {!projectPath ? "No project open." : "Loading…"}
      </div>
    )
  }

  function toggleExpand(graphName: string) {
    setExpandedGraphs((prev) => {
      const next = new Set(prev)
      next.has(graphName) ? next.delete(graphName) : next.add(graphName)
      return next
    })
  }

  async function getAffectedPages(graphName: string): Promise<string[]> {
    const index = await loadPageGraphIndex(projectPath)
    return findPagesByGraph(index, graphName)
  }

  function buildPageListText(pages: string[]): string {
    return pages.map((p) => `  - ${p}`).join("\n")
  }

  // ── Graph Add ──────────────────────────────────────────────────────────────

  async function handleAddGraph() {
    const name = newGraphName.trim()
    if (!name) return
    if (policy.managedGraphs.includes(name)) {
      await message(`Graph "${name}" already exists.`, { kind: "warning" })
      return
    }
    const next: GraphPolicy = {
      ...policy,
      managedGraphs: [...policy.managedGraphs, name],
      graphRelationTypes: { ...policy.graphRelationTypes, [name]: [] },
    }
    const saved = await saveGraphPolicy(projectPath, next)
    setPolicy(saved)
    onPolicySaved?.(saved.managedGraphs)
    setAddingGraph(false)
    setNewGraphName("")
  }

  // ── Graph Rename ───────────────────────────────────────────────────────────

  function startRename(graphName: string) {
    setRenamingGraph(graphName)
    setRenameValue(graphName)
  }

  async function handleRename(oldName: string) {
    const newName = renameValue.trim()
    if (!newName || newName === oldName) {
      setRenamingGraph(null)
      return
    }
    if (policy.managedGraphs.includes(newName)) {
      await message(`Graph "${newName}" already exists.`, { kind: "warning" })
      return
    }

    const pages = await getAffectedPages(oldName)
    if (pages.length > 0) {
      const ok = await confirm(
        `다음 문서가 이 graph에 연결되어 있습니다. 이름을 변경하면 재인제스트 전까지 해당 문서의 graph 연결이 끊깁니다:\n${buildPageListText(pages)}\n계속하시겠습니까?`,
      )
      if (!ok) {
        setRenamingGraph(null)
        return
      }
    }

    const newRelTypes = { ...policy.graphRelationTypes }
    newRelTypes[newName] = newRelTypes[oldName] ?? []
    delete newRelTypes[oldName]

    const next: GraphPolicy = {
      ...policy,
      managedGraphs: policy.managedGraphs.map((g) => (g === oldName ? newName : g)),
      graphRelationTypes: newRelTypes,
    }
    const saved = await saveGraphPolicy(projectPath, next)
    setPolicy(saved)
    onPolicySaved?.(saved.managedGraphs)
    setRenamingGraph(null)

    setExpandedGraphs((prev) => {
      const next = new Set(prev)
      if (next.has(oldName)) {
        next.delete(oldName)
        next.add(newName)
      }
      return next
    })
  }

  // ── Graph Delete ───────────────────────────────────────────────────────────

  async function handleDeleteGraph(graphName: string) {
    const pages = await getAffectedPages(graphName)
    const pageNote =
      pages.length > 0
        ? `\n\n다음 문서가 이 graph에 연결되어 있습니다. 삭제하면 해당 문서의 graph 연결이 끊깁니다:\n${buildPageListText(pages)}\n`
        : "\n"
    const ok = await confirm(`Graph "${graphName}"을 삭제하시겠습니까?${pageNote}FalkorDB의 graph 데이터도 함께 삭제됩니다. 계속하시겠습니까?`)
    if (!ok) return

    // Delete from FalkorDB (best-effort — graph may not exist yet)
    try {
      await deleteGraphDb(projectName, graphName)
    } catch {
      // Graph may not exist in FalkorDB yet; proceed with policy cleanup
    }

    const newRelTypes = { ...policy.graphRelationTypes }
    delete newRelTypes[graphName]

    const next: GraphPolicy = {
      ...policy,
      managedGraphs: policy.managedGraphs.filter((g) => g !== graphName),
      graphRelationTypes: newRelTypes,
    }
    const saved = await saveGraphPolicy(projectPath, next)
    setPolicy(saved)
    onPolicySaved?.(saved.managedGraphs)
  }

  // ── Relation Type Edit ─────────────────────────────────────────────────────

  function startEditRelation(graphName: string, index: number, currentValue: string) {
    setEditingRelation({ graph: graphName, index })
    setEditingRelationValue(currentValue)
  }

  async function handleSaveRelation(graphName: string, index: number) {
    const newValue = editingRelationValue.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_")
    const types = policy.graphRelationTypes[graphName] ?? []
    const oldValue = types[index]
    if (!newValue || newValue === oldValue) {
      setEditingRelation(null)
      return
    }

    const pages = await getAffectedPages(graphName)
    const pageNote = pages.length > 0 ? `\n\n영향 문서:\n${buildPageListText(pages)}\n` : "\n"
    const ok = await confirm(
      `FalkorDB의 "${graphName}" graph에서 "${oldValue}" 엣지를 "${newValue}"로 변경합니다.${pageNote}계속하시겠습니까?`,
    )
    if (!ok) {
      setEditingRelation(null)
      return
    }

    // Rename edges in FalkorDB: copy old edges as new type, then delete old
    try {
      await queryGraphDb(
        projectName,
        graphName,
        `MATCH (a)-[r:${oldValue}]->(b) MERGE (a)-[:${newValue}]->(b) DELETE r`,
      )
    } catch {
      // Graph may not exist yet in FalkorDB; proceed with policy update
    }

    const newTypes = [...types]
    newTypes[index] = newValue
    const next: GraphPolicy = {
      ...policy,
      graphRelationTypes: { ...policy.graphRelationTypes, [graphName]: newTypes },
    }
    const saved = await saveGraphPolicy(projectPath, next)
    setPolicy(saved)
    onPolicySaved?.(saved.managedGraphs)
    setEditingRelation(null)
  }

  // ── Relation Type Delete ───────────────────────────────────────────────────

  async function handleDeleteRelation(graphName: string, index: number) {
    const types = policy.graphRelationTypes[graphName] ?? []
    const typeName = types[index]

    const pages = await getAffectedPages(graphName)
    const pageNote = pages.length > 0 ? `\n\n영향 문서:\n${buildPageListText(pages)}\n` : "\n"
    const ok = await confirm(
      `FalkorDB의 "${graphName}" graph에서 "${typeName}" 엣지를 모두 삭제합니다.${pageNote}계속하시겠습니까?`,
    )
    if (!ok) return

    // Delete edges of this type from FalkorDB
    try {
      await queryGraphDb(
        projectName,
        graphName,
        `MATCH ()-[r:${typeName}]->() DELETE r`,
      )
    } catch {
      // Graph may not exist yet in FalkorDB; proceed with policy update
    }

    const newTypes = types.filter((_, i) => i !== index)
    const next: GraphPolicy = {
      ...policy,
      graphRelationTypes: { ...policy.graphRelationTypes, [graphName]: newTypes },
    }
    const saved = await saveGraphPolicy(projectPath, next)
    setPolicy(saved)
    onPolicySaved?.(saved.managedGraphs)
  }

  // ── Relation Type Add ─────────────────────────────────────────────────────

  async function handleAddRelation(graphName: string) {
    const newValue = addingRelationValue.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_")
    if (!newValue) {
      setAddingRelationGraph(null)
      return
    }
    const types = policy.graphRelationTypes[graphName] ?? []
    if (types.includes(newValue)) {
      await message(`"${newValue}" already exists in this graph.`, { kind: "warning" })
      return
    }
    const next: GraphPolicy = {
      ...policy,
      graphRelationTypes: { ...policy.graphRelationTypes, [graphName]: [...types, newValue] },
    }
    const saved = await saveGraphPolicy(projectPath, next)
    setPolicy(saved)
    onPolicySaved?.(saved.managedGraphs)
    setAddingRelationGraph(null)
    setAddingRelationValue("")
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-1.5">
        <span className="text-xs font-medium">Graphs</span>
        <button
          onClick={() => {
            setAddingGraph(true)
            setNewGraphName("")
          }}
          className="text-xs text-muted-foreground hover:text-foreground"
          title="Add graph"
        >
          + Add
        </button>
      </div>

      {/* New graph input */}
      {addingGraph && (
        <div className="flex shrink-0 items-center gap-1 border-b px-3 py-1.5">
          <input
            autoFocus
            value={newGraphName}
            onChange={(e) => setNewGraphName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddGraph()
              if (e.key === "Escape") {
                setAddingGraph(false)
                setNewGraphName("")
              }
            }}
            placeholder="graph_name"
            className="flex-1 rounded border bg-background px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            onClick={handleAddGraph}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            OK
          </button>
          <button
            onClick={() => {
              setAddingGraph(false)
              setNewGraphName("")
            }}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </div>
      )}

      {/* Graph list */}
      <div className="flex-1 overflow-y-auto">
        {policy.managedGraphs.length === 0 && (
          <div className="p-3 text-xs text-muted-foreground">No graphs.</div>
        )}
        {policy.managedGraphs.map((graphName) => {
          const isExpanded = expandedGraphs.has(graphName)
          const relTypes = policy.graphRelationTypes[graphName] ?? []
          const isRenaming = renamingGraph === graphName

          return (
            <div key={graphName} className="border-b last:border-b-0">
              {/* Graph row */}
              <div className="group flex items-center gap-1 px-2 py-1 hover:bg-muted/40">
                <button
                  onClick={() => toggleExpand(graphName)}
                  className="shrink-0 text-xs text-muted-foreground"
                >
                  {isExpanded ? "▼" : "▶"}
                </button>

                {isRenaming ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRename(graphName)
                      if (e.key === "Escape") setRenamingGraph(null)
                    }}
                    onBlur={() => handleRename(graphName)}
                    className="flex-1 rounded border bg-background px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                ) : (
                  <span className="flex-1 truncate text-xs">{graphName}</span>
                )}

                {!isRenaming && (
                  <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100">
                    <button
                      onClick={() => startRename(graphName)}
                      className="text-xs text-muted-foreground hover:text-foreground"
                      title="Rename"
                    >
                      ✎
                    </button>
                    <button
                      onClick={() => handleDeleteGraph(graphName)}
                      className="text-xs text-muted-foreground hover:text-destructive"
                      title="Delete"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>

              {/* Relation types */}
              {isExpanded && (
                <div className="pl-6">
                  {relTypes.length === 0 && (
                    <div className="py-1 text-xs text-muted-foreground">No relation types.</div>
                  )}
                  {relTypes.map((rt, idx) => {
                    const isEditingThis =
                      editingRelation?.graph === graphName && editingRelation.index === idx

                    return (
                      <div
                        key={idx}
                        className="group flex items-center gap-1 py-0.5 pr-2 hover:bg-muted/40"
                      >
                        {isEditingThis ? (
                          <input
                            autoFocus
                            value={editingRelationValue}
                            onChange={(e) => setEditingRelationValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveRelation(graphName, idx)
                              if (e.key === "Escape") setEditingRelation(null)
                            }}
                            onBlur={() => handleSaveRelation(graphName, idx)}
                            className="flex-1 rounded border bg-background px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        ) : (
                          <span className="flex-1 truncate font-mono text-xs">{rt}</span>
                        )}

                        {!isEditingThis && (
                          <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100">
                            <button
                              onClick={() => startEditRelation(graphName, idx, rt)}
                              className="text-xs text-muted-foreground hover:text-foreground"
                              title="Edit"
                            >
                              ✎
                            </button>
                            <button
                              onClick={() => handleDeleteRelation(graphName, idx)}
                              className="text-xs text-muted-foreground hover:text-destructive"
                              title="Delete"
                            >
                              ✕
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}

                  {/* Add relation type (only when < 4) */}
                  {relTypes.length < 4 && (
                    addingRelationGraph === graphName ? (
                      <div className="flex items-center gap-1 py-0.5 pr-2">
                        <input
                          autoFocus
                          value={addingRelationValue}
                          onChange={(e) => setAddingRelationValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { void handleAddRelation(graphName) }
                            if (e.key === "Escape") {
                              setAddingRelationGraph(null)
                              setAddingRelationValue("")
                            }
                          }}
                          onBlur={() => { void handleAddRelation(graphName) }}
                          placeholder="RELATION_TYPE"
                          className="flex-1 rounded border bg-background px-1 py-0.5 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setAddingRelationGraph(graphName)
                          setAddingRelationValue("")
                        }}
                        className="py-0.5 text-xs text-muted-foreground hover:text-foreground"
                      >
                        + Add type
                      </button>
                    )
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
