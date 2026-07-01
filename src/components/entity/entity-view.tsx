import { useEffect, useMemo, useState } from "react"
import { confirm } from "@tauri-apps/plugin-dialog"
import { useWikiStore } from "@/stores/wiki-store"
import { getGraphBackend } from "@/lib/graph-backend"
import {
  loadEntityDict,
  saveEntityDict,
  upsertEntity,
  renameEntity,
  addAlias,
  removeAlias,
  mergeEntities,
  splitEntity,
  findCandidates,
  type EntityDict,
  type EntityEntry,
  type EntityGraphNodeRef,
} from "@/lib/entity-dict"

export function EntityView() {
  const project = useWikiStore((s) => s.project)
  const projectPath = project?.path ?? ""
  const projectName = project?.name ?? ""

  const [dict, setDict] = useState<EntityDict>({})
  const [loaded, setLoaded] = useState(false)
  const [search, setSearch] = useState("")

  const [addingEntity, setAddingEntity] = useState(false)
  const [newEntityName, setNewEntityName] = useState("")

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState("")
  const [newAlias, setNewAlias] = useState("")

  const [mergingId, setMergingId] = useState<string | null>(null)
  const [mergeSearch, setMergeSearch] = useState("")

  const [splittingId, setSplittingId] = useState<string | null>(null)
  const [splitSelection, setSplitSelection] = useState<Set<string>>(new Set())
  const [splitName, setSplitName] = useState("")

  useEffect(() => {
    if (!projectPath) return
    loadEntityDict(projectPath).then((d) => {
      setDict(d)
      setLoaded(true)
    })
  }, [projectPath])

  async function persist(next: EntityDict) {
    setDict(next)
    await saveEntityDict(projectPath, next)
  }

  const entries = useMemo(() => Object.values(dict), [dict])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return entries
    return entries.filter(
      (e) => e.canonicalName.toLowerCase().includes(q) || e.aliases.some((a) => a.toLowerCase().includes(q)),
    )
  }, [entries, search])

  if (!projectPath) {
    return <div className="p-3 text-xs text-muted-foreground">No project open.</div>
  }
  if (!loaded) {
    return <div className="p-3 text-xs text-muted-foreground">Loading…</div>
  }

  // ── New entity ─────────────────────────────────────────────────────────────

  async function handleAddEntity() {
    const name = newEntityName.trim()
    if (!name) return
    const next = upsertEntity({ canonicalName: name }, dict)
    await persist(next)
    setAddingEntity(false)
    setNewEntityName("")
  }

  // ── Edit (rename / alias) ────────────────────────────────────────────────

  function startEdit(entry: EntityEntry) {
    setEditingId(entry.id)
    setEditName(entry.canonicalName)
    setNewAlias("")
  }

  async function handleRename(entry: EntityEntry) {
    const name = editName.trim()
    if (!name || name === entry.canonicalName) return
    const next = renameEntity(entry.id, name, dict)
    const backend = await getGraphBackend(projectPath)
    for (const ref of entry.graphNodes) {
      try {
        await backend.updateNodeName(projectName, ref.graphName, ref.nodeId, name)
      } catch { /* best-effort */ }
    }
    await persist(next)
  }

  async function handleAddAlias(entry: EntityEntry) {
    const alias = newAlias.trim()
    if (!alias) return
    await persist(addAlias(entry.id, alias, dict))
    setNewAlias("")
  }

  async function handleRemoveAlias(entry: EntityEntry, alias: string) {
    await persist(removeAlias(entry.id, alias, dict))
  }

  async function handleDeleteEntity(entry: EntityEntry) {
    const ok = await confirm(`엔티티 "${entry.canonicalName}"을 사전에서 삭제하시겠습니까?\n연결된 그래프 노드는 삭제되지 않습니다.`)
    if (!ok) return
    const next = { ...dict }
    delete next[entry.id]
    await persist(next)
  }

  // ── Merge ──────────────────────────────────────────────────────────────────

  const mergeCandidates = useMemo(() => {
    if (!mergingId) return []
    const q = mergeSearch.trim()
    const pool = entries.filter((e) => e.id !== mergingId)
    if (!q) return pool
    return findCandidates(q, dict)
      .map((c) => c.entry)
      .filter((e) => e.id !== mergingId)
  }, [mergingId, mergeSearch, entries, dict])

  async function handleMerge(targetId: string) {
    if (!mergingId) return
    const next = await mergeEntities(mergingId, targetId, dict, projectPath, projectName)
    await persist(next)
    setMergingId(null)
    setMergeSearch("")
  }

  // ── Split ──────────────────────────────────────────────────────────────────

  function startSplit(entry: EntityEntry) {
    setSplittingId(entry.id)
    setSplitSelection(new Set())
    setSplitName("")
  }

  function toggleSplitRef(ref: EntityGraphNodeRef) {
    const key = `${ref.graphName}::${ref.nodeId}`
    setSplitSelection((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  async function handleSplit(entry: EntityEntry) {
    const name = splitName.trim()
    if (!name || splitSelection.size === 0) return
    const refs = entry.graphNodes.filter((ref) => splitSelection.has(`${ref.graphName}::${ref.nodeId}`))
    const next = splitEntity(entry.id, name, refs, dict)
    await persist(next)
    setSplittingId(null)
    setSplitSelection(new Set())
    setSplitName("")
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="검색"
          className="flex-1 rounded border bg-background px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <button
          onClick={() => { setAddingEntity(true); setNewEntityName("") }}
          className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
        >
          + 신규 엔티티
        </button>
      </div>

      {addingEntity && (
        <div className="flex shrink-0 items-center gap-1 border-b px-3 py-1.5">
          <input
            autoFocus
            value={newEntityName}
            onChange={(e) => setNewEntityName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { void handleAddEntity() }
              if (e.key === "Escape") setAddingEntity(false)
            }}
            placeholder="canonicalName"
            className="flex-1 rounded border bg-background px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button onClick={() => { void handleAddEntity() }} className="text-xs text-muted-foreground hover:text-foreground">OK</button>
          <button onClick={() => setAddingEntity(false)} className="text-xs text-muted-foreground hover:text-foreground">✕</button>
        </div>
      )}

      {/* Entity list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="p-3 text-xs text-muted-foreground">No entities.</div>
        )}
        {filtered.map((entry) => {
          const isEditing = editingId === entry.id
          const isMerging = mergingId === entry.id
          const isSplitting = splittingId === entry.id
          const nodeCount = entry.graphNodes.length
          const graphCount = new Set(entry.graphNodes.map((r) => r.graphName)).size

          return (
            <div key={entry.id} className="border-b px-3 py-2 last:border-b-0">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm font-medium">{entry.canonicalName}</div>
                  <div className="text-xs text-muted-foreground">
                    연결 그래프: {graphCount} / 노드: {nodeCount}
                  </div>
                  {entry.aliases.length > 0 && (
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      별칭: {entry.aliases.join(", ")}
                    </div>
                  )}
                  {entry.pagePaths.length > 0 && (
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      문서: {entry.pagePaths[0]}{entry.pagePaths.length > 1 ? ` 외 ${entry.pagePaths.length - 1}` : ""}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button onClick={() => startEdit(entry)} className="text-xs text-muted-foreground hover:text-foreground">편집</button>
                  <button onClick={() => { setMergingId(entry.id); setMergeSearch("") }} className="text-xs text-muted-foreground hover:text-foreground">병합</button>
                  <button onClick={() => startSplit(entry)} className="text-xs text-muted-foreground hover:text-foreground">분리</button>
                  <button onClick={() => { void handleDeleteEntity(entry) }} className="text-xs text-muted-foreground hover:text-destructive">삭제</button>
                </div>
              </div>

              {/* Edit panel */}
              {isEditing && (
                <div className="mt-2 space-y-2 rounded border bg-muted/30 p-2">
                  <div>
                    <label className="mb-1 block text-[10px] font-bold uppercase text-muted-foreground">canonicalName</label>
                    <div className="flex items-center gap-1">
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="flex-1 rounded border bg-background px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <button onClick={() => { void handleRename(entry) }} className="text-xs text-muted-foreground hover:text-foreground">저장</button>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-bold uppercase text-muted-foreground">aliases</label>
                    <div className="flex flex-wrap gap-1">
                      {entry.aliases.map((a) => (
                        <span key={a} className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs">
                          {a}
                          <button onClick={() => { void handleRemoveAlias(entry, a) }} className="text-muted-foreground hover:text-destructive">✕</button>
                        </span>
                      ))}
                    </div>
                    <div className="mt-1 flex items-center gap-1">
                      <input
                        value={newAlias}
                        onChange={(e) => setNewAlias(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { void handleAddAlias(entry) } }}
                        placeholder="+ alias 추가"
                        className="flex-1 rounded border bg-background px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <button onClick={() => { void handleAddAlias(entry) }} className="text-xs text-muted-foreground hover:text-foreground">추가</button>
                    </div>
                  </div>
                  {entry.graphNodes.length > 0 && (
                    <div>
                      <label className="mb-1 block text-[10px] font-bold uppercase text-muted-foreground">연결 노드</label>
                      <div className="space-y-0.5 text-xs text-muted-foreground">
                        {entry.graphNodes.map((ref, i) => (
                          <div key={i}>{ref.graphName} #{ref.nodeId}{ref.pagePath ? ` (${ref.pagePath})` : ""}</div>
                        ))}
                      </div>
                    </div>
                  )}
                  <button onClick={() => setEditingId(null)} className="text-xs text-muted-foreground hover:text-foreground">닫기</button>
                </div>
              )}

              {/* Merge panel */}
              {isMerging && (
                <div className="mt-2 space-y-2 rounded border bg-muted/30 p-2">
                  <div className="text-xs text-muted-foreground">"{entry.canonicalName}"을 다른 엔티티에 병합합니다.</div>
                  <input
                    value={mergeSearch}
                    onChange={(e) => setMergeSearch(e.target.value)}
                    placeholder="병합 대상 검색"
                    className="w-full rounded border bg-background px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <div className="max-h-32 space-y-1 overflow-y-auto">
                    {mergeCandidates.map((cand) => (
                      <div key={cand.id} className="flex items-center justify-between gap-2 rounded px-1.5 py-1 hover:bg-muted/50">
                        <span className="truncate text-xs">{cand.canonicalName} (노드: {cand.graphNodes.length})</span>
                        <button onClick={() => { void handleMerge(cand.id) }} className="shrink-0 text-xs text-muted-foreground hover:text-foreground">흡수</button>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setMergingId(null)} className="text-xs text-muted-foreground hover:text-foreground">취소</button>
                </div>
              )}

              {/* Split panel */}
              {isSplitting && (
                <div className="mt-2 space-y-2 rounded border bg-muted/30 p-2">
                  <div className="text-xs text-muted-foreground">"{entry.canonicalName}"에서 일부 그래프를 분리합니다.</div>
                  <div className="space-y-1">
                    {entry.graphNodes.map((ref, i) => {
                      const key = `${ref.graphName}::${ref.nodeId}`
                      return (
                        <label key={i} className="flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={splitSelection.has(key)}
                            onChange={() => toggleSplitRef(ref)}
                          />
                          {ref.graphName} #{ref.nodeId}{ref.pagePath ? ` (${ref.pagePath})` : ""}
                        </label>
                      )
                    })}
                  </div>
                  <input
                    value={splitName}
                    onChange={(e) => setSplitName(e.target.value)}
                    placeholder="새 엔티티 이름"
                    className="w-full rounded border bg-background px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <div className="flex items-center gap-2">
                    <button onClick={() => { void handleSplit(entry) }} className="text-xs text-muted-foreground hover:text-foreground">분리 생성</button>
                    <button onClick={() => setSplittingId(null)} className="text-xs text-muted-foreground hover:text-foreground">취소</button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
