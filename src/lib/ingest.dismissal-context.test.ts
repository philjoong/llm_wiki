/**
 * Dismissal context — verify that prior dismissals (rejection log)
 * reach the LLM by checking the system prompt sent to streamChat.
 *
 * The prompt-injection effect on the model output is non-deterministic,
 * so this test only confirms the *prompt context* is correct — that's
 * what dismissal context needs to guarantee. The downstream "LLM
 * dismisses" step is best-effort (see development-plan.md §Dismissal
 * Context 완료 조건).
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  listDirectory: vi.fn(),
  fileExists: vi.fn(),
}))

vi.mock("@/commands/git", () => ({
  gitInit: vi.fn(async () => undefined),
  gitCommit: vi.fn(async () => ({ committed: true, commitHash: "abc1234" })),
  gitStatus: vi.fn(async () => []),
  gitLog: vi.fn(async () => []),
}))

vi.mock("./llm-client", () => ({
  streamChat: vi.fn(async (_cfg: unknown, _msgs: unknown, cb: any) => {
    cb.onToken("")
    cb.onDone()
  }),
  // autoIngest dispatches on this; HTTP-provider fixtures here all return false.
  isCliProvider: () => false,
}))

import { readFile, listDirectory, fileExists, writeFile } from "@/commands/fs"
import { streamChat } from "./llm-client"
import { autoIngest } from "./ingest"

const streamChatSpy = vi.mocked(streamChat)
import { useWikiStore } from "@/stores/wiki-store"
import { useReviewStore } from "@/stores/review-store"
import { useActivityStore } from "@/stores/activity-store"
import { __resetProjectLocksForTesting } from "./project-mutex"
import type { FileNode } from "@/types/wiki"

const mockReadFile = vi.mocked(readFile)
const mockWriteFile = vi.mocked(writeFile)
const mockListDirectory = vi.mocked(listDirectory)
const mockFileExists = vi.mocked(fileExists)

const PROJECT = "/proj"
const SOURCE = "/proj/raw/instance_server_design_v2.md"

beforeEach(() => {
  streamChatSpy.mockClear()
  mockReadFile.mockReset()
  mockWriteFile.mockReset().mockResolvedValue(undefined)
  mockListDirectory.mockReset()
  mockFileExists.mockReset()
  useReviewStore.setState({ items: [] })
  useActivityStore.setState({ items: [] })
  useWikiStore.setState({
    project: {
      id: "p1",
      name: "t",
      path: PROJECT,
    } as unknown as ReturnType<typeof useWikiStore.getState>["project"],
  })
  useWikiStore.getState().setLlmConfig({
    provider: "openai",
    apiKey: "test-key",
    model: "gpt-4",
    ollamaUrl: "",
    customEndpoint: "",
    maxContextSize: 128000,
  })
  useWikiStore.getState().setOutputLanguage("auto")
  __resetProjectLocksForTesting()
})

describe("dismissal context injection", () => {
  it("includes rejection-log entries in the analysis prompt", async () => {
    mockReadFile.mockImplementation(async (p: string) => {
      if (p === SOURCE) return "# 인스턴스 서버 v2\n\n## 던전 A — 보상 (변경)\n- 골드 1500\n"
      if (p === `${PROJECT}/schema.md`) return "# Schema\n- db/content/dungeons/{id}/rewards.md\n"
      if (p === `${PROJECT}/purpose.md`) return "Game-dev wiki."
      if (p === `${PROJECT}/.llm-wiki/rejection-log.jsonl`) {
        return (
          JSON.stringify({
            timestamp: "2026-05-04T10:00:00Z",
            targetPath: "db/content/dungeons/dungeon_a/rewards.md",
            sourceFile: "instance_server_design_v2.md",
            sourceRange: "## 던전 A — 보상 (변경)",
            reason: "wrong v2",
          }) + "\n"
        )
      }
      throw new Error(`unexpected readFile: ${p}`)
    })
    mockListDirectory.mockImplementation(async (p: string) => {
      if (p === `${PROJECT}/db`) return [] as FileNode[]
      throw new Error(`unexpected listDirectory: ${p}`)
    })
    mockFileExists.mockImplementation(async (p: string) =>
      p === `${PROJECT}/.llm-wiki/rejection-log.jsonl`,
    )

    await autoIngest(PROJECT, SOURCE, useWikiStore.getState().llmConfig)

    expect(streamChatSpy).toHaveBeenCalled()
    const firstCall = streamChatSpy.mock.calls[0]
    const messages = firstCall[1] as Array<{ role: string; content: string }>
    const systemPrompt = messages.find((m) => m.role === "system")?.content ?? ""

    // The dismissal section must be present with the rejection-log
    // content the model needs to apply the prior decision.
    expect(systemPrompt).toContain("Prior dismissals")
    expect(systemPrompt).toContain("Discards")
    expect(systemPrompt).toContain("db/content/dungeons/dungeon_a/rewards.md")
    expect(systemPrompt).toContain("instance_server_design_v2.md:## 던전 A — 보상 (변경)")
    expect(systemPrompt).toContain("wrong v2")
  })

  it("omits the dismissal section when there are no rejections", async () => {
    mockReadFile.mockImplementation(async (p: string) => {
      if (p === SOURCE) return "# Source\n## section\nbody\n"
      if (p === `${PROJECT}/schema.md`) return "# Schema\n"
      if (p === `${PROJECT}/purpose.md`) return ""
      throw new Error(`unexpected readFile: ${p}`)
    })
    mockListDirectory.mockImplementation(async (p: string) => {
      if (p === `${PROJECT}/db`) return [] as FileNode[]
      throw new Error(`unexpected listDirectory: ${p}`)
    })
    mockFileExists.mockResolvedValue(false)

    await autoIngest(PROJECT, SOURCE, useWikiStore.getState().llmConfig)

    const messages = streamChatSpy.mock.calls[0][1] as Array<{
      role: string
      content: string
    }>
    const systemPrompt = messages.find((m) => m.role === "system")?.content ?? ""
    expect(systemPrompt).not.toContain("Prior dismissals")
  })
})
