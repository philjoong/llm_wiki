import { sourceRefKey, type SourceRef } from "./source-ref"

/** A v2 document must use a structured `sources` list. */
export class SourceRefValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SourceRefValidationError"
  }
}

/**
 * Read the v2 `sources` frontmatter field.
 *
 * Only the object form is accepted:
 *
 * sources:
 *   - file: raw.md
 *     range: "## Heading"
 *
 * A legacy string array/list is deliberately rejected rather than guessed at
 * or rewritten. Callers should surface the resulting VALIDATION_FAILED error
 * and let the user restore or migrate from a backup.
 */
export function parseSourceRefs(
  content: string,
): SourceRef[] {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (!fmMatch) return []
  const fm = fmMatch[1]
  const header = fm.match(/^sources:[ \t]*(.*?)[ \t]*$/m)
  if (!header) return []
  if (header[1] !== "") {
    throw new SourceRefValidationError("sources must be a structured SourceRef list, not an inline value")
  }

  const after = fm.slice(fm.indexOf(header[0]) + header[0].length)
  const lines = after.split("\n")
  const refs: SourceRef[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (line === "") { index++; continue }
    if (!/^[ \t]/.test(line)) break
    const entry = line.match(/^[ \t]+-\s+file:\s*(.+?)\s*$/)
    if (!entry) {
      throw new SourceRefValidationError("each sources entry must be an object with a file field")
    }
    const file = unquote(entry[1])
    if (!file) throw new SourceRefValidationError("SourceRef.file must be a non-empty string")
    index++
    let range: string | undefined
    while (index < lines.length) {
      const child = lines[index]
      if (child === "") { index++; continue }
      if (!/^[ \t]/.test(child) || /^[ \t]+-\s/.test(child)) break
      const field = child.match(/^[ \t]+([A-Za-z_]\w*):\s*(.*?)\s*$/)
      if (!field) throw new SourceRefValidationError("invalid SourceRef field")
      if (field[1] === "range") {
        const value = unquote(field[2])
        if (!value) throw new SourceRefValidationError("SourceRef.range must be a non-empty string when present")
        range = value
      }
      index++
    }
    refs.push(range ? { file, range } : { file })
  }
  return refs
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\").trim()
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).trim()
  return trimmed
}

/** Rewrite `sources` in canonical structured SourceRef form. */
export function writeSourceRefs(
  content: string,
  refs: readonly SourceRef[],
) {
  const fmMatch = content.match(/^(---\n)([\s\S]*?)(\n---)/)
  if (!fmMatch) throw new SourceRefValidationError("v2 source metadata requires YAML frontmatter")
  const [, open, body, close] = fmMatch
  const block = serializeRefsBlock(refs)
  const header = body.match(/^sources:[ \t]*.*$/m)
  let rewritten: string
  if (header) {
    const start = body.indexOf(header[0])
    const before = body.slice(0, start)
    const remainder = body.slice(start + header[0].length).replace(/^\n/, "")
    const tailLines = remainder.split("\n")
    let consumed = 0
    while (consumed < tailLines.length && (tailLines[consumed] === "" || /^[ \t]/.test(tailLines[consumed]))) consumed++
    const tail = tailLines.slice(consumed).join("\n")
    rewritten = `${before}${block}${tail ? `\n${tail}` : ""}`
  } else {
    rewritten = `${body}\n${block}`
  }
  return `${open}${rewritten}${close}${content.slice(fmMatch[0].length)}`
}

function serializeRefsBlock(
  refs: readonly SourceRef[],
): string {
  if (!refs.length) return "sources:"
  return ["sources:", ...refs.flatMap((ref) => [
    `  - file: ${quote(ref.file)}`,
    ...(ref.range ? [`    range: ${quote(ref.range)}`] : []),
  ])].join("\n")
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

export function mergeSourceRefsLists(existing: readonly SourceRef[], incoming: readonly SourceRef[]): SourceRef[] {
  const seen = new Set<string>()
  return [...existing, ...incoming].filter((ref) => {
    const key = sourceRefKey(ref)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Merge only validated v2 SourceRef frontmatter. */
export function mergeSourceRefsIntoContent(
  newContent: string,
  existingContent: string | null,
): string {
  const incoming = parseSourceRefs(newContent)
  if (!existingContent) return newContent
  const existing = parseSourceRefs(existingContent)
  if (!existing.length) return newContent
  const merged = mergeSourceRefsLists(existing, incoming)
  return merged.length === incoming.length && merged.every((ref, i) => sourceRefKey(ref) === sourceRefKey(incoming[i]))
    ? newContent
    : writeSourceRefs(newContent, merged)
}
