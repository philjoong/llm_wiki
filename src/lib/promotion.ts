/**
 * Stage 13 — Pattern → Axiom promotion (Level 1 → 2 → 3).
 *
 * Reads the Stage 12 instance log under `exclusions/instances/<YYYY-MM>/*.md`
 * and aggregates how often each (judged typeId, top-hit path) pair recurs.
 * Pairs that cross the threshold from `exclusions/promotion_rules.md`
 * surface as candidates that a human can promote to a pattern entry, an
 * axiom file, or dismiss for good.
 *
 *   IDEA.md §2.6 — promotion is ALWAYS human-driven. Frequency is a
 *   signal, never a trigger. This module never writes a pattern/axiom
 *   file on its own; only `promoteToPattern`/`promoteToAxiom` (called
 *   from the UI's button click) does that.
 *
 * Dedup story
 *   - Pairs already covered by an existing pattern/axiom entry are
 *     filtered out — we don't suggest something the user already has.
 *     Archived entries count as "already decided": the user explicitly
 *     retracted that exclusion, so resurfacing it would be noise.
 *   - Dismissed pairs are persisted in `.llm-wiki/promotion-dismissals.jsonl`
 *     (same pattern as Stage 4's `.llm-wiki/rejection-log.jsonl`) so a
 *     re-analysis after restart still hides them.
 */
import { fileExists, listDirectory, readFile, writeFile } from "@/commands/fs"
import { gitCommit } from "@/commands/git"
import { normalizePath } from "@/lib/path-utils"
import { withProjectLock } from "@/lib/project-mutex"
import { parseFrontmatter } from "./question-types"
import type { FileNode } from "@/types/wiki"

export interface PromotionThresholds {
  /** Min (typeId, path) co-occurrence in instances → pattern candidate. */
  patternMinCount: number
  /** Min number of distinct typeIds covering a path → axiom candidate
   *  (reserved for future use; surfaced via `loadThresholds` so UI can
   *  show the value from promotion_rules.md). */
  axiomMinPatterns: number
  /** Stage 14 freshness window — kept here so all rule knobs live in
   *  one place even though Stage 13 doesn't consume it. */
  freshnessDays: number
}

export const DEFAULT_THRESHOLDS: PromotionThresholds = {
  patternMinCount: 5,
  axiomMinPatterns: 3,
  freshnessDays: 90,
}

export interface PromotionCandidate {
  typeId: string
  /** Project-relative, e.g. `db/policy.md`. */
  path: string
  count: number
  /** Project-relative instance file paths that contributed to the count. */
  instances: string[]
}

export interface AnalyzeOptions {
  /** Override individual thresholds (typically for tests / tooling). */
  thresholds?: Partial<PromotionThresholds>
}

const DISMISSAL_LOG_REL = ".llm-wiki/promotion-dismissals.jsonl"

export async function analyzePromotionCandidates(
  projectPath: string,
  opts: AnalyzeOptions = {},
): Promise<PromotionCandidate[]> {
  const pp = normalizePath(projectPath)
  const baseThresholds = await loadThresholds(pp)
  const thresholds: PromotionThresholds = {
    ...baseThresholds,
    ...(opts.thresholds ?? {}),
  }

  const instanceFiles = await listInstanceFiles(pp)
  const tally = new Map<
    string,
    { typeId: string; path: string; count: number; instances: string[] }
  >()

  for (const relInstance of instanceFiles) {
    let content: string
    try {
      content = await readFile(`${pp}/${relInstance}`)
    } catch {
      continue
    }
    const parsed = parseInstanceFile(content, pp)
    if (!parsed) continue
    for (const hitPath of parsed.hits) {
      const key = `${parsed.typeId}::${hitPath}`
      const cur = tally.get(key)
      if (cur) {
        cur.count += 1
        cur.instances.push(relInstance)
      } else {
        tally.set(key, {
          typeId: parsed.typeId,
          path: hitPath,
          count: 1,
          instances: [relInstance],
        })
      }
    }
  }

  const overThreshold = [...tally.values()].filter(
    (t) => t.count >= thresholds.patternMinCount,
  )

  const alreadyExcluded = await loadExistingExclusionKeys(pp)
  const dismissed = await loadDismissalKeys(pp)

  return overThreshold
    .filter((c) => !alreadyExcluded.has(`${c.typeId}::${c.path}`))
    .filter((c) => !dismissed.has(`${c.typeId}::${c.path}`))
    .sort((a, b) => b.count - a.count)
}

