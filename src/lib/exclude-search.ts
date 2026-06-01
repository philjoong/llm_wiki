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
import { searchPaths, type SearchResult } from "./search"
import { recordSearchInstance } from "./instance-log"
import { loadQuestionTypes, type QuestionType } from "./question-types"
import { classifyQuestion } from "./classify-question"
import { loadExclusions, applyExclusions } from "./exclusions"

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
    zeroResidueMeaning?: string
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
  /** The full QuestionType object if classified. */
  questionType?: QuestionType
}

export async function runExcludeSearch(
  question: string,
  projectPath: string,
  llmConfig: LlmConfig,
): Promise<ExcludeSearchResult> {
  const pp = normalizePath(projectPath)

  // Stage 10 — Classification
  const types = await loadQuestionTypes(pp)
  const classification = await classifyQuestion(question, types, llmConfig)
  const qt = classification ? types.find((t) => t.id === classification.typeId) : undefined

  const candidatesRel = await listDbCandidates(pp)
  let kept = candidatesRel
  const appliedEntries: AppliedEntry[] = []

  if (classification) {
    const allExDoc = await loadExclusions(pp)
    const activeDocs = allExDoc.filter((d) => 
      d.questionTypeIds.includes(classification.typeId)
    )

    for (const doc of activeDocs) {
      const { kept: nextKept, excludedByEntry } = applyExclusions(kept, doc.entries)
      kept = nextKept
      
      for (const [pattern, matched] of excludedByEntry.entries()) {
        const entry = doc.entries.find((e) => e.pattern === pattern)
        if (entry) {
          appliedEntries.push({
            pattern,
            rationale: entry.rationale,
            matched,
            filePath: doc.filePath,
          })
        }
      }
    }
  }

  const absoluteKept = kept.map((rel) => `${pp}/${rel}`)
  const hits =
    absoluteKept.length > 0
      ? await searchPaths(pp, question, absoluteKept)
      : []

  const trace: SearchTrace = {
    judgedType: classification && qt ? {
      id: classification.typeId,
      name: qt.name,
      confidence: classification.confidence,
      reasoning: classification.reasoning,
      zeroResidueMeaning: qt.zeroResidueMeaning,
    } : null,
    appliedEntries,
    initialCandidateCount: candidatesRel.length,
    residueCount: kept.length,
    zeroResidueMeaning: kept.length === 0 && qt ? qt.zeroResidueMeaning : undefined,
  }

  const out: ExcludeSearchResult = { 
    hits, 
    trace, 
    keptPaths: absoluteKept,
    questionType: qt,
  }

  // Stage 12 — Level 1 instance log. Skipped for empty/whitespace-only
  // questions as a safety net (real noise like greetings is already
  // filtered upstream by chat-panel's greeting-detector). Logging
  // failures must not break the user-visible search, so they are
  // swallowed with a warning — promotion (Stage 13) just sees one
  // fewer instance row.
  if (question.trim().length > 0) {
    try {
      await recordSearchInstance(pp, question, out)
    } catch (err) {
      console.warn("[exclude-search] recordSearchInstance failed:", err)
    }
  }

  return out
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
