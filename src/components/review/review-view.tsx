import { useCallback, useState } from "react"
import {
  AlertTriangle,
  Copy,
  FileQuestion,
  CheckCircle2,
  GitMerge,
  Lightbulb,
  MessageSquare,
  X,
  Check,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useReviewStore, type ReviewItem } from "@/stores/review-store"
import { useWikiStore } from "@/stores/wiki-store"
import { writeFile, readFile, listDirectory, deleteFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import {
  approveModification,
  discardModification,
  pendingModification,
  counterexampleModification,
} from "@/lib/modification-resolve"
import { PendingView } from "@/components/review/pending-view"

const typeConfig: Record<ReviewItem["type"], { icon: typeof AlertTriangle; label: string; color: string }> = {
  contradiction: { icon: AlertTriangle, label: "Contradiction", color: "text-amber-500" },
  duplicate: { icon: Copy, label: "Possible Duplicate", color: "text-blue-500" },
  "missing-page": { icon: FileQuestion, label: "Missing Page", color: "text-purple-500" },
  confirm: { icon: MessageSquare, label: "Needs Confirmation", color: "text-foreground" },
  suggestion: { icon: Lightbulb, label: "Suggestion", color: "text-emerald-500" },
  modification: { icon: GitMerge, label: "Modification", color: "text-orange-500" },
}

export function ReviewView() {
  const items = useReviewStore((s) => s.items)
  const resolveItem = useReviewStore((s) => s.resolveItem)
  const transitionToRejectionHandling = useReviewStore((s) => s.transitionToRejectionHandling)
  const dismissItem = useReviewStore((s) => s.dismissItem)
  const clearResolved = useReviewStore((s) => s.clearResolved)
  const project = useWikiStore((s) => s.project)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const [tab, setTab] = useState<"reviews" | "pending">("reviews")

  const handleResolve = useCallback(async (id: string, action: string) => {
    const pp = project ? normalizePath(project.path) : ""

    // Stage 4 — modification flow. Hand off to the dedicated resolver
    // module (file moves + git commits) and refresh the file tree so
    // the sidebar reflects the new state of pending/_proposals/...
    const item = items.find((i) => i.id === id)
    if (item?.type === "modification" && project) {
      const proposal = item.proposal
      if (!proposal) {
        resolveItem(id, action)
        return
      }
      try {
        if (action === "modification:approve") {
          await approveModification(pp, proposal)
          resolveItem(id, "Approved")
        } else if (action === "modification:merge") {
          // Open the parked draft in the editor for hand-edit. The user
          // edits, saves, then re-clicks Approve from the same card —
          // the merge action itself doesn't move files or commit.
          const draftAbs = `${pp}/${proposal.incomingDraftPath}`
          try {
            const content = await readFile(draftAbs)
            useWikiStore.getState().setSelectedFile(draftAbs)
            useWikiStore.getState().setFileContent(content)
            useWikiStore.getState().setActiveView("wiki")
          } catch {
            // proposal file disappeared — fall through to no-op
          }
          return
        } else if (action === "modification:reject") {
          // Stage 1 → Stage 2 of the decision tree. No file effect.
          transitionToRejectionHandling(id)
          return
        } else if (action === "modification:discard") {
          await discardModification(pp, proposal)
          resolveItem(id, "Discarded")
        } else if (action === "modification:pending") {
          await pendingModification(pp, proposal)
          resolveItem(id, "Sent to pending")
        } else if (action === "modification:counterexample") {
          await counterexampleModification(pp, proposal)
          resolveItem(id, "Saved as counterexample")
        } else {
          resolveItem(id, action)
        }

        // Refresh file tree so pending/_proposals removal & new
        // pending/counterexamples files surface in the sidebar.
        try {
          const tree = await listDirectory(pp)
          setFileTree(tree)
          useWikiStore.getState().bumpDataVersion()
        } catch {
          // ignore
        }
      } catch (err) {
        console.error("[review] modification action failed:", err)
        resolveItem(id, `Failed: ${err instanceof Error ? err.message : String(err)}`)
      }
      return
    }

    if (action.startsWith("save:") && project) {
      // Decode and save the content to wiki
      try {
        const encoded = action.slice(5)
        const content = decodeURIComponent(atob(encoded))

        // Strip hidden comments
        const cleanContent = content
          .replace(/<!--\s*save-worthy:.*?-->/g, "")
          .replace(/<!--\s*sources:.*?-->/g, "")
          .trimEnd()

        // Generate filename
        const firstLine = cleanContent.split("\n").find((l) => l.trim() && !l.startsWith("<!--"))?.replace(/^#+\s*/, "").trim() ?? "Saved Query"
        const title = firstLine.slice(0, 60)
        const slug = title.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 50)
        const date = new Date().toISOString().slice(0, 10)
        const fileName = `${slug}-${date}.md`
        const filePath = `${pp}/db/queries/${fileName}`

        const frontmatter = `---\ntype: query\ntitle: "${title.replace(/"/g, '\\"')}"\ncreated: ${date}\ntags: []\n---\n\n`
        await writeFile(filePath, frontmatter + cleanContent)

        // Update index
        const indexPath = `${pp}/db/index.md`
        let indexContent = ""
        try { indexContent = await readFile(indexPath) } catch { indexContent = "# DB Index\n" }
        const entry = `- [[queries/${slug}-${date}|${title}]]`
        if (indexContent.includes("## Queries")) {
          indexContent = indexContent.replace(/(## Queries\n)/, `$1${entry}\n`)
        } else {
          indexContent = indexContent.trimEnd() + "\n\n## Queries\n" + entry + "\n"
        }
        await writeFile(indexPath, indexContent)

        // Append log
        const logPath = `${pp}/db/log.md`
        let logContent = ""
        try { logContent = await readFile(logPath) } catch { logContent = "# DB Log\n" }
        await writeFile(logPath, logContent.trimEnd() + `\n- ${date}: Saved query page \`${fileName}\`\n`)

        // Refresh tree
        const tree = await listDirectory(pp)
        setFileTree(tree)

        resolveItem(id, "Saved to Wiki")
      } catch (err) {
        console.error("Failed to save to wiki from review:", err)
        resolveItem(id, "Save failed")
      }
    } else if (action.startsWith("open:") && project) {
      // Open a page for editing
      const page = action.slice(5)
      const candidates = [
        `${pp}/db/${page}`,
        `${pp}/db/${page}.md`,
      ]
      for (const path of candidates) {
        try {
          const content = await readFile(path)
          useWikiStore.getState().setSelectedFile(path)
          useWikiStore.getState().setFileContent(content)
          useWikiStore.getState().setActiveView("wiki")
          break
        } catch {
          // try next
        }
      }
      resolveItem(id, action)
    } else if (action.startsWith("delete:") && project) {
      // Delete a file
      const filePath = action.slice(7)
      try {
        await deleteFile(filePath)
        const tree = await listDirectory(pp)
        setFileTree(tree)
        resolveItem(id, "Deleted")
      } catch (err) {
        console.error("Failed to delete:", err)
        resolveItem(id, "Delete failed")
      }
    } else if (
      (action.startsWith("__create_page__:") || actionLooksLikeCreate(action))
      && project
    ) {
      // Create a wiki page from the review item's content. Accepts both
      // the `__create_page__:` sentinel (forced via the "no search API"
      // fallback branch above) and actions that heuristically look like
      // a create instruction.
      const realAction = action.startsWith("__create_page__:")
        ? action.slice("__create_page__:".length)
        : action
      const item = items.find((i) => i.id === id)
      if (item) {
        try {
          const title = item.title.replace(/^(Create|Save|Add)[:\s]*/i, "").trim() || "Untitled"
          const slug = title.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 50)
          const date = new Date().toISOString().slice(0, 10)

          // Determine page type from review type or action text
          const pageType = detectPageType(realAction, item.type)
          const dir = pageType === "query" ? "queries" : pageType === "entity" ? "entities" : pageType === "concept" ? "concepts" : "queries"
          const fileName = `${slug}-${date}.md`
          const filePath = `${pp}/db/${dir}/${fileName}`

          const frontmatter = `---\ntype: ${pageType}\ntitle: "${title.replace(/"/g, '\\"')}"\ncreated: ${date}\ntags: []\nrelated: []\n---\n\n`
          const body = `# ${title}\n\n${item.description}\n`
          await writeFile(filePath, frontmatter + body)

          // Update index
          const indexPath = `${pp}/db/index.md`
          let indexContent = ""
          try { indexContent = await readFile(indexPath) } catch { indexContent = "# DB Index\n" }
          const sectionHeader = `## ${dir.charAt(0).toUpperCase() + dir.slice(1)}`
          const entry = `- [[${dir}/${slug}-${date}|${title}]]`
          if (indexContent.includes(sectionHeader)) {
            indexContent = indexContent.replace(new RegExp(`(${sectionHeader}\n)`), `$1${entry}\n`)
          } else {
            indexContent = indexContent.trimEnd() + `\n\n${sectionHeader}\n${entry}\n`
          }
          await writeFile(indexPath, indexContent)

          // Log
          const logPath = `${pp}/db/log.md`
          let logContent = ""
          try { logContent = await readFile(logPath) } catch { logContent = "# DB Log\n" }
          await writeFile(logPath, logContent.trimEnd() + `\n- ${date}: Created ${pageType} page \`${fileName}\` from review\n`)

          // Refresh
          const tree = await listDirectory(pp)
          setFileTree(tree)
          useWikiStore.getState().bumpDataVersion()

          resolveItem(id, `Created: db/${dir}/${fileName}`)
        } catch (err) {
          console.error("Failed to create page from review:", err)
          resolveItem(id, "Create failed")
        }
      } else {
        resolveItem(id, action)
      }
    } else {
      resolveItem(id, action)
    }
  }, [project, items, resolveItem, transitionToRejectionHandling, setFileTree])

  const pending = items.filter((i) => !i.resolved)
  const resolved = items.filter((i) => i.resolved)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setTab("reviews")}
            className={`rounded-md px-2 py-1 text-sm font-semibold transition-colors ${
              tab === "reviews"
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50"
            }`}
          >
            Review
            {pending.length > 0 && (
              <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                {pending.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setTab("pending")}
            className={`rounded-md px-2 py-1 text-sm font-semibold transition-colors ${
              tab === "pending"
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50"
            }`}
          >
            Pending
          </button>
        </div>
        {tab === "reviews" && resolved.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clearResolved} className="text-xs">
            <Trash2 className="mr-1 h-3 w-3" />
            Clear resolved
          </Button>
        )}
      </div>

      {tab === "pending" ? (
        <PendingView />
      ) : (
        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
              <CheckCircle2 className="h-8 w-8 text-muted-foreground/30" />
              <p>All clear — nothing to review</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2 p-3">
              {pending.map((item) => (
                <ReviewCard
                  key={item.id}
                  item={item}
                  onResolve={handleResolve}
                  onDismiss={dismissItem}
                />
              ))}
              {resolved.length > 0 && pending.length > 0 && (
                <div className="my-2 text-center text-xs text-muted-foreground">
                  — Resolved —
                </div>
              )}
              {resolved.map((item) => (
                <ReviewCard
                  key={item.id}
                  item={item}
                  onResolve={handleResolve}
                  onDismiss={dismissItem}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ReviewCard({
  item,
  onResolve,
  onDismiss,
}: {
  item: ReviewItem
  onResolve: (id: string, action: string) => void
  onDismiss: (id: string) => void
}) {
  const config = typeConfig[item.type]
  const Icon = config.icon

  return (
    <div
      className={`rounded-lg border p-3 text-sm transition-opacity ${
        item.resolved ? "opacity-50" : ""
      }`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 shrink-0 ${config.color}`} />
          <span className="font-medium">{item.title}</span>
        </div>
        <button
          onClick={() => onDismiss(item.id)}
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <p className="mb-3 text-xs text-muted-foreground">{item.description}</p>

      {item.affectedPages && item.affectedPages.length > 0 && (
        <div className="mb-3 text-xs text-muted-foreground">
          Pages: {item.affectedPages.join(", ")}
        </div>
      )}

      {item.type === "modification" && item.proposal && (
        <ModificationDiff proposal={item.proposal} />
      )}

      {!item.resolved ? (
        <div className="flex flex-wrap gap-1.5">
          {item.type === "modification" ? (
            <ModificationActions item={item} onResolve={onResolve} />
          ) : (
            <>
              {item.options.map((opt) => (
                <Button
                  key={opt.action}
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => onResolve(item.id, opt.action)}
                >
                  {opt.label}
                </Button>
              ))}
            </>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-1 text-xs text-emerald-600">
          <Check className="h-3 w-3" />
          {item.resolvedAction}
        </div>
      )}
    </div>
  )
}

/**
 * Two-pane diff for a Stage 4 modification proposal. Shows the existing
 * page on the left and the parked draft on the right. Truncated to keep
 * the card sane; the full content lives in `pending/_proposals/...`.
 */
function extractFrontmatterField(content: string, field: string): string | null {
  const match = content.match(new RegExp(`^---\\n[\\s\\S]*?^${field}:\\s*["']?(.+?)["']?\\s*$`, "m"))
  return match ? match[1].trim() : null
}

function ModificationDiff({
  proposal,
}: {
  proposal: NonNullable<ReviewItem["proposal"]>
}) {
  const truncate = (s: string, n = 600) => (s.length > n ? s.slice(0, n) + "\n…" : s)

  const existingGraph = extractFrontmatterField(proposal.existingExcerpt, "graph")
  const incomingGraph = extractFrontmatterField(proposal.incomingExcerpt, "graph")
  const graphChanged = existingGraph !== incomingGraph

  return (
    <div className="mb-3 grid grid-cols-2 gap-2 text-[11px]">
      {(existingGraph || incomingGraph) && (
        <div className="col-span-2 flex items-center gap-2 rounded border bg-muted/20 px-2 py-1 text-[10px]">
          <span className="text-muted-foreground">Target graph:</span>
          {existingGraph && (
            <code className="rounded bg-muted px-1">{existingGraph}</code>
          )}
          {graphChanged && incomingGraph && incomingGraph !== existingGraph && (
            <>
              <span className="text-muted-foreground">→</span>
              <code className="rounded bg-orange-100 px-1 text-orange-700 dark:bg-orange-950/50 dark:text-orange-400">
                {incomingGraph}
              </code>
            </>
          )}
        </div>
      )}
      <div className="rounded border bg-muted/30 p-2">
        <div className="mb-1 font-semibold text-muted-foreground">기존 (existing)</div>
        <pre className="whitespace-pre-wrap break-words font-mono text-[10px] leading-snug">
          {truncate(proposal.existingExcerpt)}
        </pre>
      </div>
      <div className="rounded border border-orange-300 bg-orange-50 p-2 dark:bg-orange-950/30">
        <div className="mb-1 font-semibold text-orange-600">신규 (incoming)</div>
        <pre className="whitespace-pre-wrap break-words font-mono text-[10px] leading-snug">
          {truncate(proposal.incomingExcerpt)}
        </pre>
      </div>
      <div className="col-span-2 text-[10px] text-muted-foreground">
        Draft: <code>{proposal.incomingDraftPath}</code>
      </div>
    </div>
  )
}

/**
 * Stage-aware buttons for a modification card. Primary stage exposes
 * Approve / Merge / Reject; clicking Reject flips the same card to the
 * rejection-handling stage which shows Discard / Pending / Counterexample.
 */
function ModificationActions({
  item,
  onResolve,
}: {
  item: ReviewItem
  onResolve: (id: string, action: string) => void
}) {
  const stage = item.stage ?? "primary"
  if (stage === "primary") {
    return (
      <>
        <Button
          variant="default"
          size="sm"
          className="h-7 text-xs"
          onClick={() => onResolve(item.id, "modification:approve")}
        >
          Approve
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => onResolve(item.id, "modification:merge")}
        >
          Merge
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => onResolve(item.id, "modification:reject")}
        >
          Reject
        </Button>
      </>
    )
  }
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        onClick={() => onResolve(item.id, "modification:discard")}
      >
        Discard
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        onClick={() => onResolve(item.id, "modification:pending")}
      >
        Pending
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        onClick={() => onResolve(item.id, "modification:counterexample")}
      >
        Counterexample
      </Button>
    </>
  )
}

/** Detect if an action is a dismissal (no-op) or should create a page */
function actionIsDismissal(action: string): boolean {
  const lower = action.toLowerCase()
  return (
    lower === "skip" ||
    lower === "dismiss" ||
    lower === "ignore" ||
    lower === "跳过" ||
    lower === "忽略" ||
    lower === "approve" ||
    lower === "keep existing" ||
    lower === "no"
  )
}

function actionLooksLikeCreate(action: string): boolean {
  // Anything that isn't a dismissal should create a page
  return !actionIsDismissal(action)
}

/** Infer wiki page type from action text and review item type */
function detectPageType(action: string, reviewType: string): string {
  const lower = action.toLowerCase()
  if (lower.includes("entity") || lower.includes("实体")) return "entity"
  if (lower.includes("concept") || lower.includes("概念")) return "concept"
  if (lower.includes("comparison") || lower.includes("compare") || lower.includes("比较")) return "comparison"
  if (lower.includes("synthesis") || lower.includes("综合")) return "synthesis"
  if (reviewType === "missing-page") return "concept"
  if (reviewType === "contradiction") return "query"
  if (reviewType === "suggestion") return "query"
  // Default: research/investigate/create → query
  return "query"
}
