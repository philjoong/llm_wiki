/**
 * Stage 14 — self-correction mechanisms for the exclusion map.
 *
 * IDEA §2.8 lays out four invalidation paths that keep the exclusion map
 * from accumulating dead weight forever. This module is the data layer
 * for all four:
 *
 *   1. 출처 의존성 (source dependency) — when an entry's cited source
 *      file has been modified after the entry's `last_validated_at`,
 *      flag `needs_review: true`. {@link checkSourceFreshness}
 *
 *   2. 신선도 (freshness)            — axioms whose `last_validated_at`
 *      is older than `freshness_days` are reported as `stale`.
 *      {@link findStaleAxioms}
 *
 *   3. 반례 발견 (counterexample)    — when a user marks a search hit
 *      as a "correct" answer, every entry across the project that
 *      *excludes* that exact path is flagged for human review.
 *      {@link recordCounterexample}
 *
 *   4. 명시적 폐기 (explicit retract) — `archived: true` flag on the
 *      entry's markdown sub-fields. {@link setEntryFlag} +
 *      {@link unsetEntryFlag}.  `applyExclusions` already skips
 *      archived entries (Stage 9), so flipping the flag is enough.
 *
 * Markdown shape (extending Stage 9's entry parser, already understood
 * by {@link loadExclusions}):
 *
 *   ## 배제
 *   - db/foo.md
 *     근거: ...
 *     출처: db/policy.md
 *     last_validated_at: 2026-04-12
 *     needs_review: true
 *     archived: true
 *
 * The writer here preserves whatever lines existed in the file and only
 * surgically mutates the target sub-field block. Pattern matches are
 * exact (string equality on the trimmed `- <pattern>` line) — globs are
 * resolved only at search time, not at this layer.
 *
 * Source modification times are passed in as a plain `Map<path, ISO>`.
 * Tests stub the map directly; the production caller (UI button) is free
 * to fill it however it wants — filesystem mtime, git mtime, content
 * hash, etc. — without this module taking a dependency on git/fs ordering.
 */
import { fileExists, readFile, writeFile } from "@/commands/fs"
import { gitCommit, gitLog, gitShow } from "@/commands/git"
import { normalizePath } from "@/lib/path-utils"
import { withProjectLock } from "@/lib/project-mutex"
import {
  loadExclusions,
  type ExclusionDoc,
  type ExclusionEntry,
} from "./exclusions"

export interface EntryRef {
  /** Project-relative — e.g. `exclusions/by_question_type/policy_violation.md`. */
  filePath: string
  /** Exact pattern string used at the entry's top-level list item. */
  pattern: string
}

export interface NeedsReviewRow {
  ref: EntryRef
  /** Sources whose mtime is newer than the entry's `last_validated_at`. */
  staleSources: string[]
  /** The entry's stored `last_validated_at` (echoed for UI). */
  lastValidatedAt: string
}

export interface SourceFreshnessResult {
  /** Per-entry rows. Sorted by filePath then pattern for stable UI ordering. */
  rows: NeedsReviewRow[]
}

export interface StaleAxiomRow {
  ref: EntryRef
  /** Days between `now` and the entry's `last_validated_at`. */
  ageDays: number
  lastValidatedAt: string
}

export interface StaleAxiomResult {
  rows: StaleAxiomRow[]
}

/**
 * Find entries whose cited source files have been modified after the
 * entry's `last_validated_at`. Entries without either field are skipped —
 * source freshness is opt-in per entry, not retroactively applied.
 *
 * `mtimes` is `path → ISO date`. Paths that aren't present in the map
 * are treated as "unknown" and skipped (matches the Stage 9 stance:
 * a missing source is not a freshness signal, it's just nothing to compare).
 */
