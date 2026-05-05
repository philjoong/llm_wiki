/**
 * Stage 5 — pending-view tab inside ReviewView.
 *
 * Lists every entry under `pending/<slug>.md` (top-level only — the
 * `pending/_proposals/` drafts are still mid-flight Stage 4 modification
 * cards and don't belong here). Each row exposes Re-review / Promote /
 * Discard.
 */
import { useCallback, useEffect, useState } from "react"
import { Inbox, RefreshCcw, FileUp, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useWikiStore } from "@/stores/wiki-store"
import { listDirectory } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import {
  loadPendingItems,
  discardPending,
  promotePending,
  reReviewPending,
  type PendingItem,
} from "@/lib/pending-resolve"

export function PendingView() {
  const project = useWikiStore((s) => s.project)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const dataVersion = useWikiStore((s) => s.dataVersion)
  const [items, setItems] = useState<PendingItem[]>([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!project) {
      setItems([])
      return
    }
    setLoading(true)
    try {
      const next = await loadPendingItems(normalizePath(project.path))
      setItems(next)
    } finally {
      setLoading(false)
    }
  }, [project])

  useEffect(() => {
    void refresh()
  }, [refresh, dataVersion])

  const runAction = useCallback(
    async (
      item: PendingItem,
      fn: (pp: string, item: PendingItem) => Promise<void>,
    ) => {
      if (!project) return
      const pp = normalizePath(project.path)
      setBusyId(item.path)
      try {
        await fn(pp, item)
        try {
          const tree = await listDirectory(pp)
          setFileTree(tree)
          useWikiStore.getState().bumpDataVersion()
        } catch {
          // tree refresh is best-effort
        }
        await refresh()
      } catch (err) {
        console.error("[pending-view] action failed:", err)
        window.alert(
          `Action failed: ${err instanceof Error ? err.message : String(err)}`,
        )
      } finally {
        setBusyId(null)
      }
    },
    [project, refresh, setFileTree],
  )

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No project open.
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
            <Inbox className="h-8 w-8 text-muted-foreground/30" />
            <p>{loading ? "Loading…" : "No pending entries."}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2 p-3">
            {items.map((item) => (
              <PendingCard
                key={item.path}
                item={item}
                busy={busyId === item.path}
                onReReview={() => runAction(item, reReviewPending)}
                onPromote={() => runAction(item, promotePending)}
                onDiscard={() => runAction(item, discardPending)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function PendingCard({
  item,
  busy,
  onReReview,
  onPromote,
  onDiscard,
}: {
  item: PendingItem
  busy: boolean
  onReReview: () => void
  onPromote: () => void
  onDiscard: () => void
}) {
  return (
    <div className="rounded-lg border p-3 text-sm">
      <div className="mb-1 flex items-center gap-2">
        <Inbox className="h-4 w-4 shrink-0 text-amber-500" />
        <span className="font-medium">{item.title}</span>
      </div>
      <div className="mb-2 text-xs text-muted-foreground">
        <code className="break-all">{item.path}</code>
        {" → "}
        <code className="break-all">
          {item.targetPath}
          {!item.targetExists && " (target not found)"}
        </code>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button
          variant="default"
          size="sm"
          className="h-7 gap-1 text-xs"
          disabled={busy}
          onClick={onReReview}
        >
          <RefreshCcw className="h-3 w-3" />
          Re-review
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs"
          disabled={busy}
          onClick={onPromote}
        >
          <FileUp className="h-3 w-3" />
          Promote to db/
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs"
          disabled={busy}
          onClick={onDiscard}
        >
          <Trash2 className="h-3 w-3" />
          Discard
        </Button>
      </div>
    </div>
  )
}
