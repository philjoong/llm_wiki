/**
 * Modification resolution actions.
 *
 * When an ingest run wants to write a db/ page that already exists
 * with materially different content, the writer parks the incoming draft
 * under `pending/_proposals/<id>.md` and queues a `modification` review
 * card instead of overwriting. This module is what the card's buttons
 * call when the user picks an outcome:
 *
 *   primary stage:           [Approve][Merge][Reject]
 *   rejection-handling stage: [Discard][Pending]
 *
 *   - Approve  — copy proposal → target, source-merge frontmatter, commit.
 *   - Merge    — UI-only (open the proposal in the editor for hand-edit).
 *                The eventual write goes through Approve. No file effect
 *                here, so no handler.
 *   - Discard  — drop the proposal, append a rejection-log entry, commit.
 *   - Pending  — move the proposal to `pending/<slug>.md` for human triage,
 *                commit.
 *
 * File moves are handled here; git commits are deferred to Sync to Remote.
 */

import { readFile, writeFile, deleteFile, fileExists } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { parseMarkdownV2, serializeMarkdownV2, spliceSectionById } from "@/lib/markdown-v2"
import type { ModificationProposal } from "@/stores/review-store"
import type { SourceRef } from "@/lib/source-ref"

/**
 * Convert a target db/ path to a flat slug usable as a filename in
 * `pending/`. Strips the `db/` prefix and the `.md` extension, then
 * collapses `/` to `_`. Two distinct target paths always produce
 * distinct slugs.
 *
 *   db/content/dungeons/dungeon_a/rewards.md → content_dungeons_dungeon_a_rewards
 */
export function pathToSlug(targetPath: string): string {
  return targetPath
    .replace(/^db\//, "")
    .replace(/\.md$/, "")
    .replace(/\//g, "_")
}

/**
 * Pick a SourceRef to attribute a modification commit to. Modification
 * proposals always carry at least one SourceRef (the incoming raw range
 * that triggered the conflict); falls back to a synthetic
 * `{file: "(unknown)"}` so the commit message still parses if the
 * proposal somehow arrived empty.
 */
function primarySourceRef(proposal: ModificationProposal): SourceRef {
  return proposal.sourceRefs[0] ?? { file: "(unknown)" }
}

export async function approveModification(
  projectPath: string,
  proposal: ModificationProposal,
): Promise<{ targetPath: string; content: string }> {
  const pp = normalizePath(projectPath)
  const draftAbs = `${pp}/${proposal.incomingDraftPath}`
  const targetAbs = `${pp}/${proposal.targetPath}`

  const incoming = await readFile(draftAbs)
  const existing = (await fileExists(targetAbs)) ? await readFile(targetAbs) : null

  if (!proposal.pageId || !proposal.sectionId) throw new Error("VALIDATION_FAILED: modification proposal has no v2 pageId/sectionId")
  if (existing === null) throw new Error(`Cannot approve section '${proposal.sectionId}': target page is missing`)
  const page = parseMarkdownV2(existing)
  if (page.page.page_id !== proposal.pageId) throw new Error(`Cannot approve section '${proposal.sectionId}': page identity changed`)
  const current = page.sections.find((section) => section.sectionId === proposal.sectionId)
  if (!current) throw new Error(`Cannot approve section '${proposal.sectionId}': section no longer exists`)
  const merged = serializeMarkdownV2(spliceSectionById(page, proposal.sectionId, { ...current, body: incoming }))

  await writeFile(targetAbs, merged)
  await deleteFile(draftAbs)

  return { targetPath: proposal.targetPath, content: merged }
}

export async function discardModification(
  projectPath: string,
  proposal: ModificationProposal,
  reason: string = "",
): Promise<void> {
  const pp = normalizePath(projectPath)
  const draftAbs = `${pp}/${proposal.incomingDraftPath}`
  const logRel = ".llm-wiki/rejection-log.jsonl"
  const logAbs = `${pp}/${logRel}`

  const sr = primarySourceRef(proposal)
  const entry = {
    timestamp: new Date().toISOString(),
    targetPath: proposal.targetPath,
    sourceFile: sr.file,
    sourceRange: sr.range ?? null,
    reason: reason || "discarded by user",
  }
  const line = JSON.stringify(entry) + "\n"

  const existing = (await fileExists(logAbs)) ? await readFile(logAbs) : ""
  await writeFile(logAbs, existing + line)
  if (await fileExists(draftAbs)) {
    await deleteFile(draftAbs)
  }
}

export async function pendingModification(
  projectPath: string,
  proposal: ModificationProposal,
): Promise<void> {
  const pp = normalizePath(projectPath)
  const draftAbs = `${pp}/${proposal.incomingDraftPath}`
  const slug = pathToSlug(proposal.targetPath)
  const destRel = `pending/${slug}.md`
  const destAbs = `${pp}/${destRel}`

  const content = await readFile(draftAbs)
  await writeFile(destAbs, content)
  await deleteFile(draftAbs)
}

