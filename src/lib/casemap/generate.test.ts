/**
 * Focused test for runAbstraction()'s graph-context injection (Phase J,
 * entity-relation-plan.md §Phase J). getGraphContext() must be called
 * scoped to the "casemap_" prefix, and its formatted result must be
 * appended to the model's user turn.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"

vi.mock("@/lib/llm-client", () => ({
  streamChat: vi.fn(),
  isCliProvider: () => false,
}))

const mockGetGraphContext = vi.fn()
vi.mock("@/lib/graph-qna", () => ({
  getGraphContext: (...args: unknown[]) => mockGetGraphContext(...args),
  formatGraphContextBlocks: (blocks: unknown[]) =>
    (blocks as { lines: string[] }[]).length === 0 ? "" : "## Knowledge Graph Context\n" + JSON.stringify(blocks),
}))

import { streamChat } from "@/lib/llm-client"
import { runAbstraction, type StepContext } from "./generate"

const mockStreamChat = vi.mocked(streamChat)

function fakeLlmConfig(): LlmConfig {
  return {
    provider: "openai",
    apiKey: "test-key",
    model: "gpt-4",
    ollamaUrl: "",
    customEndpoint: "",
    maxContextSize: 128000,
  }
}

function ctx(): StepContext {
  return { llmConfig: fakeLlmConfig(), projectPath: "/proj", projectName: "test-project" }
}

beforeEach(() => {
  mockGetGraphContext.mockReset()
  mockStreamChat.mockReset()
  mockGetGraphContext.mockResolvedValue([])
  mockStreamChat.mockImplementation(async (_cfg, _msgs, cb) => {
    cb.onToken(JSON.stringify({ tags: ["시전형 스킬"] }))
    cb.onDone()
  })
})

describe("runAbstraction — graph context injection", () => {
  it("scopes getGraphContext to the casemap_ prefix", async () => {
    await runAbstraction("파이어볼 스킬 설명", ctx())

    expect(mockGetGraphContext).toHaveBeenCalledWith(
      "파이어볼 스킬 설명",
      "/proj",
      "test-project",
      expect.anything(),
      "casemap_",
    )
  })

  it("appends the formatted graph context to the user turn when non-empty", async () => {
    mockGetGraphContext.mockResolvedValue([
      { graphName: "casemap_use_item", reasoning: "r", lines: ["- 기능B --HAS_TEST_CASE--> 조합 Y"], truncated: false },
    ])

    await runAbstraction("파이어볼 스킬 설명", ctx())

    const userContent = mockStreamChat.mock.calls[0][1][1].content
    expect(userContent).toContain("## Knowledge Graph Context")
    expect(userContent).toContain("기능B")
  })

  it("does not append a graph context section when getGraphContext returns nothing", async () => {
    mockGetGraphContext.mockResolvedValue([])

    await runAbstraction("파이어볼 스킬 설명", ctx())

    const userContent = mockStreamChat.mock.calls[0][1][1].content
    expect(userContent).not.toContain("## Knowledge Graph Context")
  })
})
