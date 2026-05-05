/**
 * Stage 9 — exclusion map loader and glob-based candidate pruner.
 *
 * Two file shapes feed this loader:
 *
 *   exclusions/by_question_type/<typeId>.md  (level: "pattern")
 *     - Applies only to that one question type.
 *     - typeId is taken from the filename stem.
 *
 *   exclusions/axioms/<name>.md              (level: "axiom")
 *     - Applies to every typeId listed in frontmatter `applies_to:`.
 *     - Empty / missing `applies_to:` → applies to no type (still loaded
 *       so a Stage-13 promotion-from-pattern can backfill it later).
 *
 * Both shapes share the same body parser:
 *
 *   ## 배제                # or "## Exclusions"
 *   - <pattern>
 *     근거: <rationale>    # or "rationale:"
 *     출처: a, b, c        # or "sources:"
 *     archived: true
 *     last_validated_at: 2026-04-12
 *     needs_review: true
 *   ## 출처                # or "## Sources" — doc-level fallback
 *   - 사람 검토 (2026-04-12)
 *
 * Glob support is intentionally minimal: literal text, `*` (single
 * segment), and `**` (any depth). The IDEA spec doesn't require
 * negation, brace expansion, or character classes, and pulling in a
 * full minimatch dependency for two metacharacters is dead weight.
 *
 * Stage 11 will wire `applyExclusions` into the search pipeline; this
 * module is pure data layer and has no UI side effects.
 */
import { listDirectory, readFile } from "@/commands/fs"
import type { FileNode } from "@/types/wiki"
import { parseFrontmatter } from "./question-types"

export interface ExclusionEntry {
  /** Glob or literal path under `db/`, e.g. `db/**\/spawn_rules.md`. */
  pattern: string
  rationale: string
  /** Per-entry citations. Falls back to doc-level `## 출처` list at parse time. */
  sources: string[]
  /** ISO date — used by Stage 14 freshness checks. */
  lastValidatedAt?: string
  /** Set by Stage 14 when an entry's source has changed since validation. */
  needsReview?: boolean
  /** Stage 14 explicit retraction. archived entries are skipped by applyExclusions. */
  archived?: boolean
}

export interface ExclusionDoc {
  /**
   * For pattern files: a single-element array `[<filename stem>]`.
   * For axiom files: the frontmatter `applies_to` array (possibly empty).
   * Stage 11 selects docs whose array contains the judged typeId.
   */
  questionTypeIds: string[]
  level: "pattern" | "axiom"
  /** Project-relative — used by trace UI and Stage 13 promotion citations. */
  filePath: string
  entries: ExclusionEntry[]
}

export async function loadExclusions(
  projectPath: string,
): Promise<ExclusionDoc[]> {
  const docs: ExclusionDoc[] = []

  const patternNodes = await safeList(`${projectPath}/exclusions/by_question_type`)
  for (const node of patternNodes) {
    if (!isMarkdownFile(node)) continue
    const stem = node.name.replace(/\.md$/, "")
    const filePath = `exclusions/by_question_type/${node.name}`
    const parsed = await readAndParse(projectPath, filePath)
    if (!parsed) continue
    docs.push({
      questionTypeIds: [stem],
      level: "pattern",
      filePath,
      entries: parsed.entries,
    })
  }

  const axiomNodes = await safeList(`${projectPath}/exclusions/axioms`)
  for (const node of axiomNodes) {
    if (!isMarkdownFile(node)) continue
    const filePath = `exclusions/axioms/${node.name}`
    const parsed = await readAndParse(projectPath, filePath)
    if (!parsed) continue
    docs.push({
      questionTypeIds: parseAppliesTo(parsed.fm.applies_to),
      level: "axiom",
      filePath,
      entries: parsed.entries,
    })
  }

  return docs
}

async function safeList(path: string): Promise<FileNode[]> {
  try {
    return await listDirectory(path)
  } catch {
    return []
  }
}

function isMarkdownFile(node: FileNode): boolean {
  return !node.is_dir && !node.name.startsWith(".") && node.name.endsWith(".md")
}

async function readAndParse(
  projectPath: string,
  relPath: string,
): Promise<{ fm: Record<string, unknown>; entries: ExclusionEntry[] } | null> {
  let content: string
  try {
    content = await readFile(`${projectPath}/${relPath}`)
  } catch (err) {
    console.warn(`[exclusions] failed to read ${relPath}:`, err)
    return null
  }
  try {
    const { fm, body } = parseFrontmatter(content)
    const docSources = collectDocSources(body)
    const entries = collectEntries(body, docSources)
    return { fm, entries }
  } catch (err) {
    console.warn(`[exclusions] failed to parse ${relPath}:`, err)
    return null
  }
}

function parseAppliesTo(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((v) => String(v).trim()).filter((s) => s.length > 0)
  }
  if (typeof raw === "string" && raw.trim()) return [raw.trim()]
  return []
}

function collectDocSources(body: string): string[] {
  const block = sliceSection(body, ["출처", "Sources"])
  if (!block) return []
  const out: string[] = []
  for (const line of block.split("\n")) {
    const lm = line.match(/^\s*-\s+(.+?)\s*$/)
    if (lm) out.push(lm[1].trim())
  }
  return out
}

