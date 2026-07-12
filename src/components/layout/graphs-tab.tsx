import { useEffect, useState } from "react"
import { confirm, message } from "@tauri-apps/plugin-dialog"
import { useWikiStore } from "@/stores/wiki-store"
import {
  deleteKnowledgeGraph,
  deleteKnowledgeRelationType,
  listKnowledgeGraphs,
  listKnowledgeRelationTypes,
  registerGraph,
  registerRelationType,
  renameKnowledgeGraph,
  renameKnowledgeRelationType,
} from "@/commands/knowledge"
import type { GraphRecord, RelationTypeRecord } from "@/lib/knowledge/types"

interface GraphsTabProps { onPolicySaved?: (graphNames: string[]) => void }
const predicate = (value: string) => value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_")

/** Graph administration is deliberately backed by knowledge.sqlite only. */
export function GraphsTab({ onPolicySaved }: GraphsTabProps = {}) {
  const projectPath = useWikiStore((s) => s.project?.path ?? "")
  const [graphs, setGraphs] = useState<GraphRecord[]>([])
  const [relations, setRelations] = useState<Record<string, RelationTypeRecord[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [addingGraph, setAddingGraph] = useState(false)
  const [newGraphName, setNewGraphName] = useState("")
  const [renameGraph, setRenameGraph] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [addingRelation, setAddingRelation] = useState<string | null>(null)
  const [relationValue, setRelationValue] = useState("")
  const [editingRelation, setEditingRelation] = useState<{ graphId: string; name: string } | null>(null)

  const notify = (items: GraphRecord[]) => onPolicySaved?.(items.map((item) => item.graphName))
  const reload = async () => {
    if (!projectPath) return
    const next = await listKnowledgeGraphs(projectPath)
    setGraphs(next); notify(next)
    const entries = await Promise.all(next.map(async (graph) => [graph.graphId, await listKnowledgeRelationTypes(projectPath, graph.graphId)] as const))
    setRelations(Object.fromEntries(entries))
  }
  useEffect(() => { void reload() }, [projectPath])
  if (!projectPath) return <div className="p-3 text-xs text-muted-foreground">No project open.</div>

  const addGraph = async () => {
    const graphName = newGraphName.trim(); if (!graphName) return
    try { await registerGraph(projectPath, { graphId: crypto.randomUUID(), graphName, purpose: "" }); await reload(); setAddingGraph(false); setNewGraphName("") }
    catch (error) { await message(String(error), { kind: "error" }) }
  }
  const saveGraphRename = async (graph: GraphRecord) => {
    const graphName = renameValue.trim(); setRenameGraph(null)
    if (!graphName || graphName === graph.graphName) return
    try { await renameKnowledgeGraph(projectPath, graph.graphId, graphName); await reload() }
    catch (error) { await message(String(error), { kind: "error" }) }
  }
  const removeGraph = async (graph: GraphRecord) => {
    if (!await confirm(`Delete graph “${graph.graphName}” and all of its assertions?`)) return
    await deleteKnowledgeGraph(projectPath, graph.graphId); await reload()
  }
  const addRelation = async (graph: GraphRecord) => {
    const name = predicate(relationValue); if (!name) return
    const relation: RelationTypeRecord = { graphId: graph.graphId, name, description: "Defined in Graphs", subjectTypes: ["concept"], objectTypes: ["concept"], symmetric: false, objectCardinality: "many" }
    try { await registerRelationType(projectPath, relation); await reload(); setAddingRelation(null); setRelationValue("") }
    catch (error) { await message(String(error), { kind: "error" }) }
  }
  const saveRelationRename = async () => {
    if (!editingRelation) return
    const input = editingRelation; const name = predicate(relationValue); setEditingRelation(null)
    if (!name || name === input.name) return
    try { await renameKnowledgeRelationType(projectPath, input.graphId, input.name, name); await reload() }
    catch (error) { await message(String(error), { kind: "error" }) }
  }

  return <div className="flex h-full flex-col overflow-hidden">
    <div className="flex items-center justify-between border-b px-3 py-1.5"><span className="text-xs font-medium">Graphs</span><button onClick={() => setAddingGraph(true)} className="text-xs text-muted-foreground hover:text-foreground">+ Add</button></div>
    {addingGraph && <div className="flex gap-1 border-b p-2"><input autoFocus value={newGraphName} onChange={(e) => setNewGraphName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void addGraph()} placeholder="graph name" className="flex-1 rounded border px-1 text-xs"/><button onClick={() => void addGraph()} className="text-xs">OK</button></div>}
    <div className="flex-1 overflow-y-auto">{graphs.length === 0 && <div className="p-3 text-xs text-muted-foreground">No graphs.</div>}
      {graphs.map((graph) => <div key={graph.graphId} className="border-b">
        <div className="group flex items-center gap-1 px-2 py-1"><button onClick={() => setExpanded((old) => { const next = new Set(old); next.has(graph.graphId) ? next.delete(graph.graphId) : next.add(graph.graphId); return next })} className="text-xs">{expanded.has(graph.graphId) ? "▼" : "▶"}</button>
          {renameGraph === graph.graphId ? <input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)} onBlur={() => void saveGraphRename(graph)} onKeyDown={(e) => e.key === "Enter" && void saveGraphRename(graph)} className="flex-1 rounded border px-1 text-xs"/> : <span className="flex-1 truncate text-xs">{graph.graphName}</span>}
          {renameGraph !== graph.graphId && <div className="flex gap-1 opacity-0 group-hover:opacity-100"><button onClick={() => { setRenameGraph(graph.graphId); setRenameValue(graph.graphName) }} className="text-xs">✎</button><button onClick={() => void removeGraph(graph)} className="text-xs text-destructive">✕</button></div>}
        </div>
        {expanded.has(graph.graphId) && <div className="pl-6 pb-1">{(relations[graph.graphId] ?? []).map((relation) => <div key={relation.name} className="group flex gap-1 py-0.5 text-xs"><span className="flex-1 font-mono">{editingRelation?.graphId === graph.graphId && editingRelation.name === relation.name ? <input autoFocus value={relationValue} onChange={(e) => setRelationValue(e.target.value)} onBlur={() => void saveRelationRename()} onKeyDown={(e) => e.key === "Enter" && void saveRelationRename()} className="w-full rounded border px-1"/> : relation.name}</span>{!editingRelation && <span className="opacity-0 group-hover:opacity-100"><button onClick={() => { setEditingRelation({ graphId: graph.graphId, name: relation.name }); setRelationValue(relation.name) }}>✎</button><button onClick={() => void deleteKnowledgeRelationType(projectPath, graph.graphId, relation.name).then(reload)} className="ml-1 text-destructive">✕</button></span>}</div>)}
          {addingRelation === graph.graphId ? <input autoFocus value={relationValue} onChange={(e) => setRelationValue(e.target.value)} onBlur={() => void addRelation(graph)} onKeyDown={(e) => e.key === "Enter" && void addRelation(graph)} placeholder="RELATION_TYPE" className="w-full rounded border px-1 font-mono text-xs"/> : <button onClick={() => { setAddingRelation(graph.graphId); setRelationValue("") }} className="text-xs text-muted-foreground">+ Add type</button>}</div>}
      </div>)}</div>
  </div>
}
