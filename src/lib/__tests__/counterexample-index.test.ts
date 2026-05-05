import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/commands/fs", () => ({
  listDirectory: vi.fn(),
  readFile: vi.fn(),
  fileExists: vi.fn(),
}))

import { listDirectory, readFile, fileExists } from "@/commands/fs"
import {
  loadCounterexamples,
  loadRejectionLog,
  findRelatedCounterexamples,
  findRelatedRejections,
  formatDismissalContext,
  type CounterexampleEntry,
  type RejectionLogEntry,
} from "../counterexample-index"
import type { FileNode } from "@/types/wiki"

const mockListDirectory = vi.mocked(listDirectory)
const mockReadFile = vi.mocked(readFile)
const mockFileExists = vi.mocked(fileExists)

beforeEach(() => {
  mockListDirectory.mockReset()
  mockReadFile.mockReset()
  mockFileExists.mockReset()
})

function makeFile(name: string): FileNode {
  return {
    name,
    path: `/proj/counterexamples/${name}`,
    is_dir: false,
  }
}

describe("loadCounterexamples", () => {
  it("returns [] when the counterexamples directory does not exist", async () => {
    mockListDirectory.mockRejectedValueOnce(new Error("ENOENT"))
    const out = await loadCounterexamples("/proj")
    expect(out).toEqual([])
  })

  it("indexes files with frontmatter title + Stage-3 object sources", async () => {
    mockListDirectory.mockResolvedValueOnce([
      makeFile(".gitkeep" as string),
      makeFile("dungeon_a_rewards.md"),
      { name: "_proposals", path: "/proj/counterexamples/_proposals", is_dir: true },
    ] as FileNode[])
    mockReadFile.mockResolvedValueOnce(
      [
        "---",
        "title: 던전 A 보상 (잘못된 v2)",
        "sources:",
        "  - file: instance_server_design_v2.md",
        '    range: "## 던전 A — 보상 (변경)"',
        "---",
        "",
        "# 던전 A 보상",
        "",
        "잘못된 보상값을 적은 버전이라 반례로 등록했다.",
      ].join("\n"),
    )
    const out = await loadCounterexamples("/proj")
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      path: "counterexamples/dungeon_a_rewards.md",
      title: "던전 A 보상 (잘못된 v2)",
      sources: [
        {
          file: "instance_server_design_v2.md",
          range: "## 던전 A — 보상 (변경)",
        },
      ],
    })
    expect(out[0].excerpt).toContain("# 던전 A 보상")
  })

  it("skips dotfiles, directories, and non-md files", async () => {
    mockListDirectory.mockResolvedValueOnce([
      makeFile(".gitkeep"),
      { name: "_proposals", path: "/proj/counterexamples/_proposals", is_dir: true },
      makeFile("notes.txt"),
    ] as FileNode[])
    const out = await loadCounterexamples("/proj")
    expect(out).toEqual([])
    expect(mockReadFile).not.toHaveBeenCalled()
  })

  it("falls back to the slug when no title field is present", async () => {
    mockListDirectory.mockResolvedValueOnce([makeFile("orphan.md")] as FileNode[])
    mockReadFile.mockResolvedValueOnce("just a body, no frontmatter\n")
    const out = await loadCounterexamples("/proj")
    expect(out[0].title).toBe("orphan")
    expect(out[0].sources).toEqual([])
  })
})

describe("findRelatedCounterexamples", () => {
  function entry(file: string, range?: string): CounterexampleEntry {
    return {
      path: `counterexamples/${file.replace(/\W/g, "_")}.md`,
      title: file,
      sources: [{ file, ...(range ? { range } : {}) }],
      excerpt: "",
    }
  }

  it("matches case-insensitively on file name when no range is given", () => {
    const entries = [entry("DesignDoc.md", "## A"), entry("OtherDoc.md")]
    const out = findRelatedCounterexamples(entries, { file: "designdoc.md" })
    expect(out).toHaveLength(1)
    expect(out[0].title).toBe("DesignDoc.md")
  })

  it("scopes by range when the input has one — same file, different range is filtered out", () => {
    const entries = [
      entry("doc.md", "## section A"),
      entry("doc.md", "## section B"),
    ]
    const out = findRelatedCounterexamples(entries, {
      file: "doc.md",
      range: "## section B",
    })
    expect(out.map((e) => e.sources[0].range)).toEqual(["## section B"])
  })

  it("keeps range-less entries when input specifies a range — broader entries still apply", () => {
    const entries = [entry("doc.md")]
    const out = findRelatedCounterexamples(entries, {
      file: "doc.md",
      range: "## anything",
    })
    expect(out).toHaveLength(1)
  })
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
  it("returns '' when both inputs are empty", () => {
    expect(formatDismissalContext([], [])).toBe("")
  })

  it("includes both counterexamples and discards in distinct sections", () => {
    const cxs: CounterexampleEntry[] = [
      {
        path: "counterexamples/dungeon_a_rewards.md",
        title: "던전 A 보상 (잘못된 v2)",
        sources: [
          { file: "design_v2.md", range: "## 던전 A — 보상" },
        ],
        excerpt: "",
      },
    ]
    const rejs: RejectionLogEntry[] = [
      {
        timestamp: "2026-05-05T10:00:00Z",
        targetPath: "db/world/lore.md",
        sourceFile: "lore_draft.md",
        sourceRange: "## intro",
        reason: "out of scope",
      },
    ]
    const out = formatDismissalContext(cxs, rejs)
    expect(out).toContain("Prior dismissals")
    expect(out).toContain("Counterexamples")
    expect(out).toContain("Discards")
    expect(out).toContain("던전 A 보상 (잘못된 v2)")
    expect(out).toContain("design_v2.md:## 던전 A — 보상")
    expect(out).toContain("db/world/lore.md")
    expect(out).toContain("lore_draft.md:## intro")
    expect(out).toContain("out of scope")
  })

  it("omits the discards section when there are no rejections", () => {
    const cxs: CounterexampleEntry[] = [
      {
        path: "counterexamples/x.md",
        title: "X",
        sources: [{ file: "a.md" }],
        excerpt: "",
      },
    ]
    const out = formatDismissalContext(cxs, [])
    expect(out).toContain("Counterexamples")
    expect(out).not.toContain("### Discards")
  })
})