function collectEntries(body: string, docSources: string[]): ExclusionEntry[] {
  const block = sliceSection(body, ["배제", "Exclusions"])
  if (!block) return []
  const lines = block.split("\n")
  const entries: ExclusionEntry[] = []
  let current: ExclusionEntry | null = null

  const finalize = (e: ExclusionEntry) => {
    if (e.sources.length === 0 && docSources.length > 0) {
      e.sources = [...docSources]
    }
    entries.push(e)
  }

  for (const raw of lines) {
    // Top-level list item — pattern at the dash, no leading whitespace.
    const top = raw.match(/^-\s+(.+?)\s*$/)
    if (top) {
      if (current) finalize(current)
      current = { pattern: top[1].trim(), rationale: "", sources: [] }
      continue
    }
    if (!current) continue

    // Indented `key: value` continues the current entry. The key character
    // class accepts ASCII letters/underscore plus Hangul so `근거`/`출처`
    // work without aliasing every Korean letter.
    const sub = raw.match(/^\s+([A-Za-z_ㄱ-ㆎ가-힣][\wㄱ-ㆎ가-힣-]*)\s*:\s*(.*)$/)
    if (!sub) continue
    const key = sub[1].toLowerCase()
    const val = sub[2].trim()
    if (key === "근거" || key === "rationale") {
      current.rationale = val
    } else if (key === "출처" || key === "sources") {
      current.sources = val
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    } else if (key === "archived") {
      current.archived = val.toLowerCase() === "true"
    } else if (key === "needs_review" || key === "needsreview") {
      current.needsReview = val.toLowerCase() === "true"
    } else if (key === "last_validated_at" || key === "lastvalidatedat") {
      current.lastValidatedAt = val
    }
  }
  if (current) finalize(current)
  return entries
}

function sliceSection(body: string, titles: readonly string[]): string | null {
  for (const title of titles) {
    const re = new RegExp(`^##\\s+${escapeRegex(title)}\\s*$`, "im")
    const m = body.match(re)
    if (!m) continue
    const start = (m.index ?? 0) + m[0].length
    const rest = body.slice(start)
    const next = rest.search(/\n##\s/)
    return next >= 0 ? rest.slice(0, next) : rest
  }
  return null
}

function escapeRegex(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\*]/g, "\\$&")
}

/**
 * Glob match a candidate path against a pattern.
 *
 *   `db/foo.md`              → literal
 *   `db/*.md`                → `*` matches one path segment (no `/`)
 *   `db/**\/spawn_rules.md`  → `**` matches any depth, including slashes
 *
 * Match is exact (anchored at both ends). Backslashes are not normalized
 * — callers should normalize their candidates to forward slashes first
 * (paths in our project model already use `/` consistently).
 */
export function matchesPattern(pattern: string, candidatePath: string): boolean {
  let re = "^"
  let i = 0
  while (i < pattern.length) {
    const c = pattern[i]
    if (c === "*" && pattern[i + 1] === "*") {
      re += ".*"
      i += 2
    } else if (c === "*") {
      re += "[^/]*"
      i += 1
    } else if (/[.+?^${}()|[\]\\]/.test(c)) {
      re += "\\" + c
      i += 1
    } else {
      re += c
      i += 1
    }
  }
  re += "$"
  return new RegExp(re).test(candidatePath)
}

/**
 * Reduce a candidate path list by a flat list of exclusion entries.
 *
 * Returns:
 *   - `kept`: the candidates that no entry matched.
 *   - `excludedByEntry`: per-entry hit list, keyed on the entry's pattern
 *     (used by Stage 11's trace UI to render "47 → 26 (21 제거)" with
 *     drill-down). Entries that matched zero candidates are omitted from
 *     the map — the trace block only shows entries that actually fired.
 *
 * Behavior corner-cases:
 *   - `archived: true` entries are skipped in their entirety. Filtering
 *     happens here, not at load time, so Stage 13/14 UI can still render
 *     archived entries from the loaded doc.
 *   - A pattern that matches nothing in `candidates` is silently a no-op.
 *     "누락된 path 무시" — we don't probe the filesystem; if a pattern
 *     refers to a path that no longer exists, the search just doesn't
 *     remove anything. The user will see the entry simply not fire in
 *     the trace, which is exactly the signal Stage 14 freshness needs.
 */
export function applyExclusions(
  candidates: readonly string[],
  entries: readonly ExclusionEntry[],
): { kept: string[]; excludedByEntry: Map<string, string[]> } {
  const excludedByEntry = new Map<string, string[]>()
  const excludedSet = new Set<string>()

  for (const entry of entries) {
    if (entry.archived) continue
    const hits: string[] = []
    for (const path of candidates) {
      if (matchesPattern(entry.pattern, path)) {
        hits.push(path)
        excludedSet.add(path)
      }
    }
    if (hits.length > 0) {
      excludedByEntry.set(entry.pattern, hits)
    }
  }

  const kept = candidates.filter((c) => !excludedSet.has(c))
  return { kept, excludedByEntry }
}
