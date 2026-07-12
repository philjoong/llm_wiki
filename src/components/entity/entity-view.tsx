import { useEffect, useMemo, useState } from "react"
import { confirm, message } from "@tauri-apps/plugin-dialog"
import { useWikiStore } from "@/stores/wiki-store"
import {
  addKnowledgeEntityAlias,
  createOrLinkEntity,
  deleteKnowledgeEntity,
  getKnowledgeDeleteImpact,
  listKnowledgeEntities,
  mergeKnowledgeEntities,
  removeKnowledgeEntityAlias,
  renameKnowledgeEntity,
  splitKnowledgeEntity,
  type EntityDetail,
} from "@/commands/knowledge"
import { ENTITY_TYPES, type EntityType } from "@/lib/knowledge/vocabularies"

export function EntityView() {
  const projectPath = useWikiStore((s) => s.project?.path ?? "")
  const [entities, setEntities] = useState<EntityDetail[]>([])
  const [search, setSearch] = useState("")
  const [newName, setNewName] = useState("")
  const [newType, setNewType] = useState<EntityType>("concept")
  const [editing, setEditing] = useState<string | null>(null)
  const [value, setValue] = useState("")
  const [alias, setAlias] = useState("")
  const reload = async () => { if (projectPath) setEntities(await listKnowledgeEntities(projectPath)) }
  useEffect(() => { void reload() }, [projectPath])
  const filtered = useMemo(() => { const q=search.trim().toLocaleLowerCase();return q ? entities.filter((e)=>e.canonicalName.toLocaleLowerCase().includes(q)||e.aliases.some((a)=>a.toLocaleLowerCase().includes(q))) : entities },[entities,search])
  if (!projectPath) return <div className="p-3 text-xs text-muted-foreground">No project open.</div>

  const add = async () => { if (!newName.trim()) return;await createOrLinkEntity(projectPath,{canonicalName:newName.trim(),entityType:newType});setNewName("");await reload() }
  const rename = async (entity:EntityDetail) => { if(value.trim()&&value.trim()!==entity.canonicalName) await renameKnowledgeEntity(projectPath,entity.entityId,value.trim());setEditing(null);await reload() }
  const remove = async (entity:EntityDetail) => { const impact=await getKnowledgeDeleteImpact(projectPath,{entityId:entity.entityId});const ok=await confirm(`Delete “${entity.canonicalName}”?\n${impact.nodeIds.length} projections, ${impact.assertionIds.length} assertions and ${impact.pageIds.length} referenced pages are affected.`);if(ok){await deleteKnowledgeEntity(projectPath,entity.entityId);await reload()} }
  const merge = async (source:EntityDetail) => { const target=entities.find((e)=>e.entityId===value);if(!target){await message("Choose a target entity ID.",{kind:"warning"});return}if(await confirm(`Merge “${source.canonicalName}” into “${target.canonicalName}”?`)){await mergeKnowledgeEntities(projectPath,source.entityId,target.entityId);setEditing(null);await reload()} }
  const split = async (source:EntityDetail) => { const parts=value.split("|");const name=parts[0]?.trim();const nodeIds=(parts[1]??"").split(",").map((v)=>v.trim()).filter(Boolean);if(!name||!nodeIds.length){await message("Use: New name | node-id-1,node-id-2",{kind:"warning"});return}await splitKnowledgeEntity(projectPath,source.entityId,name,nodeIds);setEditing(null);await reload() }

  return <div className="flex h-full flex-col overflow-hidden">
    <div className="flex gap-2 border-b p-2"><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search entities" className="flex-1 rounded border px-2 text-xs"/><input value={newName} onChange={(e)=>setNewName(e.target.value)} placeholder="Canonical name" className="rounded border px-2 text-xs"/><select value={newType} onChange={(e)=>setNewType(e.target.value as EntityType)} className="rounded border text-xs">{ENTITY_TYPES.map((t)=><option key={t}>{t}</option>)}</select><button onClick={()=>void add()} className="text-xs">+ Add</button></div>
    <div className="flex-1 overflow-y-auto">{filtered.map((entity)=><div key={entity.entityId} className="border-b p-3 text-xs"><div className="flex items-start gap-2"><div className="flex-1"><div className="font-medium">{entity.canonicalName} <span className="text-muted-foreground">({entity.entityType})</span></div><div className="font-mono text-[10px] text-muted-foreground">{entity.entityId}</div><div className="text-muted-foreground">Aliases: {entity.aliases.join(", ")||"—"} · Projections: {entity.nodeIds.length}</div></div><button onClick={()=>{setEditing(entity.entityId);setValue(entity.canonicalName);setAlias("")}}>Edit</button><button className="text-destructive" onClick={()=>void remove(entity)}>Delete</button></div>
      {editing===entity.entityId&&<div className="mt-2 space-y-2 rounded border p-2"><div className="flex gap-1"><input value={value} onChange={(e)=>setValue(e.target.value)} className="flex-1 rounded border px-1"/><button onClick={()=>void rename(entity)}>Rename</button><button onClick={()=>void merge(entity)}>Merge by ID</button><button onClick={()=>void split(entity)}>Split</button></div><div className="flex gap-1"><input value={alias} onChange={(e)=>setAlias(e.target.value)} placeholder="New alias" className="flex-1 rounded border px-1"/><button onClick={()=>void addKnowledgeEntityAlias(projectPath,entity.entityId,alias).then(reload)}>Add alias</button></div>{entity.aliases.map((a)=><button key={a} onClick={()=>void removeKnowledgeEntityAlias(projectPath,entity.entityId,a).then(reload)} className="mr-1 rounded bg-muted px-1">{a} ×</button>)}<div className="text-[10px] text-muted-foreground">Merge: enter target entity ID. Split: enter “New name | node-id-1,node-id-2”.</div></div>}
    </div>)}</div>
  </div>
}
