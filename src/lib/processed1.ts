import { writeFile } from "@/commands/fs"
import { getFileName } from "@/lib/path-utils"

/**
 * Stage 3 Part 1: passthrough-only "1차 가공" stage.
 *
 * The new ingest pipeline writes a copy of every raw file to
 * `processed_1/<original_name>.md` BEFORE the LLM analysis/generation
 * step runs. The decomposed pages under `db/` then carry frontmatter
 * `sources` pointing back at the raw filename — this gives every wiki
 * page a stable, on-disk record of what it was derived from, even if
 * the original raw upload is later deleted from the source tree.
 *
 * For now this is a true passthrough (the raw text is written verbatim
 * with a `.md` extension). The structured 1차 가공 algorithm — splitting
 * raw docs into clean canonical 1차 산출물 ahead of LLM ingestion — is
 * Part 1.5 work and will replace the body of `runProcessed1` later.
 */
// TODO Part 1.5: structured 1차 가공 — replace passthrough with a
// segmenter that emits clean canonical 1차 산출물 per source format.

/** Project-relative path that the passthrough wrote to. */
export interface Processed1Result {
  /** Original raw file's basename (filename only, no directory). */
  rawFileName: string
  /** Path under processed_1/, relative to projectPath. */
  writtenPath: string
}

/**
 * Run the passthrough 1차 가공: copy raw text into
 * `<projectPath>/processed_1/<basename>.md`. Returns the project-relative
 * `processed_1/...` path so the caller can include it in the ingest
 * commit's writtenPaths.
 *
 * Behavior:
 *   - The output filename is the raw file's basename with `.md`
 *     replacing whatever extension it had (or appended if it had none).
 *     `.docx` / `.pdf` / `.xlsx` raw inputs become `.md` because their
 *     extracted text is already plaintext at this point in the pipeline.
 *   - The body is `rawContent` verbatim — no transformation, no
 *     frontmatter, no language detection. Stage 3 explicitly leaves
 *     1차 가공 unimplemented.
 *   - Writes are idempotent: re-running on the same content overwrites
 *     the same path. The ingest cache layer above us will short-circuit
 *     re-runs on identical content anyway.
 */
export async function runProcessed1(
  projectPath: string,
  sourcePath: string,
  rawContent: string,
): Promise<Processed1Result> {
  const rawFileName = getFileName(sourcePath)
  const stem = stripExtension(rawFileName)
  const writtenPath = `processed_1/${stem}.md`
  await writeFile(`${projectPath}/${writtenPath}`, rawContent)
  return { rawFileName, writtenPath }
}

function stripExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".")
  return lastDot > 0 ? fileName.slice(0, lastDot) : fileName
}
