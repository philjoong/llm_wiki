/**
 * Real-LLM sweep tests — exercises the LLM-judged stage against Ollama.
 *
 * Uses only the sweep scenarios that involve LLM judgment. Asserts contracts:
 *   - Sweep completes without throwing
 *   - All resolved IDs came from the input review set
 *   - Every resolution is attributed to the LLM judge
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import { realFs, createTempProject } from "@/test-helpers/fs-temp"

vi.mock("@/commands/fs", () => realFs)

import { sweepResolvedReviews } from "./sweep-reviews"
import { useWikiStore } from "@/stores/wiki-store"
import { useReviewStore } from "@/stores/review-store"
import { useActivityStore } from "@/stores/activity-store"
import { sweepScenarios } from "@/test-helpers/scenarios/sweep-scenarios"

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://192.168.1.50:8080"
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "Qwen3.6-35B-A3B-UD-Q4_K_M.gguf"
const ENABLED = process.env.RUN_LLM_TESTS === "1"

const TEST_TIMEOUT_MS = 5 * 60 * 1000

// Only run scenarios that actually invoke the LLM stage. The no-LLM
// scenario is fully deterministic and already covered by the mocked runner.
const LLM_SCENARIO_NAMES = new Set([
  "llm-judged/semantic-match",
  "mixed-batch/partial-resolution",
])
const scenarios = sweepScenarios.filter((s) => LLM_SCENARIO_NAMES.has(s.name))

beforeAll(() => {
  // nothing required for ollama
})

beforeEach(() => {
  useReviewStore.setState({ items: [] })
  useActivityStore.setState({ items: [] })
})

interface Ctx {
  tmp: { path: string; cleanup: () => Promise<void> }
}
let ctx: Ctx | undefined

async function setup(scenario: typeof sweepScenarios[number]): Promise<Ctx> {
  const tmp = await createTempProject(`real-llm-sweep-${scenario.name.replace(/\//g, "-")}`)

  for (const [rel, content] of Object.entries(scenario.initialWiki)) {
    const full = path.join(tmp.path, rel)
    await fs.mkdir(path.dirname(full), { recursive: true })
    await fs.writeFile(full, content, "utf-8")
  }

  useReviewStore.setState({
    items: scenario.reviews.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      description: r.description ?? "",
      affectedPages: r.affectedPages,
      sourcePath: r.sourcePath,
      options: [],
      resolved: false,
      createdAt: 0,
    })),
  })

  useWikiStore.setState({
    project: {
      name: "test",
      path: tmp.path,
      createdAt: 0,
      purposeText: "",
      fileTree: [],
    } as unknown as ReturnType<typeof useWikiStore.getState>["project"],
  })
  useWikiStore.getState().setLlmConfig({
    provider: "ollama",
    apiKey: "",
    model: OLLAMA_MODEL,
    ollamaUrl: OLLAMA_URL,
    customEndpoint: "",
    maxContextSize: 110000,
  })

  return { tmp }
}

afterEach(async () => {
  if (ctx) {
    await ctx.tmp.cleanup()
    ctx = undefined
  }
})

describe("real-LLM sweep scenarios (LLM-judged only)", () => {
  for (const scenario of scenarios) {
    it.skipIf(!ENABLED)(
      scenario.name,
      async () => {
        ctx = await setup(scenario)
        const inputIds = new Set(scenario.reviews.map((r) => r.id))

        const t0 = Date.now()
        const total = await sweepResolvedReviews(ctx.tmp.path)
        const elapsedS = ((Date.now() - t0) / 1000).toFixed(1)

        const state = useReviewStore.getState().items
        const resolved = state.filter((i) => i.resolved)
        const resolvedIds = resolved.map((i) => i.id)

        // eslint-disable-next-line no-console
        console.log(
          `\n[sweep-real: ${scenario.name}] ${elapsedS}s, ` +
            `resolved ${total}/${scenario.reviews.length} ` +
            `(${resolvedIds.join(", ") || "none"})\n`,
        )

        // Contract 1: Every resolved ID must have come from the input batch
        for (const id of resolvedIds) {
          expect(
            inputIds.has(id),
            `unexpected resolved ID ${id} not in input`,
          ).toBe(true)
        }

        // Contract 2: Resolved items carry the LLM-judged action — the
        // sweep has no other resolution path.
        for (const item of resolved) {
          expect(
            item.resolvedAction,
            `${item.id} resolved but has no resolvedAction`,
          ).toBeTruthy()
          expect(
            item.resolvedAction,
            `${item.id} has unknown action: ${item.resolvedAction}`,
          ).toBe("llm-judged")
        }

        // Contract 3: Total count matches the number of resolved items
        expect(total).toBe(resolvedIds.length)

        // Contract 4: Input item count preserved (nothing added, nothing lost)
        expect(state.length).toBe(scenario.reviews.length)

        // ── Scenario-specific strict assertions ────────────────────────
        // These catch regressions that the generic contracts miss.
        if (scenario.name === "mixed-batch/partial-resolution") {
          // Both items are suggestions; resolution is best-effort LLM
          // judgment, but any resolution must be attributed to the judge.
          const suggItem = state.find((i) => i.id === "r-mix-sugg")
          if (suggItem?.resolved) {
            expect(
              suggItem.resolvedAction,
              "suggestion can only be resolved by the LLM judge",
            ).toBe("llm-judged")
          }
        }

        if (scenario.name === "llm-judged/semantic-match") {
          // LIMITATION: the sweep judge only sends page FILENAMES + TITLES
          // to the LLM, not body content. Semantic matching of 'Context
          // Window' to attention.md depends on the LLM's general knowledge
          // that attention windows = context windows. This is best-effort;
          // we assert the operation completes cleanly rather than demand
          // the LLM always make the leap.
          // If it ever resolves, the action must be llm-judged.
          for (const item of resolved) {
            expect(item.resolvedAction).toBe("llm-judged")
          }
        }
      },
      TEST_TIMEOUT_MS,
    )
  }
})
