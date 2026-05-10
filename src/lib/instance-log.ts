/**
 * Stage 12 — Level 1 instance logging.
 *
 * Every chat send that produces a `runExcludeSearch` result writes a
 * markdown record under
 *
 *     exclusions/instances/<YYYY-MM>/q-<compact-ISO>-<slug>.md
 *
 * and triggers one commit. The user can later inspect the history via
 * git tooling, and Stage 13's promotion code aggregates these records
 * to surface (typeId, path) pairs that recur often enough to deserve
 * promotion to a pattern or axiom (IDEA.md §2.7, "Level 1 → 2 → 3").
 *
 * Failures here MUST NOT break the user-visible search — `runExcludeSearch`
 * wraps the call in a try/catch and warns on failure. The search result
 * is the primary output; logging is a side effect.
 *
 * Filename design notes
 *   - <YYYY-MM> directory keeps the instance tree from growing into a
 *     single 10k-file folder; promotion analysis filters by month
 *     when needed.
 *   - The compact-ISO timestamp (with `:` and `.` flattened to `-`) is
 *     filesystem-safe on Windows.
 *   - The slug is derived from the question via `makeQuerySlug`, the
 *     same Unicode-aware helper that user-driven "Save to Wiki" uses
 *     — guarantees CJK questions don't collapse to an empty slug.
 *   - Same-millisecond collisions (two synchronous chat sends with the
 *     identical question text) get a `-N` suffix instead of overwriting.
 */
import { writeFile, fileExists } from "@/commands/fs"
import { makeQuerySlug } from "@/lib/wiki-filename"
import { commitSearchInstance } from "@/lib/auto-commit"
import type { ExcludeSearchResult } from "./exclude-search"

export interface RecordedInstance {
  /** Project-relative path to the markdown file just written. */
  path: string
  commitHash: string | null
}

const HIT_PREVIEW_LIMIT = 10

export async function recordSearchInstance(
  projectPath: string,
  question: string,
  result: ExcludeSearchResult,
  now: Date = new Date(),
): Promise<RecordedInstance> {
  const yyyymm = now.toISOString().slice(0, 7) // 2026-05
  const stamp = compactTimestamp(now)
  const slug = makeQuerySlug(question)

  // Same-ms collision guard: if a file with this exact name already
  // exists, append `-N` and retry. In practice this only fires when a
  // test or scripted caller fires two records inside the same Date.now()
  // tick — a real user can't type fast enough.
  let rel = `exclusions/instances/${yyyymm}/q-${stamp}-${slug}.md`
  let absolute = `${projectPath}/${rel}`
  let counter = 1
  while (await fileExists(absolute).catch(() => false)) {
    rel = `exclusions/instances/${yyyymm}/q-${stamp}-${slug}-${counter}.md`
    absolute = `${projectPath}/${rel}`
    counter += 1
  }

  await writeFile(absolute, renderInstanceMarkdown(question, result, now))

  const { judgedType, residueCount, initialCandidateCount } = result.trace
  const excludedCount = initialCandidateCount - residueCount
  const commit = await commitSearchInstance(
    projectPath,
    rel,
    judgedType?.id ?? null,
    result.hits.length,
    excludedCount,
  )

  return { path: rel, commitHash: commit.commitHash }
}

/** ISO 8601 with `:` and `.` flattened to `-` for filesystem safety.
 *  e.g. `2026-05-10T14:30:52.123Z` → `2026-05-10T14-30-52-123Z`. */
function compactTimestamp(d: Date): string {
  return d.toISOString().replace(/[:.]/g, "-")
}

function renderInstanceMarkdown(
  question: string,
  result: ExcludeSearchResult,
  now: Date,
): string {
  const { trace, hits } = result
  const lines: string[] = []

  // Frontmatter — kept simple (scalars only) so promotion code can
  // parse it with the same parseFrontmatter helper used elsewhere.
  lines.push("---")
  lines.push(`question_type: ${trace.judgedType?.id ?? "(none)"}`)
  lines.push(`initial_candidates: ${trace.initialCandidateCount}`)
  lines.push(`residue_count: ${trace.residueCount}`)
  lines.push(`hits_count: ${hits.length}`)
  lines.push(`recorded_at: ${now.toISOString()}`)
  lines.push("---")
  lines.push("")

  lines.push("## Question")
  lines.push("")
  lines.push(question.trim())
  lines.push("")

  lines.push("## Judged Type")
  if (trace.judgedType) {
    lines.push(`- id: ${trace.judgedType.id}`)
    lines.push(`- name: ${trace.judgedType.name}`)
    lines.push(`- confidence: ${trace.judgedType.confidence}`)
    if (trace.judgedType.reasoning) {
      lines.push(`- reasoning: ${trace.judgedType.reasoning}`)
    }
  } else {
    lines.push("(no type matched — full db/ candidate space used)")
  }
  lines.push("")

  lines.push("## Applied Exclusions")
  if (trace.appliedEntries.length === 0) {
    lines.push("(no exclusions applied)")
  } else {
    for (const e of trace.appliedEntries) {
      lines.push(`- pattern: ${e.pattern}`)
      lines.push(`  source: ${e.filePath}`)
      lines.push(`  rationale: ${e.rationale}`)
      lines.push(`  matched (${e.matched.length}):`)
      for (const m of e.matched) {
        lines.push(`    - ${m}`)
      }
    }
  }
  lines.push("")

  lines.push("## Residue")
  lines.push(`${trace.residueCount} candidates remained after exclusions.`)
  lines.push("")

  lines.push("## Top Hits")
  if (hits.length === 0) {
    // Zero hits is a valid log entry — IDEA.md §2.10 treats residue 0
    // as a positive signal ("the question doesn't apply to this wiki"),
    // not a failure mode.
    lines.push("(no hits)")
  } else {
    for (const [i, h] of hits.slice(0, HIT_PREVIEW_LIMIT).entries()) {
      lines.push(`${i + 1}. ${h.path} — score ${h.score.toFixed(2)}`)
    }
  }
  lines.push("")

  return lines.join("\n")
}
