/**
 * Stage 4 — `modification` review items are NEVER auto-resolved by the
 * sweep pass. The sweep is allowed to clean up stale missing-page /
 * duplicate cards via filename or LLM judgment, but a modification
 * proposal carries a parked draft file that only the user can resolve.
 *
 * This test mocks both the FS index lookup and the LLM client to a no-op
 * baseline, then runs the sweep against a store that mixes one
 * resolvable missing-page card with one modification card. The expected
 * outcome: missing-page may resolve via the rule stage, modification
 * stays pending and never reaches the LLM judge.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("./llm-client", () => ({
  streamChat: vi.fn(),
}))
vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  listDirectory: vi.fn(),
}))

import { streamChat } from "./llm-client"
import { listDirectory, readFile } from "@/commands/fs"
import { sweepResolvedReviews } from "./sweep-reviews"
import { useWikiStore } from "@/stores/wiki-store"
import { useReviewStore, type ReviewItem } from "@/stores/review-store"
import type { FileNode } from "@/types/wiki"

const mockStreamChat = vi.mocked(streamChat)
const mockListDirectory = vi.mocked(listDirectory)
const mockReadFile = vi.mocked(readFile)

function fileNode(name: string): FileNode {
  return {
    name,
    path: `/proj/db/${name}`,
    is_dir: false,
    children: [],
  } as FileNode
}

beforeEach(() => {
  useReviewStore.setState({ items: [] })
  mockStreamChat.mockReset()
  mockListDirectory.mockReset()
  mockReadFile.mockReset()
  useWikiStore.setState({
    project: {
      name: "p",
      path: "/proj",
      createdAt: 0,
      purposeText: "",
      fileTree: [],
    } as unknown as ReturnType<typeof useWikiStore.getState>["project"],
  })
  // Disable the LLM stage entirely — nothing in this test should reach it.
  useWikiStore.getState().setLlmConfig({
    provider: "openai",
    apiKey: "",
    model: "",
    ollamaUrl: "",
    customEndpoint: "",
    maxContextSize: 0,
  })
})

describe("sweep skips modification items", () => {
  it("does not resolve modification cards even when the rule stage clears other items", async () => {
    // Wiki index contains an `attention.md` page → the missing-page
    // card SHOULD resolve via the rule stage.
    mockListDirectory.mockResolvedValue([fileNode("attention.md")])
    mockReadFile.mockResolvedValue("---\ntitle: Attention\n---\n\n# Attention\n")

    useReviewStore.getState().addItems([
      {
        type: "missing-page",
        title: "Missing page: attention",
        description: "",
        options: [],
      },
      {
        type: "modification",
        title: "Modification proposal: db/content/dungeons/dungeon_a/rewards.md",
        description: "v2 differs",
        options: [],
        proposal: {
          targetPath: "db/content/dungeons/dungeon_a/rewards.md",
          existingExcerpt: "old",
          incomingExcerpt: "new",
          incomingDraftPath: "pending/_proposals/100-1-rewards.md",
          sourceRefs: [{ file: "raw_v2.md", range: "## section" }],
        },
      },
    ])

    const resolvedCount = await sweepResolvedReviews("/proj")

    const items = useReviewStore.getState().items
    const modItem = items.find((i) => i.type === "modification") as ReviewItem
    const missingItem = items.find((i) => i.type === "missing-page") as ReviewItem

    expect(modItem.resolved).toBe(false)
    expect(modItem.stage).toBe("primary")
    expect(missingItem.resolved).toBe(true)
    expect(missingItem.resolvedAction).toBe("auto-resolved")
    expect(resolvedCount).toBe(1)

    // LLM judge must never see a modification card — the API key was
    // cleared, but as a belt-and-suspenders check: streamChat was not
    // called at all.
    expect(mockStreamChat).not.toHaveBeenCalled()
  })

  it("returns 0 when the only pending item is a modification", async () => {
    mockListDirectory.mockResolvedValue([])
    useReviewStore.getState().addItems([
      {
        type: "modification",
        title: "Modification proposal",
        description: "",
        options: [],
        proposal: {
          targetPath: "db/x.md",
          existingExcerpt: "a",
          incomingExcerpt: "b",
          incomingDraftPath: "pending/_proposals/1-1-x.md",
          sourceRefs: [{ file: "r.md" }],
        },
      },
    ])
    const resolved = await sweepResolvedReviews("/proj")
    expect(resolved).toBe(0)
    const item = useReviewStore.getState().items[0]
    expect(item.resolved).toBe(false)
  })
})
