/**
 * Phase B (docs/entity-relation-plan.md) — raw-score threshold tests.
 *
 * searchWiki must drop results whose RAW token score AND raw vector
 * similarity both fall under their thresholds, instead of keeping every
 * page that matched even a single weak token.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import path from "node:path"
import fs from "node:fs/promises"
import { realFs, createTempProject } from "@/test-helpers/fs-temp"

vi.mock("@/commands/fs", () => realFs)

const mockSearchByEmbedding =
  vi.fn<(...args: unknown[]) => Promise<Array<{ id: string; score: number }>>>()
vi.mock("./embedding", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./embedding")>()
  return {
    ...actual,
    searchByEmbedding: (...args: unknown[]) => mockSearchByEmbedding(...args),
  }
})

import { searchWiki } from "./search"
import { useWikiStore } from "@/stores/wiki-store"

interface Ctx {
  tmp: { path: string; cleanup: () => Promise<void> }
}
let ctx: Ctx | undefined

async function setupProject(files: Record<string, string>): Promise<Ctx> {
  const tmp = await createTempProject("search-threshold")
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(tmp.path, rel)
    await fs.mkdir(path.dirname(full), { recursive: true })
    await fs.writeFile(full, content, "utf-8")
  }
  return { tmp }
}

beforeEach(() => {
  mockSearchByEmbedding.mockReset()
  useWikiStore.getState().setEmbeddingConfig({
    source: "builtin",
    enabled: false,
    endpoint: "",
    apiKey: "",
    model: "",
  })
})

afterEach(async () => {
  if (ctx) {
    await ctx.tmp.cleanup()
    ctx = undefined
  }
})

describe("searchWiki — raw-score threshold (token-only path)", () => {
  it("a page with a strong match (title/filename) is kept", async () => {
    ctx = await setupProject({
      "db/concepts/attention.md":
        "---\ntitle: Attention\n---\n\n# Attention\n\nbody about attention mechanisms.",
    })
    const out = await searchWiki(ctx.tmp.path, "attention")
    expect(out).toHaveLength(1)
    expect(out[0].title).toBe("Attention")
  })

  it("no db content and no query match → empty array", async () => {
    ctx = await setupProject({
      "db/concepts/unrelated.md": "---\ntitle: Unrelated\n---\n\n# Unrelated\n\nnothing to do with the query.",
    })
    const out = await searchWiki(ctx.tmp.path, "xyz123nomatch")
    expect(out).toEqual([])
  })
})

describe("searchWiki — raw-score threshold (vector path)", () => {
  beforeEach(() => {
    useWikiStore.getState().setEmbeddingConfig({
      source: "external",
      enabled: true,
      endpoint: "http://test/v1/embeddings",
      apiKey: "",
      model: "test-embed",
    })
  })

  it("a vector hit below MIN_VECTOR_SIMILARITY is dropped when it has no token match", async () => {
    ctx = await setupProject({
      "db/concepts/weakvec.md":
        "---\ntitle: Weak Vector Match\n---\n\n# Weak Vector Match\n\nsomething else entirely.",
    })
    mockSearchByEmbedding.mockResolvedValueOnce([
      { id: "concepts_weakvec", score: 0.1 }, // below MIN_VECTOR_SIMILARITY (0.3)
    ])
    const out = await searchWiki(ctx.tmp.path, "completely unrelated query")
    expect(out).toEqual([])
  })

  it("a vector hit at/above MIN_VECTOR_SIMILARITY survives with no token match", async () => {
    ctx = await setupProject({
      "db/concepts/strongvec.md":
        "---\ntitle: Strong Vector Match\n---\n\n# Strong Vector Match\n\nsomething else entirely.",
    })
    mockSearchByEmbedding.mockResolvedValueOnce([
      { id: "concepts_strongvec", score: 0.85 },
    ])
    const out = await searchWiki(ctx.tmp.path, "completely unrelated query")
    expect(out).toHaveLength(1)
    expect(out[0].title).toBe("Strong Vector Match")
  })
})
