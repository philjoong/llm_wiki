import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/commands/fs", () => ({
  writeFile: vi.fn(),
  fileExists: vi.fn(),
}))
vi.mock("@/lib/ingest-queue", () => ({
  enqueueIngest: vi.fn(),
}))
vi.mock("@/lib/url-import", () => ({
  fetchUrlAsMarkdown: vi.fn(),
}))

import { writeFile, fileExists } from "@/commands/fs"
import { enqueueIngest } from "@/lib/ingest-queue"
import { fetchUrlAsMarkdown } from "@/lib/url-import"
import { formatInfoAnswer, parseInfoAnswer, injectLinkAnswer, injectFileAnswers } from "./chat-info-injection"

const mockWriteFile = vi.mocked(writeFile)
const mockFileExists = vi.mocked(fileExists)
const mockEnqueue = vi.mocked(enqueueIngest)
const mockFetch = vi.mocked(fetchUrlAsMarkdown)

beforeEach(() => {
  vi.clearAllMocks()
})

describe("formatInfoAnswer (Step 11 §2)", () => {
  it("tags a normal answer with its info_key", () => {
    expect(formatInfoAnswer("change_detail", "쿨타임 8초")).toBe("[info_key: change_detail] 쿨타임 8초")
  })
  it("emits the terminal unavailable marker regardless of answer text", () => {
    expect(formatInfoAnswer("change_detail", "ignored", true)).toBe("[info_key: change_detail] 이 정보는 없음/모름")
  })
})

describe("parseInfoAnswer (Step 12 — save action gating)", () => {
  it("round-trips an answer produced by formatInfoAnswer", () => {
    const msg = formatInfoAnswer("change_detail", "쿨타임 8초")
    expect(parseInfoAnswer(msg)).toEqual({ infoKey: "change_detail", answer: "쿨타임 8초" })
  })
  it("recognizes the unavailable marker (its key is still parseable)", () => {
    const msg = formatInfoAnswer("change_detail", "", true)
    expect(parseInfoAnswer(msg)).toEqual({ infoKey: "change_detail", answer: "이 정보는 없음/모름" })
  })
  it("returns null for an ordinary message", () => {
    expect(parseInfoAnswer("스킬 A의 쿨타임은 8초입니다")).toBeNull()
  })
})

describe("injectLinkAnswer (Step 11 §1 — reuse URL injection)", () => {
  it("fetches, writes under raw/sources, and enqueues the ingest", async () => {
    mockFetch.mockResolvedValueOnce({ markdown: "# doc", baseName: "example.com-post" })
    mockFileExists.mockResolvedValueOnce(false)
    mockEnqueue.mockResolvedValueOnce("task-1")

    const taskId = await injectLinkAnswer("/proj", "proj-uuid", "https://example.com/post")

    expect(mockFetch).toHaveBeenCalledWith("https://example.com/post")
    expect(mockWriteFile).toHaveBeenCalledWith("/proj/raw/sources/example.com-post.md", "# doc")
    expect(mockEnqueue).toHaveBeenCalledWith("proj-uuid", "raw/sources/example.com-post.md")
    expect(taskId).toBe("task-1")
  })
})

describe("injectFileAnswers (Step 11 §1 — reuse file injection)", () => {
  it("relativizes in-project paths and enqueues each file", async () => {
    mockEnqueue.mockResolvedValueOnce("t1").mockResolvedValueOnce("t2")
    const ids = await injectFileAnswers("/proj", "proj-uuid", ["/proj/raw/sources/a.pdf", "/elsewhere/b.md"])
    expect(mockEnqueue).toHaveBeenNthCalledWith(1, "proj-uuid", "raw/sources/a.pdf")
    // Out-of-project path is passed through unchanged (matches icon-sidebar).
    expect(mockEnqueue).toHaveBeenNthCalledWith(2, "proj-uuid", "/elsewhere/b.md")
    expect(ids).toEqual(["t1", "t2"])
  })
})
