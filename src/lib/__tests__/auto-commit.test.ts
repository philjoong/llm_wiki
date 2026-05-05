import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/commands/git", () => ({
  gitCommit: vi.fn(),
}))

import { gitCommit } from "@/commands/git"
import {
  commitIngest,
  commitModification,
  formatIngestMessage,
  formatModificationMessage,
} from "../auto-commit"
import { __resetProjectLocksForTesting } from "../project-mutex"

const mockGitCommit = vi.mocked(gitCommit)

beforeEach(() => {
  mockGitCommit
    .mockReset()
    .mockResolvedValue({ committed: true, commitHash: "abc1234" })
  __resetProjectLocksForTesting()
})

describe("commitIngest", () => {
  it("does not call gitCommit when writtenPaths is empty", async () => {
    const res = await commitIngest("/proj", "src.md", [])
    expect(mockGitCommit).not.toHaveBeenCalled()
    expect(res).toEqual({ committed: false, commitHash: null })
  })

  it("commits the writtenPaths with a structured message and routes through the mutex", async () => {
    const res = await commitIngest("/proj", "instance_server_design.md", [
      "db/systems/instance_server/server_structure.md",
      "db/content/dungeons/dungeon_a/rewards.md",
    ])

    expect(mockGitCommit).toHaveBeenCalledTimes(1)
    const [projectPath, message, paths] = mockGitCommit.mock.calls[0]
    expect(projectPath).toBe("/proj")
    expect(paths).toEqual([
      "db/systems/instance_server/server_structure.md",
      "db/content/dungeons/dungeon_a/rewards.md",
    ])
    // Subject includes count and source filename.
    expect(message).toMatch(/^ingest: instance_server_design\.md → 2 pages\n\n/)
    // Each written path appears as a "(new)" bullet.
    expect(message).toContain("- db/systems/instance_server/server_structure.md (new)")
    expect(message).toContain("- db/content/dungeons/dungeon_a/rewards.md (new)")
    // Trailer carries the source filename.
    expect(message).toContain("\nSource: instance_server_design.md")
    expect(res).toEqual({ committed: true, commitHash: "abc1234" })
  })
})

describe("commitModification", () => {
  it("commits the target path with action + source range trailer", async () => {
    await commitModification(
      "/proj",
      "approve",
      "db/content/dungeons/dungeon_a/rewards.md",
      { file: "instance_server_design_v2.md", range: "## 3. 던전 A — 보상" },
    )

    expect(mockGitCommit).toHaveBeenCalledTimes(1)
    const [projectPath, message, paths] = mockGitCommit.mock.calls[0]
    expect(projectPath).toBe("/proj")
    expect(paths).toEqual(["db/content/dungeons/dungeon_a/rewards.md"])
    expect(message).toMatch(
      /^modification: approve db\/content\/dungeons\/dungeon_a\/rewards\.md\n\n/,
    )
    expect(message).toContain(
      "Source: instance_server_design_v2.md:## 3. 던전 A — 보상",
    )
    expect(message).toContain("Resolved-by: approve")
  })

  it("omits the range suffix when sourceRef has no range", async () => {
    await commitModification("/proj", "discard", "db/x.md", {
      file: "raw.md",
    })
    const [, message] = mockGitCommit.mock.calls[0]
    expect(message).toContain("\nSource: raw.md\n")
    expect(message).not.toContain("Source: raw.md:")
  })
})

describe("message formatters (pure)", () => {
  it("formatIngestMessage shape", () => {
    const msg = formatIngestMessage("a.md", ["db/x.md"])
    expect(msg).toBe("ingest: a.md → 1 pages\n\n- db/x.md (new)\n\nSource: a.md")
  })

  it("formatModificationMessage shape with range", () => {
    const msg = formatModificationMessage("approve", "db/x.md", {
      file: "raw.md",
      range: "section 3",
    })
    expect(msg).toBe(
      "modification: approve db/x.md\n\nSource: raw.md:section 3\nResolved-by: approve",
    )
  })

  it("formatModificationMessage shape without range", () => {
    const msg = formatModificationMessage("discard", "db/x.md", {
      file: "raw.md",
    })
    expect(msg).toBe(
      "modification: discard db/x.md\n\nSource: raw.md\nResolved-by: discard",
    )
  })
})
