/**
 * Stage 14 — exclusion-validity tests.
 *
 * Coverage breakdown (IDEA §2.8):
 *
 *   Mechanism 1 (source dependency) — 1 case
 *   Mechanism 2 (freshness)         — 1 case
 *   Mechanism 3 (counterexample)    — 1 case
 *   Mechanism 4 (archive/restore)   — 1 case
 *
 * Scenarios (end-to-end through the helpers, still mocked at the fs/git
 * boundary) — 4 cases:
 *
 *   - Source freshness then validate → flag cleared
 *   - Stale axiom then validate → no longer stale
 *   - Counterexample across a typed entry → other-type entry also flagged
 *   - Archive then restore → applyExclusions reflects state in both
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/commands/fs", () => ({
  listDirectory: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  fileExists: vi.fn(),
}))

vi.mock("@/commands/git", () => ({
  gitCommit: vi.fn(),
  gitLog: vi.fn(),
  gitShow: vi.fn(),
}))

import { listDirectory, readFile, writeFile, fileExists } from "@/commands/fs"
import { gitCommit, gitLog, gitShow } from "@/commands/git"
import {
  checkSourceFreshness,
  findStaleAxioms,
  getGitMtimes,
  markValidated,
  recordCounterexample,
  runFreshnessCheck,
  setEntryFlag,
  setEntrySubField,
  appendEntrySource,
} from "../exclusion-validity"
import { loadExclusions, applyExclusions } from "../exclusions"
import { __resetProjectLocksForTesting } from "../project-mutex"
import type { FileNode } from "@/types/wiki"

const mockList = vi.mocked(listDirectory)
const mockRead = vi.mocked(readFile)
const mockWrite = vi.mocked(writeFile)
const mockExists = vi.mocked(fileExists)
const mockCommit = vi.mocked(gitCommit)
const mockLog = vi.mocked(gitLog)
const mockShow = vi.mocked(gitShow)

const PP = "/proj"

beforeEach(() => {
  mockList.mockReset().mockResolvedValue([])
  mockRead.mockReset().mockRejectedValue(new Error("not found"))
  mockWrite.mockReset().mockResolvedValue(undefined)
  mockExists.mockReset().mockResolvedValue(false)
  mockCommit
    .mockReset()
    .mockResolvedValue({ committed: true, commitHash: "abc1234" })
  mockLog.mockReset().mockResolvedValue([])
  mockShow.mockReset()
  __resetProjectLocksForTesting()
})

function patternFileNode(name: string): FileNode {
  return {
    name,
    path: `${PP}/exclusions/by_question_type/${name}`,
    is_dir: false,
  }
}

function axiomFileNode(name: string): FileNode {
  return {
    name,
    path: `${PP}/exclusions/axioms/${name}`,
    is_dir: false,
  }
}

// ── Mechanism unit tests ─────────────────────────────────────────────

describe("checkSourceFreshness (mechanism 1 — source dependency)", () => {
  it("flags entries whose source mtime is newer than last_validated_at", () => {
    const docs = [
      {
        questionTypeIds: ["policy_violation"],
        level: "pattern" as const,
        filePath: "exclusions/by_question_type/policy_violation.md",
        entries: [
          {
            pattern: "db/foo.md",
            rationale: "out-of-scope",
            sources: ["db/policy.md", "사람 검토 (2026-01-01)"],
            lastValidatedAt: "2026-04-12",
          },
          {
            pattern: "db/bar.md",
            rationale: "ok",
            sources: ["db/policy.md"],
            lastValidatedAt: "2026-06-01",
          },
          {
            pattern: "db/baz.md",
            rationale: "no validation date",
            sources: ["db/policy.md"],
          },
        ],
      },
    ]
    const mtimes = new Map([["db/policy.md", "2026-05-01T00:00:00Z"]])

    const { rows } = checkSourceFreshness(docs, mtimes)

    // Only `db/foo.md` qualifies: db/policy.md changed 2026-05-01 which
    // is after the entry's 2026-04-12 validation. db/bar.md was validated
    // AFTER the source change so it's fine. db/baz.md has no
    // lastValidatedAt → skipped (source freshness is opt-in).
    expect(rows).toHaveLength(1)
    expect(rows[0].ref.pattern).toBe("db/foo.md")
    expect(rows[0].staleSources).toEqual(["db/policy.md"])
    expect(rows[0].lastValidatedAt).toBe("2026-04-12")
  })
})

describe("findStaleAxioms (mechanism 2 — freshness)", () => {
  it("returns axiom entries older than the freshness window, sorted oldest first", () => {
    const NOW = new Date("2026-05-11T00:00:00Z")
    const docs = [
      {
        questionTypeIds: ["t1"],
        level: "axiom" as const,
        filePath: "exclusions/axioms/old-infra.md",
        entries: [
          {
            pattern: "db/old.md",
            rationale: "infra",
            sources: [],
            lastValidatedAt: "2026-01-01",
          },
        ],
      },
      {
        questionTypeIds: ["t1"],
        level: "axiom" as const,
        filePath: "exclusions/axioms/recent.md",
        entries: [
          {
            pattern: "db/recent.md",
            rationale: "policy",
            sources: [],
            lastValidatedAt: "2026-05-01",
          },
        ],
      },
      {
        questionTypeIds: ["t1"],
        // pattern-level entries don't go stale — same date but ignored.
        level: "pattern" as const,
        filePath: "exclusions/by_question_type/t1.md",
        entries: [
          {
            pattern: "db/pat.md",
            rationale: "x",
            sources: [],
            lastValidatedAt: "2026-01-01",
          },
        ],
      },
    ]

    const { rows } = findStaleAxioms(docs, 90, NOW)

    expect(rows).toHaveLength(1)
    expect(rows[0].ref.pattern).toBe("db/old.md")
    expect(rows[0].ageDays).toBeGreaterThan(90)
  })
})

describe("recordCounterexample (mechanism 3 — counterexample)", () => {
  it("flags every non-archived entry whose pattern matches the path", async () => {
    // Two docs both exclude db/instance_server/server_structure.md, one
    // archived (must NOT be flagged), one active (must be flagged).
    mockList.mockImplementation(async (path: string) => {
      if (path === `${PP}/exclusions/by_question_type`) {
        return [patternFileNode("policy_violation.md")]
      }
      if (path === `${PP}/exclusions/axioms`) {
        return [axiomFileNode("infra.md")]
      }
      return []
    })
    mockRead.mockImplementation(async (path: string) => {
      if (path.endsWith("/policy_violation.md")) {
        return [
          "# policy_violation",
          "",
          "## 배제",
          "- db/instance_server/server_structure.md",
          "  근거: 인프라 설명",
          "  출처: 사람 검토",
          "",
        ].join("\n")
      }
      if (path.endsWith("/infra.md")) {
        // Archived axiom — its match should be SKIPPED.
        return [
          "---",
          "applies_to: [regression_test]",
          "---",
          "",
          "## 배제",
          "- db/**/server_structure.md",
          "  근거: 인프라",
          "  archived: true",
          "",
        ].join("\n")
      }
      throw new Error("not found")
    })
    mockExists.mockResolvedValue(true)

    const out = await recordCounterexample(
      PP,
      "db/instance_server/server_structure.md",
      "사용자 검토",
    )

    expect(out.flagged).toHaveLength(1)
    expect(out.flagged[0].filePath).toBe(
      "exclusions/by_question_type/policy_violation.md",
    )
    // setEntryFlag wrote once with needs_review: true.
    expect(mockWrite).toHaveBeenCalledTimes(1)
    const writtenBody = mockWrite.mock.calls[0][1]
    expect(writtenBody).toContain("needs_review: true")
    // Citation appended as a new source.
    expect(writtenBody).toMatch(/출처:.*반례:/)
    expect(mockCommit).toHaveBeenCalledTimes(1)
    expect(mockCommit.mock.calls[0][1]).toContain("counterexample:")
  })
})

