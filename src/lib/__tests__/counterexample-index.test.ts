import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(),
  fileExists: vi.fn(),
}))

import { readFile, fileExists } from "@/commands/fs"
import {
  loadRejectionLog,
  findRelatedRejections,
  formatDismissalContext,
  type RejectionLogEntry,
} from "../counterexample-index"

const mockReadFile = vi.mocked(readFile)
const mockFileExists = vi.mocked(fileExists)

beforeEach(() => {
  mockReadFile.mockReset()
  mockFileExists.mockReset()
})

describe("loadRejectionLog", () => {
  it("returns [] when the file is missing", async () => {
    mockFileExists.mockResolvedValueOnce(false)
    const out = await loadRejectionLog("/proj")
    expect(out).toEqual([])
  })

  it("parses well-formed JSONL entries newest-first and skips bad lines", async () => {
    mockFileExists.mockResolvedValueOnce(true)
    mockReadFile.mockResolvedValueOnce(
      [
        JSON.stringify({
          timestamp: "2026-05-04T10:00:00Z",
          targetPath: "db/foo.md",
          sourceFile: "raw1.md",
          sourceRange: "## A",
          reason: "old",
        }),
        "not-json",
        JSON.stringify({
          timestamp: "2026-05-05T11:00:00Z",
          targetPath: "db/bar.md",
          sourceFile: "raw2.md",
          reason: "new",
        }),
        "",
      ].join("\n"),
    )
    const out = await loadRejectionLog("/proj")
    expect(out).toHaveLength(2)
    // newest-first
    expect(out[0].targetPath).toBe("db/bar.md")
    expect(out[0].sourceRange).toBeNull() // missing in input → null
    expect(out[1].targetPath).toBe("db/foo.md")
  })
})

describe("findRelatedRejections", () => {
  it("filters by sourceFile case-insensitively", () => {
    const entries: RejectionLogEntry[] = [
      {
        timestamp: "t",
        targetPath: "db/x.md",
        sourceFile: "Foo.md",
        sourceRange: null,
        reason: "",
      },
      {
        timestamp: "t",
        targetPath: "db/y.md",
        sourceFile: "bar.md",
        sourceRange: null,
        reason: "",
      },
    ]
    const out = findRelatedRejections(entries, "FOO.MD")
    expect(out).toHaveLength(1)
    expect(out[0].targetPath).toBe("db/x.md")
  })
})

describe("formatDismissalContext", () => {
  it("returns '' when there are no rejections", () => {
    expect(formatDismissalContext([])).toBe("")
  })

  it("includes discards", () => {
    const rejs: RejectionLogEntry[] = [
      {
        timestamp: "2026-05-05T10:00:00Z",
        targetPath: "db/world/lore.md",
        sourceFile: "lore_draft.md",
        sourceRange: "## intro",
        reason: "out of scope",
      },
    ]
    const out = formatDismissalContext(rejs)
    expect(out).toContain("Prior dismissals")
    expect(out).toContain("Discards")
    expect(out).toContain("db/world/lore.md")
    expect(out).toContain("lore_draft.md:## intro")
    expect(out).toContain("out of scope")
  })
})
