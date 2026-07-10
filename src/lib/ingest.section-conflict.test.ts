/**
 * Section-level conflict detection (Phase 2 of the modification-proposal
 * improvement plan, docs/temp-dev.md). Verifies writeFileBlocks' new
 * section-scoped conflict logic end-to-end through autoIngest:
 *
 *   - a `## heading` present only in the incoming content is auto-merged
 *     (no proposal, applied immediately)
 *   - a `## heading` present on both sides with a different body becomes a
 *     single-section modification proposal, while the rest of the page is
 *     written immediately
 *
 * streamChat is mocked to return a canned decomposition (SECTION format)
 * response for stage 1, then an empty response for stage 2 (graph
 * assignment) — parses to zero triples, which is a legitimate no-op path
 * (see runGraphAssignment) and keeps this test from needing a graph
 * backend mock.
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

let pendingResponses: string[] = []
vi.mock("./llm-client", () => ({
  streamChat: vi.fn(async (_cfg: unknown, _msgs: unknown, cb: any) => {
    const resp = pendingResponses.shift() ?? ""
    cb.onToken(resp)
    cb.onDone()
  }),
  isCliProvider: () => false,
}))

import { readFile, listDirectory, fileExists, writeFile } from "@/commands/fs"
import { autoIngest } from "./ingest"
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
const TARGET_ABS = `${PROJECT}/db/content/dungeons/dungeon_a/rewards.md`

function fileNode(name: string, isDir = false): FileNode {
  return { name, path: `/proj/${name}`, is_dir: isDir }
}

beforeEach(() => {
  pendingResponses = []
  mockReadFile.mockReset()
  mockWriteFile.mockReset().mockResolvedValue(undefined)
  mockListDirectory.mockReset()
  mockFileExists.mockReset().mockResolvedValue(false)
  useReviewStore.setState({ items: [] })
  useActivityStore.setState({ items: [] })
  useWikiStore.setState({
    project: { id: "p1", name: "t", path: PROJECT } as unknown as ReturnType<
      typeof useWikiStore.getState
    >["project"],
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

const EXISTING_BODY = ["## stats", "", "- 레벨 10"].join("\n")

function setupCommonMocks(existingTargetBody: string) {
  mockListDirectory.mockImplementation(async (p: string) => {
    if (p === `${PROJECT}/db`) return [fileNode("content", true)] as FileNode[]
    if (p === `${PROJECT}/counterexamples`) return [] as FileNode[]
    throw new Error(`unexpected listDirectory: ${p}`)
  })
  mockReadFile.mockImplementation(async (p: string) => {
    if (p === SOURCE) return "인스턴스 서버 설계 문서 v2"
    if (p === `${PROJECT}/schema.md`) return "# Schema\n- db/content/dungeons/{id}/rewards.md\n"
    if (p === `${PROJECT}/purpose.md`) return "Game-dev wiki."
    if (p === TARGET_ABS) return existingTargetBody
    throw new Error(`unexpected readFile: ${p}`)
  })
  mockFileExists.mockImplementation(async (p: string) => p === TARGET_ABS)
}

describe("section-level conflict detection", () => {
  it("auto-merges a brand-new section with no modification proposal", async () => {
    setupCommonMocks(`---\ntitle: 던전 A 보상\nsources:\n  - file: old.md\n---\n\n${EXISTING_BODY}`)

    const decomposition = [
      "---SECTION: ## 던전 A — 드랍 | db/content/dungeons/dungeon_a/rewards.md---",
      "## drops",
      "",
      "- 골드 1000",
      "---END SECTION---",
    ].join("\n")
    pendingResponses = [decomposition, ""]

    await autoIngest(PROJECT, SOURCE, useWikiStore.getState().llmConfig)

    expect(useReviewStore.getState().items.filter((i) => i.type === "modification")).toHaveLength(0)

    const targetWrite = mockWriteFile.mock.calls.find(([p]) => p === TARGET_ABS)
    expect(targetWrite).toBeDefined()
    const [, written] = targetWrite!
    expect(written).toContain("## stats")
    expect(written).toContain("- 레벨 10")
    expect(written).toContain("## drops")
    expect(written).toContain("- 골드 1000")

    // No draft parked under pending/_proposals — nothing conflicted.
    expect(mockWriteFile.mock.calls.some(([p]) => p.includes("pending/_proposals"))).toBe(false)
  })

  it("parks only the changed section as a modification proposal, applying the rest immediately", async () => {
    const existingBody = ["## stats", "", "- 레벨 10", "", "## drops", "", "- 골드 500"].join("\n")
    setupCommonMocks(`---\ntitle: 던전 A 보상\nsources:\n  - file: old.md\n---\n\n${existingBody}`)

    // stats changes (conflict), drops is untouched (should survive as-is
    // in the immediate write since it's absent from incoming).
    const decomposition = [
      "---SECTION: ## 던전 A — 스탯 변경 | db/content/dungeons/dungeon_a/rewards.md---",
      "## stats",
      "",
      "- 레벨 20",
      "---END SECTION---",
    ].join("\n")
    pendingResponses = [decomposition, ""]

    await autoIngest(PROJECT, SOURCE, useWikiStore.getState().llmConfig)

    const modItems = useReviewStore.getState().items.filter((i) => i.type === "modification")
    expect(modItems).toHaveLength(1)
    const proposal = modItems[0].proposal!
    expect(proposal.targetPath).toBe("db/content/dungeons/dungeon_a/rewards.md")
    expect(proposal.sectionHeading).toBe("stats")
    expect(proposal.existingExcerpt).toContain("레벨 10")
    expect(proposal.incomingExcerpt).toContain("레벨 20")

    // The draft parked under pending/_proposals holds only the conflicting
    // section's incoming body, not the whole incoming page.
    const draftWrite = mockWriteFile.mock.calls.find(([p]) => p.includes("pending/_proposals"))
    expect(draftWrite).toBeDefined()
    expect(draftWrite![1]).toContain("레벨 20")
    expect(draftWrite![1]).not.toContain("골드")

    // The immediate write to the target keeps the untouched `## drops`
    // section and the OLD `## stats` body (conflict not yet resolved).
    const targetWrite = mockWriteFile.mock.calls.find(([p]) => p === TARGET_ABS)
    expect(targetWrite).toBeDefined()
    expect(targetWrite![1]).toContain("레벨 10")
    expect(targetWrite![1]).not.toContain("레벨 20")
    expect(targetWrite![1]).toContain("골드 500")
  })

  it("still treats a fully different single-section body as one whole-page proposal (no regression)", async () => {
    setupCommonMocks(`---\ntitle: 던전 A 보상\nsources:\n  - file: old.md\n---\n\n${EXISTING_BODY}`)

    const decomposition = [
      "---SECTION: ## 던전 A — 스탯 변경 | db/content/dungeons/dungeon_a/rewards.md---",
      "## stats",
      "",
      "- 레벨 99",
      "---END SECTION---",
    ].join("\n")
    pendingResponses = [decomposition, ""]

    await autoIngest(PROJECT, SOURCE, useWikiStore.getState().llmConfig)

    const modItems = useReviewStore.getState().items.filter((i) => i.type === "modification")
    expect(modItems).toHaveLength(1)
    expect(modItems[0].proposal!.sectionHeading).toBe("stats")
  })

  it("does not create a proposal when the incoming body is identical to what's on disk", async () => {
    setupCommonMocks(`---\ntitle: 던전 A 보상\nsources:\n  - file: old.md\n---\n\n${EXISTING_BODY}`)

    const decomposition = [
      "---SECTION: ## 던전 A — 스탯 | db/content/dungeons/dungeon_a/rewards.md---",
      "## stats",
      "",
      "- 레벨 10",
      "---END SECTION---",
    ].join("\n")
    pendingResponses = [decomposition, ""]

    await autoIngest(PROJECT, SOURCE, useWikiStore.getState().llmConfig)

    expect(useReviewStore.getState().items.filter((i) => i.type === "modification")).toHaveLength(0)
    expect(mockWriteFile.mock.calls.some(([p]) => p.includes("pending/_proposals"))).toBe(false)
  })
})
