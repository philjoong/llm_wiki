/**
 * Stage 4 — modification resolution actions.
 *
 * When a Stage 3 ingest run wants to write a db/ page that already exists
 * with materially different content, the writer parks the incoming draft
 * under `pending/_proposals/<id>.md` and queues a `modification` review
 * card instead of overwriting. This module is what the card's buttons
 * call when the user picks an outcome:
 *
 *   primary stage:           [Approve][Merge][Reject]
 *   rejection-handling stage: [Discard][Pending][Counterexample]
 *
 *   - Approve  — copy proposal → target, source-merge frontmatter, commit.
 *   - Merge    — UI-only (open the proposal in the editor for hand-edit).
 *                The eventual write goes through Approve. No file effect
 *                here, so no handler.
 *   - Discard  — drop the proposal, append a rejection-log entry, commit.
 *   - Pending  — move the proposal to `pending/<slug>.md` for human triage,
 *                commit.
 *   - Counterexample — move the proposal to `counterexamples/<slug>.md`,
 *                commit. Stage 5 will inject these back into the prompt.
 *
 * Every handler ends in a single git commit. We rely on `commitModification`
 * (auto-commit.ts) to take the per-project lock so concurrent ingest /
 * modification commits serialize safely.
 */

import { readFile, writeFile, deleteFile, fileExists } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { mergeSourceRefsIntoContent } from "@/lib/sources-merge"
import { commitModification } from "@/lib/auto-commit"
import type { ModificationProposal } from "@/stores/review-store"
import type { SourceRef } from "@/lib/source-ref"

/**
 * Convert a target db/ path to a flat slug usable as a filename in
 * `pending/` or `counterexamples/`. Strips the `db/` prefix and the
 * `.md` extension, then collapses `/` to `_`. Two distinct target paths
 * always produce distinct slugs.
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

/**
 * Approve: write the parked draft into the real target, source-merge with
 * whatever's currently on disk so older sources aren't lost, then drop
 * the draft and commit.
 */
export async function approveModification(
  projectPath: string,
  proposal: ModificationProposal,
): Promise<void> {
  const pp = normalizePath(projectPath)
  const draftAbs = `${pp}/${proposal.incomingDraftPath}`
  const targetAbs = `${pp}/${proposal.targetPath}`

  const incoming = await readFile(draftAbs)
  const existing = (await fileExists(targetAbs)) ? await readFile(targetAbs) : null
  const merged = mergeSourceRefsIntoContent(incoming, existing)

  await writeFile(targetAbs, merged)
  await deleteFile(draftAbs)

  await commitModification(pp, "approve", proposal.targetPath, primarySourceRef(proposal))
}

/**
 * Discard: the existing page is correct, the proposal is wrong. Drop the
 * draft, append a one-line JSONL entry to `.llm-wiki/rejection-log.jsonl`
 * for Stage 5's prompt-context injection, and commit.
 */
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

  await commitModification(pp, "discard", proposal.targetPath, sr)
}

/**
 * Pending: park the proposal under `pending/<slug>.md` for the user to
 * triage later (Stage 5 will surface a pending-view sidebar). Commits
 * the move.
 */
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

  await commitModification(pp, "pending", proposal.targetPath, primarySourceRef(proposal))
}

/**
 * Counterexample: park the proposal under `counterexamples/<slug>.md` to
 * mark it as "this is the wrong answer for this raw range". Stage 5's
 * ingest prompt will inject these back so the same raw section doesn't
 * keep re-triggering the same modification card.
 */
export async function counterexampleModification(
  projectPath: string,
  proposal: ModificationProposal,
): Promise<void> {
  const pp = normalizePath(projectPath)
  const draftAbs = `${pp}/${proposal.incomingDraftPath}`
  const slug = pathToSlug(proposal.targetPath)
  const destRel = `counterexamples/${slug}.md`
  const destAbs = `${pp}/${destRel}`

  const content = await readFile(draftAbs)
  await writeFile(destAbs, content)
  await deleteFile(draftAbs)

  await commitModification(
    pp,
    "counterexample",
    proposal.targetPath,
    primarySourceRef(proposal),
  )
}