export function checkSourceFreshness(
  docs: readonly ExclusionDoc[],
  mtimes: ReadonlyMap<string, string>,
): SourceFreshnessResult {
  const rows: NeedsReviewRow[] = []
  for (const doc of docs) {
    for (const entry of doc.entries) {
      if (entry.archived) continue
      if (!entry.lastValidatedAt) continue
      const validatedAt = parseIso(entry.lastValidatedAt)
      if (validatedAt === null) continue
      const stale: string[] = []
      for (const src of entry.sources) {
        if (!looksLikePath(src)) continue
        const mtime = mtimes.get(src)
        if (!mtime) continue
        const mt = parseIso(mtime)
        if (mt === null) continue
        if (mt > validatedAt) stale.push(src)
      }
      if (stale.length > 0) {
        rows.push({
          ref: { filePath: doc.filePath, pattern: entry.pattern },
          staleSources: stale,
          lastValidatedAt: entry.lastValidatedAt,
        })
      }
    }
  }
  rows.sort((a, b) => {
    const f = a.ref.filePath.localeCompare(b.ref.filePath)
    if (f !== 0) return f
    return a.ref.pattern.localeCompare(b.ref.pattern)
  })
  return { rows }
}

/**
 * Surface axiom entries whose `last_validated_at` is older than the
 * project's freshness window. Only axiom-level docs are reported —
 * pattern files are short-lived by design and don't carry the same
 * "this is a long-standing rule" semantics that staleness targets.
 *
 * `freshnessDays` typically comes from `loadThresholds` (Stage 13's
 * promotion_rules.md → `freshness_days`). Entries without
 * `last_validated_at` are ignored — they were never validated, so
 * "going stale" doesn't apply.
 */
export function findStaleAxioms(
  docs: readonly ExclusionDoc[],
  freshnessDays: number,
  now: Date = new Date(),
): StaleAxiomResult {
  const rows: StaleAxiomRow[] = []
  const cutoffMs = freshnessDays * 24 * 60 * 60 * 1000
  for (const doc of docs) {
    if (doc.level !== "axiom") continue
    for (const entry of doc.entries) {
      if (entry.archived) continue
      if (!entry.lastValidatedAt) continue
      const validated = parseIso(entry.lastValidatedAt)
      if (validated === null) continue
      const age = now.getTime() - validated.getTime()
      if (age > cutoffMs) {
        rows.push({
          ref: { filePath: doc.filePath, pattern: entry.pattern },
          ageDays: Math.floor(age / (24 * 60 * 60 * 1000)),
          lastValidatedAt: entry.lastValidatedAt,
        })
      }
    }
  }
  rows.sort((a, b) => b.ageDays - a.ageDays)
  return { rows }
}

export interface CounterexampleResult {
  flagged: EntryRef[]
}

/**
 * When a chat user marks a result hit as correct, that hit should NOT
 * have been excluded. Flag every entry across the project whose pattern
 * matches the path as `needs_review: true`. Also append a citation line
 * so the user can trace back why the entry was flagged.
 *
 * No commit is rolled — each entry's flag mutation is committed
 * individually so history reads as one logical mark-per-entry, not a
 * bulk "everything flagged because of one click".
 */
export async function recordCounterexample(
  projectPath: string,
  excludedPath: string,
  citation: string,
): Promise<CounterexampleResult> {
  const pp = normalizePath(projectPath)
  const docs = await loadExclusions(pp)
  const flagged: EntryRef[] = []

  for (const doc of docs) {
    for (const entry of doc.entries) {
      if (entry.archived) continue
      if (!matchesPatternStrict(entry.pattern, excludedPath)) continue
      const ref = { filePath: doc.filePath, pattern: entry.pattern }
      await setEntryFlag(pp, ref, "needs_review", true, {
        appendSource: `반례: ${excludedPath} → ${citation}`,
        commitMessage: `counterexample: ${doc.filePath} — ${entry.pattern}`,
      })
      flagged.push(ref)
    }
  }
  return { flagged }
}

export interface SetEntryFlagOptions {
  /** Extra source citation appended to the entry's `출처:` list. */
  appendSource?: string
  /** Override the default git commit message. */
  commitMessage?: string
}

