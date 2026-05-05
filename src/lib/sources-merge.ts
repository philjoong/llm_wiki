/**
 * Merge a page's YAML frontmatter `sources:` array with what the LLM
 * just emitted, so re-ingesting a page that already has a history from
 * another source doesn't silently clobber that history.
 *
 * Why this exists: the stage-2 prompt instructs the LLM to emit
 * `sources: ["${sourceFileName}"]` — with JUST the current source — on
 * every FILE block. The stage-2 prompt also doesn't feed existing page
 * bodies into the context, so the LLM can't see the old sources. If
 * the ingest write were naive, each re-ingest would overwrite the
 * sources array with a single-element list, and the downstream
 * source-delete logic would later treat the page as single-sourced and
 * delete it — losing content contributed by the earlier source.
 *
 * The fix: before writing, read the existing file (if any), parse its
 * sources, union with the freshly emitted sources, rewrite the frontmatter.
 *
 * Stage 3 introduced `SourceRef`-aware variants (`parseSourceRefs`,
 * `writeSourceRefs`, `mergeSourceRefsLists`, `mergeSourceRefsIntoContent`)
 * that preserve the `range` field. The legacy string-only API is kept
 * unchanged for callers that only care about file identity (e.g. the
 * source-delete flow): when reading a page whose frontmatter uses the
 * new object form, those legacy functions transparently project each
 * entry down to its `file`.
 */
import { parseSourceRef, sourceRefKey, type SourceRef } from "./source-ref"

/**
 * Extract `sources: [...]` from the YAML frontmatter of a wiki page.
 * Returns `[]` when no sources line is found or parsing fails.
 *
 * Handles both single-line form (`sources: ["a.md", "b.md"]`) and the
 * multi-line YAML list form (`sources:\n  - a.md\n  - b.md`). Single
 * and double quotes on items are stripped; bare items are accepted.
 */
export function parseSources(content: string): string[] {
  // Project SourceRef[] down to file names. This makes the legacy API
  // transparently work on Stage-3 frontmatter that stores objects with a
  // `range:` field — callers that only care about file identity (e.g.
  // source-delete) keep working unchanged when a project mixes pre- and
  // post-Stage-3 pages.
  return parseSourceRefs(content).map((r) => r.file)
}

/**
 * Rewrite the `sources:` field of a markdown page's frontmatter to the
 * provided array. Preserves every other frontmatter line. If no
 * `sources:` line exists (LLM forgot it), one is inserted just before
 * the closing `---`. If no frontmatter exists at all, returns the
 * content unchanged — we don't manufacture frontmatter for pages the
 * LLM didn't frontmatter-prefix, since that almost certainly means
 * the emission was already malformed and the caller should surface it.
 */
export function writeSources(content: string, sources: string[]): string {
  const fmMatch = content.match(/^(---\n)([\s\S]*?)(\n---)/)
  if (!fmMatch) return content

  const [, openDelim, fmBody, closeDelim] = fmMatch
  const serialized = sources.map((s) => `"${s}"`).join(", ")
  const newLine = `sources: [${serialized}]`

  // Prefer replacing an existing inline `sources:` line in-place so
  // field ordering within the frontmatter stays the same as the LLM
  // emitted it — users don't see fields shuffle around on every
  // re-ingest.
  if (/^sources:\s*\[[^\]]*\]/m.test(fmBody)) {
    const rewritten = fmBody.replace(/^sources:\s*\[[^\]]*\]/m, newLine)
    return `${openDelim}${rewritten}${closeDelim}${content.slice(fmMatch[0].length)}`
  }

  // Replace a multi-line YAML list form with an inline form too —
  // consistent shape across pages makes downstream parsing simpler.
  if (/^sources:\s*\n((?:[ \t]+-\s+.+\n?)+)/m.test(fmBody)) {
    const rewritten = fmBody.replace(
      /^sources:\s*\n((?:[ \t]+-\s+.+\n?)+)/m,
      newLine,
    )
    return `${openDelim}${rewritten}${closeDelim}${content.slice(fmMatch[0].length)}`
  }

  // No sources field at all — append one at the end of the frontmatter.
  const rewritten = `${fmBody}\n${newLine}`
  return `${openDelim}${rewritten}${closeDelim}${content.slice(fmMatch[0].length)}`
}

