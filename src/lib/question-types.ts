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
import { listDirectory, readFile } from "@/commands/fs"
import type { FileNode } from "@/types/wiki"

export interface QuestionType {
  /** Filename stem — stable id used by the classifier and exclusion map. */
  id: string
  /** Display name. Frontmatter `title:` wins; falls back to first H1, then id. */
  name: string
  /** First non-heading paragraph in the body. */
  description: string
  /** Body of `## Input` section, if present. */
  inputShape?: string
  /** Body of `## Output` section, if present. */
  outputShape?: string
  /** Body of `## Zero residue` section — surfaced to the user when residue == 0 (§2.10). */
  zeroResidueMeaning?: string
}

export async function loadQuestionTypes(
  projectPath: string,
): Promise<QuestionType[]> {
  let nodes: FileNode[]
  try {
    nodes = await listDirectory(`${projectPath}/question_types`)
  } catch {
    return []
  }
  const out: QuestionType[] = []
  for (const node of nodes) {
    if (node.is_dir) continue
    if (node.name.startsWith(".")) continue
    if (!node.name.endsWith(".md")) continue
    const id = node.name.replace(/\.md$/, "")
    let content: string
    try {
      content = await readFile(`${projectPath}/question_types/${node.name}`)
    } catch (err) {
      console.warn(`[question-types] failed to read ${node.name}:`, err)
      continue
    }
    try {
      out.push(parseQuestionType(id, content))
    } catch (err) {
      console.warn(`[question-types] failed to parse ${node.name}:`, err)
    }
  }
  return out
}

function parseQuestionType(id: string, content: string): QuestionType {
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

  return {
    id,
    name,
    description,
    ...(inputShape ? { inputShape } : {}),
    ...(outputShape ? { outputShape } : {}),
    ...(zeroResidueMeaning ? { zeroResidueMeaning } : {}),
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
