import {
  gitLog,
  gitShow,
  gitShowFile,
  gitDiff,
  gitCheckoutPath,
  gitCommit,
  gitRevert,
  type CommitInfo,
  type CommitDetail,
  type RevertResult,
} from "@/commands/git"
import { readFile } from "@/commands/fs"
import { getKnowledgePage } from "@/commands/knowledge"
import { parseMarkdownV2 } from "@/lib/markdown-v2"
import { normalizePath } from "@/lib/path-utils"

/** Page size for the history list. Tuned so the initial fetch covers a
 *  small project's full history without paginating, but doesn't pull
 *  thousands of commits eagerly on a long-running project. */
export const HISTORY_PAGE_SIZE = 50

/**
 * Load up to `limit` commits ending at HEAD. Pagination is keyset-based:
 * the UI passes the `cursor` (last commit hash from the previous page) on
 * subsequent calls to fetch the next page.
 *
 * NOTE: git_log honours `-n <limit>` but does not natively accept a "skip"
 * cursor. We get one extra commit and then slice past the cursor, so the
 * caller doesn't see the cursor commit twice. This is fine for the small
 * project sizes the UI targets; for very long histories we'd switch to
 * `--skip` or `<cursor>~1..HEAD` revision-range syntax.
 */
export async function loadCommitPage(
  projectPath: string,
  cursor: string | null,
  limit: number = HISTORY_PAGE_SIZE,
): Promise<CommitInfo[]> {
  if (!cursor) {
    return gitLog(projectPath, limit)
  }
  // Fetch a chunk that's likely to contain the cursor + 1 page beyond it,
  // then drop everything up to and including the cursor.
  const buffer = await gitLog(projectPath, limit * 4)
  const idx = buffer.findIndex((c) => c.hash === cursor)
  if (idx < 0) {
    // Cursor isn't in this slice — likely fell off the end. Return empty
    // so the UI stops paginating instead of looping.
    return []
  }
  return buffer.slice(idx + 1, idx + 1 + limit)
}

/** Fetch the metadata + per-file change summary for a single commit. */
export async function loadCommitDetail(
  projectPath: string,
  hash: string,
): Promise<CommitDetail> {
  return gitShow(projectPath, hash)
}

/**
 * Diff for a single file inside a commit. Compares against the commit's
 * first parent (`<hash>^`) — for the initial commit there's no parent,
 * so we fall back to `4b825dc...` (git's empty-tree object) which yields
 * "everything in this commit was added".
 */
export async function loadFileDiff(
  projectPath: string,
  hash: string,
  path: string,
): Promise<string> {
  // Try parent-based diff first; if it fails (parent doesn't exist),
  // diff against the empty tree.
  try {
    return await gitDiff(projectPath, `${hash}^`, hash, path)
  } catch {
    return gitDiff(
      projectPath,
      "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
      hash,
      path,
    )
  }
}

/**
 * Restore a single file's content to its state at `hash` and create a new
 * commit recording the restoration. Two-step: `git checkout <hash> -- <path>`
 * updates the working tree, then `git_commit` makes a new commit so the
 * change is auditable in history.
 *
 * Why not `git revert`: revert generates a commit that exactly inverts the
 * target commit across the WHOLE tree. We only want to roll back ONE
 * file. Commit metadata (author, etc.) is left to git config.
 */
export async function restoreFileFromCommit(
  projectPath: string,
  hash: string,
  path: string,
): Promise<{ committed: boolean; commitHash: string | null }> {
  await gitCheckoutPath(projectPath, hash, [path])
  // Use the short hash (first 7 chars) in the message to keep the subject
  // line readable in `git log --oneline` style outputs.
  const shortHash = hash.slice(0, 7)
  return gitCommit(
    projectPath,
    `revert: restore ${path} to ${shortHash}`,
    [path],
  )
}

/**
 * Revert an entire commit. Returns conflict info as-is — callers must
 * surface conflicts to the user; we never auto-resolve.
 */
export async function revertCommit(
  projectPath: string,
  hash: string,
): Promise<RevertResult> {
  return gitRevert(projectPath, hash)
}

// ── History context for Chat (Step 08/09) ─────────────────────────────

/** Upper bound on file-touching commits the default-point walk inspects.
 *  Each inspected commit costs one `git show` subprocess; in practice the
 *  walk stops at the first or second commit. */
const COMPARISON_WALK_LIMIT = 100

/** A file's content as it was at one commit. */
export interface HistoricalFileVersion {
  commitHash: string
  /** ISO 8601 author date of the commit. */
  commitDate: string
  /** false when the file did not exist at that commit. */
  exists: boolean
  content: string | null
}

/** Read `path`'s content at a specific commit (user-selected point, Step 09). */
export async function loadFileVersionAtCommit(
  projectPath: string,
  commit: Pick<CommitInfo, "hash" | "date">,
  path: string,
): Promise<HistoricalFileVersion> {
  const shown = await gitShowFile(projectPath, commit.hash, path)
  return {
    commitHash: commit.hash,
    commitDate: commit.date,
    exists: shown.exists,
    content: shown.content,
  }
}