export async function loadThresholds(
  projectPath: string,
): Promise<PromotionThresholds> {
  const pp = normalizePath(projectPath)
  const rulesPath = `${pp}/exclusions/promotion_rules.md`
  let raw = ""
  if (await fileExists(rulesPath).catch(() => false)) {
    try {
      raw = await readFile(rulesPath)
    } catch {
      raw = ""
    }
  }
  const result: PromotionThresholds = { ...DEFAULT_THRESHOLDS }
  // Tolerant scan — match `key: value` even inside backticks or list
  // items so the seed format with `\`pattern_min_count: 5\`` works.
  const reads: Array<[RegExp, keyof PromotionThresholds]> = [
    [/pattern_min_count\s*:\s*(\d+)/i, "patternMinCount"],
    [/axiom_min_patterns\s*:\s*(\d+)/i, "axiomMinPatterns"],
    [/freshness_days\s*:\s*(\d+)/i, "freshnessDays"],
  ]
  for (const [re, key] of reads) {
    const m = raw.match(re)
    if (m) {
      const n = parseInt(m[1], 10)
      if (Number.isFinite(n) && n > 0) result[key] = n
    }
  }
  return result
}

async function listInstanceFiles(projectPath: string): Promise<string[]> {
  let nodes: FileNode[]
  try {
    nodes = await listDirectory(`${projectPath}/exclusions/instances`)
  } catch {
    return []
  }
  const out: string[] = []
  for (const node of nodes) {
    if (node.is_dir) {
      const children = node.children ?? []
      for (const f of children) {
        if (
          !f.is_dir &&
          f.name.endsWith(".md") &&
          !f.name.startsWith(".")
        ) {
          out.push(`exclusions/instances/${node.name}/${f.name}`)
        }
      }
      continue
    }
    if (node.name.endsWith(".md") && !node.name.startsWith(".")) {
      // Tolerate a flat layout — the writer always nests under YYYY-MM
      // but a hand-imported tree might not.
      out.push(`exclusions/instances/${node.name}`)
    }
  }
  return out
}

interface InstanceData {
  typeId: string
  hits: string[]
}