/**
 * Merge two source lists, case-insensitively deduped. Order of existing
 * entries is preserved; new entries not already present are appended
 * in the order they appear in `incoming`.
 *
 * Case handling: if both lists contain the same name but with different
 * casing (e.g. "Test.md" and "test.md"), the first-seen form wins.
 * This keeps the user's original filename casing stable on disk.
 */
export function mergeSourcesLists(
  existing: readonly string[],
  incoming: readonly string[],
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of [...existing, ...incoming]) {
    const key = s.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  return out
}

/**
 * The main entry point used from ingest: given the content the LLM
 * just emitted for a page (`newContent`), and whatever is currently on
 * disk at that path (`existingContent`, or null if the page is new),
 * return content whose `sources:` field is the union of both.
 *
 * For new pages: returns newContent unchanged.
 * For existing pages with no frontmatter: returns newContent unchanged
 *   (don't corrupt unconventional files).
 * For existing pages with frontmatter: merges sources, rewrites.
 */
export function mergeSourcesIntoContent(
  newContent: string,
  existingContent: string | null,
): string {
  if (!existingContent) return newContent
  const oldSources = parseSources(existingContent)
  if (oldSources.length === 0) return newContent
  const newSources = parseSources(newContent)
  const merged = mergeSourcesLists(oldSources, newSources)
  // Avoid writing a no-op change: if nothing actually needs merging,
  // hand back the original newContent verbatim so hashes / caches stay
  // stable.
  if (
    merged.length === newSources.length &&
    merged.every((s, i) => s === newSources[i])
  ) {
    return newContent
  }
  return writeSources(newContent, merged)
}

// ── Stage 3: SourceRef-aware variants ──────────────────────────────────
//
// The Stage 3 ingest prompt instructs the LLM to emit frontmatter with
// objects, not bare strings:
//
//   sources:
//     - file: instance_server_design.md
//       range: ## 3. 던전 A — 보상
//
// The variants below preserve the `range` field across re-ingest, which
// the legacy string-based path can't. Use them from any pipeline that
// needs ranges to round-trip; legacy callers that only care about file
// identity (e.g. source-delete) can keep using the plain `parseSources`
// API — it transparently projects new-format frontmatter down to file
// names.

/**
 * Parse `sources:` from frontmatter into SourceRef[]. Recognized forms:
 *
 *   1. Inline string array     — `sources: ["a.md", "b.md"]`
 *   2. Multi-line string list  — `sources:\n  - a.md\n  - b.md`
 *   3. Multi-line object list  — `sources:\n  - file: a.md\n    range: ...`
 *
 * Form 3 is what Stage 3 ingest emits. Forms 1 and 2 are legacy / pre-
 * Stage-3 pages — those parse with no `range` field (just `{file}`).
 */
export function parseSourceRefs(content: string): SourceRef[] {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
  const fm = fmMatch ? fmMatch[1] : content

  // Locate the `sources:` line and everything that belongs to it. We
  // match either the inline form or the start of a multi-line block;
  // the actual entry parsing happens below.
  const headerMatch = fm.match(/^sources:\s*(\[[^\]]*\])?\s*$/m)
  if (!headerMatch) {
    return []
  }

  // Inline form on the same line as the key.
  if (headerMatch[1]) {
    return parseInlineArray(headerMatch[1])
  }

  // Multi-line form: collect indented lines following the `sources:` line.
  const headerIdx = fm.indexOf(headerMatch[0])
  const after = fm.slice(headerIdx + headerMatch[0].length)
  const block = takeIndentedBlock(after)
  return parseMultiLineBlock(block)
}

