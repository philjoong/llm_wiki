import { describe, it, expect, beforeEach, vi } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"

vi.mock("@/lib/llm-client", () => ({
  streamChat: vi.fn(),
}))

import { classifyQuestion } from "../classify-question"
import { streamChat } from "@/lib/llm-client"
import type { QuestionType } from "../question-types"

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

function mockStreamChatReturns(text: string) {
  mockStreamChat.mockImplementation(async (_config, _msgs, callbacks) => {
    callbacks.onToken(text)
    callbacks.onDone()
  })
}

function mockStreamChatErrors(err: Error) {
  mockStreamChat.mockImplementation(async (_config, _msgs, callbacks) => {
    callbacks.onError(err)
  })
}

const TYPES: QuestionType[] = [
  {
    id: "policy_violation",
    name: "정책 위반 탐지",
    description: "사용자/운영 정책에 위반되는 동작을 식별한다.",
    _filePath: "",
  },
  {
    id: "condition_based_test",
    name: "조건 기반 가상 테스트",
    description: "특정 조건에서의 시스템 동작을 묘사한다.",
    inputShape: "조건 + 행위",
    _filePath: "",
  },
]

beforeEach(() => {
  mockStreamChat.mockReset()
})

describe("classifyQuestion", () => {
  it("returns the parsed result on a normal match", async () => {
    mockStreamChatReturns(
      JSON.stringify({
        typeId: "condition_based_test",
        confidence: 0.85,
        reasoning: "조건과 행위가 명시되어 있다.",
      }),
    )

    const out = await classifyQuestion(
      "Fireball을 SafeZone에서 발사하면?",
      TYPES,
      fakeLlmConfig(),
    )

    expect(out).toEqual({
      typeId: "condition_based_test",
      confidence: 0.85,
      reasoning: "조건과 행위가 명시되어 있다.",
    })
  })

  it("returns null when the LLM admits no type fits (typeId: null)", async () => {
    mockStreamChatReturns(
      JSON.stringify({
        typeId: null,
        confidence: 0,
        reasoning: "질문이 너무 모호함.",
      }),
    )

    const out = await classifyQuestion("이거 좀 봐줘", TYPES, fakeLlmConfig())
    expect(out).toBeNull()
  })

  it("rejects an unknown typeId returned by a hallucinating LLM", async () => {
    mockStreamChatReturns(
      JSON.stringify({
        typeId: "made_up_type",
        confidence: 0.9,
        reasoning: "...",
      }),
    )

    const out = await classifyQuestion("어떤 질문", TYPES, fakeLlmConfig())
    expect(out).toBeNull()
  })

  it("returns null when the LLM response is not parseable JSON", async () => {
    mockStreamChatReturns("Sorry, I cannot help with that.")

    const out = await classifyQuestion("어떤 질문", TYPES, fakeLlmConfig())
    expect(out).toBeNull()
  })

  it("returns null without calling the LLM when types is empty", async () => {
    const out = await classifyQuestion("어떤 질문", [], fakeLlmConfig())
    expect(out).toBeNull()
    expect(mockStreamChat).not.toHaveBeenCalled()
  })

  it("returns null when streamChat reports an error", async () => {
    mockStreamChatErrors(new Error("network down"))
    const out = await classifyQuestion("어떤 질문", TYPES, fakeLlmConfig())
    expect(out).toBeNull()
  })

  it("tolerates JSON wrapped in ```json fences", async () => {
    mockStreamChatReturns(
      [
        "```json",
        JSON.stringify({
          typeId: "policy_violation",
          confidence: 0.7,
          reasoning: "정책 관련.",
        }),
        "```",
      ].join("\n"),
    )

    const out = await classifyQuestion(
      "이 동작이 정책 위반인가?",
      TYPES,
      fakeLlmConfig(),
    )
    expect(out?.typeId).toBe("policy_violation")
    expect(out?.confidence).toBe(0.7)
  })

  it("includes question type cards in the prompt", async () => {
    mockStreamChatReturns(
      JSON.stringify({
        typeId: "policy_violation",
        confidence: 0.5,
        reasoning: "test",
      }),
    )
    await classifyQuestion("질문", TYPES, fakeLlmConfig())

    const prompt = mockStreamChat.mock.calls[0][1][0].content
    expect(prompt).toContain("policy_violation")
    expect(prompt).toContain("condition_based_test")
    expect(prompt).toContain("정책 위반 탐지")
    expect(prompt).toContain("조건 기반 가상 테스트")
    expect(prompt).toContain("질문")
  })
})
