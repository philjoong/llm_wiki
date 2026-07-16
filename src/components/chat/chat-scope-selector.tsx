import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Filter, ChevronDown } from "lucide-react"
import { listKnowledgeGraphs, listKnowledgePages, listKnowledgeEntities } from "@/commands/knowledge"
import { isUserVisibleGraph } from "@/lib/knowledge/types"

/** Answer-scope selection kept per conversation (Step 07). Empty arrays mean
 * "no restriction" — retrieval falls back to prior whole-graph behavior. */
export interface ChatScopeSelection {
  graphIds: string[]
  pageIds: string[]
  entityIds: string[]
}

export const EMPTY_SCOPE: ChatScopeSelection = { graphIds: [], pageIds: [], entityIds: [] }

interface Option { id: string; label: string }

/**
 * Scope selector shown only when the active question type declares
 * `retrieval.scope === "selectable"` (Step 04 flag) — the parent gates
 * rendering, so there is no question-type id hardcoding here. Multi-select
 * across graphs (system unit) and pages/entities (content unit).
 */
export function ChatScopeSelector({
  projectPath,
  value,
  onChange,
  disabled,
}: {
  projectPath: string
  value: ChatScopeSelection
  onChange: (next: ChatScopeSelection) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [graphs, setGraphs] = useState<Option[]>([])
  const [pages, setPages] = useState<Option[]>([])
  const [entities, setEntities] = useState<Option[]>([])
  const rootRef = useRef<HTMLDivElement>(null)

  // Load candidate options once the picker is first opened, so an unused
  // selector never queries the DB.
  useEffect(() => {
    if (!open || graphs.length + pages.length + entities.length > 0) return
    let cancelled = false
    Promise.all([listKnowledgeGraphs(projectPath), listKnowledgePages(projectPath), listKnowledgeEntities(projectPath)])
      .then(([g, p, e]) => {
        if (cancelled) return
        setGraphs(g.filter(isUserVisibleGraph).map((x) => ({ id: x.graphId, label: x.graphName })))
        setPages(p.map((x) => ({ id: x.pageId, label: x.title || x.pagePath })))
        setEntities(e.map((x) => ({ id: x.entityId, label: x.canonicalName })))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [open, projectPath, graphs.length, pages.length, entities.length])

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    const onDoc = (ev: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(ev.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])

  const selectedCount = value.graphIds.length + value.pageIds.length + value.entityIds.length

  const toggle = (key: keyof ChatScopeSelection, id: string) => {
    const list = value[key]
    const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id]
    onChange({ ...value, [key]: next })
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        title={t("chat.scope.title")}
        className={`flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          selectedCount > 0
            ? "border-primary/40 bg-primary/10 text-primary"
            : "border-border bg-background text-muted-foreground"
        }`}
      >
        <Filter className="h-3 w-3" />
        {selectedCount > 0 ? t("chat.scope.selected", { count: selectedCount }) : t("chat.scope.all")}
        <ChevronDown className="h-3 w-3" />
      </button>

      {open && (
        <div className="absolute bottom-full right-0 z-20 mb-1 max-h-80 w-64 overflow-y-auto rounded-md border bg-popover p-2 text-xs shadow-md">
          <ScopeGroup title={t("chat.scope.graphs")} options={graphs} selected={value.graphIds} onToggle={(id) => toggle("graphIds", id)} />
          <ScopeGroup title={t("chat.scope.pages")} options={pages} selected={value.pageIds} onToggle={(id) => toggle("pageIds", id)} />
          <ScopeGroup title={t("chat.scope.entities")} options={entities} selected={value.entityIds} onToggle={(id) => toggle("entityIds", id)} />
          {selectedCount > 0 && (
            <button
              type="button"
              onClick={() => onChange(EMPTY_SCOPE)}
              className="mt-1 w-full rounded px-2 py-1 text-left text-muted-foreground hover:bg-accent"
            >
              {t("chat.scope.clear")}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function ScopeGroup({ title, options, selected, onToggle }: { title: string; options: Option[]; selected: string[]; onToggle: (id: string) => void }) {
  if (options.length === 0) return null
  return (
    <div className="mb-2 last:mb-0">
      <div className="px-1 py-0.5 font-medium text-muted-foreground">{title}</div>
      {options.map((opt) => (
        <label key={opt.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-accent">
          <input type="checkbox" checked={selected.includes(opt.id)} onChange={() => onToggle(opt.id)} className="h-3 w-3" />
          <span className="truncate" title={opt.label}>{opt.label}</span>
        </label>
      ))}
    </div>
  )
}