/**
 * Toggle a boolean flag on a single entry's markdown sub-fields and
 * commit. Supports `archived`, `needs_review`. Existing values are
 * replaced; absent values are inserted as a new sub-field line in the
 * entry's indented block.
 *
 * Returns `null` commitHash when nothing changed (e.g. flag already at
 * the requested value). This lets the caller short-circuit UI feedback
 * without claiming a commit was made.
 */
export async function setEntryFlag(
  projectPath: string,
  ref: EntryRef,
  flag: "needs_review" | "archived",
  value: boolean,
  opts: SetEntryFlagOptions = {},
): Promise<{ commitHash: string | null }> {
  const pp = normalizePath(projectPath)
  const abs = `${pp}/${ref.filePath}`
  if (!(await fileExists(abs).catch(() => false))) {
    return { commitHash: null }
  }
  const before = await readFile(abs)
  const fieldKey = flag === "needs_review" ? "needs_review" : "archived"
  let next = setEntrySubField(before, ref.pattern, fieldKey, String(value))
  if (opts.appendSource) {
    next = appendEntrySource(next, ref.pattern, opts.appendSource)
  }
  if (next === before) return { commitHash: null }

  await writeFile(abs, next)
  const message =
    opts.commitMessage ??
    `exclusion: set ${fieldKey}=${value} — ${ref.filePath} (${ref.pattern})`
  const commit = await withProjectLock(pp, () =>
    gitCommit(pp, message, [ref.filePath]),
  )
  return { commitHash: commit.commitHash }
}

/**
 * Refresh an entry's `last_validated_at` to `now` and clear
 * `needs_review` so the freshness check stops surfacing it. Intended for
 * the "Mark validated" UI action: user has eyeballed the entry and
 * confirms it's still correct.
 */
export async function markValidated(
  projectPath: string,
  ref: EntryRef,
  now: Date = new Date(),
): Promise<{ commitHash: string | null }> {
  const pp = normalizePath(projectPath)
  const abs = `${pp}/${ref.filePath}`
  if (!(await fileExists(abs).catch(() => false))) {
    return { commitHash: null }
  }
  const before = await readFile(abs)
  const iso = now.toISOString().slice(0, 10)
  let next = setEntrySubField(before, ref.pattern, "last_validated_at", iso)
  // Clearing needs_review is a no-op if it wasn't set — same code path.
  next = setEntrySubField(next, ref.pattern, "needs_review", "false")
  if (next === before) return { commitHash: null }

  await writeFile(abs, next)
  const message = `exclusion: validated ${ref.filePath} (${ref.pattern}) — ${iso}`
  const commit = await withProjectLock(pp, () =>
    gitCommit(pp, message, [ref.filePath]),
  )
  return { commitHash: commit.commitHash }
}

// ── helpers ──────────────────────────────────────────────────────────

/**
 * Tight match for the counterexample path-vs-pattern check. Reuses
 * Stage 9 glob semantics (`*` single segment, `**` any depth) but goes
 * via a local copy so this module doesn't pull a circular import.
 */
function matchesPatternStrict(pattern: string, candidate: string): boolean {
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
  return new RegExp(re).test(candidate)
}

/**
 * A `sources` array entry counts as a "file source" iff it looks like a
 * path. Free-form citations like "사람 검토 (2026-04-12)" are kept in
 * the same field for human readability but skipped here. Conservative:
 * we only honor entries containing a `/` or ending in `.md`.
 */
function looksLikePath(src: string): boolean {
  const s = src.trim()
  if (!s) return false
  if (s.includes("/")) return true
  if (s.endsWith(".md")) return true
  return false
}

function parseIso(s: string): Date | null {
  // Accept both `2026-04-12` and full ISO timestamps. `Date.parse` returns
  // NaN on garbage which we map to null.
  const t = Date.parse(s)
  if (Number.isNaN(t)) return null
  return new Date(t)
}

