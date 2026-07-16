import { useCallback, useEffect, useMemo, useState } from "react"
import { confirm, message } from "@tauri-apps/plugin-dialog"
import { Button } from "@/components/ui/button"
import { GraphsTab } from "@/components/layout/graphs-tab"
import { EntityView } from "@/components/entity/entity-view"
import { FalkorCanvas } from "./falkor-canvas"
import { assignColors, type CanvasData } from "@/lib/falkor-visualization"
import { useWikiStore } from "@/stores/wiki-store"
import {
  createManualAssertion,
  createOrLinkGraphNode,
  deleteAssertion,
  deleteGraphProjection,
  getEntityNeighborhood,
  getKnowledgeDeleteImpact,
  getKnowledgeGraphSnapshot,
  getKnowledgePage,
  listAllowedRelationTypes,
  listGraphsForPage,
  listKnowledgeEntities,
  listKnowledgeGraphs,
  rejectReviewAssertion,
  resolveCardinalityConflict,
  type EntityDetail,
} from "@/commands/knowledge"
import { isUserVisibleGraph, type EntityNeighborhood, type EntityRecord, type GraphNodeRecord, type GraphRecord, type KnowledgeGraphSnapshot } from "@/lib/knowledge/types"
import { ENTITY_TYPES, type EntityType } from "@/lib/knowledge/vocabularies"
import { readFile } from "@/commands/fs"
import { listDbFiles } from "@/lib/wiki-graph"
import { normalizePath } from "@/lib/path-utils"
import { usePageTitles, titleForPath } from "@/lib/use-page-titles"
import type { FileNode } from "@/types/wiki"

type Tab = "knowledge" | "graphs" | "entity" | "files"
type SnapshotNode = GraphNodeRecord & { entity: EntityRecord }

const EVIDENCE_STATE_LABEL: Record<string, string> = { documented: "from documents", manual: "added manually", contradicted: "contradicted by source" }
const STATUS_LABEL: Record<string, string> = { active: "confirmed", review: "needs review", superseded: "replaced" }

/** Shared node/assertion shape of both a single-graph snapshot and an entity neighborhood. */
type GraphData = Pick<KnowledgeGraphSnapshot, "nodes" | "assertions">

/**
 * Build canvas data, optionally filtered to a single relation type. Nodes are
 * keyed by entityId so a merged neighborhood (same entity projected into
 * several graphs) collapses to one node per entity instead of duplicates.
 */
function snapshotToCanvas(snapshot: GraphData, relationFilter?: string | null): CanvasData {
  const assertions = relationFilter ? snapshot.assertions.filter((a) => a.predicate === relationFilter) : snapshot.assertions
  const nodeByEntity = new Map(snapshot.nodes.map((item) => [item.entity.entityId, item.entity.entityId]))
  return assignColors({
    nodes: snapshot.nodes.map((item) => ({ id:item.entity.entityId,labels:[item.entity.entityType],visible:true,data:{nodeId:item.nodeId,entityId:item.entity.entityId,concept:item.entity.canonicalName,label:item.entity.canonicalName} })),
    links: assertions.flatMap((item) => { const source=nodeByEntity.get(item.subjectEntityId);const target=nodeByEntity.get(item.objectEntityId);return source&&target?[{id:item.assertionId,relationship:item.predicate,visible:true,source,target,data:{assertionId:item.assertionId,evidenceState:item.evidenceState,evidence:item.evidence}}]:[] }),
  }).data
}

/**
 * Relation-type legend + filter shared by every canvas (knowledge and files
 * tabs). Clicking a type filters the canvas/facts to that predicate; the color
 * chips match the edge colors from `assignColors`.
 */
function RelationTypeFilter({ data, filter, onFilterChange }: { data: GraphData | null; filter: string | null; onFilterChange: (next: string | null) => void }) {
  const colors = useMemo(() => (data ? assignColors(snapshotToCanvas(data)).relationColorMap : new Map<string, string>()), [data])
  const types = useMemo(() => Array.from(new Set((data?.assertions ?? []).map((a) => a.predicate))).sort(), [data])
  return <div className="border-t p-2 text-xs"><div className="mb-1 font-medium">Relation types</div>{types.length === 0 ? <p className="text-muted-foreground">No relations</p> : <div className="space-y-0.5"><button onClick={() => onFilterChange(null)} className={`block w-full rounded px-1 py-0.5 text-left ${filter === null ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"}`}>All</button>{types.map((rel) => <button key={rel} onClick={() => onFilterChange(filter === rel ? null : rel)} className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left ${filter === rel ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"}`}><span className="inline-block h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: colors.get(rel) ?? "#888" }}/><span className="truncate font-mono">{rel}</span></button>)}</div>}</div>
}

