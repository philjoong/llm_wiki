/**
 * Stage 15 — Part 2 end-to-end scenario tests.
 *
 * Walks the search pipeline from a freshly bootstrapped project through
 * 5 chat queries, then `analyzePromotionCandidates`, `promoteToAxiom`,
 * and one final query that verifies the new axiom fires.
 *
 * What is real here:
 *   - The filesystem: realFs from test-helpers, scoped to a tmp dir.
 *   - `runExcludeSearch` and the loaders / matchers / `searchPaths` it
 *     calls — including BM25-style token search over the seeded `db/`
 *     content. The point of this scenario is to prove the wiring, not
 *     to re-test individual modules.
 *   - `recordSearchInstance` writes real markdown into
 *     `exclusions/instances/<YYYY-MM>/`.
 *   - `analyzePromotionCandidates` reads those instance files back and
 *     aggregates them.
 *   - `promoteToAxiom` writes a real markdown file into
 *     `exclusions/axioms/`.
 *
 * What is mocked:
 *   - `streamChat` (the LLM call inside `classifyQuestion`). We queue a
 *     per-step classifier response.
 *   - `@/commands/git` `gitCommit` — Stage 12 / Stage 13 both touch git
 *     for audit, and we don't want a real `git` process per test.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest"
import path from "node:path"
import fs from "node:fs/promises"
import { realFs, createTempProject, readFileRaw, fileExists } from "@/test-helpers/fs-temp"
import { materializeScenario, copyDir } from "@/test-helpers/scenarios/materialize"
import {
  partTwoMvpScenarios,
  type ExcludeSearchScenario,
} from "@/test-helpers/scenarios/exclude-search-scenarios"

vi.mock("@/commands/fs", () => realFs)

vi.mock("@/commands/git", () => ({
  gitInit: vi.fn(async () => undefined),
  gitCommit: vi.fn(async () => ({ committed: true, commitHash: "test1234" })),
  gitStatus: vi.fn(async () => []),
  gitLog: vi.fn(async () => []),
}))

// Sequenced streamChat — each chat send pops one queued response. The
// scenario wires `classifierResponse` into this queue at the right step.
let pendingResponses: string[] = []
vi.mock("./llm-client", () => ({
  streamChat: vi.fn(async (_cfg, _msgs, cb) => {
    const resp = pendingResponses.shift() ?? ""
    cb.onToken(resp)
    cb.onDone()
  }),
  isCliProvider: () => false,
}))

import { runExcludeSearch } from "./exclude-search"
import {
  analyzePromotionCandidates,
  promoteToAxiom,
} from "./promotion"
import { useWikiStore } from "@/stores/wiki-store"
import { __resetProjectLocksForTesting } from "./project-mutex"

const FIXTURES_ROOT = path.join(
  process.cwd(),
  "tests",
  "fixtures",
  "scenarios-exclude-search",
)

beforeAll(async () => {
  await fs.rm(FIXTURES_ROOT, { recursive: true, force: true })
  await fs.mkdir(FIXTURES_ROOT, { recursive: true })
  for (const s of partTwoMvpScenarios) {
    // materializeScenario expects `expected` on the scenario; our shape
    // tracks expectations per-step instead, so we feed it a stub. The
    // materialized initial-wiki/ dir is the only piece the runner reads.
    await materializeScenario(
      {
        name: s.name,
        description: s.description,
        initialWiki: s.initialWiki,
        expected: { steps: s.preSteps.length + s.postSteps.length },
      },
      FIXTURES_ROOT,
    )
  }
})

interface Ctx {
  tmp: { path: string; cleanup: () => Promise<void> }
}
let ctx: Ctx | undefined

beforeEach(() => {
  pendingResponses = []
  __resetProjectLocksForTesting()
  // Disable embedding so `searchPaths` runs only the deterministic token
  // path — vector search would require a real embedding model.
  useWikiStore.getState().setEmbeddingConfig({
    enabled: false,
    endpoint: "",
    apiKey: "",
    model: "",
  })
  useWikiStore.getState().setLlmConfig({
    provider: "openai",
    apiKey: "test-key",
    model: "gpt-4",
    ollamaUrl: "",
    customEndpoint: "",
    maxContextSize: 128000,
  })
})

afterEach(async () => {
  if (ctx) {
    await ctx.tmp.cleanup()
    ctx = undefined
  }
})

async function setup(scenario: ExcludeSearchScenario): Promise<Ctx> {
  const tmp = await createTempProject(
    `exsearch-${scenario.name.replace(/\//g, "-")}`,
  )
  const initialWikiDir = path.join(FIXTURES_ROOT, scenario.name, "initial-wiki")
  await copyDir(initialWikiDir, tmp.path)

  useWikiStore.setState({
    project: {
      name: "t",
      path: tmp.path,
      createdAt: 0,
      purposeText: "",
      fileTree: [],
    } as unknown as ReturnType<typeof useWikiStore.getState>["project"],
  })

  return { tmp }
}

describe("exclude-search scenarios (Part 2 MVP)", () => {
  it.each(partTwoMvpScenarios.map((s) => [s.name, s] as const))(
    "%s",
    async (_name, scenario) => {
      ctx = await setup(scenario)
      const cfg = useWikiStore.getState().llmConfig

      // ── pre-steps ─────────────────────────────────────────────────
      for (const step of scenario.preSteps) {
        pendingResponses = [step.classifierResponse]
        const result = await runExcludeSearch(step.query, ctx.tmp.path, cfg)

        try {
          // Trace's judgedType id matches.
          if (step.expected.judgedTypeId === null) {
            expect(result.trace.judgedType).toBeNull()
          } else {
            expect(
              result.trace.judgedType?.id,
              `${step.label}: judgedType.id`,
            ).toBe(step.expected.judgedTypeId)
          }

          // Each expected hit appears somewhere in the result list.
          if (step.expected.hitPathsContain) {
            for (const wantedRel of step.expected.hitPathsContain) {
              const found = result.hits.find((h) =>
                h.path.endsWith(wantedRel),
              )
              expect(
                found,
                `${step.label}: hit missing for ${wantedRel}. hits=${result.hits
                  .map((h) => h.path)
                  .join(",")}`,
              ).toBeTruthy()
            }
          }
          if (step.expected.residueCount !== undefined) {
            expect(
              result.trace.residueCount,
              `${step.label}: residue size`,
            ).toBe(step.expected.residueCount)
          }
        } catch (err) {
          console.error(
            `\n[${scenario.name}] ${step.label} failed.\n` +
              `Trace: ${JSON.stringify(result.trace, null, 2)}\n` +
              `Hits: ${JSON.stringify(
                result.hits.map((h) => ({ path: h.path, score: h.score })),
                null,
                2,
              )}`,
          )
          throw err
        }
      }

      // ── promotion ─────────────────────────────────────────────────
      const candidates = await analyzePromotionCandidates(ctx.tmp.path, {
        thresholds: { patternMinCount: scenario.patternMinCount },
      })
      const target = candidates.find(
        (c) =>
          c.typeId === scenario.promotion.typeId &&
          c.path === scenario.promotion.path,
      )
      expect(
        target,
        `promotion candidate missing: (${scenario.promotion.typeId}, ${scenario.promotion.path}). ` +
          `got: ${JSON.stringify(
            candidates.map((c) => ({ t: c.typeId, p: c.path, n: c.count })),
            null,
            2,
          )}`,
      ).toBeTruthy()
      expect(target!.count).toBeGreaterThanOrEqual(scenario.patternMinCount)

      await promoteToAxiom(ctx.tmp.path, target!, scenario.promotion.axiomName)

      // Axiom file exists and contains the expected substrings.
      const axiomRel = `exclusions/axioms/${scenario.promotion.axiomName}.md`
      const axiomAbs = path.join(ctx.tmp.path, axiomRel)
      expect(await fileExists(axiomAbs), `axiom file not written: ${axiomRel}`).toBe(true)
      const axiomBody = await readFileRaw(axiomAbs)
      for (const sub of scenario.promotion.axiomFileContains) {
        expect(axiomBody, `axiom missing substring "${sub}"`).toContain(sub)
      }

      // ── post-steps ────────────────────────────────────────────────
      for (const step of scenario.postSteps) {
        pendingResponses = [step.classifierResponse]
        const result = await runExcludeSearch(step.query, ctx.tmp.path, cfg)

        try {
          if (step.expected.judgedTypeId === null) {
            expect(result.trace.judgedType).toBeNull()
          } else {
            expect(result.trace.judgedType?.id).toBe(step.expected.judgedTypeId)
          }
          if (step.expected.appliedEntryPatterns) {
            for (const wanted of step.expected.appliedEntryPatterns) {
              const fired = result.trace.appliedEntries.find(
                (e) => e.pattern === wanted,
              )
              expect(
                fired,
                `${step.label}: applied pattern missing: ${wanted}. ` +
                  `got: ${result.trace.appliedEntries
                    .map((e) => e.pattern)
                    .join(",")}`,
              ).toBeTruthy()
            }
          }
        } catch (err) {
          console.error(
            `\n[${scenario.name}] ${step.label} failed.\n` +
              `Trace: ${JSON.stringify(result.trace, null, 2)}`,
          )
          throw err
        }
      }
    },
  )
})