/**
 * Default comparison point for one file (Step 08 작업 2): the most recent
 * commit whose version of `path` DIFFERS from the current working-tree
 * content — never a fixed HEAD~1. A fixed HEAD~1 gives a false "no change"
 * answer whenever the last commit only touched other pages; walking
 * `git log -- <path>` newest-first and comparing content avoids that.
 *
 * Returns null when no commit touches the file (e.g. Sync never ran) —
 * callers inject nothing and the prompt's "past unavailable" rule applies.
 * When every recorded version equals the working tree (file never changed
 * since it was added), the oldest version is returned so the model can
 * honestly answer "no change since <date>" instead of "no past info".
 */
export async function findDefaultComparisonVersion(
  projectPath: string,
  path: string,
  workingContent: string,
): Promise<HistoricalFileVersion | null> {
  const commits = await gitLog(projectPath, COMPARISON_WALK_LIMIT, path)
  let oldest: HistoricalFileVersion | null = null
  for (const commit of commits) {
    const version = await loadFileVersionAtCommit(projectPath, commit, path)
    const past = version.exists ? (version.content ?? "") : null
    if (past !== workingContent) return version
    oldest = version
  }
  return oldest
}

/** Past state of one cited section, keyed by its issued citation key. */
export interface PreviousSectionVersion {
  /** Citation key of the CURRENT section this past body corresponds to. */
  key: string
  title?: string
  headingText?: string
  /** ISO 8601 date of the comparison commit. */
  commitDate: string
  /** "present": body holds the section's past text. "file-absent": the page
   *  file did not exist at that commit. "section-absent": the file existed
   *  but this section (matched by its stable `{#sec-ULID}` id) did not. */
  state: "present" | "file-absent" | "section-absent"
  body: string | null
}

/**
 * Collect past versions for the cited sections (Step 08 작업 3/4).
 * The comparison "current" is the working tree. `selectedCommit` (Step 09)
 * pins one repo-wide point; when null the per-file default point is used.
 * Sections are matched across versions by their stable `{#sec-ULID}` id —
 * rename/split tracking is out of scope (same-path assumption).
 * Files with no history (Sync never ran) contribute no entries.
 */
export async function collectPreviousVersions(
  projectPath: string,
  entries: Array<{ key: string; pageId: string; sectionId: string; title?: string; headingText?: string }>,
  selectedCommit: Pick<CommitInfo, "hash" | "date"> | null,
): Promise<PreviousSectionVersion[]> {
  const byPage = new Map<string, typeof entries>()
  for (const entry of entries) {
    const list = byPage.get(entry.pageId) ?? []
    list.push(entry)
    byPage.set(entry.pageId, list)
  }

  const out: PreviousSectionVersion[] = []
  for (const [pageId, pageEntries] of byPage) {
    let version: HistoricalFileVersion | null = null
    let pagePath: string
    try {
      const page = await getKnowledgePage(projectPath, pageId)
      if (!page) continue
      pagePath = page.pagePath
      if (selectedCommit) {
        version = await loadFileVersionAtCommit(projectPath, selectedCommit, pagePath)
      } else {
        const workingContent = await readFile(normalizePath(`${projectPath}/${pagePath}`))
        version = await findDefaultComparisonVersion(projectPath, pagePath, workingContent)
      }
    } catch {
      continue // history is best-effort; a failing file just contributes nothing
    }
    if (!version) continue

    if (!version.exists) {
      for (const entry of pageEntries) {
        out.push({ key: entry.key, title: entry.title, headingText: entry.headingText, commitDate: version.commitDate, state: "file-absent", body: null })
      }
      continue
    }

    let pastSections: Map<string, string>
    try {
      pastSections = new Map(parseMarkdownV2(version.content ?? "").sections.map((s) => [s.sectionId, s.body]))
    } catch {
      continue // a past version this app didn't write as v2 — skip honestly
    }
    for (const entry of pageEntries) {
      const body = pastSections.get(entry.sectionId)
      out.push(
        body === undefined
          ? { key: entry.key, title: entry.title, headingText: entry.headingText, commitDate: version.commitDate, state: "section-absent", body: null }
          : { key: entry.key, title: entry.title, headingText: entry.headingText, commitDate: version.commitDate, state: "present", body },
      )
    }
  }
  return out
}

/**
 * Serialize collected past versions into the "Previous Versions" prompt
 * block — deliberately distinct from "Citation Sections" (which hold the
 * CURRENT working-tree content) and labeled with each version's commit
 * date. Returns "" when there is nothing to inject, so the caller keeps
 * the existing "past unavailable" prompt rules.
 */
export function buildPreviousVersionsBlock(items: PreviousSectionVersion[]): string {
  if (!items.length) return ""
  const blocks = items.map((item) => {
    const parts = [`[CIT:${item.key}]`]
    if (item.title) parts.push(`title="${item.title}"`)
    if (item.headingText) parts.push(`section="${item.headingText}"`)
    parts.push(`as-of=${item.commitDate}`)
    const header = parts.join(" ")
    if (item.state === "file-absent") return `${header}\n(This page did not exist at that point in history.)`
    if (item.state === "section-absent") return `${header}\n(The page existed, but this section did not exist at that point in history.)`
    return `${header}\n${item.body ?? ""}`
  })
  return [
    "## Previous Versions",
    "PAST versions of the cited sections, read from the project's git history at the date shown per entry.",
    "The Citation Sections above are the CURRENT state; use these entries only as the past side of the comparison.",
    "Each entry starts with the [CIT:key] of the current section it corresponds to.",
    "",
    blocks.join("\n\n---\n\n"),
  ].join("\n")
}
