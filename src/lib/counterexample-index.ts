/**
 * Dismissal context — counterexample / rejection-log context loader.
 *
 * When an ingest re-runs over a raw range that the user has already
 * rejected (Discard) or marked as a Counterexample (the existing page is
 * correct, the proposed new page is wrong), we want to surface those
 * decisions back into the LLM's analysis prompt so the same modification
 * card doesn't keep re-appearing every time the source is re-ingested.
 *
 * Two persisted artifacts contribute:
 *   - `counterexamples/*.md` — full pages the user marked as wrong.
 *     Frontmatter carries `title` + `sources` (ingest object form).
 *   - `.llm-wiki/rejection-log.jsonl` — one JSON object per Discard,
 *     written by `discardModification` in modification-resolve.ts.
 *
 * Pending pages (`pending/<slug>.md`, excluding `pending/_proposals/...`)
 * are deliberately NOT loaded here — those are awaiting the user's
 * manual triage and shouldn't influence the model's next decomposition.
 * The pending-view component reads them directly.
 */

import { listDirectory, readFile, fileExists } from "@/commands/fs"
import { parseSourceRefs } from "@/lib/sources-merge"
import type { SourceRef } from "@/lib/source-ref"
import type { FileNode } from "@/types/wiki"

export interface CounterexampleEntry {
  /** Project-relative path, e.g. "counterexamples/dungeon_a_rewards.md". */
  path: string
  /** Title from frontmatter, falling back to the filename slug. */
  title: string
  /** Sources extracted from the frontmatter (file + optional range). */
  sources: SourceRef[]
  /** First ~600 chars of post-frontmatter body — enough for prompt context. */
  excerpt: string
}

export interface RejectionLogEntry {
  timestamp: string
  targetPath: string
  sourceFile: string
  sourceRange: string | null
  reason: string
}

const EXCERPT_LIMIT = 600
const REJECTION_LOG_REL = ".llm-wiki/rejection-log.jsonl"

/**
 * Load every counterexample under `counterexamples/`. Returns an empty
 * array if the directory doesn't exist, is empty, or only holds dotfiles
 * (e.g. `.gitkeep`).
 */
export async function loadCounterexamples(
  projectPath: string,
): Promise<CounterexampleEntry[]> {
  let nodes: FileNode[]
  try {
    nodes = await listDirectory(`${projectPath}/counterexamples`)
  } catch {
    return []
  }
  const entries: CounterexampleEntry[] = []
  for (const node of nodes) {
    if (node.is_dir) continue
    if (!node.name.endsWith(".md")) continue
    if (node.name.startsWith(".")) continue
    const rel = `counterexamples/${node.name}`
    let content: string
    try {
      content = await readFile(`${projectPath}/${rel}`)
    } catch {
      continue
    }
    entries.push(buildEntry(rel, content))
  }
  return entries
}

function buildEntry(rel: string, content: string): CounterexampleEntry {
  const titleMatch = content.match(/^---\n[\s\S]*?^title:\s*["']?(.+?)["']?\s*$/m)
  const fallback = rel.split("/").pop()!.replace(/\.md$/, "")
  const title = titleMatch ? titleMatch[1].trim() : fallback
  const sources = parseSourceRefs(content)
  const body = stripFrontmatter(content)
  return {
    path: rel,
    title,
    sources,
    excerpt: body.slice(0, EXCERPT_LIMIT),
  }
}

function stripFrontmatter(content: string): string {
  if (!content.startsWith("---\n")) return content
  const end = content.indexOf("\n---\n", 4)
  return end < 0 ? content : content.slice(end + 5)
}

/**
 * Filter counterexamples whose `sources` overlap the given source ref.
 * Match is case-insensitive on file name. If the input also has a range,
 * the entry must either share that range or have no range stored — we
 * keep range-less entries because they generally apply to the whole file.
 */
export function findRelatedCounterexamples(
  entries: readonly CounterexampleEntry[],
  ref: SourceRef,
): CounterexampleEntry[] {
  const refFile = ref.file.toLowerCase()
  const refRange = ref.range?.toLowerCase()
  return entries.filter((e) =>
    e.sources.some((s) => {
      if (s.file.toLowerCase() !== refFile) return false
      if (!refRange) return true
      const sr = s.range?.toLowerCase()
      return !sr || sr === refRange
    }),
  )
}

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
 * Format counterexamples + rejection-log entries into a markdown section
 * suitable for injection into `buildAnalysisPrompt`. Returns "" when
 * there's nothing to inject so the caller can `.filter(Boolean)` cleanly.
 *
 * The prompt explicitly tells the model: if the proposed decomposition
 * for a section maps to one of these prior decisions, do NOT emit a
 * page — list it under an "Skipped (prior dismissal)" section instead.
 */
export function formatDismissalContext(
  counterexamples: readonly CounterexampleEntry[],
  rejections: readonly RejectionLogEntry[],
): string {
  if (counterexamples.length === 0 && rejections.length === 0) return ""
  const lines: string[] = []
  lines.push("## Prior dismissals (apply before proposing pages)")
  lines.push(
    "If a section of the raw source maps to one of the prior decisions",
    "below, do NOT propose a new page or modification for it. Instead,",
    "list it under '## Skipped (prior dismissal)' at the end of your",
    "analysis with the matching path and a one-line reason.",
    "",
  )

  if (counterexamples.length > 0) {
    lines.push(
      "### Counterexamples (the existing db/ page is correct — these proposals were wrong)",
    )
    for (const e of counterexamples) {
      const srcs =
        e.sources.length > 0
          ? e.sources
              .map((s) => (s.range ? `${s.file}:${s.range}` : s.file))
              .join(", ")
          : "(unknown source)"
      lines.push(`- **${e.title}** — sources: ${srcs}`)
    }
    lines.push("")
  }

  if (rejections.length > 0) {
    lines.push("### Discards (user dropped the proposal entirely)")
    for (const e of rejections.slice(0, 20)) {
      const ref = e.sourceRange
        ? `${e.sourceFile}:${e.sourceRange}`
        : e.sourceFile
      const reason = e.reason ? ` — ${e.reason}` : ""
      lines.push(`- target \`${e.targetPath}\` from ${ref}${reason}`)
    }
    lines.push("")
  }

  return lines.join("\n").trimEnd()
}