describe("setEntryFlag (mechanism 4 — archive)", () => {
  it("toggles `archived: true` on an entry and commits", async () => {
    mockExists.mockResolvedValue(true)
    mockRead.mockResolvedValue(
      [
        "# policy_violation",
        "",
        "## 배제",
        "- db/foo.md",
        "  근거: 보존 대상",
        "",
      ].join("\n"),
    )

    const out = await setEntryFlag(
      PP,
      {
        filePath: "exclusions/by_question_type/policy_violation.md",
        pattern: "db/foo.md",
      },
      "archived",
      true,
    )

    expect(out.commitHash).toBe("abc1234")
    const body = mockWrite.mock.calls[0][1]
    expect(body).toContain("- db/foo.md")
    expect(body).toContain("archived: true")
    expect(mockCommit.mock.calls[0][2]).toEqual([
      "exclusions/by_question_type/policy_violation.md",
    ])
  })

  it("returns null commitHash when the file is missing (UI no-op)", async () => {
    mockExists.mockResolvedValue(false)
    const out = await setEntryFlag(
      PP,
      { filePath: "exclusions/by_question_type/x.md", pattern: "db/foo.md" },
      "archived",
      true,
    )
    expect(out.commitHash).toBeNull()
    expect(mockWrite).not.toHaveBeenCalled()
    expect(mockCommit).not.toHaveBeenCalled()
  })
})

