import { gitCommit, type CommitResult } from "@/commands/git"
import { withProjectLock } from "@/lib/project-mutex"

/**
 * Lightweight SourceRef shape used by commit messages. The full type
 * lives in `src/lib/source-ref.ts` (Stage 3) — keeping a structural
 * dupe here avoids a forward dependency before that module exists.
 */
export interface SourceRefLite {
  file: string
  range?: string
}

/**
 * Commit the result of a single ingest run. Each entry in `writtenPaths`
 * is the project-relative path of a page the ingest pipeline wrote.
 *
 * No-op when `writtenPaths` is empty (parse with no usable blocks, etc.) —
 * we don't want empty commits cluttering history.
 */
export async function commitIngest(
  projectPath: string,
  sourceFile: string,
  writtenPaths: string[],
): Promise<CommitResult> {
  if (writtenPaths.length === 0) {
    return { committed: false, commitHash: null }
  }
  const message = formatIngestMessage(sourceFile, writtenPaths)
  return withProjectLock(projectPath, () =>
    gitCommit(projectPath, message, writtenPaths),
  )
}

/**
 * Commit a single user-driven modification action (Approve, Discard,
 * Pending, Counterexample, ...). `targetPath` is the file the action
 * mutates; `sourceRef` records which raw file/range justified the
 * incoming proposal that the user just resolved.
 */
export async function commitModification(
  projectPath: string,
  action: string,
  targetPath: string,
  sourceRef: SourceRefLite,
): Promise<CommitResult> {
  const message = formatModificationMessage(action, targetPath, sourceRef)
  return withProjectLock(projectPath, () =>
    gitCommit(projectPath, message, [targetPath]),
  )
}

export function formatIngestMessage(sourceFile: string, writtenPaths: string[]): string {
  const lines = writtenPaths.map((p) => `- ${p} (new)`).join("\n")
  const subject = `ingest: ${sourceFile} → ${writtenPaths.length} pages`
  return `${subject}\n\n${lines}\n\nSource: ${sourceFile}`
}

/**
 * Commit a Stage 12 search-instance log file. `instancePath` is the
 * project-relative path that `recordSearchInstance` just wrote.
 *
 * `questionTypeId` is null when the classifier couldn't pick a type
 * (or `question_types/` is empty) — we still log the search, but the
 * commit subject reads `search: untyped → …`.
 */
export async function commitSearchInstance(
  projectPath: string,
  instancePath: string,
  questionTypeId: string | null,
  hitsCount: number,
  excludedCount: number,
): Promise<CommitResult> {
  const message = formatSearchInstanceMessage(
    questionTypeId,
    hitsCount,
    excludedCount,
  )
  return withProjectLock(projectPath, () =>
    gitCommit(projectPath, message, [instancePath]),
  )
}

export function formatSearchInstanceMessage(
  questionTypeId: string | null,
  hitsCount: number,
  excludedCount: number,
): string {
  const type = questionTypeId ?? "untyped"
  return `search: ${type} → ${hitsCount} hits (${excludedCount} excluded)`
}

export function formatModificationMessage(
  action: string,
  targetPath: string,
  sourceRef: SourceRefLite,
): string {
  const range = sourceRef.range ? `:${sourceRef.range}` : ""
  return `modification: ${action} ${targetPath}\n\nSource: ${sourceRef.file}${range}\nResolved-by: ${action}`
}