/**
 * Replace or insert a `<key>: <value>` sub-field line beneath the entry
 * whose top-level dash line equals `- <pattern>` (trimmed). Returns the
 * full updated content. If the entry isn't found, returns the input
 * unchanged.
 */
export function setEntrySubField(
  content: string,
  pattern: string,
  key: string,
  value: string,
): string {
  const lines = content.split("\n")
  const targetTop = pattern.trim()
  let entryIdx = -1
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^-\s+(.+?)\s*$/)
    if (m && m[1].trim() === targetTop) {
      entryIdx = i
      break
    }
  }
  if (entryIdx === -1) return content

  // Walk indented sub-field lines beneath the entry.
  let subStart = entryIdx + 1
  let subEnd = subStart
  while (subEnd < lines.length) {
    const ln = lines[subEnd]
    if (/^-\s/.test(ln)) break // next top-level entry
    if (/^##\s/.test(ln)) break // next section
    if (/^\s+/.test(ln) || ln.trim() === "") {
      subEnd++
      continue
    }
    break
  }

  // Try to find an existing key line within the run.
  const keyRe = new RegExp(`^(\\s+)(${escapeRegex(key)})\\s*:\\s*.*$`)
  let replaced = false
  for (let i = subStart; i < subEnd; i++) {
    const m = lines[i].match(keyRe)
    if (!m) continue
    lines[i] = `${m[1]}${key}: ${value}`
    replaced = true
    break
  }
  if (replaced) return lines.join("\n")

  // Insert a new sub-field line just before the trailing blank-line run
  // (if any) so the entry's block stays compact.
  let insertAt = subEnd
  while (insertAt > subStart && lines[insertAt - 1].trim() === "") {
    insertAt--
  }
  const indent = pickIndent(lines, subStart, subEnd)
  lines.splice(insertAt, 0, `${indent}${key}: ${value}`)
  return lines.join("\n")
}

/**
 * Append a free-form citation to an entry's `출처:` (or `sources:`)
 * comma-separated sub-field. If neither exists, insert a fresh
 * `출처: <citation>` sub-field.
 */
export function appendEntrySource(
  content: string,
  pattern: string,
  citation: string,
): string {
  const lines = content.split("\n")
  const targetTop = pattern.trim()
  let entryIdx = -1
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^-\s+(.+?)\s*$/)
    if (m && m[1].trim() === targetTop) {
      entryIdx = i
      break
    }
  }
  if (entryIdx === -1) return content

  let subStart = entryIdx + 1
  let subEnd = subStart
  while (subEnd < lines.length) {
    const ln = lines[subEnd]
    if (/^-\s/.test(ln)) break
    if (/^##\s/.test(ln)) break
    if (/^\s+/.test(ln) || ln.trim() === "") {
      subEnd++
      continue
    }
    break
  }

  const srcRe = /^(\s+)(출처|sources)\s*:\s*(.*)$/i
  for (let i = subStart; i < subEnd; i++) {
    const m = lines[i].match(srcRe)
    if (!m) continue
    const cur = m[3].trim()
    if (cur.split(",").map((s) => s.trim()).includes(citation)) {
      return content // already cited
    }
    lines[i] = cur
      ? `${m[1]}${m[2]}: ${cur}, ${citation}`
      : `${m[1]}${m[2]}: ${citation}`
    return lines.join("\n")
  }
  // No 출처 line — insert one.
  let insertAt = subEnd
  while (insertAt > subStart && lines[insertAt - 1].trim() === "") {
    insertAt--
  }
  const indent = pickIndent(lines, subStart, subEnd)
  lines.splice(insertAt, 0, `${indent}출처: ${citation}`)
  return lines.join("\n")
}

function pickIndent(lines: string[], start: number, end: number): string {
  for (let i = start; i < end; i++) {
    const m = lines[i].match(/^(\s+)\S/)
    if (m) return m[1]
  }
  return "  "
}

