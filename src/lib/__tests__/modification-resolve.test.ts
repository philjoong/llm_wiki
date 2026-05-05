import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  deleteFile: vi.fn(),
  fileExists: vi.fn(),
}))

vi.mock("@/commands/git", () => ({
  gitCommit: vi.fn(),
}))

import { readFile, writeFile, deleteFile, fileExists } from "@/commands/fs"
import { gitCommit } from "@/commands/git"
import {
  approveModification,
  discardModification,
  pendingModification,
  counterexampleModification,
  pathToSlug,
} from "../modification-resolve"
import { __resetProjectLocksForTesting } from "../project-mutex"
import type { ModificationProposal } from "@/stores/review-store"

const mockReadFile = vi.mocked(readFile)
const mockWriteFile = vi.mocked(writeFile)
const mockDeleteFile = vi.mocked(deleteFile)
const mockFileExists = vi.mocked(fileExists)
const mockGitCommit = vi.mocked(gitCommit)

function makeProposal(overrides: Partial<ModificationProposal> = {}): ModificationProposal {
  return {
    targetPath: "db/content/dungeons/dungeon_a/rewards.md",
    existingExcerpt:
      "---\ntitle: 던전 A 보상\n---\n\n# 던전 A 보상\n\n- 골드 1000\n",
    incomingExcerpt:
      "---\ntitle: 던전 A 보상\nsources:\n  - file: instance_server_design_v2.md\n    range: \"## 던전 A — 보상 (변경)\"\n---\n\n# 던전 A 보상\n\n- 골드 1500\n",
    incomingDraftPath: "pending/_proposals/1714-1-content_dungeons_dungeon_a_rewards.md",
    sourceRefs: [
      { file: "instance_server_design_v2.md", range: "## 던전 A — 보상 (변경)" },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  mockReadFile.mockReset()
  mockWriteFile.mockReset().mockResolvedValue(undefined)
  mockDeleteFile.mockReset().mockResolvedValue(undefined)
  mockFileExists.mockReset().mockResolvedValue(false)
  mockGitCommit
    .mockReset()
    .mockResolvedValue({ committed: true, commitHash: "abc1234" })
  __resetProjectLocksForTesting()
})

describe("pathToSlug", () => {
  it("strips db/ prefix and .md extension, joins with underscores", () => {
    expect(pathToSlug("db/content/dungeons/dungeon_a/rewards.md")).toBe(
      "content_dungeons_dungeon_a_rewards",
    )
  })

  it("handles paths without db/ prefix", () => {
    expect(pathToSlug("foo/bar.md")).toBe("foo_bar")
  })
})

describe("approveModification", () => {
  it("copies the parked draft to the target with sources merged, deletes the draft, commits", async () => {
    const proposal = makeProposal()
    mockReadFile
      .mockResolvedValueOnce(proposal.incomingExcerpt) // draft
      .mockResolvedValueOnce(
        "---\ntitle: 던전 A 보상\nsources:\n  - file: instance_server_design.md\n    range: \"## 3. 던전 A — 보상\"\n---\n\n# 던전 A 보상\n\n- 골드 1000\n",
      ) // existing
    mockFileExists.mockResolvedValue(true)

    await approveModification("/proj", proposal)

    // draft + existing read
    expect(mockReadFile).toHaveBeenNthCalledWith(
      1,
      `/proj/${proposal.incomingDraftPath}`,
    )
    expect(mockReadFile).toHaveBeenNthCalledWith(
      2,
      `/proj/${proposal.targetPath}`,
    )

    // The merged write goes to the target. We don't pin the exact YAML
    // layout — just confirm both source files are present in the merged
    // sources block (the v2 one from the draft + the original from disk).
    expect(mockWriteFile).toHaveBeenCalledTimes(1)
    const [writePath, writeContent] = mockWriteFile.mock.calls[0]
    expect(writePath).toBe(`/proj/${proposal.targetPath}`)
    expect(writeContent).toContain("instance_server_design_v2.md")
    expect(writeContent).toContain("instance_server_design.md")

    // Draft deleted
    expect(mockDeleteFile).toHaveBeenCalledWith(`/proj/${proposal.incomingDraftPath}`)

    // Commit on the target with the v2 source ref in the trailer
    expect(mockGitCommit).toHaveBeenCalledTimes(1)
    const [, message, paths] = mockGitCommit.mock.calls[0]
    expect(paths).toEqual([proposal.targetPath])
    expect(message).toContain("modification: approve db/content/dungeons/dungeon_a/rewards.md")
    expect(message).toContain(
      "Source: instance_server_design_v2.md:## 던전 A — 보상 (변경)",
    )
  })

  it("works when the target page does not yet exist on disk", async () => {
    // No existing file → mergeSourceRefsIntoContent returns the incoming
    // content unchanged, and the target path is created fresh.
    const proposal = makeProposal()
    mockReadFile.mockResolvedValueOnce(proposal.incomingExcerpt)
    mockFileExists.mockResolvedValue(false)

    await approveModification("/proj", proposal)

    expect(mockReadFile).toHaveBeenCalledTimes(1) // only the draft
    expect(mockWriteFile).toHaveBeenCalledWith(
      `/proj/${proposal.targetPath}`,
      proposal.incomingExcerpt,
    )
    expect(mockDeleteFile).toHaveBeenCalledWith(`/proj/${proposal.incomingDraftPath}`)
    expect(mockGitCommit).toHaveBeenCalledTimes(1)
  })
})

describe("discardModification", () => {
  it("appends a JSONL line to .llm-wiki/rejection-log.jsonl, deletes the draft, commits", async () => {
    const proposal = makeProposal()
    // existing log present
    mockFileExists.mockImplementation(async (p) => {
      if (p.endsWith("rejection-log.jsonl")) return true
      if (p === `/proj/${proposal.incomingDraftPath}`) return true
      return false
    })
    mockReadFile.mockResolvedValueOnce('{"prior":"entry"}\n')

    await discardModification("/proj", proposal, "wrong v2")

    expect(mockReadFile).toHaveBeenCalledWith("/proj/.llm-wiki/rejection-log.jsonl")

    // Log was rewritten with prior + new line
    expect(mockWriteFile).toHaveBeenCalledTimes(1)
    const [logPath, logContent] = mockWriteFile.mock.calls[0]
    expect(logPath).toBe("/proj/.llm-wiki/rejection-log.jsonl")
    expect(logContent.startsWith('{"prior":"entry"}\n')).toBe(true)
    expect(logContent.trimEnd().split("\n")).toHaveLength(2)
    const last = JSON.parse(logContent.trimEnd().split("\n")[1])
    expect(last.targetPath).toBe(proposal.targetPath)
    expect(last.sourceFile).toBe("instance_server_design_v2.md")
    expect(last.sourceRange).toBe("## 던전 A — 보상 (변경)")
    expect(last.reason).toBe("wrong v2")

    // Draft deleted
    expect(mockDeleteFile).toHaveBeenCalledWith(`/proj/${proposal.incomingDraftPath}`)

    // Commit attributed to the target page (not the log file) with discard action
    const [, message] = mockGitCommit.mock.calls[0]
    expect(message).toMatch(
      /^modification: discard db\/content\/dungeons\/dungeon_a\/rewards\.md/,
    )
    expect(message).toContain("Resolved-by: discard")
  })

  it("creates the rejection log fresh when it doesn't exist yet", async () => {
    const proposal = makeProposal()
    mockFileExists.mockResolvedValue(false) // log + draft both absent

    await discardModification("/proj", proposal)

    // No readFile call (log absent)
    expect(mockReadFile).not.toHaveBeenCalled()

    const [, logContent] = mockWriteFile.mock.calls[0]
    expect(logContent.split("\n").filter((l) => l.length > 0)).toHaveLength(1)

    // Draft delete is skipped if absent (idempotency)
    expect(mockDeleteFile).not.toHaveBeenCalled()
  })
})

describe("pendingModification", () => {
  it("moves pending/_proposals/<id>.md to pending/<slug>.md and commits", async () => {
    const proposal = makeProposal()
    mockReadFile.mockResolvedValueOnce(proposal.incomingExcerpt)

    await pendingModification("/proj", proposal)

    expect(mockReadFile).toHaveBeenCalledWith(`/proj/${proposal.incomingDraftPath}`)
    expect(mockWriteFile).toHaveBeenCalledWith(
      "/proj/pending/content_dungeons_dungeon_a_rewards.md",
      proposal.incomingExcerpt,
    )
    expect(mockDeleteFile).toHaveBeenCalledWith(`/proj/${proposal.incomingDraftPath}`)

    const [, message] = mockGitCommit.mock.calls[0]
    expect(message).toMatch(
      /^modification: pending db\/content\/dungeons\/dungeon_a\/rewards\.md/,
    )
  })
})

describe("counterexampleModification", () => {
  it("moves pending/_proposals/<id>.md to counterexamples/<slug>.md and commits", async () => {
    const proposal = makeProposal()
    mockReadFile.mockResolvedValueOnce(proposal.incomingExcerpt)

    await counterexampleModification("/proj", proposal)

    expect(mockWriteFile).toHaveBeenCalledWith(
      "/proj/counterexamples/content_dungeons_dungeon_a_rewards.md",
      proposal.incomingExcerpt,
    )
    expect(mockDeleteFile).toHaveBeenCalledWith(`/proj/${proposal.incomingDraftPath}`)

    const [, message] = mockGitCommit.mock.calls[0]
    expect(message).toMatch(
      /^modification: counterexample db\/content\/dungeons\/dungeon_a\/rewards\.md/,
    )
  })
})
