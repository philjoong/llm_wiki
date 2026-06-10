/**
 * Scenario-driven sweep tests.
 *
 * Each scenario is the AUTHORITATIVE description of a sweep behavior —
 * it contains the initial wiki state (realistic markdown + frontmatter),
 * the review items to inject, optional raw LLM response text, and the
 * expected outcome after sweepResolvedReviews runs.
 *
 * The materialize helper writes the scenario to disk under
 * tests/fixtures/scenarios/<name>/ so authors can inspect actual files
 * when debugging. Those files are gitignored (tests/ is ignored) — the
 * TS source here is the only thing tracked.
 */

export type ReviewType =
  | "contradiction"
  | "duplicate"
  | "missing-page"
  | "confirm"
  | "suggestion"

export interface ReviewFixture {
  id: string
  type: ReviewType
  title: string
  description?: string
  affectedPages?: string[]
  sourcePath?: string
}

export interface SweepScenarioExpected {
  /** Review IDs that should be resolved after sweep. */
  resolvedIds: string[]
  /** Review IDs that should remain pending. */
  pendingIds: string[]
  /** Optional per-ID resolved action assertion (auto-resolved / llm-judged). */
  resolvedActions?: Record<string, string>
}

/**
 * Lint scenarios exercise both runStructuralLint (deterministic — orphans,
 * broken links, no-outlinks) and optionally runSemanticLint (LLM-backed).
 */
export interface LintScenario {
  name: string
  description: string
  /** Virtual project tree. Must include a db/ subfolder. */
  initialWiki: Record<string, string>
  /**
   * Optional raw LLM response for semantic lint. When absent, the semantic
   * stage is skipped — only structural assertions apply.
   */
  llmResponse?: string
  expected: {
    /** Expected structural lint findings. Order-independent. */
    structural: Array<{
      type: "orphan" | "broken-link" | "no-outlinks"
      /** Page path relative to db/ (e.g. "attention.md") */
      page: string
      /** For broken-link, the substring that should appear in the detail */
      linkName?: string
    }>
    /** Expected semantic lint findings (when llmResponse provided) */
    semantic?: Array<{
      type: string
      severity: string
      titleContains?: string
    }>
  }
}

/**
 * Ingest scenarios exercise autoIngest end-to-end: a source document plus
 * existing project state, through two LLM calls (analysis + generation),
 * to the files written on disk and the review items injected into the store.
 */
export interface IngestScenario {
  name: string
  description: string
  /** Project state before ingest runs (purpose.md, schema.md, db/*.md). */
  initialWiki: Record<string, string>
  /** The source document being ingested. */
  source: {
    /** Project-relative path, e.g. "raw/sources/paper.md" */
    path: string
    content: string
  }
  /** Raw LLM response for stage 1 (analysis). */
  analysisResponse: string
  /** Raw LLM response for stage 2 (generation — contains FILE + REVIEW blocks). */
  generationResponse: string
  expected: {
    /** File paths (relative to project root) that must be written. */
    writtenPaths: string[]
    /** Substring matches for specific files (path → list of substrings to find). */
    fileContains?: Record<string, string[]>
    /**
     * Expected review items (subset match). Each entry matches if an injected
     * review has the same type and a title containing titleContains.
     */
    reviewsCreated?: Array<{
      type: "contradiction" | "duplicate" | "missing-page" | "suggestion" | "confirm"
      titleContains: string
    }>
  }
}

/**
 * Search scenarios exercise searchWiki: a wiki directory plus a query text
 * produces a ranked list of SearchResult entries.
 */
export interface SearchScenario {
  name: string
  description: string
  /** Project state (must include db/). */
  initialWiki: Record<string, string>
  query: string
  expected: {
    /**
     * File paths (under db/, relative to project root) expected in the top
     * results, IN ORDER. Extra results beyond this prefix are allowed.
     */
    topResultPaths: string[]
    /** Paths that must NOT appear anywhere in the results. */
    excludedPaths?: string[]
    /** Paths for which the result's `titleMatch` field must be true. */
    titleMatchPaths?: string[]
  }
}

export interface SweepScenario {
  /**
   * Path-like name used as the scenario's folder under
   * tests/fixtures/scenarios/. Slashes create nested folders.
   * Example: "missing-page/filename-match"
   */
  name: string

  /** One-line human-readable description. Shown in test output. */
  description: string

  /**
   * Virtual file tree for the initial wiki state. Keys are project-root
   * relative paths, values are full file contents (usually markdown with
   * YAML frontmatter). Materialized before the test runs.
   *
   * Example:
   *   {
   *     "purpose.md": "...",
   *     "db/index.md": "...",
   *     "db/attention.md": "---\ntitle: Attention\n---\n..."
   *   }
   */
  initialWiki: Record<string, string>

  /**
   * Review items to seed into useReviewStore before sweep runs. They
   * don't need `resolved` / `createdAt` / `options` — those are filled in.
   */
  reviews: ReviewFixture[]

  /**
   * Optional raw LLM response text — exactly what `streamChat` would
   * emit. Can include markdown fences, prose wrappers, etc. If absent,
   * the LLM stage is disabled (apiKey="") so only the rule stage runs.
   */
  llmResponse?: string

  /** What the sweep should have done when it finishes. */
  expected: SweepScenarioExpected
}
