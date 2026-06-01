/**
 * Stage 9 — `question_types/*.md` loader.
 *
 * Each markdown file under `question_types/` becomes one QuestionType.
 * The id is the filename stem (e.g. `policy_violation.md` → `policy_violation`).
 * Sections are pulled from H2 headings (`## Description`, `## Input`,
 * `## Output`, `## Zero residue`); free-form content outside those
 * headings is summarized into `description`.
 *
 * Malformed files (read errors, parse errors) are logged and skipped —
 * a single broken file should not break the rest of the search wiring.
 */
import yaml from "js-yaml"
import { listDirectory, readFile } from "@/commands/fs"
import type { FileNode } from "@/types/wiki"

export interface QuestionType {
  /** Filename stem — stable id used by the classifier and exclusion map. */
  id: string
  /** Display name. */
  name: string
  /** Description for the classifier and UI. */
  description: string
  /** Keys the LLM should fill in its structured response. Map of key -> description. */
  fields?: Record<string, string>
  /** Prompt template for execution. */
  promptTemplate?: string
  /** Legacy markdown shape description used by older tests and docs. */
  inputShape?: string
  /** Legacy markdown output description used by older tests and docs. */
  outputShape?: string
  /** Body of `Zero residue` section — surfaced to the user when residue == 0 (§2.10). */
  zeroResidueMeaning?: string
}

export async function loadQuestionTypes(
  projectPath: string,
): Promise<QuestionType[]> {
  const projectSpecificPath = `${projectPath}/question_types`
  const userOverridePath = `${projectPath}/.llm-wiki/question-types`
  // In dev, schema is at the root. In production, it might be bundled.
  // We'll try to find it relative to the process CWD or a known resource path.
  const appDefaultPath = `schema/question_types`

  const projectNodes = await tryListDirectory(projectSpecificPath)
  const userNodes = await tryListDirectory(userOverridePath)
  const appNodes = await tryListDirectory(appDefaultPath)

  const outMap = new Map<string, QuestionType>()

  // Load app defaults
  for (const node of appNodes) {
    const qt = await loadNode(appDefaultPath, node)
    if (qt) outMap.set(qt.id, qt)
  }

  // Load project-specific (shared via git)
  for (const node of projectNodes) {
    const qt = await loadNode(projectSpecificPath, node)
    if (qt) outMap.set(qt.id, qt)
  }

  // Load user overrides (private to .llm-wiki)
  for (const node of userNodes) {
    const qt = await loadNode(userOverridePath, node)
    if (qt) outMap.set(qt.id, qt)
  }

  return Array.from(outMap.values())
}

async function tryListDirectory(path: string): Promise<FileNode[]> {
  try {
    return await listDirectory(path)
  } catch {
    return []
  }
}

async function loadNode(dir: string, node: FileNode): Promise<QuestionType | null> {
  if (node.is_dir) return null
  if (node.name.startsWith(".")) return null
  
  const isYaml = node.name.endsWith(".yaml") || node.name.endsWith(".yml")
  const isMd = node.name.endsWith(".md")
  if (!isYaml && !isMd) return null

  const id = node.name.replace(/\.(yaml|yml|md)$/, "")
  try {
    const content = await readFile(`${dir}/${node.name}`)
    if (isYaml) {
      return parseYamlQuestionType(id, content)
    } else {
      return parseMdQuestionType(id, content)
    }
  } catch (err) {
    console.warn(`[question-types] failed to load ${node.name}:`, err)
    return null
  }
}

function parseYamlQuestionType(id: string, content: string): QuestionType {
  const raw = yaml.load(content) as any
  return {
    id,
    name: raw.name || id,
    description: raw.description || "",
    fields: raw.fields || {},
    promptTemplate: raw.prompt_template || raw.promptTemplate || "",
    zeroResidueMeaning: raw.zero_residue_meaning || raw.zeroResidueMeaning,
  }
}

function parseMdQuestionType(id: string, content: string): QuestionType {
  const { fm, body } = parseFrontmatter(content)
  let name = ""
  if (typeof fm.title === "string" && fm.title.trim()) {
    name = fm.title.trim()
  } else {
    const h1 = body.match(/^#\s+(.+)$/m)
    if (h1) name = h1[1].trim()
  }
  if (!name) name = id

  const inputShape = extractSection(body, ["Input", "입력"])
  const outputShape = extractSection(body, ["Output", "출력"])
  const zeroResidueMeaning = extractSection(body, [
    "Zero residue",
    "Zero-residue",
    "잔존 0",
  ])
  const description = extractDescription(body)

  // Legacy MD doesn't have fields/promptTemplate in the same way.
  // We'll map Input/Output to description/fields for now.
  return {
    id,
    name,
    description: description || inputShape || "",
    fields: {
      answer: outputShape || "General answer",
    },
    promptTemplate: "", // MD doesn't have a template
    inputShape,
    outputShape,
    zeroResidueMeaning,
  }
}

/**
 * First non-heading paragraph of `body`. Keeps the writer free to put a
 * leading H1 ("# 정책 위반 탐지") followed by the description text without
 * needing an explicit `## Description` heading.
 */
function extractDescription(body: string): string {
  const lines = body.split("\n")
  const para: string[] = []
  for (const line of lines) {
    if (/^\s*#{1,6}\s/.test(line)) {
      if (para.length > 0) break
      continue
    }
    if (line.trim() === "") {
      if (para.length > 0) break
      continue
    }
    para.push(line.trim())
  }
  return para.join(" ").trim()
}

function extractSection(body: string, titles: readonly string[]): string | undefined {
  for (const title of titles) {
    const re = new RegExp(`^##\\s+${escapeRegex(title)}\\s*$`, "im")
    const m = body.match(re)
    if (!m) continue
    const start = (m.index ?? 0) + m[0].length
    const rest = body.slice(start)
    const next = rest.search(/\n##\s/)
    const block = next >= 0 ? rest.slice(0, next) : rest
    const trimmed = block.trim()
    if (trimmed.length > 0) return trimmed
  }
  return undefined
}

function escapeRegex(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\*]/g, "\\$&")
}

/**
 * Minimal YAML frontmatter parser shared with `exclusions.ts`. Recognizes
 * scalar strings, booleans, and inline `[a, b, c]` arrays. Multi-line
 * YAML blocks are not supported here — `sources:` block parsing lives in
 * sources-merge.ts and uses its own walker.
 */
export function parseFrontmatter(content: string): {
  fm: Record<string, unknown>
  body: string
} {
  const m = content.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!m) return { fm: {}, body: content }
  const body = content.slice(m[0].length)
  const fm: Record<string, unknown> = {}
  for (const line of m[1].split("\n")) {
    const km = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
    if (!km) continue
    const key = km[1]
    const raw = km[2].trim()
    if (raw === "") {
      fm[key] = ""
      continue
    }
    if (raw.startsWith("[") && raw.endsWith("]")) {
      const inner = raw.slice(1, -1).trim()
      fm[key] =
        inner === ""
          ? []
          : inner.split(",").map((s) => stripQuotes(s.trim())).filter((s) => s.length > 0)
      continue
    }
    if (raw === "true") {
      fm[key] = true
      continue
    }
    if (raw === "false") {
      fm[key] = false
      continue
    }
    fm[key] = stripQuotes(raw)
  }
  return { fm, body }
}

function stripQuotes(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\")
  }
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1)
  }
  return s
}
