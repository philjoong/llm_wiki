import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/commands/fs", () => ({
  listDirectory: vi.fn(),
  readFile: vi.fn(),
}))

import { listDirectory, readFile } from "@/commands/fs"
import {
  loadExclusions,
  matchesPattern,
  applyExclusions,
  type ExclusionEntry,
} from "../exclusions"
import type { FileNode } from "@/types/wiki"

const mockListDirectory = vi.mocked(listDirectory)
const mockReadFile = vi.mocked(readFile)

beforeEach(() => {
  mockListDirectory.mockReset()
  mockReadFile.mockReset()
})

function patternFile(name: string): FileNode {
  return { name, path: `/proj/exclusions/by_question_type/${name}`, is_dir: false }
}
function axiomFile(name: string): FileNode {
  return { name, path: `/proj/exclusions/axioms/${name}`, is_dir: false }
}

describe("matchesPattern", () => {
  it("matches a literal path exactly (no wildcards)", () => {
    expect(
      matchesPattern(
        "db/instance_server/server_structure.md",
        "db/instance_server/server_structure.md",
      ),
    ).toBe(true)
    expect(
      matchesPattern(
        "db/instance_server/server_structure.md",
        "db/instance_server/spawn_rules.md",
      ),
    ).toBe(false)
  })

  it("uses single-`*` to match within one path segment only", () => {
    expect(matchesPattern("db/*.md", "db/foo.md")).toBe(true)
    expect(matchesPattern("db/*.md", "db/foo/bar.md")).toBe(false)
  })

  it("uses `**` to match across path separators", () => {
    expect(matchesPattern("db/**/spawn_rules.md", "db/x/spawn_rules.md")).toBe(true)
    expect(
      matchesPattern("db/**/spawn_rules.md", "db/instance_server/region/spawn_rules.md"),
    ).toBe(true)
    expect(matchesPattern("db/**/spawn_rules.md", "wiki/x/spawn_rules.md")).toBe(false)
  })

  it("escapes regex metacharacters in pattern literals", () => {
    // `.` would be a regex wildcard if not escaped — must NOT match `mdx`.
    expect(matchesPattern("db/foo.md", "db/foo.md")).toBe(true)
    expect(matchesPattern("db/foo.md", "db/foomd")).toBe(false)
  })
})

describe("loadExclusions", () => {
  it("loads pattern files, mapping filename stem to questionTypeIds", async () => {
    mockListDirectory
      .mockResolvedValueOnce([patternFile("policy_violation.md")]) // by_question_type
      .mockResolvedValueOnce([]) // axioms
    mockReadFile.mockResolvedValueOnce(
      [
        "# 정책 위반 탐지 유형의 배제 대상",
        "## 배제",
        "- db/instance_server/server_structure.md",
        "  근거: 서버 구조는 정책이 아닌 인프라 설명.",
        "- db/**/spawn_rules.md",
        "  근거: 스폰 규칙은 운영 데이터.",
        "## 출처",
        "- 사람 검토 (2026-04-12)",
      ].join("\n"),
    )
    const docs = await loadExclusions("/proj")
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({
      questionTypeIds: ["policy_violation"],
      level: "pattern",
      filePath: "exclusions/by_question_type/policy_violation.md",
    })
    expect(docs[0].entries).toHaveLength(2)
    expect(docs[0].entries[0]).toEqual({
      pattern: "db/instance_server/server_structure.md",
      rationale: "서버 구조는 정책이 아닌 인프라 설명.",
      sources: ["사람 검토 (2026-04-12)"],
    })
    expect(docs[0].entries[1].pattern).toBe("db/**/spawn_rules.md")
  })

  it("loads axiom files and pulls applies_to from frontmatter", async () => {
    mockListDirectory
      .mockResolvedValueOnce([]) // by_question_type
      .mockResolvedValueOnce([axiomFile("infra_only.md")])
    mockReadFile.mockResolvedValueOnce(
      [
        "---",
        "applies_to: [policy_violation, condition_based_test]",
        "---",
        "## 배제",
        "- db/infra/**.md",
        "  근거: 인프라 문서는 의미 도메인 밖.",
        "  sources: 도메인 정책 v3",
        "  last_validated_at: 2026-04-01",
      ].join("\n"),
    )
    const docs = await loadExclusions("/proj")
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({
      questionTypeIds: ["policy_violation", "condition_based_test"],
      level: "axiom",
      filePath: "exclusions/axioms/infra_only.md",
    })
    expect(docs[0].entries[0]).toEqual({
      pattern: "db/infra/**.md",
      rationale: "인프라 문서는 의미 도메인 밖.",
      sources: ["도메인 정책 v3"],
      lastValidatedAt: "2026-04-01",
    })
  })

  it("loads pattern + axiom files together; missing axiom dir is fine", async () => {
    mockListDirectory
      .mockResolvedValueOnce([patternFile("a.md")])
      .mockRejectedValueOnce(new Error("ENOENT")) // axioms dir missing
    mockReadFile.mockResolvedValueOnce("## 배제\n- db/a.md\n  근거: r")
    const docs = await loadExclusions("/proj")
    expect(docs.map((d) => [d.level, d.filePath])).toEqual([
      ["pattern", "exclusions/by_question_type/a.md"],
    ])
  })

  it("parses entry-level metadata: archived, needs_review, last_validated_at", async () => {
    mockListDirectory
      .mockResolvedValueOnce([patternFile("p.md")])
      .mockResolvedValueOnce([])
    mockReadFile.mockResolvedValueOnce(
      [
        "## 배제",
        "- db/x.md",
        "  근거: 일반",
        "- db/y.md",
        "  근거: archived 항목",
        "  archived: true",
        "- db/z.md",
        "  근거: 검토 필요",
        "  needs_review: true",
        "  last_validated_at: 2025-12-01",
      ].join("\n"),
    )
    const [doc] = await loadExclusions("/proj")
    expect(doc.entries[1].archived).toBe(true)
    expect(doc.entries[2].needsReview).toBe(true)
    expect(doc.entries[2].lastValidatedAt).toBe("2025-12-01")
    // The non-archived/non-flagged entry must not pick up stray flags.
    expect(doc.entries[0].archived).toBeUndefined()
    expect(doc.entries[0].needsReview).toBeUndefined()
  })

  it("skips dotfiles, non-markdown, and read failures", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    mockListDirectory
      .mockResolvedValueOnce([
        patternFile(".gitkeep"),
        { name: "_drafts", path: "/proj/exclusions/by_question_type/_drafts", is_dir: true },
        patternFile("readme.txt"),
        patternFile("ok.md"),
        patternFile("broken.md"),
      ] as FileNode[])
      .mockResolvedValueOnce([])
    mockReadFile
      .mockResolvedValueOnce("## 배제\n- db/ok.md\n  근거: r")
      .mockRejectedValueOnce(new Error("EACCES"))
    const docs = await loadExclusions("/proj")
    expect(docs.map((d) => d.filePath)).toEqual([
      "exclusions/by_question_type/ok.md",
    ])
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("broken.md"),
      expect.any(Error),
    )
    warn.mockRestore()
  })
})

