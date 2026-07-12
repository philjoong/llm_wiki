import yaml from "js-yaml"
import { readFile } from "@/commands/fs"
import { MarkdownV2ValidationError } from "./types"

export interface TagSchema { namespaces: Record<string, readonly string[]> }

/** Loads the project tag vocabulary. Duplicate namespace/value entries are rejected. */
export async function loadTagSchema(projectPath: string): Promise<TagSchema> {
  let source: string
  try { source = await readFile(`${projectPath}/.llm-wiki/tag-schema.yaml`) }
  catch { return { namespaces: {} } }
  const namespaceKeys = new Set<string>()
  let inNamespaces = false
  for (const line of source.split(/\r?\n/)) {
    if (/^namespaces:\s*$/.test(line)) { inNamespaces = true; continue }
    if (inNamespaces && /^\S/.test(line)) inNamespaces = false
    const match = inNamespaces ? /^  ([a-z][a-z0-9_-]*):\s*$/.exec(line) : null
    if (match) {
      if (namespaceKeys.has(match[1])) throw new MarkdownV2ValidationError(`Duplicate tag namespace '${match[1]}'`)
      namespaceKeys.add(match[1])
    }
  }
  let raw: unknown
  try { raw = yaml.load(source) } catch (error) { throw new MarkdownV2ValidationError(`Invalid tag schema: ${String(error)}`) }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new MarkdownV2ValidationError("Tag schema must be a mapping")
  const namespaces = (raw as Record<string, unknown>).namespaces
  if (!namespaces || typeof namespaces !== "object" || Array.isArray(namespaces)) throw new MarkdownV2ValidationError("Tag schema requires a namespaces mapping")
  const result: Record<string, readonly string[]> = {}
  for (const [name, values] of Object.entries(namespaces as Record<string, unknown>)) {
    if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !value)) throw new MarkdownV2ValidationError(`Tag namespace '${name}' must contain string values`)
    if (new Set(values).size !== values.length) throw new MarkdownV2ValidationError(`Tag namespace '${name}' contains duplicate values`)
    result[name] = values as string[]
  }
  return { namespaces: result }
}

export function validateTag(tag: string, schema: TagSchema): void {
  const match = /^([a-z][a-z0-9_-]*):([a-z0-9][a-z0-9_-]*)$/.exec(tag)
  if (!match) throw new MarkdownV2ValidationError(`Invalid tag '${tag}'; expected namespace:value`)
  if (!schema.namespaces[match[1]]?.includes(match[2])) throw new MarkdownV2ValidationError(`Unknown tag '${tag}'`)
}
