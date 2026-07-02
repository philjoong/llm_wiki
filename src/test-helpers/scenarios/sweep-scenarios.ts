/**
 * Authoritative definitions of sweep-behavior scenarios.
 * Edit here to change a scenario — the runner materializes these to disk.
 *
 * The sweep resolves stale reviews via LLM semantic judgment only (the
 * old rule stage went away with the missing-page/duplicate card types).
 * Scenarios therefore cover: no-LLM conservatism, LLM-judged resolution,
 * and partial resolution within a mixed batch.
 */
import type { SweepScenario } from "./types"

const SHARED_PURPOSE = `# Purpose

This wiki tracks deep-learning research papers and the core concepts
they introduce or rely on. Pages aim to be short, encyclopedic, and
linked via [[wikilinks]] to neighboring concepts.
`

const SHARED_INDEX = `# Index

## Concepts
- [[attention]]
- [[transformer]]

## Papers
`

// ── Helpers for readable content ─────────────────────────────────────────────

function page(title: string, body: string, extras: Record<string, string> = {}): string {
  const fm = Object.entries({ title, ...extras })
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n")
  return `---\n${fm}\n---\n\n# ${title}\n\n${body}\n`
}

// ── Scenarios ────────────────────────────────────────────────────────────────

export const sweepScenarios: SweepScenario[] = [
  // 1. suggestion/stays-pending-by-default
  {
    name: "suggestion/stays-pending-by-default",
    description:
      "Suggestion items need judgment to resolve. Without LLM configured, " +
      "they stay pending.",
    initialWiki: {
      "purpose.md": SHARED_PURPOSE,
      "db/attention.md": page("Attention", "..."),
    },
    reviews: [
      {
        id: "r-sugg",
        type: "suggestion",
        title: "Consider adding a 'Transformer variants' survey page",
        description: "There are now several pages that reference variants.",
      },
    ],
    expected: {
      resolvedIds: [],
      pendingIds: ["r-sugg"],
    },
  },

  // 2. llm-judged/semantic-match
  {
    name: "llm-judged/semantic-match",
    description:
      "A suggestion asks for a Context Window page. The LLM, given the " +
      "wiki state, returns the review ID as resolved (attention.md covers " +
      "context windows). Uses a fenced JSON response to exercise " +
      "extractJsonObject.",
    initialWiki: {
      "purpose.md": SHARED_PURPOSE,
      "db/index.md": SHARED_INDEX,
      "db/attention.md": page(
        "Attention",
        "Attention defines an effective context window — the span of tokens " +
          "that can influence each output. Modern models extend this to " +
          "hundreds of thousands of tokens. This covers what users usually " +
          "mean by 'context window'.",
      ),
    },
    reviews: [
      {
        id: "r-context-window",
        type: "suggestion",
        title: "Add a page covering Context Window",
        description: "Transformer page references context windows.",
      },
    ],
    llmResponse: '```json\n{"resolved": ["r-context-window"]}\n```',
    expected: {
      resolvedIds: ["r-context-window"],
      pendingIds: [],
      resolvedActions: { "r-context-window": "llm-judged" },
    },
  },

  // 3. mixed-batch/partial-resolution
  {
    name: "mixed-batch/partial-resolution",
    description:
      "Two suggestions: one the LLM confirms as addressed by the current " +
      "wiki, one it conservatively keeps pending.",
    initialWiki: {
      "purpose.md": SHARED_PURPOSE,
      "db/index.md": SHARED_INDEX,
      "db/attention.md": page(
        "Attention",
        "Attention mechanism details. Covers context windows too.",
      ),
      "db/transformer.md": page("Transformer", "..."),
    },
    reviews: [
      {
        id: "r-mix-llm",
        type: "suggestion",
        title: "Add a page covering Context Window",
      },
      {
        id: "r-mix-sugg",
        type: "suggestion",
        title: "Consider adding a glossary page",
      },
    ],
    llmResponse: '```json\n{"resolved": ["r-mix-llm"]}\n```',
    expected: {
      resolvedIds: ["r-mix-llm"],
      pendingIds: ["r-mix-sugg"],
      resolvedActions: {
        "r-mix-llm": "llm-judged",
      },
    },
  },
]
