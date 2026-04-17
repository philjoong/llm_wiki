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
  searchQueries?: string[]
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
   *     "wiki/index.md": "...",
   *     "wiki/attention.md": "---\ntitle: Attention\n---\n..."
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