/** Parse the contents of `[ ... ]` for inline sources arrays. */
function parseInlineArray(bracketed: string): SourceRef[] {
  // Strip outer brackets and split on commas not inside quotes/braces.
  // Keep this simple: only legacy projects use the inline form, and
  // they always store bare strings (no inline objects).
  const body = bracketed.slice(1, -1).trim()
  if (body === "") return []
  const refs: SourceRef[] = []
  for (const tok of body.split(",")) {
    const cleaned = tok.trim().replace(/^["']|["']$/g, "")
    const ref = parseSourceRef(cleaned)
    if (ref) refs.push(ref)
  }
  return refs
}

/**
 * Pull the contiguous indented block that follows `sources:`. Stops at
 * the first non-indented non-empty line — that's the next frontmatter
 * field. A blank line inside the block keeps the block alive (YAML allows
 * blank lines inside a list, even though our writer never emits them).
 */
function takeIndentedBlock(rest: string): string {
  const lines = rest.split("\n")
  // The header match consumed the trailing newline of the `sources:`
  // line, so `lines[0]` is the first real line of the block.
  const collected: string[] = []
  for (const line of lines) {
    if (line === "") {
      collected.push(line)
      continue
    }
    // Indented (space or tab) → still inside the block.
    if (/^[ \t]/.test(line)) {
      collected.push(line)
      continue
    }
    break
  }
  return collected.join("\n")
}

/**
 * Parse a multi-line block into SourceRef[]. Handles both the legacy
 * string form (`  - a.md`) and the Stage-3 object form
 * (`  - file: a.md\n    range: ...`). Mixed entries in the same list
 * are tolerated — each `- ` opens a new entry.
 */
function parseMultiLineBlock(block: string): SourceRef[] {
  const refs: SourceRef[] = []
  const lines = block.split("\n")
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    // Match "  - <something>" — that opens a list entry.
    const entryMatch = line.match(/^[ \t]+-\s+(.*)$/)
    if (!entryMatch) {
      i++
      continue
    }
    const head = entryMatch[1].trim()
    // Object-form entry: `- file: foo.md` (range may follow on next line)
    const fileMatch = head.match(/^file:\s*(.+)$/)
    if (fileMatch) {
      const file = stripQuotes(fileMatch[1].trim())
      let range: string | undefined
      // Look at subsequent more-deeply-indented lines for sibling keys.
      i++
      while (i < lines.length) {
        const sub = lines[i]
        const subMatch = sub.match(/^[ \t]+([a-zA-Z_]\w*):\s*(.*)$/)
        // Stop the sub-loop at: another `- ` entry, or any non-indented /
        // non-key continuation.
        if (!subMatch || /^[ \t]+-\s/.test(sub)) break
        if (subMatch[1] === "range") {
          range = stripQuotes(subMatch[2].trim())
        }
        // Other sibling keys (confidence, etc.) ignored for now.
        i++
      }
      const ref = parseSourceRef(range ? { file, range } : { file })
      if (ref) refs.push(ref)
      continue
    }
    // String-form entry: `- foo.md`
    const ref = parseSourceRef(stripQuotes(head))
    if (ref) refs.push(ref)
    i++
  }
  return refs
}

function stripQuotes(s: string): string {
  // YAML-flavor unquote. Strip matching outer quotes; if double-quoted,
  // also un-escape the two sequences our writer ever emits (`\"` and
  // `\\`). Single-quoted YAML doesn't recognize backslash escapes, so
  // those pass through as-is.
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\")
  }
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1)
  }
  return s
}

/**
 * Rewrite the `sources:` field as a multi-line object list. Preserves
 * every other frontmatter line. If there's no frontmatter, the content
 * is returned unchanged.
 *
 * Output shape (always — even when refs have no `range`):
 *   sources:
 *     - file: foo.md
 *       range: ## section 3      # only when range is set
 *
 * The shape is intentionally object-form, not string-form, so a
 * subsequent re-ingest can pick the range back out of the file. The
 * tradeoff: legacy callers that look for `sources: [...]` substrings
 * won't find them. `parseSources` handles both forms transparently, so
 * runtime callers are fine; only string-search assertions in old tests
 * need updating.
 */