// ── Scenario tests (helper-level integration) ────────────────────────

describe("scenario: source dependency → mark validated clears flag", () => {
  it("flag is set on first runFreshnessCheck then cleared by markValidated", async () => {
    // 1) Setup: one pattern entry citing db/policy.md, validated 2026-04-12.
    const entryBody = [
      "# policy_violation",
      "",
      "## 배제",
      "- db/foo.md",
      "  근거: out of scope",
      "  출처: db/policy.md",
      "  last_validated_at: 2026-04-12",
      "",
    ].join("\n")

    // First pass: loadExclusions + git mtimes show source changed
    // after 2026-04-12.
    mockList.mockImplementation(async (path: string) => {
      if (path === `${PP}/exclusions/by_question_type`) {
        return [patternFileNode("policy_violation.md")]
      }
      return []
    })
    let currentEntry = entryBody
    mockRead.mockImplementation(async (path: string) => {
      if (path.endsWith("/policy_violation.md")) return currentEntry
      throw new Error("not found")
    })
    mockWrite.mockImplementation(async (_path, content) => {
      currentEntry = content as string
    })
    mockExists.mockResolvedValue(true)
    mockLog.mockResolvedValue([
      {
        hash: "h1",
        author: "a",
        date: "2026-05-01T00:00:00Z",
        message: "edit policy",
      },
    ])
    mockShow.mockResolvedValue({
      hash: "h1",
      author: "a",
      date: "2026-05-01T00:00:00Z",
      message: "edit policy",
      files: [{ path: "db/policy.md", status: "M", additions: 1, deletions: 0 }],
    })

    const r1 = await runFreshnessCheck(PP, 90, new Date("2026-05-11T00:00:00Z"))
    expect(r1.freshness.rows).toHaveLength(1)
    expect(currentEntry).toContain("needs_review: true")

    // 2) Mark validated → flag cleared, last_validated_at refreshed.
    await markValidated(
      PP,
      {
        filePath: "exclusions/by_question_type/policy_violation.md",
        pattern: "db/foo.md",
      },
      new Date("2026-05-11T00:00:00Z"),
    )
    expect(currentEntry).toContain("last_validated_at: 2026-05-11")
    expect(currentEntry).toContain("needs_review: false")
  })
})

describe("scenario: stale axiom → validated → no longer stale", () => {
  it("findStaleAxioms reports it, then drops after lastValidatedAt is refreshed", async () => {
    const NOW = new Date("2026-05-11T00:00:00Z")
    const original = [
      "---",
      "applies_to: [t1]",
      "---",
      "",
      "## 배제",
      "- db/old.md",
      "  근거: infra",
      "  last_validated_at: 2026-01-01",
      "",
    ].join("\n")

    let cur = original
    mockList.mockImplementation(async (path: string) => {
      if (path === `${PP}/exclusions/axioms`) return [axiomFileNode("infra.md")]
      return []
    })
    mockRead.mockImplementation(async (path: string) => {
      if (path.endsWith("/infra.md")) return cur
      throw new Error("not found")
    })
    mockWrite.mockImplementation(async (_p, c) => {
      cur = c as string
    })
    mockExists.mockResolvedValue(true)

    const docs = await loadExclusions(PP)
    const stale1 = findStaleAxioms(docs, 90, NOW)
    expect(stale1.rows).toHaveLength(1)

    await markValidated(
      PP,
      {
        filePath: "exclusions/axioms/infra.md",
        pattern: "db/old.md",
      },
      NOW,
    )

    const docs2 = await loadExclusions(PP)
    const stale2 = findStaleAxioms(docs2, 90, NOW)
    expect(stale2.rows).toEqual([])
  })
})

describe("scenario: counterexample marks other-type entry needsReview", () => {
  it("user marks a hit as correct, an existing exclusion for that path under another type is flagged", async () => {
    const pBody = [
      "# regression_test",
      "",
      "## 배제",
      "- db/safezone/rule.md",
      "  근거: 다른 유형의 규칙",
      "  출처: 사람 검토",
      "",
    ].join("\n")
    let cur = pBody

    mockList.mockImplementation(async (path: string) => {
      if (path === `${PP}/exclusions/by_question_type`) {
        return [patternFileNode("regression_test.md")]
      }
      return []
    })
    mockRead.mockImplementation(async (path: string) => {
      if (path.endsWith("/regression_test.md")) return cur
      throw new Error("not found")
    })
    mockWrite.mockImplementation(async (_p, c) => {
      cur = c as string
    })
    mockExists.mockResolvedValue(true)

    const r = await recordCounterexample(
      PP,
      "db/safezone/rule.md",
      "SafeZone 응답",
    )
    expect(r.flagged).toHaveLength(1)
    expect(cur).toContain("needs_review: true")
    expect(cur).toContain("반례:")
  })
})

