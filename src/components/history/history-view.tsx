import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Clock, RotateCcw, Undo2, Network } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useWikiStore } from "@/stores/wiki-store"
import { normalizePath } from "@/lib/path-utils"
import { listDirectory } from "@/commands/fs"
import {
  loadCommitPage,
  loadCommitDetail,
  loadFileDiff,
  restoreFileFromCommit,
  revertCommit,
} from "@/lib/git-history"
import type { CommitInfo, CommitDetail, FileChange } from "@/commands/git"

export function HistoryView() {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const bumpDataVersion = useWikiStore((s) => s.bumpDataVersion)

  const projectPath = useMemo(
    () => (project ? normalizePath(project.path) : ""),
    [project],
  )

  const [commits, setCommits] = useState<CommitInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [selectedHash, setSelectedHash] = useState<string | null>(null)
  const [detail, setDetail] = useState<CommitDetail | null>(null)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [diffText, setDiffText] = useState<string>("")
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // Initial page load when the project changes.
  useEffect(() => {
    if (!projectPath) {
      setCommits([])
      setSelectedHash(null)
      setDetail(null)
      setHasMore(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setActionError(null)
    loadCommitPage(projectPath, null)
      .then((page) => {
        if (cancelled) return
        setCommits(page)
        setHasMore(page.length > 0)
        // Auto-select newest commit so the right panel isn't empty.
        if (page.length > 0) setSelectedHash(page[0].hash)
      })
      .catch((err) => {
        if (cancelled) return
        setActionError(String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectPath])

  // Load detail when a commit is selected.
  useEffect(() => {
    if (!projectPath || !selectedHash) {
      setDetail(null)
      setSelectedFile(null)
      setDiffText("")
      return
    }
    let cancelled = false
    loadCommitDetail(projectPath, selectedHash)
      .then((d) => {
        if (cancelled) return
        setDetail(d)
        // Reset file selection — caller can re-pick if relevant.
        setSelectedFile(null)
        setDiffText("")
      })
      .catch((err) => {
        if (cancelled) return
        setActionError(String(err))
      })
    return () => {
      cancelled = true
    }
  }, [projectPath, selectedHash])

  // Load diff when a file is picked inside the selected commit.
  useEffect(() => {
    if (!projectPath || !selectedHash || !selectedFile) {
      setDiffText("")
      return
    }
    let cancelled = false
    loadFileDiff(projectPath, selectedHash, selectedFile)
      .then((d) => {
        if (!cancelled) setDiffText(d)
      })
      .catch((err) => {
        if (!cancelled) setActionError(String(err))
      })
    return () => {
      cancelled = true
    }
  }, [projectPath, selectedHash, selectedFile])

  const handleLoadMore = useCallback(async () => {
    if (!projectPath || commits.length === 0) return
    setLoading(true)
    try {
      const cursor = commits[commits.length - 1].hash
      const next = await loadCommitPage(projectPath, cursor)
      if (next.length === 0) {
        setHasMore(false)
      } else {
        setCommits((prev) => [...prev, ...next])
      }
    } catch (err) {
      setActionError(String(err))
    } finally {
      setLoading(false)
    }
  }, [projectPath, commits])

  const refreshAfterAction = useCallback(async () => {
    if (!projectPath) return
    // Reload the first page so the new commit shows at the top.
    const page = await loadCommitPage(projectPath, null)
    setCommits(page)
    if (page.length > 0) setSelectedHash(page[0].hash)
    // Refresh the file tree because restoration may have changed contents.
    try {
      const tree = await listDirectory(projectPath)
      setFileTree(tree)
    } catch {
      // Ignore — tree refresh is best-effort.
    }
    bumpDataVersion()
  }, [projectPath, setFileTree, bumpDataVersion])

  const handleRestoreFile = useCallback(
    async (hash: string, path: string) => {
      if (!projectPath) return
      setBusyAction(`restore:${hash}:${path}`)
      setActionError(null)
      try {
        await restoreFileFromCommit(projectPath, hash, path)
        await refreshAfterAction()
      } catch (err) {
        setActionError(t("history.actionFailed", { error: String(err) }))
      } finally {
        setBusyAction(null)
      }
    },
    [projectPath, refreshAfterAction, t],
  )

  const handleRevertCommit = useCallback(
    async (hash: string) => {
      if (!projectPath) return
      setBusyAction(`revert:${hash}`)
      setActionError(null)
      try {
        const res = await revertCommit(projectPath, hash)
        if (res.conflicts.length > 0) {
          // Surface conflict info to the user without destructive recovery.
          setActionError(
            t("history.conflictBody", { files: res.conflicts.join("\n") }),
          )
        } else {
          await refreshAfterAction()
        }
      } catch (err) {
        setActionError(t("history.actionFailed", { error: String(err) }))
      } finally {
        setBusyAction(null)
      }
    },
    [projectPath, refreshAfterAction, t],
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Clock className="h-4 w-4" />
          {t("history.title")}
        </div>
      </div>
      {actionError && (
        <div className="border-b bg-destructive/10 px-4 py-2 text-xs text-destructive whitespace-pre-wrap">
          {actionError}
        </div>
      )}
      <div className="flex flex-1 overflow-hidden">
        <CommitList
          commits={commits}
          selectedHash={selectedHash}
          onSelect={setSelectedHash}
          onLoadMore={handleLoadMore}
          hasMore={hasMore}
          loading={loading}
          emptyText={t("history.empty")}
          loadingText={t("history.loading")}
          loadMoreText={t("history.loadMore")}
        />
        <CommitDetailPanel
          detail={detail}
          selectedFile={selectedFile}
          onSelectFile={setSelectedFile}
          diffText={diffText}
          onRestoreFile={handleRestoreFile}
          onRevertCommit={handleRevertCommit}
          busyAction={busyAction}
          t={t}
        />
      </div>
    </div>
  )
}

interface CommitListProps {
  commits: CommitInfo[]
  selectedHash: string | null
  onSelect: (hash: string) => void
  onLoadMore: () => void
  hasMore: boolean
  loading: boolean
  emptyText: string
  loadingText: string
  loadMoreText: string
}

function CommitList({
  commits,
  selectedHash,
  onSelect,
  onLoadMore,
  hasMore,
  loading,
  emptyText,
  loadingText,
  loadMoreText,
}: CommitListProps) {
  const { t } = useTranslation()
  if (commits.length === 0) {
    return (
      <div className="flex w-72 flex-col items-center justify-center border-r p-6 text-sm text-muted-foreground">
        {loading ? loadingText : emptyText}
      </div>
    )
  }
  return (
    <div className="flex w-72 flex-col overflow-y-auto border-r">
      <ul className="flex flex-col">
        {commits.map((c) => {
          const isSelected = c.hash === selectedHash
          const subject = c.message.split("\n")[0]
          const isGraphRelated = /^graph[_:]|graph.db|graph.policy|managed.graph/i.test(subject)
          return (
            <li key={c.hash}>
              <button
                type="button"
                onClick={() => onSelect(c.hash)}
                className={`flex w-full flex-col items-start gap-0.5 border-b px-3 py-2 text-left text-sm transition-colors ${
                  isSelected
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50"
                }`}
              >
                <div className="flex items-center gap-1.5 w-full min-w-0">
                  {isGraphRelated && (
                    <Network className="h-3 w-3 shrink-0 text-blue-500" title="Graph-related commit" />
                  )}
                  <span className="line-clamp-2 font-medium min-w-0">{subject}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {c.author} · {formatRelative(c.date, t)}
                </span>
                <span className="text-[10px] text-muted-foreground/70 font-mono">
                  {c.hash.slice(0, 7)}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {hasMore && (
        <div className="border-t p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs"
            onClick={onLoadMore}
            disabled={loading}
          >
            {loading ? loadingText : loadMoreText}
          </Button>
        </div>
      )}
    </div>
  )
}

interface CommitDetailPanelProps {
  detail: CommitDetail | null
  selectedFile: string | null
  onSelectFile: (path: string) => void
  diffText: string
  onRestoreFile: (hash: string, path: string) => void
  onRevertCommit: (hash: string) => void
  busyAction: string | null
  t: (key: string, opts?: Record<string, unknown>) => string
}

function CommitDetailPanel({
  detail,
  selectedFile,
  onSelectFile,
  diffText,
  onRestoreFile,
  onRevertCommit,
  busyAction,
  t,
}: CommitDetailPanelProps) {
  if (!detail) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {t("history.selectCommit")}
      </div>
    )
  }
  const revertBusy = busyAction === `revert:${detail.hash}`
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Commit header */}
      <div className="border-b px-4 py-3">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold whitespace-pre-wrap break-words">
              {detail.message}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {detail.author} · {detail.date}
            </div>
            <div className="mt-0.5 text-[10px] font-mono text-muted-foreground/70">
              {detail.hash}
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={revertBusy}
            onClick={() => onRevertCommit(detail.hash)}
          >
            <Undo2 className="mr-1 h-3 w-3" />
            {revertBusy ? t("history.reverting") : t("history.revertCommit")}
          </Button>
        </div>
      </div>
      <div className="flex flex-1 overflow-hidden">
        {/* File list */}
        <FileList
          files={detail.files}
          selectedFile={selectedFile}
          onSelectFile={onSelectFile}
          onRestore={(path) => onRestoreFile(detail.hash, path)}
          busyAction={busyAction}
          hash={detail.hash}
          t={t}
        />
        {/* Diff */}
        <div className="flex-1 overflow-y-auto bg-muted/30">
          {selectedFile ? (
            <pre className="whitespace-pre-wrap p-3 font-mono text-xs">
              {diffText}
            </pre>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {t("history.noFileSelected")}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

interface FileListProps {
  files: FileChange[]
  selectedFile: string | null
  onSelectFile: (path: string) => void
  onRestore: (path: string) => void
  busyAction: string | null
  hash: string
  t: (key: string, opts?: Record<string, unknown>) => string
}

function FileList({
  files,
  selectedFile,
  onSelectFile,
  onRestore,
  busyAction,
  hash,
  t,
}: FileListProps) {
  return (
    <div className="flex w-72 flex-col overflow-y-auto border-r">
      <div className="border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t("history.filesChanged")} ({files.length})
      </div>
      <ul className="flex flex-col">
        {files.map((f) => {
          const isSelected = f.path === selectedFile
          const restoreKey = `restore:${hash}:${f.path}`
          const restoring = busyAction === restoreKey
          return (
            <li key={f.path} className={`border-b ${isSelected ? "bg-accent/40" : ""}`}>
              <button
                type="button"
                onClick={() => onSelectFile(f.path)}
                className="flex w-full items-start gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-accent/30"
              >
                <span
                  className={`mt-0.5 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-[10px] font-bold ${statusColor(
                    f.status,
                  )}`}
                >
                  {f.status}
                </span>
                <span className="min-w-0 flex-1 break-all">{f.path}</span>
                <span className="flex-shrink-0 text-[10px] text-muted-foreground">
                  +{f.additions} −{f.deletions}
                </span>
              </button>
              <div className="px-3 pb-2">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-full justify-start text-[11px]"
                  disabled={restoring}
                  onClick={() => onRestore(f.path)}
                >
                  <RotateCcw className="mr-1 h-3 w-3" />
                  {restoring ? t("history.restoring") : t("history.restoreFile")}
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function statusColor(status: string): string {
  switch (status) {
    case "A":
      return "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
    case "M":
      return "bg-amber-500/20 text-amber-700 dark:text-amber-300"
    case "D":
      return "bg-rose-500/20 text-rose-700 dark:text-rose-300"
    default:
      return "bg-muted text-muted-foreground"
  }
}

/** Translated relative-time formatter (mirrors about-section helper). */
function formatRelative(iso: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return iso
  const delta = Date.now() - ts
  if (delta < 0) return t("time.justNow", { defaultValue: "just now" })
  const mins = Math.floor(delta / 60_000)
  if (mins < 1) return t("time.justNow", { defaultValue: "just now" })
  if (mins < 60) return t("time.minutesAgo", { count: mins, defaultValue: `${mins} min ago` })
  const hours = Math.floor(mins / 60)
  if (hours < 24) return t("time.hoursAgo", { count: hours, defaultValue: `${hours} h ago` })
  const days = Math.floor(hours / 24)
  return t("time.daysAgo", { count: days, defaultValue: `${days} d ago` })
}
