/**
 * Stage 5 — actions for pending-view.
 *
 * `pending/<slug>.md` is where modifications go when the user picks the
 * "Pending" branch on a modification card. The pending-view exposes
 * three follow-up actions; this module is the file/git side of each:
 *
 *   - Re-review        — move the pending file back to
 *                        `pending/_proposals/...` and queue a new
 *                        modification review card. No commit (the next
 *                        user action records the outcome).
 *   - Promote to db/   — write the pending content to its db/ target
 *                        with source-merge, delete the pending file,
 *                        commit both.
 *   - Discard          — append a rejection-log entry, delete the file,
 *                        commit.
 *
 * Recovering the db/ target: the slug we used when sending to pending
 * (`pathToSlug`) is lossy in principle (path components with internal
 * underscores are indistinguishable from path separators). We work
 * around that by enumerating the live db/ tree and matching by the
 * same `pathToSlug` — that round-trip is exact for any path that's
 * actually present. If the target has been deleted since, we fall
 * back to a naive reconstruction (`db/<slug-with-underscores-as-slashes>.md`)
 * so the user still has a starting point.
 */
import {
  listDirectory,
  readFile,
  writeFile,
  deleteFile,
  fileExists,
} from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { gitCommit } from "@/commands/git"
import { formatModificationMessage } from "@/lib/auto-commit"
import { withProjectLock } from "@/lib/project-mutex"
import {
  mergeSourceRefsIntoContent,
  parseSourceRefs,
} from "@/lib/sources-merge"
import { pathToSlug } from "@/lib/modification-resolve"
import {
  useReviewStore,
  type ModificationProposal,
} from "@/stores/review-store"
import type { FileNode } from "@/types/wiki"

export interface PendingItem {
  /** Project-relative path, always under `pending/`, e.g. `pending/dungeon_a_rewards.md`. */
  path: string
  /** Filename without `.md`. Same encoding as `pathToSlug` produces. */
  slug: string
  /** Frontmatter title, falling back to the slug. */
  title: string
  /** Recovered db/ target (best-effort if target was deleted). */
  targetPath: string
  /** Whether the recovered target file actually exists in the project. */
  targetExists: boolean
}

const REJECTION_LOG_REL = ".llm-wiki/rejection-log.jsonl"

/**
 * Enumerate `pending/<slug>.md` (top-level only — `pending/_proposals/`
 * is excluded since those are mid-flight modification drafts the user
 * hasn't acted on yet).
 */
