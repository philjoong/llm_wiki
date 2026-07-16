import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { History, ChevronDown } from "lucide-react"
import type { CommitInfo } from "@/commands/git"
import { loadCommitPage } from "@/lib/git-history"

/** Comparison-point selection kept per conversation (Step 09). null means
 * "no selection" — Step 08's per-file default point (the most recent commit
 * where the file's content differs from the working tree) applies. */
export type HistoryPointSelection = CommitInfo | null

/** Relative time ("3 days ago" / "3일 전") in the UI language. */
function relativeTime(iso: string, lang: string): string {
  const diffMs = new Date(iso).getTime() - Date.now()
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" })
  const minutes = Math.round(diffMs / 60_000)
  if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute")
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return rtf.format(hours, "hour")
  const days = Math.round(hours / 24)
  if (Math.abs(days) < 30) return rtf.format(days, "day")
  const months = Math.round(days / 30)
  if (Math.abs(months) < 12) return rtf.format(months, "month")
  return rtf.format(Math.round(months / 12), "year")
}

function absoluteTime(iso: string, lang: string): string {
  return new Date(iso).toLocaleString(lang, { dateStyle: "medium", timeStyle: "short" })
}

/** Sync commits all share the same message ("sync: update knowledge
 * database"), so showing it adds nothing — the message is surfaced only
 * for non-sync commits (restore etc.) as secondary text. */
function isSyncCommit(commit: CommitInfo): boolean {
  return commit.message.startsWith("sync:")
}

/**
 * Comparison-point picker shown only when the active question type declares
 * `retrieval.include_history: true` (Step 04 flag) — the parent gates
 * rendering, so there is no question-type id hardcoding here. Candidates are
 * the REPO commit list (not per-file): at question time retrieval hasn't run
 * yet, so the target pages are unknown; the chosen commit is applied to
 * whichever files retrieval finds (Step 08 `git_show_file` path).
 * Dates are shown relative + absolute; hashes are hidden.
 */
export function ChatHistoryPicker({
  projectPath,
  value,
  onChange,
  disabled,
}: {
  projectPath: string
  value: HistoryPointSelection
  onChange: (next: HistoryPointSelection) => void
  disabled?: boolean
}) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const [commits, setCommits] = useState<CommitInfo[] | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  // Load the commit list once the picker is first opened, so an unused
  // picker never spawns git.
  useEffect(() => {
    if (!open || commits !== null) return
    let cancelled = false
    loadCommitPage(projectPath, null)
      .then((page) => { if (!cancelled) setCommits(page) })
      .catch(() => { if (!cancelled) setCommits([]) })
    return () => { cancelled = true }
  }, [open, projectPath, commits])

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    const onDoc = (ev: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(ev.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])

  const lang = i18n.language

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        title={t("chat.history.title")}
        className={`flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          value
            ? "border-primary/40 bg-primary/10 text-primary"
            : "border-border bg-background text-muted-foreground"
        }`}
      >
        <History className="h-3 w-3" />
        {value ? relativeTime(value.date, lang) : t("chat.history.default")}
        <ChevronDown className="h-3 w-3" />
      </button>

      {open && (
        <div className="absolute bottom-full right-0 z-20 mb-1 max-h-80 w-72 overflow-y-auto rounded-md border bg-popover p-2 text-xs shadow-md">
          <button
            type="button"
            onClick={() => { onChange(null); setOpen(false) }}
            className={`w-full rounded px-2 py-1 text-left hover:bg-accent ${value === null ? "text-primary" : ""}`}
          >
            <div className="font-medium">{t("chat.history.default")}</div>
            <div className="text-muted-foreground">{t("chat.history.defaultHint")}</div>
          </button>
          {commits === null ? (
            <div className="px-2 py-1 text-muted-foreground">…</div>
          ) : commits.length === 0 ? (
            <div className="px-2 py-1 text-muted-foreground">{t("chat.history.empty")}</div>
          ) : (
            commits.map((commit) => (
              <button
                key={commit.hash}
                type="button"
                onClick={() => { onChange(commit); setOpen(false) }}
                className={`w-full rounded px-2 py-1 text-left hover:bg-accent ${value?.hash === commit.hash ? "text-primary" : ""}`}
              >
                <div className="font-medium">
                  {relativeTime(commit.date, lang)}
                  <span className="ml-1 font-normal text-muted-foreground">{absoluteTime(commit.date, lang)}</span>
                </div>
                {!isSyncCommit(commit) && (
                  <div className="truncate text-muted-foreground" title={commit.message}>{commit.message}</div>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
