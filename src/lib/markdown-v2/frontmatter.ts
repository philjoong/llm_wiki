import yaml from "js-yaml"
import { MarkdownV2ValidationError } from "./types"

export function splitV2Frontmatter(source: string): { raw: string; body: string } {
  if (!source.startsWith("---\n") && !source.startsWith("---\r\n")) {
    throw new MarkdownV2ValidationError("Markdown v2 requires a leading YAML frontmatter block")
  }
  const match = /^(---\r?\n)([\s\S]*?)\r?\n---\r?\n?/.exec(source)
  if (!match) throw new MarkdownV2ValidationError("Markdown v2 frontmatter is not closed")
  return { raw: match[2], body: source.slice(match[0].length) }
}

/** js-yaml normally permits duplicate mapping keys. Reject them before parsing. */
function rejectDuplicateKeys(raw: string) {
  const stacks = new Map<number, Set<string>>()
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line) || /^\s*-\s/.test(line)) continue
    const match = /^(\s*)([^:#][^:]*):(?:\s|$)/.exec(line)
    if (!match) continue
    const indent = match[1].length
    for (const depth of [...stacks.keys()]) if (depth > indent) stacks.delete(depth)
    const keys = stacks.get(indent) ?? new Set<string>()
    const key = match[2].trim()
    if (keys.has(key)) throw new MarkdownV2ValidationError(`Duplicate YAML key '${key}'`)
    keys.add(key); stacks.set(indent, keys)
  }
  if (/(^|\s)[&*][A-Za-z0-9_-]+/.test(raw) || /!![A-Za-z]/.test(raw)) {
    throw new MarkdownV2ValidationError("YAML aliases, anchors, and explicit tags are not allowed")
  }
}

export function parseV2Frontmatter(raw: string): Record<string, unknown> {
  rejectDuplicateKeys(raw)
  try {
    const value = yaml.load(raw)
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new MarkdownV2ValidationError("Frontmatter must be a YAML mapping")
    }
    return value as Record<string, unknown>
  } catch (error) {
    if (error instanceof MarkdownV2ValidationError) throw error
    throw new MarkdownV2ValidationError(`Invalid YAML frontmatter: ${error instanceof Error ? error.message : String(error)}`)
  }
}