function parseInstanceFile(
  content: string,
  projectPath: string,
): InstanceData | null {
  const { fm, body } = parseFrontmatter(content)
  const typeIdRaw =
    typeof fm.question_type === "string" ? fm.question_type.trim() : ""
  // `(none)` is the sentinel the writer emits when classification failed —
  // promotion for an untyped search doesn't make sense.
  if (!typeIdRaw || typeIdRaw === "(none)") return null

  const section = body.match(/^##\s+Top\s+Hits\s*$/im)
  if (!section) return { typeId: typeIdRaw, hits: [] }
  const start = (section.index ?? 0) + section[0].length
  const rest = body.slice(start)
  const next = rest.search(/\n##\s/)
  const block = next >= 0 ? rest.slice(0, next) : rest

  const hits: string[] = []
  for (const line of block.split("\n")) {
    // `1. /proj/db/policy.md — score 1.00`
    const m = line.match(/^\s*\d+\.\s+(.+?)\s+(?:—|--)\s+score\s/)
    if (!m) continue
    const rel = toProjectRelative(m[1].trim(), projectPath)
    if (rel.startsWith("db/")) hits.push(rel)
  }
  return { typeId: typeIdRaw, hits }
}

function toProjectRelative(raw: string, projectPath: string): string {
  const p = normalizePath(raw)
  const base = normalizePath(projectPath).replace(/\/$/, "")
  if (base && p.startsWith(base + "/")) return p.slice(base.length + 1)
  const dbIdx = p.indexOf("db/")
  if (dbIdx >= 0) return p.slice(dbIdx)
  return p
}

async function loadExistingExclusionKeys(
  projectPath: string,
): Promise<Set<string>> {
  const out = new Set<string>()

  const patternNodes = await safeList(
    `${projectPath}/exclusions/by_question_type`,
  )
  for (const node of patternNodes) {
    if (node.is_dir) continue
    if (!node.name.endsWith(".md") || node.name.startsWith(".")) continue
    const typeId = node.name.replace(/\.md$/, "")
    const content = await safeRead(
      `${projectPath}/exclusions/by_question_type/${node.name}`,
    )
    if (content === null) continue
    for (const p of extractEntryPatterns(content)) {
      out.add(`${typeId}::${p}`)
    }
  }

  const axiomNodes = await safeList(`${projectPath}/exclusions/axioms`)
  for (const node of axiomNodes) {
    if (node.is_dir) continue
    if (!node.name.endsWith(".md") || node.name.startsWith(".")) continue
    const content = await safeRead(
      `${projectPath}/exclusions/axioms/${node.name}`,
    )
    if (content === null) continue
    const { fm } = parseFrontmatter(content)
    const applies = Array.isArray(fm.applies_to)
      ? (fm.applies_to as unknown[]).map((v) => String(v).trim()).filter(Boolean)
      : []
    const patterns = extractEntryPatterns(content)
    for (const typeId of applies) {
      for (const p of patterns) out.add(`${typeId}::${p}`)
    }
  }

  return out
}

async function safeList(path: string): Promise<FileNode[]> {
  try {
    return await listDirectory(path)
  } catch {
    return []
  }
}

async function safeRead(path: string): Promise<string | null> {
  try {
    return await readFile(path)
  } catch {
    return null
  }
}

/**
 * Pull every pattern path from a pattern/axiom file's `## 배제` (or
 * `## Exclusions`) block. Archived entries ARE included — once the user
 * archives an entry they've decided that path doesn't deserve exclusion
 * for this type, and re-promoting it would resurface a settled question.
 */
function extractEntryPatterns(content: string): string[] {
  const { body } = parseFrontmatter(content)
  const re = /^##\s+(배제|Exclusions)\s*$/im
  const m = body.match(re)
  if (!m) return []
  const start = (m.index ?? 0) + m[0].length
  const rest = body.slice(start)
  const next = rest.search(/\n##\s/)
  const block = next >= 0 ? rest.slice(0, next) : rest

  const out: string[] = []
  for (const line of block.split("\n")) {
    const top = line.match(/^-\s+(.+?)\s*$/)
    if (top) out.push(top[1].trim())
  }
  return out
}

async function loadDismissalKeys(projectPath: string): Promise<Set<string>> {
  const path = `${projectPath}/${DISMISSAL_LOG_REL}`
  if (!(await fileExists(path).catch(() => false))) return new Set()
  let raw: string
  try {
    raw = await readFile(path)
  } catch {
    return new Set()
  }
  const out = new Set<string>()
  for (const line of raw.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as {
        typeId?: unknown
        path?: unknown
      }
      if (typeof parsed.typeId === "string" && typeof parsed.path === "string") {
        out.add(`${parsed.typeId}::${parsed.path}`)
      }
    } catch {
      // skip malformed line
    }
  }
  return out
}

export interface PromotionResult {
  filePath: string
  commitHash: string | null
}

export async function promoteToPattern(
  projectPath: string,
  candidate: PromotionCandidate,
): Promise<PromotionResult> {
  const pp = normalizePath(projectPath)
  const relFile = `exclusions/by_question_type/${candidate.typeId}.md`
  const abs = `${pp}/${relFile}`
  const exists = await fileExists(abs).catch(() => false)
  const seed = `# ${candidate.typeId}\n\n## 배제\n`
  const current = exists ? await readFile(abs) : seed
  const updated = appendExclusionEntry(current, candidate)
  await writeFile(abs, updated)

  const message = `promote: pattern ${candidate.typeId} — ${candidate.path}`
  const commit = await withProjectLock(pp, () =>
    gitCommit(pp, message, [relFile]),
  )
  return { filePath: relFile, commitHash: commit.commitHash }
}

export async function promoteToAxiom(
  projectPath: string,
  candidate: PromotionCandidate,
  axiomName: string,
): Promise<PromotionResult> {
  const pp = normalizePath(projectPath)
  const safeName = axiomName
    .trim()
    .replace(/[^\wㄱ-힝-]+/g, "_")
    .replace(/^_+|_+$/g, "")
  if (!safeName) {
    throw new Error("axiomName cannot be empty")
  }
  const relFile = `exclusions/axioms/${safeName}.md`
  const abs = `${pp}/${relFile}`
  const exists = await fileExists(abs).catch(() => false)

  let content: string
  if (exists) {
    const cur = await readFile(abs)
    content = ensureAppliesToHas(cur, candidate.typeId)
    content = appendExclusionEntry(content, candidate)
  } else {
    const header = `---\napplies_to: [${candidate.typeId}]\n---\n\n# ${axiomName}\n\n## 배제\n`
    content = appendExclusionEntry(header, candidate)
  }
  await writeFile(abs, content)

  const message = `promote: axiom ${safeName} — ${candidate.path}`
  const commit = await withProjectLock(pp, () =>
    gitCommit(pp, message, [relFile]),
  )
  return { filePath: relFile, commitHash: commit.commitHash }
}

export async function dismissCandidate(
  projectPath: string,
  candidate: PromotionCandidate,
  reason: string,
): Promise<void> {
  const pp = normalizePath(projectPath)
  const path = `${pp}/${DISMISSAL_LOG_REL}`
  const entry = {
    timestamp: new Date().toISOString(),
    typeId: candidate.typeId,
    path: candidate.path,
    reason,
  }
  const line = JSON.stringify(entry) + "\n"
  const existing = (await fileExists(path).catch(() => false))
    ? await readFile(path)
    : ""
  await writeFile(path, existing + line)
}

function appendExclusionEntry(
  content: string,
  candidate: PromotionCandidate,
): string {
  const entryLines = formatEntryLines(candidate)
  const re = /^##\s+(배제|Exclusions)\s*$/im
  const m = content.match(re)
  if (m) {
    const sectionStart = (m.index ?? 0) + m[0].length
    const rest = content.slice(sectionStart)
    const nextIdx = rest.search(/\n##\s/)
    if (nextIdx >= 0) {
      const sectionEnd = sectionStart + nextIdx
      const before = content.slice(0, sectionEnd).replace(/[\s\n]+$/, "\n")
      const after = content.slice(sectionEnd)
      return `${before}${entryLines}\n${after}`
    }
    // Section runs to EOF.
    const before = content.replace(/[\s\n]+$/, "\n")
    return `${before}${entryLines}\n`
  }
  // No section — append one at the end.
  const trimmed = content.replace(/[\s\n]+$/, "")
  return `${trimmed}\n\n## 배제\n${entryLines}\n`
}

function formatEntryLines(candidate: PromotionCandidate): string {
  const cites = candidate.instances.join(", ")
  return [
    `- ${candidate.path}`,
    `  근거: 사람 검토 후 배제 처리 (instance ${candidate.count}회 누적)`,
    `  출처: ${cites}`,
  ].join("\n")
}

function ensureAppliesToHas(content: string, typeId: string): string {
  const fmRe = /^(---\n)([\s\S]*?)(\n---\n?)/
  const match = content.match(fmRe)
  if (!match) {
    // No frontmatter — prepend one with applies_to.
    return `---\napplies_to: [${typeId}]\n---\n\n${content}`
  }
  const [whole, open, fmBody, close] = match
  const { fm } = parseFrontmatter(content)
  const cur = Array.isArray(fm.applies_to)
    ? (fm.applies_to as unknown[]).map((v) => String(v).trim()).filter(Boolean)
    : []
  if (cur.includes(typeId)) return content
  const next = [...cur, typeId]
  const value = `[${next.join(", ")}]`
  let replaced = false
  const rebuilt = fmBody
    .split("\n")
    .map((line) => {
      if (/^applies_to\s*:/.test(line)) {
        replaced = true
        return `applies_to: ${value}`
      }
      return line
    })
    .join("\n")
  const newFm = replaced ? rebuilt : `${rebuilt}\napplies_to: ${value}`
  return `${open}${newFm}${close}${content.slice(whole.length)}`
}
