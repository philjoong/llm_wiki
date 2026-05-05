import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/commands/git", () => ({
  gitLog: vi.fn(),
  gitShow: vi.fn(),
  gitDiff: vi.fn(),
  gitCheckoutPath: vi.fn(),
  gitCommit: vi.fn(),
  gitRevert: vi.fn(),
}))

import {
  gitLog,
  gitShow,
  gitDiff,
  gitCheckoutPath,
  gitCommit,
  gitRevert,
} from "@/commands/git"
import {
  loadCommitPage,
  loadCommitDetail,
  loadFileDiff,
  restoreFileFromCommit,
  revertCommit,
} from "../git-history"

const mockGitLog = vi.mocked(gitLog)
const mockGitShow = vi.mocked(gitShow)
const mockGitDiff = vi.mocked(gitDiff)
const mockGitCheckoutPath = vi.mocked(gitCheckoutPath)
const mockGitCommit = vi.mocked(gitCommit)
const mockGitRevert = vi.mocked(gitRevert)

beforeEach(() => {
  mockGitLog.mockReset()
  mockGitShow.mockReset()
  mockGitDiff.mockReset()
  mockGitCheckoutPath.mockReset()
  mockGitCommit.mockReset()
  mockGitRevert.mockReset()
})

describe("loadCommitPage", () => {
  it("delegates straight to gitLog when there is no cursor", async () => {
    mockGitLog.mockResolvedValueOnce([
      { hash: "h1", author: "a", date: "2026-05-05", message: "m1" },
    ])
    const page = await loadCommitPage("/proj", null, 25)
    expect(mockGitLog).toHaveBeenCalledWith("/proj", 25)
    expect(page).toHaveLength(1)
  })

  it("trims commits up to and including the cursor", async () => {
    mockGitLog.mockResolvedValueOnce([
      { hash: "h1", author: "a", date: "d", message: "m1" },
      { hash: "h2", author: "a", date: "d", message: "m2" },
      { hash: "h3", author: "a", date: "d", message: "m3" },
      { hash: "h4", author: "a", date: "d", message: "m4" },
    ])
    const page = await loadCommitPage("/proj", "h2", 50)
    expect(page.map((c) => c.hash)).toEqual(["h3", "h4"])
  })

  it("returns empty when the cursor isn't in the buffer", async () => {
    mockGitLog.mockResolvedValueOnce([
      { hash: "h1", author: "a", date: "d", message: "m1" },
    ])
    const page = await loadCommitPage("/proj", "missing", 50)
    expect(page).toEqual([])
  })
})

describe("loadCommitDetail / loadFileDiff", () => {
  it("loadCommitDetail wraps gitShow", async () => {
    mockGitShow.mockResolvedValueOnce({
      hash: "h1",
      author: "a",
      date: "d",
      message: "msg",
      files: [],
    })
    const d = await loadCommitDetail("/proj", "h1")
    expect(mockGitShow).toHaveBeenCalledWith("/proj", "h1")
    expect(d.hash).toBe("h1")
  })

  it("loadFileDiff prefers parent ref then falls back to empty tree", async () => {
    mockGitDiff.mockRejectedValueOnce(new Error("unknown revision h1^"))
    mockGitDiff.mockResolvedValueOnce("+ alpha")
    const out = await loadFileDiff("/proj", "h1", "a.md")
    expect(mockGitDiff).toHaveBeenCalledTimes(2)
    expect(mockGitDiff.mock.calls[0]).toEqual(["/proj", "h1^", "h1", "a.md"])
    expect(mockGitDiff.mock.calls[1]).toEqual([
      "/proj",
      "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
      "h1",
      "a.md",
    ])
    expect(out).toBe("+ alpha")
  })

  it("loadFileDiff returns the parent diff directly when it succeeds", async () => {
    mockGitDiff.mockResolvedValueOnce("+ beta")
    const out = await loadFileDiff("/proj", "h2", "b.md")
    expect(mockGitDiff).toHaveBeenCalledTimes(1)
    expect(mockGitDiff).toHaveBeenCalledWith("/proj", "h2^", "h2", "b.md")
    expect(out).toBe("+ beta")
  })
})

describe("restoreFileFromCommit", () => {
  it("checks out the file then commits with a structured message", async () => {
    mockGitCheckoutPath.mockResolvedValueOnce(undefined)
    mockGitCommit.mockResolvedValueOnce({ committed: true, commitHash: "newhash" })
    const res = await restoreFileFromCommit(
      "/proj",
      "abcdef1234567890",
      "db/foo.md",
    )
    expect(mockGitCheckoutPath).toHaveBeenCalledWith(
      "/proj",
      "abcdef1234567890",
      ["db/foo.md"],
    )
    expect(mockGitCommit).toHaveBeenCalledWith(
      "/proj",
      "revert: restore db/foo.md to abcdef1",
      ["db/foo.md"],
    )
    expect(res).toEqual({ committed: true, commitHash: "newhash" })
  })
})

describe("revertCommit", () => {
  it("returns the conflict list straight through without auto-resolving", async () => {
    mockGitRevert.mockResolvedValueOnce({
      committed: false,
      commitHash: null,
      conflicts: ["db/a.md", "db/b.md"],
    })
    const res = await revertCommit("/proj", "deadbeef")
    expect(mockGitRevert).toHaveBeenCalledWith("/proj", "deadbeef")
    expect(res.conflicts).toEqual(["db/a.md", "db/b.md"])
    expect(res.committed).toBe(false)
  })

  it("returns the new commit hash on a clean revert", async () => {
    mockGitRevert.mockResolvedValueOnce({
      committed: true,
      commitHash: "rev1",
      conflicts: [],
    })
    const res = await revertCommit("/proj", "deadbeef")
    expect(res.committed).toBe(true)
    expect(res.commitHash).toBe("rev1")
  })
})
