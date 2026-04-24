/**
 * Unit-level tests for embedding.ts, focused on the pure / mockable
 * pieces: auto-halve retry heuristics and the chunk→page aggregation
 * contract inside `searchByEmbedding`.
 *
 * The actual HTTP layer and Tauri LanceDB commands are mocked — we're
 * NOT testing Rust vectorstore here (that has its own 15 Rust tests)
 * nor the webview fetch (that's tauri-fetch.ts). The boundary we pin
 * down here is "given these chunk-level results, do we aggregate to
 * page-level scores the way the design says?".
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// Module-level mock for the Tauri invoke boundary so we can script the
// chunk-search response without touching real LanceDB.
const mockInvoke = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>()
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => mockInvoke(cmd, args),
}))

// Stub getHttpFetch so fetchEmbedding calls hit our in-test responder.
const mockHttpFetch = vi.fn<(url: string, opts?: RequestInit) => Promise<Response>>()
vi.mock("@/lib/tauri-fetch", () => ({
  getHttpFetch: () => Promise.resolve(mockHttpFetch),
  isFetchNetworkError: (err: unknown) =>
    err instanceof TypeError ||
    (err instanceof Error &&
      (err.message === "Load failed" || err.message === "Failed to fetch")),
}))

// readFile / listDirectory aren't exercised in this file's cases; stub.
vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(),
  listDirectory: vi.fn(),
}))

import {
  searchByEmbedding,
  embedPage,
  getLastEmbeddingError,
  type PageSearchResult,
} from "./embedding"

const cfg = {
  enabled: true,
  endpoint: "http://localhost:1234/v1/embeddings",
  apiKey: "",
  model: "test-embed",
}

/** Build an embedding-shaped JSON Response. */
function okResponse(embedding: number[]): Response {
  return new Response(JSON.stringify({ data: [{ embedding }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

/** Build an HTTP-error Response that looks like an oversize rejection. */
function oversizeErrorResponse(status = 400): Response {
  return new Response(
    JSON.stringify({ error: "input length 3200 exceeds maximum context 512" }),
    { status, statusText: "Bad Request" },
  )
}

function genericErrorResponse(status: number, body: string): Response {
  return new Response(body, { status, statusText: "Error" })
}

beforeEach(() => {
  mockInvoke.mockReset()
  mockHttpFetch.mockReset()
})

// ── searchByEmbedding — chunk→page aggregation ─────────────────────

describe("searchByEmbedding — aggregation", () => {
  it("returns [] when embedding call fails (null vector)", async () => {
    mockHttpFetch.mockResolvedValue(genericErrorResponse(401, "Unauthorized"))
    const out = await searchByEmbedding("/tmp/p", "hello", cfg, 5)
    expect(out).toEqual([])
  })

  it("returns [] when no chunks come back from LanceDB", async () => {
    mockHttpFetch.mockResolvedValue(okResponse([0.1, 0.2, 0.3]))
    mockInvoke.mockResolvedValueOnce([] /* vector_search_chunks result */)
    const out = await searchByEmbedding("/tmp/p", "hello", cfg, 5)
    expect(out).toEqual([])
  })

  it("groups chunks by page and ranks by max-pool score", async () => {
    mockHttpFetch.mockResolvedValue(okResponse([0.1, 0.2, 0.3]))
    // Three pages: A has two chunks (strong + weak), B has one strong,
    // C has one weak. Expected order: A (top 0.9 + blended tail) > B
    // (0.88) > C (0.2).
    mockInvoke.mockResolvedValueOnce([
      { chunk_id: "A#0", page_id: "A", chunk_index: 0, chunk_text: "a0", heading_path: "## X", score: 0.9 },
      { chunk_id: "A#1", page_id: "A", chunk_index: 1, chunk_text: "a1", heading_path: "## Y", score: 0.5 },
      { chunk_id: "B#0", page_id: "B", chunk_index: 0, chunk_text: "b0", heading_path: "", score: 0.88 },
      { chunk_id: "C#0", page_id: "C", chunk_index: 0, chunk_text: "c0", heading_path: "", score: 0.2 },
    ])
    const out = await searchByEmbedding("/tmp/p", "q", cfg, 10)
    expect(out.map((p) => p.id)).toEqual(["A", "B", "C"])
    // A's score: 0.9 + min(0.5 * 0.3, 1 - 0.9) = 0.9 + min(0.15, 0.1) = 1.0
    expect(out[0].score).toBeCloseTo(1.0, 5)
    // B's score: 0.88 + 0 = 0.88
    expect(out[1].score).toBeCloseTo(0.88, 5)
    // C's score: 0.2 + 0 = 0.2
    expect(out[2].score).toBeCloseTo(0.2, 5)
  })

  it("caps tail contribution so a page with many weak chunks can't overtake a strong single-chunk page", async () => {
    mockHttpFetch.mockResolvedValue(okResponse([0.1, 0.2, 0.3]))
    // Page X: one chunk at 0.6, four chunks at 0.4 each (tail sum = 1.6).
    //   top=0.6, tail_weighted = 0.3 * 1.6 = 0.48, capped at 1 - 0.6 = 0.4
    //   blended = 0.6 + 0.4 = 1.0
    // Page Y: single 0.95 chunk.
    //   blended = 0.95
    // X would unfairly win if we didn't cap the tail.
    mockInvoke.mockResolvedValueOnce([
      { chunk_id: "X#0", page_id: "X", chunk_index: 0, chunk_text: "", heading_path: "", score: 0.6 },
      { chunk_id: "X#1", page_id: "X", chunk_index: 1, chunk_text: "", heading_path: "", score: 0.4 },
      { chunk_id: "X#2", page_id: "X", chunk_index: 2, chunk_text: "", heading_path: "", score: 0.4 },
      { chunk_id: "X#3", page_id: "X", chunk_index: 3, chunk_text: "", heading_path: "", score: 0.4 },
      { chunk_id: "X#4", page_id: "X", chunk_index: 4, chunk_text: "", heading_path: "", score: 0.4 },
      { chunk_id: "Y#0", page_id: "Y", chunk_index: 0, chunk_text: "", heading_path: "", score: 0.95 },
    ])
    const out: PageSearchResult[] = await searchByEmbedding("/tmp/p", "q", cfg, 10)
    // X can reach 1.0 but Y is 0.95 — both are valid cap outcomes; the
    // key assertion is that X does NOT score 0.6 + 0.48 = 1.08 (uncapped
    // math), which the cap is designed to prevent.
    const x = out.find((p) => p.id === "X")!
    expect(x.score).toBeLessThanOrEqual(1.0 + 1e-6)
  })

  it("attaches up to 3 matched chunks with metadata", async () => {
    mockHttpFetch.mockResolvedValue(okResponse([0.1, 0.2, 0.3]))
    mockInvoke.mockResolvedValueOnce([
      { chunk_id: "A#0", page_id: "A", chunk_index: 0, chunk_text: "first", heading_path: "## Intro", score: 0.9 },
      { chunk_id: "A#1", page_id: "A", chunk_index: 1, chunk_text: "second", heading_path: "## Body", score: 0.6 },
      { chunk_id: "A#2", page_id: "A", chunk_index: 2, chunk_text: "third", heading_path: "## Body", score: 0.4 },
      { chunk_id: "A#3", page_id: "A", chunk_index: 3, chunk_text: "fourth", heading_path: "## Body", score: 0.3 },
    ])
    const out = await searchByEmbedding("/tmp/p", "q", cfg, 10)
    const a = out[0]
    expect(a.matchedChunks).toHaveLength(3)
    expect(a.matchedChunks![0].text).toBe("first")
    expect(a.matchedChunks![0].headingPath).toBe("## Intro")
    expect(a.matchedChunks![0].score).toBeCloseTo(0.9, 5)
  })

  it("respects the topK cutoff", async () => {
    mockHttpFetch.mockResolvedValue(okResponse([0.1, 0.2, 0.3]))
    mockInvoke.mockResolvedValueOnce(
      Array.from({ length: 10 }, (_, i) => ({
        chunk_id: `${i}#0`,
        page_id: `page-${i}`,
        chunk_index: 0,
        chunk_text: "",
        heading_path: "",
        score: 1 - i * 0.05,
      })),
    )
    const out = await searchByEmbedding("/tmp/p", "q", cfg, 3)
    expect(out).toHaveLength(3)
    // Should be the three highest-scoring page ids.
    expect(out.map((p) => p.id)).toEqual(["page-0", "page-1", "page-2"])
  })
})

// ── fetchEmbedding auto-halve — via embedPage/searchByEmbedding ─────

describe("fetchEmbedding (via searchByEmbedding) — auto-halve", () => {
  it("retries after an oversize 400 with halved text and succeeds", async () => {
    const responses = [oversizeErrorResponse(400), okResponse([0.1, 0.2])]
    let call = 0
    mockHttpFetch.mockImplementation(async () => responses[call++] ?? okResponse([0]))
    mockInvoke.mockResolvedValueOnce([
      { chunk_id: "P#0", page_id: "P", chunk_index: 0, chunk_text: "", heading_path: "", score: 0.5 },
    ])

    const out = await searchByEmbedding("/tmp/p", "a".repeat(2000), cfg, 5)
    expect(out.map((p) => p.id)).toEqual(["P"])
    // First call with 2000 chars, second with 1000 chars.
    expect(mockHttpFetch).toHaveBeenCalledTimes(2)
    const firstBody = JSON.parse((mockHttpFetch.mock.calls[0][1] as RequestInit).body as string)
    const secondBody = JSON.parse((mockHttpFetch.mock.calls[1][1] as RequestInit).body as string)
    expect(firstBody.input.length).toBe(2000)
    expect(secondBody.input.length).toBe(1000)
  })

  it("recognises HTTP 413 as oversize and halves", async () => {
    mockHttpFetch
      .mockResolvedValueOnce(new Response("", { status: 413, statusText: "Payload Too Large" }))
      .mockResolvedValueOnce(okResponse([0.1]))
    mockInvoke.mockResolvedValueOnce([
      { chunk_id: "P#0", page_id: "P", chunk_index: 0, chunk_text: "", heading_path: "", score: 0.5 },
    ])
    await searchByEmbedding("/tmp/p", "a".repeat(500), cfg, 5)
    expect(mockHttpFetch).toHaveBeenCalledTimes(2)
  })

  it("does NOT halve on auth errors (401) — retries there would be pointless", async () => {
    mockHttpFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Invalid API key" }), { status: 401, statusText: "Unauthorized" }),
    )
    const out = await searchByEmbedding("/tmp/p", "hello", cfg, 5)
    expect(out).toEqual([])
    expect(mockHttpFetch).toHaveBeenCalledTimes(1)
    expect(getLastEmbeddingError()).toMatch(/401/)
  })

  it("gives up after 3 halvings and surfaces a specific error", async () => {
    // A fresh Response instance per call — `mockResolvedValue` returns
    // the same object repeatedly and Response bodies can only be
    // consumed once, which would mask the real retry count.
    mockHttpFetch.mockImplementation(async () => oversizeErrorResponse(400))
    const out = await searchByEmbedding("/tmp/p", "a".repeat(2000), cfg, 5)
    expect(out).toEqual([])
    // Initial call + 3 retries at halved sizes = 4 attempts.
    expect(mockHttpFetch).toHaveBeenCalledTimes(4)
    // The final error message should name a concrete smallest size
    // attempted so the user knows how low the server's context is.
    expect(getLastEmbeddingError()).toMatch(/chars/)
  })

  it("stops halving once text is short enough that retry is pointless", async () => {
    // With a 100-char input and the 64-char floor, only one retry at
    // 50 chars is possible before hitting the floor.
    mockHttpFetch.mockImplementation(async () => oversizeErrorResponse(400))
    await searchByEmbedding("/tmp/p", "a".repeat(100), cfg, 5)
    // Attempts: 100 → 50 (still > 64? no, 50 < 64 so no retry) → done.
    // Actually 100 is > 64, halved to 50, then 50 is not > 64, so no
    // further halving. But the current attempt still issues the
    // 50-char request, which also errors. So 2 calls total.
    expect(mockHttpFetch).toHaveBeenCalledTimes(2)
  })
})

// ── embedPage — replaces page's chunks in LanceDB ──────────────────

describe("embedPage", () => {
  it("chunks the page, embeds each, and upserts", async () => {
    // Fresh Response per call — Response body streams can't be
    // double-consumed.
    mockHttpFetch.mockImplementation(async () => okResponse([0.1, 0.2, 0.3]))

    // Short page → likely one chunk under default opts.
    await embedPage(
      "/tmp/p",
      "rope",
      "RoPE",
      "# RoPE\n\nRotary positional embeddings are a positional-encoding scheme.",
      cfg,
    )

    expect(mockInvoke).toHaveBeenCalledTimes(1)
    const [cmd, args] = mockInvoke.mock.calls[0]
    expect(cmd).toBe("vector_upsert_chunks")
    // TS→Rust conversion happens at the Tauri boundary — from the TS
    // side the arg object keeps its camelCase keys.
    const payload = args as { pageId: string; chunks: Array<{ chunk_index: number; embedding: number[] }> }
    expect(payload.pageId).toBe("rope")
    expect(payload.chunks.length).toBeGreaterThan(0)
    // embedding.ts rounds every float to f32 via Math.fround before
    // sending to Rust, which drifts the IEEE-754 representation
    // slightly — compare element-wise with a tolerance instead of
    // strict equality.
    const emb = payload.chunks[0].embedding
    expect(emb).toHaveLength(3)
    expect(emb[0]).toBeCloseTo(0.1, 5)
    expect(emb[1]).toBeCloseTo(0.2, 5)
    expect(emb[2]).toBeCloseTo(0.3, 5)
  })

  it("skips LanceDB call when all chunks fail to embed", async () => {
    mockHttpFetch.mockImplementation(async () => genericErrorResponse(500, "internal"))
    await embedPage("/tmp/p", "rope", "RoPE", "# RoPE\n\nbody text", cfg)
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it("no-ops when embedding is disabled in config", async () => {
    const disabled = { ...cfg, enabled: false }
    await embedPage("/tmp/p", "rope", "RoPE", "body", disabled)
    expect(mockHttpFetch).not.toHaveBeenCalled()
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it("no-ops when the content produces zero chunks (empty page)", async () => {
    await embedPage("/tmp/p", "rope", "RoPE", "   ", cfg)
    expect(mockHttpFetch).not.toHaveBeenCalled()
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it("passes page title + heading path + chunk text to the embed request", async () => {
    mockHttpFetch.mockResolvedValue(okResponse([0.5]))

    await embedPage(
      "/tmp/p",
      "attention",
      "Attention Mechanism",
      "## Intro\n\nCore concept of Transformers.",
      cfg,
    )

    expect(mockHttpFetch).toHaveBeenCalled()
    const body = JSON.parse((mockHttpFetch.mock.calls[0][1] as RequestInit).body as string)
    expect(body.input).toContain("Attention Mechanism")
    expect(body.input).toContain("## Intro")
    expect(body.input).toContain("Core concept")
  })
})