describe("scenario: archive → applyExclusions drops the entry; restore brings it back", () => {
  it("flipping `archived: true` removes the entry from active exclusions, false restores it", async () => {
    const body = [
      "# policy_violation",
      "",
      "## 배제",
      "- db/foo.md",
      "  근거: 일시 보류",
      "",
    ].join("\n")
    let cur = body

    mockList.mockImplementation(async (path: string) => {
      if (path === `${PP}/exclusions/by_question_type`) {
        return [patternFileNode("policy_violation.md")]
      }
      return []
    })
    mockRead.mockImplementation(async (path: string) => {
      if (path.endsWith("/policy_violation.md")) return cur
      throw new Error("not found")
    })
    mockWrite.mockImplementation(async (_p, c) => {
      cur = c as string
    })
    mockExists.mockResolvedValue(true)

    const ref = {
      filePath: "exclusions/by_question_type/policy_violation.md",
      pattern: "db/foo.md",
    }
    await setEntryFlag(PP, ref, "archived", true)

    let docs = await loadExclusions(PP)
    let { kept, excludedByEntry } = applyExclusions(
      ["db/foo.md", "db/bar.md"],
      docs[0].entries,
    )
    // db/foo.md is kept because the entry is archived and skipped.
    expect(kept).toContain("db/foo.md")
    expect(excludedByEntry.size).toBe(0)

    // Restore.
    await setEntryFlag(PP, ref, "archived", false)
    docs = await loadExclusions(PP)
    ;({ kept, excludedByEntry } = applyExclusions(
      ["db/foo.md", "db/bar.md"],
      docs[0].entries,
    ))
    expect(kept).toEqual(["db/bar.md"])
    expect(excludedByEntry.get("db/foo.md")).toEqual(["db/foo.md"])
  })
})

// ── Lower-level utility tests (in service of the mechanisms) ────────

describe("getGitMtimes", () => {
  it("returns ISO mtimes for requested paths from git history newest-first", async () => {
    mockLog.mockResolvedValue([
      {
        hash: "newer",
        author: "a",
        date: "2026-05-01T00:00:00Z",
        message: "edit policy",
      },
      {
        hash: "older",
        author: "a",
        date: "2026-01-01T00:00:00Z",
        message: "initial",
      },
    ])
    mockShow.mockImplementation(async (_proj, hash) => {
      if (hash === "newer") {
        return {
          hash,
          author: "a",
          date: "2026-05-01T00:00:00Z",
          message: "edit policy",
          files: [
            { path: "db/policy.md", status: "M", additions: 1, deletions: 0 },
          ],
        }
      }
      return {
        hash,
        author: "a",
        date: "2026-01-01T00:00:00Z",
        message: "initial",
        files: [
          { path: "db/other.md", status: "A", additions: 1, deletions: 0 },
          { path: "db/policy.md", status: "A", additions: 1, deletions: 0 },
        ],
      }
    })

    const mtimes = await getGitMtimes(PP, ["db/policy.md", "db/other.md"])
    expect(mtimes.get("db/policy.md")).toBe("2026-05-01T00:00:00Z") // newer wins
    expect(mtimes.get("db/other.md")).toBe("2026-01-01T00:00:00Z")
  })
})

describe("setEntrySubField / appendEntrySource", () => {
  it("replaces an existing sub-field and inserts when absent", () => {
    const body = [
      "## 배제",
      "- db/foo.md",
      "  근거: a",
      "  archived: false",
      "",
    ].join("\n")

    const updated = setEntrySubField(body, "db/foo.md", "archived", "true")
    expect(updated).toContain("archived: true")
    expect(updated).not.toContain("archived: false")

    const inserted = setEntrySubField(body, "db/foo.md", "needs_review", "true")
    expect(inserted).toContain("needs_review: true")
  })

  it("appendEntrySource appends to existing 출처 line and avoids duplicates", () => {
    const body = [
      "## 배제",
      "- db/foo.md",
      "  근거: a",
      "  출처: 사람 검토",
      "",
    ].join("\n")
    const out = appendEntrySource(body, "db/foo.md", "반례: db/foo.md")
    expect(out).toContain("출처: 사람 검토, 반례: db/foo.md")

    // Idempotent — calling again is a no-op.
    const same = appendEntrySource(out, "db/foo.md", "반례: db/foo.md")
    expect(same).toBe(out)
  })
})