/** Derive the project-relative page_path (e.g. "db/goblin.md") from an absolute file path. */
function toPagePath(projectPath: string, filePath: string): string {
  const root = normalizePath(projectPath).replace(/\/$/, "")
  const norm = filePath.replace(/\\/g, "/")
  return norm.startsWith(root + "/") ? norm.slice(root.length + 1) : norm
}

function FilesTab() {
  const project = useWikiStore((s)=>s.project)
  const projectPath = project?.path ?? ""
  const pageTitles = usePageTitles()
  const [files,setFiles] = useState<FileNode[]>([])
  const [selectedFile,setSelectedFile] = useState<FileNode|null>(null)
  const [relatedGraphs,setRelatedGraphs] = useState<GraphRecord[]>([])
  const [loadingRelated,setLoadingRelated] = useState(false)
  const [selectedGraphId,setSelectedGraphId] = useState<string|null>(null)
  const [snapshot,setSnapshot] = useState<KnowledgeGraphSnapshot|null>(null)
  const [relationFilter,setRelationFilter] = useState<string|null>(null)
  useEffect(()=>{if(!projectPath)return;void listDbFiles(normalizePath(projectPath)).then(setFiles)},[projectPath])
  const selectFile=useCallback(async(file:FileNode)=>{setSelectedFile(file);setSelectedGraphId(null);setSnapshot(null);setRelationFilter(null);setLoadingRelated(true);try{setRelatedGraphs(await listGraphsForPage(normalizePath(projectPath),toPagePath(projectPath,file.path)))}catch{setRelatedGraphs([])}finally{setLoadingRelated(false)}},[projectPath])
  const selectGraph=useCallback(async(graphId:string)=>{setSelectedGraphId(graphId);setRelationFilter(null);try{setSnapshot(await getKnowledgeGraphSnapshot(normalizePath(projectPath),graphId))}catch{setSnapshot(null)}},[projectPath])
  const canvas=useMemo(()=>snapshot?snapshotToCanvas(snapshot,relationFilter):{nodes:[],links:[]},[snapshot,relationFilter])
  return <div className="flex min-h-0 flex-1">
    <div className="w-64 flex-shrink-0 overflow-y-auto border-r p-2 text-xs">{files.length===0?<p className="text-muted-foreground">No documents under db/</p>:files.map((f)=>{const label=titleForPath(pageTitles,f.path,projectPath);return <button key={f.path} title={f.name} onClick={()=>void selectFile(f)} className={`block w-full truncate rounded px-2 py-1 text-left ${selectedFile?.path===f.path?"bg-accent text-accent-foreground":"hover:bg-accent/50"}`}>{label}</button>})}</div>
    <div className="w-56 flex-shrink-0 overflow-y-auto border-r p-2 text-xs">{!selectedFile?<p className="text-muted-foreground">Select a document to see related graphs</p>:loadingRelated?<p className="text-muted-foreground">Loading…</p>:relatedGraphs.length===0?<p className="text-muted-foreground">No related graphs</p>:<><div className="mb-2 font-medium">Related graphs</div>{relatedGraphs.map((g)=><button key={g.graphId} onClick={()=>void selectGraph(g.graphId)} className={`block w-full truncate rounded px-2 py-1 text-left ${selectedGraphId===g.graphId?"bg-accent text-accent-foreground":"hover:bg-accent/50"}`}>{g.graphName}</button>)}</>}</div>
    <div className="min-h-0 flex-1">{selectedGraphId?<FalkorCanvas data={canvas}/>:<div className="flex h-full items-center justify-center text-xs text-muted-foreground">Select a related graph to view it</div>}</div>
    {selectedGraphId&&<aside className="w-56 flex-shrink-0 overflow-y-auto border-l"><RelationTypeFilter data={snapshot} filter={relationFilter} onFilterChange={setRelationFilter}/></aside>}
  </div>
}

