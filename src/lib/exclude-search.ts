/**
 * Stage 11 — exclusion-aware search pipeline.
 *
 *   question → classifyQuestion → typeId
 *            → load exclusions (pattern + axiom for typeId)
 *            → list db/ tree → applyExclusions
 *            → searchPaths over the kept candidates
 *            → return hits + structured trace
 *
 * The trace is the user-visible "왜 이 결과가 나왔는가" block: judged
 * type, applied exclusion entries with hit counts, residue size, and
 * (when residue == 0) the type's `zeroResidueMeaning` so a 0-result
 * answer reads as a positive signal instead of "검색 실패" (§2.10).
 *
 * When classification returns null (no question_types configured, LLM
 * couldn't pick one, etc.) the pipeline falls back to "no exclusions
 * applied" — the full db/ tree feeds searchPaths and the trace's
 * judgedType field is null.
 */
import type { LlmConfig } from "@/stores/wiki-store"
import { listDirectory } from "@/commands/fs"
import type { FileNode } from "@/types/wiki"
import { normalizePath } from "@/lib/path-utils"
import { classifyQuestion } from "./classify-question"
import { loadQuestionTypes, type QuestionType } from "./question-types"
import {
  applyExclusions,
  loadExclusions,
  type ExclusionEntry,
} from "./exclusions"
import { searchPaths, type SearchResult } from "./search"

export interface AppliedEntry {
  pattern: string
  rationale: string
  matched: string[]
  /** Project-relative path of the doc the entry came from — trace drill-down. */
  filePath: string
}

export interface SearchTrace {
  judgedType: {
    id: string
    name: string
    confidence: number
    reasoning: string
  } | null
  appliedEntries: AppliedEntry[]
  initialCandidateCount: number
  residueCount: number
  /** Surfaced to the user only when residueCount == 0 (§2.10). */
  zeroResidueMeaning?: string
}

export interface ExcludeSearchResult {
  hits: SearchResult[]
  trace: SearchTrace
  /**
   * Absolute paths of every page in the residue (post-exclusion candidate
   * space). Chat needs this to constrain graph 1-level expansion to the
   * residue — pulling an excluded page back in via the graph would
   * silently violate IDEA.md §2.5.
   */
  keptPaths: string[]
}

export async function runExcludeSearch(
  question: string,
  projectPath: string,
  llmConfig: LlmConfig,
): Promise<ExcludeSearchResult> {
  const pp = normalizePath(projectPath)

  const types = await loadQuestionTypes(pp)
  const classification =
    types.length > 0 && question.trim()
      ? await classifyQuestion(question, types, llmConfig)
      : null

  const docs = await loadExclusions(pp)
  const applicableDocs = classification
    ? docs.filter((d) => d.questionTypeIds.includes(classification.typeId))
    : []

  // Flatten while remembering each entry's source doc for trace drill-down.
  const entries: { entry: ExclusionEntry; filePath: string }[] = []
  for (const doc of applicableDocs) {
    for (const entry of doc.entries) {
      entries.push({ entry, filePath: doc.filePath })
    }
  }

  const candidatesRel = await listDbCandidates(pp)
  const { kept, excludedByEntry } = applyExclusions(
    candidatesRel,
    entries.map((e) => e.entry),
  )

  const absoluteKept = kept.map((rel) => `${pp}/${rel}`)
  const hits =
    absoluteKept.length > 0
      ? await searchPaths(pp, question, absoluteKept)
      : []

  const matchedType: QuestionType | undefined = classification
    ? types.find((t) => t.id === classification.typeId)
    : undefined

  const appliedEntries: AppliedEntry[] = []
  for (const { entry, filePath } of entries) {
    const matched = excludedByEntry.get(entry.pattern)
    if (!matched || matched.length === 0) continue
    appliedEntries.push({
      pattern: entry.pattern,
      rationale: entry.rationale,
      matched,
      filePath,
    })
  }

  const trace: SearchTrace = {
    judgedType:
      classification && matchedType
        ? {
            id: classification.typeId,
            name: matchedType.name,
            confidence: classification.confidence,
            reasoning: classification.reasoning,
          }
        : null,
    appliedEntries,
    initialCandidateCount: candidatesRel.length,
    residueCount: kept.length,
    ...(matchedType?.zeroResidueMeaning
      ? { zeroResidueMeaning: matchedType.zeroResidueMeaning }
      : {}),
  }

  return { hits, trace, keptPaths: absoluteKept }
}

/**
 * Walks `db/` and returns project-relative paths to every `.md` file.
 * `listDirectory` already returns a recursive tree (depth 30) so we just
 * flatten it. Missing/unreadable `db/` → empty list (a brand-new project
 * is a valid state — the trace will report 0 candidates).
 */
async function listDbCandidates(projectPath: string): Promise<string[]> {
  let nodes: FileNode[]
  try {
    nodes = await listDirectory(`${projectPath}/db`)
  } catch {
    return []
  }
  const out: string[] = []
  walk(nodes, "db", out)
  out.sort()
  return out
}

function walk(nodes: FileNode[], relDir: string, out: string[]): void {
  for (const node of nodes) {
    if (node.name.startsWith(".")) continue
    const rel = `${relDir}/${node.name}`
    if (node.is_dir) {
      if (node.children) walk(node.children, rel, out)
    } else if (node.name.endsWith(".md")) {
      out.push(rel)
    }
  }
}
