/**
 * Dismissal context — rejection-log context loader.
 *
 * When an ingest re-runs over a raw range that the user has already
 * rejected (Discard), we want to surface that decision back into the
 * LLM's analysis prompt so the same modification card doesn't keep
 * re-appearing every time the source is re-ingested.
 *
 * Persisted artifact: `.llm-wiki/rejection-log.jsonl` — one JSON object
 * per Discard, written by `discardModification` in modification-resolve.ts.
 *
 * Pending pages (`pending/<slug>.md`, excluding `pending/_proposals/...`)
 * are deliberately NOT loaded here — those are awaiting the user's
 * manual triage and shouldn't influence the model's next decomposition.
 * The pending-view component reads them directly.
 */

import { readFile, fileExists } from "@/commands/fs"

export interface RejectionLogEntry {
  timestamp: string
  targetPath: string
  sourceFile: string
  sourceRange: string | null
  reason: string
}

const REJECTION_LOG_REL = ".llm-wiki/rejection-log.jsonl"

/**
 * Read the rejection log. JSONL — one JSON object per line. Malformed
 * lines are skipped silently (the log is purely advisory). Returns the
 * most-recent `limit` entries first.
 */
export async function loadRejectionLog(
  projectPath: string,
  limit = 50,
): Promise<RejectionLogEntry[]> {
  const logPath = `${projectPath}/${REJECTION_LOG_REL}`
  if (!(await fileExists(logPath))) return []
  let raw: string
  try {
    raw = await readFile(logPath)
  } catch {
    return []
  }
  const entries: RejectionLogEntry[] = []
  for (const line of raw.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as Partial<RejectionLogEntry>
      if (
        typeof parsed.timestamp === "string" &&
        typeof parsed.targetPath === "string" &&
        typeof parsed.sourceFile === "string"
      ) {
        entries.push({
          timestamp: parsed.timestamp,
          targetPath: parsed.targetPath,
          sourceFile: parsed.sourceFile,
          sourceRange:
            typeof parsed.sourceRange === "string" ? parsed.sourceRange : null,
          reason: typeof parsed.reason === "string" ? parsed.reason : "",
        })
      }
    } catch {
      // skip bad lines
    }
  }
  return entries.slice(-limit).reverse()
}

/**
 * Pull rejection log entries that mention the given source file
 * (case-insensitive). Used to scope the prompt context to entries
 * relevant to the file currently being ingested.
 */
export function findRelatedRejections(
  entries: readonly RejectionLogEntry[],
  sourceFile: string,
): RejectionLogEntry[] {
  const lower = sourceFile.toLowerCase()
  return entries.filter((e) => e.sourceFile.toLowerCase() === lower)
}

/**
 * Format rejection-log entries into a markdown section suitable for
 * injection into `buildAnalysisPrompt`. Returns "" when there's nothing
 * to inject so the caller can `.filter(Boolean)` cleanly.
 *
 * The prompt explicitly tells the model: if the proposed decomposition
 * for a section maps to one of these prior decisions, do NOT emit a
 * page — list it under an "Skipped (prior dismissal)" section instead.
 */
export function formatDismissalContext(
  rejections: readonly RejectionLogEntry[],
): string {
  if (rejections.length === 0) return ""
  const lines: string[] = []
  lines.push("## Prior dismissals (apply before proposing pages)")
  lines.push(
    "If a section of the raw source maps to one of the prior decisions",
    "below, do NOT propose a new page or modification for it. Instead,",
    "list it under '## Skipped (prior dismissal)' at the end of your",
    "analysis with the matching path and a one-line reason.",
    "",
  )

  lines.push("### Discards (user dropped the proposal entirely)")
  for (const e of rejections.slice(0, 20)) {
    const ref = e.sourceRange
      ? `${e.sourceFile}:${e.sourceRange}`
      : e.sourceFile
    const reason = e.reason ? ` — ${e.reason}` : ""
    lines.push(`- target \`${e.targetPath}\` from ${ref}${reason}`)
  }
  lines.push("")

  return lines.join("\n").trimEnd()
}