export function writeSourceRefs(content: string, refs: SourceRef[]): string {
  const fmMatch = content.match(/^(---\n)([\s\S]*?)(\n---)/)
  if (!fmMatch) return content

  const [, openDelim, fmBody, closeDelim] = fmMatch
  const block = serializeRefsBlock(refs)

  // Replace an existing inline `sources: [...]` line.
  if (/^sources:\s*\[[^\]]*\]\s*$/m.test(fmBody)) {
    const rewritten = fmBody.replace(/^sources:\s*\[[^\]]*\]\s*$/m, block)
    return `${openDelim}${rewritten}${closeDelim}${content.slice(fmMatch[0].length)}`
  }

  // Replace an existing multi-line block (string OR object form). We
  // identify the block by scanning indentation: everything from the
  // `sources:` line up to the first non-indented, non-blank line.
  const headerMatch = fmBody.match(/^sources:\s*$/m)
  if (headerMatch) {
    const headerIdx = fmBody.indexOf(headerMatch[0])
    const before = fmBody.slice(0, headerIdx)
    const afterHeader = fmBody.slice(headerIdx + headerMatch[0].length + 1) // +1 for \n
    // Find where the block ends.
    const lines = afterHeader.split("\n")
    let consumed = 0
    for (const line of lines) {
      if (line === "" || /^[ \t]/.test(line)) {
        consumed += line.length + 1 // +1 for \n
        continue
      }
      break
    }
    const tail = afterHeader.slice(consumed)
    const rewritten = `${before}${block}\n${tail}`.replace(/\n+$/, "")
    return `${openDelim}${rewritten}${closeDelim}${content.slice(fmMatch[0].length)}`
  }

  // No sources field at all — append one at the end of the frontmatter.
  const rewritten = `${fmBody}\n${block}`
  return `${openDelim}${rewritten}${closeDelim}${content.slice(fmMatch[0].length)}`
}

function serializeRefsBlock(refs: SourceRef[]): string {
  if (refs.length === 0) return "sources: []"
  const lines = ["sources:"]
  for (const ref of refs) {
    lines.push(`  - file: ${ref.file}`)
    if (ref.range) {
      // Quote the range — heading paths can contain colons, dashes, and
      // unicode that confuse YAML readers if left bare.
      lines.push(`    range: ${quoteForYaml(ref.range)}`)
    }
  }
  return lines.join("\n")
}

function quoteForYaml(s: string): string {
  // Use double quotes; escape any embedded double quotes and backslashes.
  // YAML is tolerant about most other characters inside double quotes.
  const escaped = s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
  return `"${escaped}"`
}

/**
 * Merge two SourceRef lists keyed on `(file, range)` (case-insensitive
 * on both fields). Order of existing entries is preserved; new entries
 * not already present are appended in the order they appear.
 *
 * Note: two refs with the same file but different ranges are KEPT as
 * separate entries — that's exactly the case Stage 3 cares about
 * (multiple sections of the same raw doc landed on the same page).
 * If two entries share both fields, the existing-side casing wins to
 * keep on-disk filenames stable.
 */
export function mergeSourceRefsLists(
  existing: readonly SourceRef[],
  incoming: readonly SourceRef[],
): SourceRef[] {
  const seen = new Set<string>()
  const out: SourceRef[] = []
  for (const ref of [...existing, ...incoming]) {
    const key = sourceRefKey(ref)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(ref)
  }
  return out
}

/**
 * SourceRef-aware merge: same contract as `mergeSourcesIntoContent` but
 * preserves `range` fields. Used by Stage 3 ingest when writing pages
 * under db/ that may already exist from an earlier raw file.
 */
export function mergeSourceRefsIntoContent(
  newContent: string,
  existingContent: string | null,
): string {
  if (!existingContent) return newContent
  const oldRefs = parseSourceRefs(existingContent)
  if (oldRefs.length === 0) return newContent
  const newRefs = parseSourceRefs(newContent)
  const merged = mergeSourceRefsLists(oldRefs, newRefs)
  // Fast path: if the merge changed nothing observable, hand back the
  // unchanged content (preserves caller-side identity / hashes).
  if (
    merged.length === newRefs.length &&
    merged.every((r, i) => sourceRefKey(r) === sourceRefKey(newRefs[i]))
  ) {
    return newContent
  }
  return writeSourceRefs(newContent, merged)
}
