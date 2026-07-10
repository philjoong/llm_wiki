/**
 * SourceRef — the "where in the raw file did this come from" handle that
 * ingest's file-write step writes into every generated page's frontmatter.
 *
 * Shape:
 *   - `file`  — the original raw filename (e.g. "instance_server_design.md")
 *   - `range` — a human-readable pointer back into that file: a heading
 *               path (`## 3. 던전 A — 보상`), a sheet+range
 *               (`DungeonA!B12:E18`), a timestamp (`12:30-15:10`), a URL
 *               anchor, etc. The format is up to the source-document type;
 *               the ingest pipeline does not interpret it.
 *
 * Backward compat: pages written before this SourceRef object form existed
 * stored sources as a flat string array (`sources: ["foo.md"]`).
 * `parseSourceRef` accepts both that legacy form (string → `{file}` with
 * no range) and the new object form.
 */
export interface SourceRef {
  file: string
  range?: string
}

/**
 * Coerce a single sources-list entry into a SourceRef.
 * Accepts:
 *   - "foo.md"                            → { file: "foo.md" }
 *   - { file, range }                     → { file, range }
 *   - { file }                            → { file }
 * Rejects anything missing a usable `file` field by returning null.
 */
export function parseSourceRef(input: unknown): SourceRef | null {
  if (typeof input === "string") {
    const file = input.trim()
    return file.length > 0 ? { file } : null
  }
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const obj = input as Record<string, unknown>
    const file = typeof obj.file === "string" ? obj.file.trim() : ""
    if (file.length === 0) return null
    const range = typeof obj.range === "string" ? obj.range.trim() : ""
    return range.length > 0 ? { file, range } : { file }
  }
  return null
}

/**
 * Compact serialization used in commit messages and human-facing UI.
 * Returns `<file>` when there's no range, `<file>:<range>` otherwise.
 *
 * The colon-joined form matches what `formatModificationMessage` already
 * emits in commit trailers (see auto-commit.ts), keeping a single
 * canonical text shape across the codebase.
 */
export function serializeSourceRef(ref: SourceRef): string {
  return ref.range ? `${ref.file}:${ref.range}` : ref.file
}

/**
 * Stable identity key for dedup. Two refs that point at the same file and
 * the same range should collapse to one entry on merge — but two refs at
 * the same file with DIFFERENT ranges (e.g. two sections of the same raw
 * doc that landed on the same page) are kept as separate entries.
 *
 * Case-insensitive on both fields so casing differences don't produce
 * spurious duplicates after re-ingest. range is trimmed but not normalized
 * further (whitespace and punctuation inside a range may carry meaning).
 */
export function sourceRefKey(ref: SourceRef): string {
  const file = ref.file.toLowerCase()
  const range = (ref.range ?? "").toLowerCase()
  return `${file}|${range}`
}
