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
  getKnowledgeDeleteImpact,
  getKnowledgeGraphSnapshot,
  getKnowledgePage,
  listAllowedRelationTypes,
  listKnowledgeGraphs,
  rejectReviewAssertion,
  resolveCardinalityConflict,
} from "@/commands/knowledge"
import type { EntityRecord, GraphNodeRecord, GraphRecord, KnowledgeGraphSnapshot } from "@/lib/knowledge/types"
import { ENTITY_TYPES, type EntityType } from "@/lib/knowledge/vocabularies"
import { readFile } from "@/commands/fs"

type Tab = "knowledge" | "graphs" | "entity"
type SnapshotNode = GraphNodeRecord & { entity: EntityRecord }

function snapshotToCanvas(snapshot: KnowledgeGraphSnapshot): CanvasData {
  const nodeByEntity = new Map(snapshot.nodes.map((item) => [item.entity.entityId, item.nodeId]))
  return assignColors({
    nodes: snapshot.nodes.map((item) => ({ id:item.nodeId,labels:[item.entity.entityType],visible:true,data:{nodeId:item.nodeId,entityId:item.entity.entityId,concept:item.entity.canonicalName,label:item.entity.canonicalName} })),
    links: snapshot.assertions.flatMap((item) => { const source=nodeByEntity.get(item.subjectEntityId);const target=nodeByEntity.get(item.objectEntityId);return source&&target?[{id:item.assertionId,relationship:item.predicate,visible:true,source,target,data:{assertionId:item.assertionId,evidenceState:item.evidenceState,evidence:item.evidence}}]:[] }),
  }).data
}