function escapeRegex(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\*]/g, "\\$&")
}

/**
 * Re-export the entry shape so callers don't have to import both modules.
 * Mostly for the UI badge components in Stage 14.
 */
export type { ExclusionEntry, ExclusionDoc }

// ── git-mtime helper (production wiring for source freshness) ────────

/**
 * Compute "last modified" ISO timestamps for `paths` by walking the
 * project's git history newest-first. Returns paths absent from history
 * silently — the caller treats "no mtime" as "unknown" and skips.
 *
 * Cost: O(N) `git show` per commit, where N is the depth we have to
 * scan. We early-out as soon as every requested path is resolved, which
 * is the common case (sources changed recently, get resolved in the
 * first few commits). For unchanged paths, the worst case is the full
 * `commitLimit` window.
 */
export async function getGitMtimes(
  projectPath: string,
  paths: readonly string[],
  commitLimit: number = 200,
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (paths.length === 0) return out
  const want = new Set(paths)

  let commits
  try {
    commits = await gitLog(projectPath, commitLimit)
  } catch {
    return out
  }
  for (const c of commits) {
    if (out.size >= want.size) break
    try {
      const detail = await gitShow(projectPath, c.hash)
      for (const f of detail.files) {
        if (want.has(f.path) && !out.has(f.path)) {
          out.set(f.path, c.date)
          if (out.size >= want.size) break
        }
      }
    } catch {
      // Unparseable commit (e.g. a merge with funky format) — skip.
    }
  }
  return out
}

/**
 * Combined freshness pass for the promotion panel: load entries, find
 * which ones need review (source modified) or are stale, and apply
 * `needs_review: true` to the former in one go. Returns the raw
 * source-freshness rows + the stale-axiom rows so the UI can render
 * dedicated sections.
 *
 * Errors during the `setEntryFlag` write are swallowed per-entry —
 * a single corrupted file shouldn't stop the rest of the report.
 */
export async function runFreshnessCheck(
  projectPath: string,
  freshnessDays: number,
  now: Date = new Date(),
): Promise<{
  freshness: SourceFreshnessResult
  staleness: StaleAxiomResult
}> {
  const pp = normalizePath(projectPath)
  const docs = await loadExclusions(pp)

  // Collect every `looksLikePath` source across every active entry.
  const sourcePaths = new Set<string>()
  for (const doc of docs) {
    for (const entry of doc.entries) {
      if (entry.archived) continue
      for (const src of entry.sources) {
        if (looksLikePath(src)) sourcePaths.add(src)
      }
    }
  }

  const mtimes = await getGitMtimes(pp, [...sourcePaths])
  const freshness = checkSourceFreshness(docs, mtimes)
  const staleness = findStaleAxioms(docs, freshnessDays, now)

  for (const row of freshness.rows) {
    try {
      await setEntryFlag(pp, row.ref, "needs_review", true)
    } catch (err) {
      console.warn(
        `[exclusion-validity] failed to flag ${row.ref.filePath}:`,
        err,
      )
    }
  }

  return { freshness, staleness }
}

/**
 * Flatten the loaded docs into a UI-ready list of entries with their
 * containing doc's metadata. Drops nothing — archived entries are
 * surfaced so the user can Restore them.
 */
export interface EntryListing {
  ref: EntryRef
  entry: ExclusionEntry
  level: "pattern" | "axiom"
  /** typeId(s) the doc applies to. */
  questionTypeIds: string[]
}

export async function loadAllEntries(
  projectPath: string,
): Promise<EntryListing[]> {
  const pp = normalizePath(projectPath)
  const docs = await loadExclusions(pp)
  const out: EntryListing[] = []
  for (const doc of docs) {
    for (const entry of doc.entries) {
      out.push({
        ref: { filePath: doc.filePath, pattern: entry.pattern },
        entry,
        level: doc.level,
        questionTypeIds: doc.questionTypeIds,
      })
    }
  }
  return out
}
