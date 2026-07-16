import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/commands/knowledge", () => ({
  listKnowledgePages: vi.fn(),
}))
vi.mock("@/lib/ingest", () => ({
  callModel: vi.fn(),
  extractKnowledgeAssertionWrites: vi.fn(),
  // Real path-safety check (mirrors production) so fallback vs accept is exercised.
  isSafeIngestPath: (p: string) => !p.includes("..") && !p.startsWith("/"),
}))
vi.mock("@/lib/ingest-v2", () => ({
  commitMarkdownV2Pages: vi.fn(),
}))
vi.mock("@/commands/fs", () => ({ readFile: vi.fn() }))

import { listKnowledgePages } from "@/commands/knowledge"
import { callModel } from "@/lib/ingest"
import { suggestSaveLocation } from "./chat-save"
import type { LlmConfig } from "@/stores/wiki-store"

const mockList = vi.mocked(listKnowledgePages)
const mockCallModel = vi.mocked(callModel)
const cfg = {} as LlmConfig

beforeEach(() => {
  vi.clearAllMocks()
  mockList.mockResolvedValue([])
})

describe("suggestSaveLocation (Step 12 §2)", () => {
  it("accepts a valid new-page suggestion", async () => {
    mockCallModel.mockResolvedValueOnce(
      JSON.stringify({ page_path: "db/concepts/스킬-쿨타임.md", title: "스킬 쿨타임", heading: "쿨타임 상한", is_new: true }),
    )
    const loc = await suggestSaveLocation("/proj", "쿨타임 상한은?", "8초", cfg)
    expect(loc).toEqual({ pagePath: "db/concepts/스킬-쿨타임.md", title: "스킬 쿨타임", heading: "쿨타임 상한", isNew: true })
  })

  it("treats a path already in the index as an existing-page append", async () => {
    mockList.mockResolvedValueOnce([
      { pageId: "p1", pagePath: "db/concepts/스킬.md", title: "스킬", pageType: "reference", summary: null, primaryEntityId: null, updatedAt: "now" } as any,
    ])
    mockCallModel.mockResolvedValueOnce(
      JSON.stringify({ page_path: "db/concepts/스킬.md", title: "스킬", heading: "쿨타임", is_new: true }),
    )
    const loc = await suggestSaveLocation("/proj", "q", "a", cfg)
    expect(loc.pagePath).toBe("db/concepts/스킬.md")
    // Path exists → forced to append regardless of the model's is_new claim.
    expect(loc.isNew).toBe(false)
  })

  it("falls back to a concepts/ page when the reply is unusable", async () => {
    mockCallModel.mockResolvedValueOnce("not json at all")
    const loc = await suggestSaveLocation("/proj", "쿨타임 상한은?", "8초", cfg)
    expect(loc.pagePath).toMatch(/^db\/concepts\/.+\.md$/)
    expect(loc.isNew).toBe(true)
  })

  it("rejects an unsafe or non-db path and falls back", async () => {
    mockCallModel.mockResolvedValueOnce(
      JSON.stringify({ page_path: "db/../secret.md", title: "x", heading: "y", is_new: true }),
    )
    const loc = await suggestSaveLocation("/proj", "q", "a", cfg)
    expect(loc.pagePath).toMatch(/^db\/concepts\//)
  })
})
