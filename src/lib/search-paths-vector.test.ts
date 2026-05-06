/**
 * Phase A — searchPaths must restrict vector hits to the kept set.
 *
 * The exclusion pipeline's contract is "줄어든 후보 공간이 검색의 시작
 * 상태가 된다" (IDEA.md §2.5). When chat / search calls searchPaths
 * with a candidate path list, any vector hit on a page OUTSIDE that
 * list is the same kind of leak as a graph-expansion leak: the
 * embedding-similarity backdoor must be closed too.
 *
 * Mirrors the structure of search-rrf.test.ts: real fs for the project
 * tree, stubbed searchByEmbedding so we can script the exact ranked
 * vector list returned from LanceDB.
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

import { searchPaths } from "./search"
import { useWikiStore } from "@/stores/wiki-store"

interface Ctx {
  tmp: { path: string; cleanup: () => Promise<void> }
}
let ctx: Ctx | undefined

async function setupProject(files: Record<string, string>): Promise<Ctx> {
  const tmp = await createTempProject("search-paths-vector")
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
    enabled: true,
    endpoint: "http://test/v1/embeddings",
    apiKey: "",
    model: "test-embed",
  })
})

afterEach(async () => {
  if (ctx) {
    await ctx.tmp.cleanup()
    ctx = undefined
  }
})

describe("searchPaths — vector hits are clipped to the kept candidate set", () => {
  it("a vector top-1 hit on an EXCLUDED page must not surface", async () => {
    // Three pages on disk; caller passes only two as the kept set.
    // Vector search returns the EXCLUDED page (excluded.md) at rank 1 —
    // simulating the worst case where the embedding model considers it
    // the strongest semantic match. searchPaths must drop it entirely.
    ctx = await setupProject({
      "db/concepts/kept-a.md":
        "---\ntitle: Kept A\n---\n\n# Kept A\n\nrope topic mentioned briefly.",
      "db/concepts/kept-b.md":
        "---\ntitle: Kept B\n---\n\n# Kept B\n\nunrelated body text.",
      "db/concepts/excluded.md":
        "---\ntitle: Excluded\n---\n\n# Excluded\n\nrope rope rope — semantically perfect.",
    })
    const pp = ctx.tmp.path
    const kept = [
      `${pp}/db/concepts/kept-a.md`,
      `${pp}/db/concepts/kept-b.md`,
    ]

    mockSearchByEmbedding.mockResolvedValueOnce([
      { id: "concepts_excluded", score: 0.95 }, // best match — must be dropped
      { id: "concepts_kept-a", score: 0.6 },
    ])

    const out = await searchPaths(pp, "rope", kept)

    const titles = out.map((r) => r.title)
    expect(titles).not.toContain("Excluded")
    expect(titles).toContain("Kept A")
  })

  it("a vector-only kept page is materialized (RRF recovers it even with no token match)", async () => {
    // Phase A wants the same RRF goodness searchWiki has, restricted
    // to kept. Construct: kept-x has zero token overlap with the
    // query, but vector ranks it #1.
    ctx = await setupProject({
      "db/concepts/kept-x.md":
        "---\ntitle: Kept X\n---\n\n# Kept X\n\nzzz unrelated text.",
      "db/concepts/kept-y.md":
        "---\ntitle: Kept Y\n---\n\n# Kept Y\n\nfoobar mentioned once.",
    })
    const pp = ctx.tmp.path
    const kept = [
      `${pp}/db/concepts/kept-x.md`,
      `${pp}/db/concepts/kept-y.md`,
    ]

    mockSearchByEmbedding.mockResolvedValueOnce([
      { id: "concepts_kept-x", score: 0.9 },
    ])

    const out = await searchPaths(pp, "foobar", kept)

    // Both surface: kept-y from token, kept-x from vector materialization.
    const titles = out.map((r) => r.title)
    expect(titles).toContain("Kept X")
    expect(titles).toContain("Kept Y")
  })

  it("when embedding is disabled, searchPaths is pure token over the kept set", async () => {
    useWikiStore.getState().setEmbeddingConfig({
      enabled: false,
      endpoint: "",
      apiKey: "",
      model: "",
    })

    ctx = await setupProject({
      "db/concepts/keep.md":
        "---\ntitle: Keep\n---\n\n# Keep\n\nfoo body.",
      "db/concepts/drop.md":
        "---\ntitle: Drop\n---\n\n# Drop\n\nfoo body.",
    })
    const pp = ctx.tmp.path
    const kept = [`${pp}/db/concepts/keep.md`]

    const out = await searchPaths(pp, "foo", kept)

    expect(out.map((r) => r.title)).toEqual(["Keep"])
    expect(mockSearchByEmbedding).not.toHaveBeenCalled()
  })

  it("empty path list short-circuits to empty results without calling vector search", async () => {
    ctx = await setupProject({})
    const pp = ctx.tmp.path

    const out = await searchPaths(pp, "anything", [])

    expect(out).toEqual([])
    expect(mockSearchByEmbedding).not.toHaveBeenCalled()
  })
})
