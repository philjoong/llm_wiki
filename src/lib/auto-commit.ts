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

export function formatModificationMessage(
  action: string,
  targetPath: string,
  sourceRef: SourceRefLite,
): string {
  const range = sourceRef.range ? `:${sourceRef.range}` : ""
  return `modification: ${action} ${targetPath}\n\nSource: ${sourceRef.file}${range}\nResolved-by: ${action}`
}
