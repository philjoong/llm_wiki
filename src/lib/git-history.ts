import {
  gitLog,
  gitShow,
  gitDiff,
  gitCheckoutPath,
  gitCommit,
  gitRevert,
  type CommitInfo,
  type CommitDetail,
  type RevertResult,
} from "@/commands/git"

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