describe("applyExclusions", () => {
  it("partitions candidates into kept vs excludedByEntry, keyed on pattern", () => {
    const entries: ExclusionEntry[] = [
      { pattern: "db/instance_server/server_structure.md", rationale: "r1", sources: [] },
      { pattern: "db/**/spawn_rules.md", rationale: "r2", sources: [] },
    ]
    const candidates = [
      "db/instance_server/server_structure.md",
      "db/foo/bar.md",
      "db/x/spawn_rules.md",
    ]
    const { kept, excludedByEntry } = applyExclusions(candidates, entries)
    expect(kept).toEqual(["db/foo/bar.md"])
    expect(excludedByEntry.size).toBe(2)
    expect(excludedByEntry.get("db/instance_server/server_structure.md")).toEqual([
      "db/instance_server/server_structure.md",
    ])
    expect(excludedByEntry.get("db/**/spawn_rules.md")).toEqual([
      "db/x/spawn_rules.md",
    ])
  })

  it("skips archived entries entirely (no match recorded, candidate kept)", () => {
    const entries: ExclusionEntry[] = [
      {
        pattern: "db/foo.md",
        rationale: "r",
        sources: [],
        archived: true,
      },
      { pattern: "db/bar.md", rationale: "r", sources: [] },
    ]
    const { kept, excludedByEntry } = applyExclusions(
      ["db/foo.md", "db/bar.md", "db/baz.md"],
      entries,
    )
    expect(kept).toEqual(["db/foo.md", "db/baz.md"])
    expect(excludedByEntry.has("db/foo.md")).toBe(false)
    expect(excludedByEntry.get("db/bar.md")).toEqual(["db/bar.md"])
  })

  it("returns the original candidates when entries is empty", () => {
    const cs = ["db/a.md", "db/b.md"]
    const { kept, excludedByEntry } = applyExclusions(cs, [])
    expect(kept).toEqual(cs)
    expect(excludedByEntry.size).toBe(0)
  })

  it("omits entries that matched zero candidates from excludedByEntry", () => {
    const entries: ExclusionEntry[] = [
      { pattern: "db/missing/**.md", rationale: "r", sources: [] },
    ]
    const { kept, excludedByEntry } = applyExclusions(["db/x.md"], entries)
    expect(kept).toEqual(["db/x.md"])
    expect(excludedByEntry.size).toBe(0)
  })

  it("dedupes overlap when two patterns match the same candidate", () => {
    const entries: ExclusionEntry[] = [
      { pattern: "db/**.md", rationale: "wide", sources: [] },
      { pattern: "db/foo.md", rationale: "narrow", sources: [] },
    ]
    const { kept, excludedByEntry } = applyExclusions(["db/foo.md", "db/bar.md"], entries)
    // Both candidates are excluded — `kept` must be empty even though
    // they were each matched by at least one entry.
    expect(kept).toEqual([])
    // Both entries record their own hits independently for the trace UI.
    expect(excludedByEntry.get("db/**.md")).toEqual(["db/foo.md", "db/bar.md"])
    expect(excludedByEntry.get("db/foo.md")).toEqual(["db/foo.md"])
  })
})