export async function loadPendingItems(
  projectPath: string,
): Promise<PendingItem[]> {
  const pp = normalizePath(projectPath)
  let nodes: FileNode[]
  try {
    nodes = await listDirectory(`${pp}/pending`)
  } catch {
    return []
  }
  const dbSlugs = await indexDbBySlug(pp)
  const items: PendingItem[] = []
  for (const node of nodes) {
    // Skip subdirectories (notably `pending/_proposals/`).
    if (node.is_dir) continue
    if (!node.name.endsWith(".md")) continue
    if (node.name.startsWith(".")) continue
    const rel = `pending/${node.name}`
    const slug = node.name.replace(/\.md$/, "")
    let content = ""
    try {
      content = await readFile(`${pp}/${rel}`)
    } catch {
      continue
    }
    const titleMatch = content.match(
      /^---\n[\s\S]*?^title:\s*["']?(.+?)["']?\s*$/m,
    )
    const title = titleMatch ? titleMatch[1].trim() : slug
    const recovered = dbSlugs.get(slug)
    items.push({
      path: rel,
      slug,
      title,
      targetPath: recovered ?? `db/${slug.replace(/_/g, "/")}.md`,
      targetExists: recovered !== undefined,
    })
  }
  return items
}

async function indexDbBySlug(
  projectPath: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  let nodes: FileNode[]
  try {
    nodes = await listDirectory(`${projectPath}/db`)
  } catch {
    return map
  }
  walkDb(nodes, "db", map)
  return map
}

function walkDb(
  nodes: FileNode[],
  prefix: string,
  out: Map<string, string>,
): void {
  for (const node of nodes) {
    if (node.name.startsWith(".")) continue
    const path = `${prefix}/${node.name}`
    if (node.is_dir) {
      walkDb(node.children ?? [], path, out)
    } else if (node.name.endsWith(".md")) {
      out.set(pathToSlug(path), path)
    }
  }
}

/**
 * Discard a pending entry: append a rejection-log line, delete the
 * file, commit. Mirrors `discardModification` so the same dismissal
 * context (Stage 5 prompt injection) picks it up.
 */
export async function discardPending(
  projectPath: string,
  item: PendingItem,
  reason: string = "discarded from pending-view",
): Promise<void> {
  const pp = normalizePath(projectPath)
  const fileAbs = `${pp}/${item.path}`
  const content = (await fileExists(fileAbs)) ? await readFile(fileAbs) : ""
  const refs = parseSourceRefs(content)
  const sr = refs[0] ?? { file: "(unknown)" }

  const logAbs = `${pp}/${REJECTION_LOG_REL}`
  const entry = {
    timestamp: new Date().toISOString(),
    targetPath: item.targetPath,
    sourceFile: sr.file,
    sourceRange: sr.range ?? null,
    reason,
  }
  const existing = (await fileExists(logAbs)) ? await readFile(logAbs) : ""
  await writeFile(logAbs, existing + JSON.stringify(entry) + "\n")
  if (await fileExists(fileAbs)) {
    await deleteFile(fileAbs)
  }

  const message = formatModificationMessage(
    "discard-pending",
    item.targetPath,
    sr,
  )
  await withProjectLock(pp, () =>
    gitCommit(pp, message, [item.path, REJECTION_LOG_REL]),
  )
}

/**
 * Promote a pending entry into db/: merge its sources with whatever's
 * at the target, write the merged result, delete the pending file,
 * commit both paths.
 */
export async function promotePending(
  projectPath: string,
  item: PendingItem,
): Promise<void> {
  const pp = normalizePath(projectPath)
  const fileAbs = `${pp}/${item.path}`
  const targetAbs = `${pp}/${item.targetPath}`

  const incoming = await readFile(fileAbs)
  const existing = (await fileExists(targetAbs))
    ? await readFile(targetAbs)
    : null
  const merged = mergeSourceRefsIntoContent(incoming, existing)

  await writeFile(targetAbs, merged)
  await deleteFile(fileAbs)

  const refs = parseSourceRefs(incoming)
  const sr = refs[0] ?? { file: "(unknown)" }
  const message = formatModificationMessage(
    "promote",
    item.targetPath,
    sr,
  )
  await withProjectLock(pp, () =>
    gitCommit(pp, message, [item.targetPath, item.path]),
  )
}

/**
 * Push a pending entry back into the modification review queue. Moves
 * the file to `pending/_proposals/<id>.md` so the existing Stage 4
 * resolver code paths (which expect drafts under that prefix) work
 * unchanged, then queues a fresh `modification` review item.
 */
export async function reReviewPending(
  projectPath: string,
  item: PendingItem,
): Promise<void> {
  const pp = normalizePath(projectPath)
  const fileAbs = `${pp}/${item.path}`
  const incoming = await readFile(fileAbs)
  const targetAbs = `${pp}/${item.targetPath}`
  const existing = (await fileExists(targetAbs))
    ? await readFile(targetAbs)
    : ""

  const runStamp = Date.now()
  const draftRel = `pending/_proposals/${runStamp}-rerev-${item.slug}.md`
  await writeFile(`${pp}/${draftRel}`, incoming)
  await deleteFile(fileAbs)

  const refs = parseSourceRefs(incoming)
  const sourceRefs = refs.length > 0 ? refs : [{ file: "(unknown)" }]

  const proposal: ModificationProposal = {
    targetPath: item.targetPath,
    existingExcerpt: existing,
    incomingExcerpt: incoming,
    incomingDraftPath: draftRel,
    sourceRefs,
  }
  useReviewStore.getState().addItems([
    {
      type: "modification",
      stage: "primary",
      title: `Re-review: ${item.title}`,
      description:
        `Pending entry pushed back into the modification queue. ` +
        `Approve writes to ${item.targetPath}; the Reject branch sends ` +
        `it through Discard / Pending / Counterexample again.`,
      affectedPages: [item.targetPath],
      options: [],
      proposal,
    },
  ])
}