type KnowledgeMode = "entity" | "graph"

export function GraphView() {
  const project = useWikiStore((s)=>s.project)
  const projectPath=project?.path??""
  const selectedGraph=useWikiStore((s)=>s.selectedGraph)
  const setSelectedGraph=useWikiStore((s)=>s.setSelectedGraph)
  const [tab,setTab]=useState<Tab>("knowledge")
  const [mode,setMode]=useState<KnowledgeMode>("entity")
  const [editing,setEditing]=useState(false)
  const [graphs,setGraphs]=useState<GraphRecord[]>([])
  const [snapshot,setSnapshot]=useState<KnowledgeGraphSnapshot|null>(null)
  const [entities,setEntities]=useState<EntityDetail[]>([])
  const [selectedEntity,setSelectedEntity]=useState<string>("")
  const [neighborhood,setNeighborhood]=useState<EntityNeighborhood|null>(null)
  const [relationFilter,setRelationFilter]=useState<string|null>(null)
  const [selectedNode,setSelectedNode]=useState<SnapshotNode|null>(null)
  const [nodeName,setNodeName]=useState("")
  const [nodeType,setNodeType]=useState<EntityType>("concept")
  const [source,setSource]=useState("")
  const [target,setTarget]=useState("")
  const [predicate,setPredicate]=useState("")
  const [allowed,setAllowed]=useState<string[]>([])
  const reloadGraphs=useCallback(async()=>{if(!projectPath)return;const next=(await listKnowledgeGraphs(projectPath)).filter(isUserVisibleGraph);setGraphs(next);const id=next.some((g)=>g.graphId===selectedGraph)?selectedGraph:next[0]?.graphId??"";if(id!==selectedGraph)setSelectedGraph(id)},[projectPath,selectedGraph,setSelectedGraph])
  const reloadSnapshot=useCallback(async()=>{if(!projectPath||!selectedGraph){setSnapshot(null);return}try{setSnapshot(await getKnowledgeGraphSnapshot(projectPath,selectedGraph))}catch{setSnapshot(null)}},[projectPath,selectedGraph])
  const reloadEntities=useCallback(async()=>{if(!projectPath)return;const next=await listKnowledgeEntities(projectPath);setEntities(next);setSelectedEntity((old)=>next.some((e)=>e.entityId===old)?old:next[0]?.entityId??"")},[projectPath])
  const reloadNeighborhood=useCallback(async()=>{if(!projectPath||!selectedEntity){setNeighborhood(null);return}try{setNeighborhood(await getEntityNeighborhood(projectPath,selectedEntity))}catch{setNeighborhood(null)}},[projectPath,selectedEntity])
  useEffect(()=>{void reloadGraphs();void reloadEntities()},[projectPath])
  useEffect(()=>{void reloadSnapshot()},[reloadSnapshot])
  useEffect(()=>{void reloadNeighborhood()},[reloadNeighborhood])
  useEffect(()=>{setRelationFilter(null)},[mode,selectedGraph,selectedEntity])
  // Editing is only meaningful in graph mode; leaving it drops back to read-only.
  useEffect(()=>{if(mode!=="graph")setEditing(false)},[mode])
  useEffect(()=>{const a=snapshot?.nodes.find((n)=>n.nodeId===source);const b=snapshot?.nodes.find((n)=>n.nodeId===target);if(!a||!b){setAllowed([]);return}void listAllowedRelationTypes(projectPath,selectedGraph,a.entity.entityId,b.entity.entityId).then((types)=>{setAllowed(types.map((t)=>t.name));setPredicate((old)=>types.some((t)=>t.name===old)?old:types[0]?.name??"")})},[projectPath,selectedGraph,snapshot,source,target])
  // The active view is either one graph (graph mode) or an entity's merged
  // neighborhood (entity mode). Both share the same node/assertion shape.
  const graphData:GraphData|null=mode==="graph"?snapshot:neighborhood
  const canvas=useMemo(()=>graphData?snapshotToCanvas(graphData,relationFilter):{nodes:[],links:[]},[graphData,relationFilter])
  const entityName=useMemo(()=>{const m=new Map<string,string>();graphData?.nodes.forEach((n)=>m.set(n.entity.entityId,n.entity.canonicalName));return m},[graphData])
  const graphName=useMemo(()=>{const m=new Map<string,string>();graphs.forEach((g)=>m.set(g.graphId,g.graphName));neighborhood?.graphs.forEach((g)=>m.set(g.graphId,g.graphName));return m},[graphs,neighborhood])
  const addNode=async()=>{if(!nodeName.trim()||!selectedGraph)return;await createOrLinkGraphNode(projectPath,{graphId:selectedGraph,canonicalName:nodeName.trim(),entityType:nodeType});setNodeName("");await reloadSnapshot()}
  const addEdge=async()=>{const a=snapshot?.nodes.find((n)=>n.nodeId===source);const b=snapshot?.nodes.find((n)=>n.nodeId===target);if(!a||!b||!predicate)return;await createManualAssertion(projectPath,{graphId:selectedGraph,subjectEntityId:a.entity.entityId,predicate,objectEntityId:b.entity.entityId});await reloadSnapshot()}
  const removeNode=async(node:SnapshotNode)=>{const impact=await getKnowledgeDeleteImpact(projectPath,{nodeId:node.nodeId});if(await confirm(`Remove projection “${node.entity.canonicalName}”? ${impact.assertionIds.length} related assertions remain attached to the entity.`)){await deleteGraphProjection(projectPath,node.nodeId);setSelectedNode(null);await reloadSnapshot()}}
  const reloadActive=async()=>{if(mode==="graph")await reloadSnapshot();else await reloadNeighborhood()}
  const removeEdge=async(assertionId:string)=>{const impact=await getKnowledgeDeleteImpact(projectPath,{assertionId});if(await confirm(`Delete assertion and ${impact.evidenceIds.length} evidence links?`)){await deleteAssertion(projectPath,assertionId);await reloadActive()}}
  const reviewAssertion=async(assertionId:string,approve:boolean)=>{if(approve)await resolveCardinalityConflict(projectPath,assertionId);else await rejectReviewAssertion(projectPath,assertionId);await reloadActive()}
  const openEvidence=async(pageId:string)=>{const page=await getKnowledgePage(projectPath,pageId);if(!page)return message("Evidence page no longer exists.",{kind:"warning"});const path=`${projectPath}/${page.pagePath}`;useWikiStore.getState().setSelectedFile(path);useWikiStore.getState().setFileContent(await readFile(path));useWikiStore.getState().setActiveView("wiki")}
  if(!projectPath)return <div className="p-4 text-sm text-muted-foreground">No project open.</div>
  return <div className="flex h-full flex-col"><div className="flex border-b">{(["knowledge","graphs","entity","files"] as Tab[]).map((item)=><button key={item} onClick={()=>setTab(item)} className={`px-4 py-2 text-sm ${tab===item?"border-b-2 border-primary":"text-muted-foreground"}`}>{item}</button>)}</div>
    {tab==="graphs"?<GraphsTab onPolicySaved={()=>void reloadGraphs()}/>:tab==="entity"?<EntityView/>:tab==="files"?<FilesTab/>:<div className="flex min-h-0 flex-1"><div className="flex min-w-0 flex-1 flex-col"><div className="flex flex-wrap items-center gap-2 border-b p-2">
      <div className="flex rounded border text-xs"><button onClick={()=>setMode("entity")} className={`px-2 py-0.5 ${mode==="entity"?"bg-accent text-accent-foreground":""}`}>Entity</button><button onClick={()=>setMode("graph")} className={`px-2 py-0.5 ${mode==="graph"?"bg-accent text-accent-foreground":""}`}>Graph</button></div>
      {mode==="graph"&&<div className="flex rounded border text-xs"><button onClick={()=>setEditing(false)} className={`px-2 py-0.5 ${!editing?"bg-accent text-accent-foreground":""}`}>View</button><button onClick={()=>setEditing(true)} className={`px-2 py-0.5 ${editing?"bg-accent text-accent-foreground":""}`}>Edit</button></div>}
      {mode==="entity"?<select value={selectedEntity} onChange={(e)=>setSelectedEntity(e.target.value)} className="rounded border px-2 text-xs">{entities.length===0&&<option value="">No entities</option>}{entities.map((e)=><option key={e.entityId} value={e.entityId}>{e.canonicalName}</option>)}</select>:<><select value={selectedGraph} onChange={(e)=>setSelectedGraph(e.target.value)} className="rounded border px-2 text-xs">{graphs.length===0&&<option value="">No graphs</option>}{graphs.map((g)=><option key={g.graphId} value={g.graphId}>{g.graphName}</option>)}</select>{editing&&<><input value={nodeName} onChange={(e)=>setNodeName(e.target.value)} placeholder="New entity" className="rounded border px-2 text-xs"/><select value={nodeType} onChange={(e)=>setNodeType(e.target.value as EntityType)} className="rounded border text-xs">{ENTITY_TYPES.map((t)=><option key={t}>{t}</option>)}</select><Button size="sm" onClick={()=>void addNode()}>Add node</Button></>}</>}
    </div><div className="min-h-0 flex-1"><FalkorCanvas data={canvas} onNodeClick={mode==="graph"&&editing?(node)=>setSelectedNode(graphData?.nodes.find((n)=>n.nodeId===(node.data?.nodeId??node.id))??null):undefined} onLinkClick={mode==="graph"&&editing?(edge)=>void removeEdge(edge.data?.assertionId??edge.id):undefined}/></div></div>
      <aside className="flex w-80 flex-col overflow-y-auto border-l text-xs"><RelationTypeFilter data={graphData} filter={relationFilter} onFilterChange={setRelationFilter}/>
      {mode==="graph"&&editing&&<div className="border-t p-3"><div className="font-medium">Manual assertion</div><select value={source} onChange={(e)=>setSource(e.target.value)} className="mt-2 w-full rounded border"><option value="">Subject</option>{snapshot?.nodes.map((n)=><option key={n.nodeId} value={n.nodeId}>{n.entity.canonicalName}</option>)}</select><select value={target} onChange={(e)=>setTarget(e.target.value)} className="mt-1 w-full rounded border"><option value="">Object</option>{snapshot?.nodes.map((n)=><option key={n.nodeId} value={n.nodeId}>{n.entity.canonicalName}</option>)}</select><select value={predicate} onChange={(e)=>setPredicate(e.target.value)} className="mt-1 w-full rounded border"><option value="">Allowed predicate</option>{allowed.map((p)=><option key={p}>{p}</option>)}</select><Button size="sm" className="mt-2" onClick={()=>void addEdge()}>Add assertion</Button>{selectedNode&&<div className="mt-4 border-t pt-3"><div className="font-medium" title={selectedNode.nodeId}>{selectedNode.entity.canonicalName}</div><Button variant="destructive" size="sm" className="mt-2" onClick={()=>void removeNode(selectedNode)}>Remove projection</Button></div>}</div>}
      <div className="border-t p-3"><div className="font-medium">Facts</div>{(graphData?.assertions??[]).filter((a)=>!relationFilter||a.predicate===relationFilter).map((a)=><div key={a.assertionId} className="mt-2 rounded border p-2" title={a.assertionId}><div><span className="font-medium">{entityName.get(a.subjectEntityId)??"?"}</span> <span className="text-muted-foreground">{a.predicate}</span> <span className="font-medium">{entityName.get(a.objectEntityId)??"?"}</span></div><div className="mt-0.5 text-[10px] text-muted-foreground">{EVIDENCE_STATE_LABEL[a.evidenceState]??a.evidenceState} · {STATUS_LABEL[a.status]??a.status}{mode==="entity"&&graphName.get(a.graphId)?` · ${graphName.get(a.graphId)}`:""}</div>{a.evidence.filter((e)=>e.pageId).map((e)=><button key={e.evidenceId} onClick={()=>void openEvidence(e.pageId!)} className="block text-primary">Open source</button>)}{a.status==="review"&&editing&&<div className="mt-1 flex gap-1"><button onClick={()=>void reviewAssertion(a.assertionId,true)} className="text-emerald-600">Approve</button><button onClick={()=>void reviewAssertion(a.assertionId,false)} className="text-destructive">Reject</button></div>}</div>)}</div></aside></div>}
  </div>
}
