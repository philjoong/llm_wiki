/**
 * Focused test for generateScenarios()'s graph-context injection (Phase J,
 * entity-relation-plan.md §Phase J). getGraphContext() must be called
 * scoped to the "persona_" prefix, and its formatted result must be
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
import { generateScenarios } from "./generate"
import { createPersona } from "./types"

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

beforeEach(() => {
  mockGetGraphContext.mockReset()
  mockStreamChat.mockReset()
  mockGetGraphContext.mockResolvedValue([])
  mockStreamChat.mockImplementation(async (_cfg, _msgs, cb) => {
    cb.onToken(JSON.stringify({ scenarios: [{ title: "튜토리얼 스킵 시도", steps: ["로그인", "스킵 클릭"] }] }))
    cb.onDone()
  })
})

describe("generateScenarios — graph context injection", () => {
  it("scopes getGraphContext to the persona_ prefix", async () => {
    const persona = createPersona("신규 유저")

    await generateScenarios(persona, "파이어볼 전투 루프", 3, fakeLlmConfig(), "/proj", "test-project")

    expect(mockGetGraphContext).toHaveBeenCalledWith(
      "파이어볼 전투 루프",
      "/proj",
      "test-project",
      expect.anything(),
      "persona_",
    )
  })

  it("appends the formatted graph context to the user turn when non-empty", async () => {
    mockGetGraphContext.mockResolvedValue([
      { graphName: "persona_play_scenario", reasoning: "r", lines: ["- 숙련유저 --PERFORMS--> 연타 콤보"], truncated: false },
    ])
    const persona = createPersona("신규 유저")

    await generateScenarios(persona, "파이어볼 전투 루프", 3, fakeLlmConfig(), "/proj", "test-project")

    const userContent = mockStreamChat.mock.calls[0][1][1].content
    expect(userContent).toContain("## Knowledge Graph Context")
    expect(userContent).toContain("연타 콤보")
  })

  it("does not append a graph context section when getGraphContext returns nothing", async () => {
    mockGetGraphContext.mockResolvedValue([])
    const persona = createPersona("신규 유저")

    await generateScenarios(persona, "파이어볼 전투 루프", 3, fakeLlmConfig(), "/proj", "test-project")

    const userContent = mockStreamChat.mock.calls[0][1][1].content
    expect(userContent).not.toContain("## Knowledge Graph Context")
  })
})