export function GraphView() {
  const project = useWikiStore((s)=>s.project)
  const projectPath=project?.path??""
  const selectedGraph=useWikiStore((s)=>s.selectedGraph)
  const setSelectedGraph=useWikiStore((s)=>s.setSelectedGraph)
  const [tab,setTab]=useState<Tab>("knowledge")
  const [graphs,setGraphs]=useState<GraphRecord[]>([])
  const [snapshot,setSnapshot]=useState<KnowledgeGraphSnapshot|null>(null)
  const [selectedNode,setSelectedNode]=useState<SnapshotNode|null>(null)
  const [nodeName,setNodeName]=useState("")
  const [nodeType,setNodeType]=useState<EntityType>("concept")
  const [source,setSource]=useState("")
  const [target,setTarget]=useState("")
  const [predicate,setPredicate]=useState("")
  const [allowed,setAllowed]=useState<string[]>([])
  const reloadGraphs=useCallback(async()=>{if(!projectPath)return;const next=await listKnowledgeGraphs(projectPath);setGraphs(next);const id=next.some((g)=>g.graphId===selectedGraph)?selectedGraph:next[0]?.graphId??"";if(id!==selectedGraph)setSelectedGraph(id)},[projectPath,selectedGraph,setSelectedGraph])
  const reloadSnapshot=useCallback(async()=>{if(!projectPath||!selectedGraph){setSnapshot(null);return}try{setSnapshot(await getKnowledgeGraphSnapshot(projectPath,selectedGraph))}catch{setSnapshot(null)}},[projectPath,selectedGraph])
  useEffect(()=>{void reloadGraphs()},[projectPath])
  useEffect(()=>{void reloadSnapshot()},[reloadSnapshot])
  useEffect(()=>{const a=snapshot?.nodes.find((n)=>n.nodeId===source);const b=snapshot?.nodes.find((n)=>n.nodeId===target);if(!a||!b){setAllowed([]);return}void listAllowedRelationTypes(projectPath,selectedGraph,a.entity.entityId,b.entity.entityId).then((types)=>{setAllowed(types.map((t)=>t.name));setPredicate((old)=>types.some((t)=>t.name===old)?old:types[0]?.name??"")})},[projectPath,selectedGraph,snapshot,source,target])
  const canvas=useMemo(()=>snapshot?snapshotToCanvas(snapshot):{nodes:[],links:[]},[snapshot])
  const addNode=async()=>{if(!nodeName.trim()||!selectedGraph)return;await createOrLinkGraphNode(projectPath,{graphId:selectedGraph,canonicalName:nodeName.trim(),entityType:nodeType});setNodeName("");await reloadSnapshot()}
  const addEdge=async()=>{const a=snapshot?.nodes.find((n)=>n.nodeId===source);const b=snapshot?.nodes.find((n)=>n.nodeId===target);if(!a||!b||!predicate)return;await createManualAssertion(projectPath,{graphId:selectedGraph,subjectEntityId:a.entity.entityId,predicate,objectEntityId:b.entity.entityId});await reloadSnapshot()}
  const removeNode=async(node:SnapshotNode)=>{const impact=await getKnowledgeDeleteImpact(projectPath,{nodeId:node.nodeId});if(await confirm(`Remove projection “${node.entity.canonicalName}”? ${impact.assertionIds.length} related assertions remain attached to the entity.`)){await deleteGraphProjection(projectPath,node.nodeId);setSelectedNode(null);await reloadSnapshot()}}
  const removeEdge=async(assertionId:string)=>{const impact=await getKnowledgeDeleteImpact(projectPath,{assertionId});if(await confirm(`Delete assertion and ${impact.evidenceIds.length} evidence links?`)){await deleteAssertion(projectPath,assertionId);await reloadSnapshot()}}
  const reviewAssertion=async(assertionId:string,approve:boolean)=>{if(approve)await resolveCardinalityConflict(projectPath,assertionId);else await rejectReviewAssertion(projectPath,assertionId);await reloadSnapshot()}
  const openEvidence=async(pageId:string)=>{const page=await getKnowledgePage(projectPath,pageId);if(!page)return message("Evidence page no longer exists.",{kind:"warning"});const path=`${projectPath}/${page.pagePath}`;useWikiStore.getState().setSelectedFile(path);useWikiStore.getState().setFileContent(await readFile(path));useWikiStore.getState().setActiveView("wiki")}
  if(!projectPath)return <div className="p-4 text-sm text-muted-foreground">No project open.</div>
  return <div className="flex h-full flex-col"><div className="flex border-b">{(["knowledge","graphs","entity"] as Tab[]).map((item)=><button key={item} onClick={()=>setTab(item)} className={`px-4 py-2 text-sm ${tab===item?"border-b-2 border-primary":"text-muted-foreground"}`}>{item}</button>)}</div>
    {tab==="graphs"?<GraphsTab onPolicySaved={()=>void reloadGraphs()}/>:tab==="entity"?<EntityView/>:<div className="flex min-h-0 flex-1"><div className="flex min-w-0 flex-1 flex-col"><div className="flex flex-wrap gap-2 border-b p-2"><select value={selectedGraph} onChange={(e)=>setSelectedGraph(e.target.value)} className="rounded border px-2 text-xs">{graphs.map((g)=><option key={g.graphId} value={g.graphId}>{g.graphName}</option>)}</select><input value={nodeName} onChange={(e)=>setNodeName(e.target.value)} placeholder="New entity" className="rounded border px-2 text-xs"/><select value={nodeType} onChange={(e)=>setNodeType(e.target.value as EntityType)} className="rounded border text-xs">{ENTITY_TYPES.map((t)=><option key={t}>{t}</option>)}</select><Button size="sm" onClick={()=>void addNode()}>Add node</Button></div><div className="min-h-0 flex-1"><FalkorCanvas data={canvas} onNodeClick={(node)=>setSelectedNode(snapshot?.nodes.find((n)=>n.nodeId===(node.data?.nodeId??node.id))??null)} onLinkClick={(edge)=>void removeEdge(edge.data?.assertionId??edge.id)}/></div></div>
      <aside className="w-80 overflow-y-auto border-l p-3 text-xs"><div className="font-medium">Manual assertion</div><select value={source} onChange={(e)=>setSource(e.target.value)} className="mt-2 w-full rounded border"><option value="">Subject</option>{snapshot?.nodes.map((n)=><option key={n.nodeId} value={n.nodeId}>{n.entity.canonicalName}</option>)}</select><select value={target} onChange={(e)=>setTarget(e.target.value)} className="mt-1 w-full rounded border"><option value="">Object</option>{snapshot?.nodes.map((n)=><option key={n.nodeId} value={n.nodeId}>{n.entity.canonicalName}</option>)}</select><select value={predicate} onChange={(e)=>setPredicate(e.target.value)} className="mt-1 w-full rounded border"><option value="">Allowed predicate</option>{allowed.map((p)=><option key={p}>{p}</option>)}</select><Button size="sm" className="mt-2" onClick={()=>void addEdge()}>Add assertion</Button>{selectedNode&&<div className="mt-4 border-t pt-3"><div className="font-medium">{selectedNode.entity.canonicalName}</div><div className="font-mono text-[10px]">{selectedNode.nodeId}</div><Button variant="destructive" size="sm" className="mt-2" onClick={()=>void removeNode(selectedNode)}>Remove projection</Button></div>}<div className="mt-4 border-t pt-3"><div className="font-medium">Assertions</div>{snapshot?.assertions.map((a)=><div key={a.assertionId} className="mt-2 rounded border p-2"><div>{a.predicate} · {a.evidenceState} · {a.status}</div><div className="font-mono text-[10px]">{a.assertionId}</div>{a.evidence.filter((e)=>e.pageId).map((e)=><button key={e.evidenceId} onClick={()=>void openEvidence(e.pageId!)} className="block text-primary">Open evidence {e.evidenceId}</button>)}{a.status==="review"&&<div className="mt-1 flex gap-1"><button onClick={()=>void reviewAssertion(a.assertionId,true)} className="text-emerald-600">Approve</button><button onClick={()=>void reviewAssertion(a.assertionId,false)} className="text-destructive">Reject</button></div>}</div>)}</div></aside></div>}
  </div>
}
