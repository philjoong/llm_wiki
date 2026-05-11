/**
 * Stage 13 — Pattern → Axiom promotion tests.
 *
 * Mocks the disk + git boundary (listDirectory / readFile / writeFile /
 * fileExists / gitCommit) so the assertions focus on tally aggregation,
 * threshold gating, dismissal dedup, and the markdown edits performed
 * by promoteToPattern / promoteToAxiom.
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
}))

import { listDirectory, readFile, writeFile, fileExists } from "@/commands/fs"
import { gitCommit } from "@/commands/git"
import {
  analyzePromotionCandidates,
  promoteToPattern,
  promoteToAxiom,
  dismissCandidate,
  loadThresholds,
  DEFAULT_THRESHOLDS,
  type PromotionCandidate,
} from "../promotion"
import { __resetProjectLocksForTesting } from "../project-mutex"
import type { FileNode } from "@/types/wiki"

const mockList = vi.mocked(listDirectory)
const mockRead = vi.mocked(readFile)
const mockWrite = vi.mocked(writeFile)
const mockExists = vi.mocked(fileExists)
const mockCommit = vi.mocked(gitCommit)

const PP = "/proj"

/** Builds a Stage-12-shaped instance markdown for one (typeId, hit) pair. */
function instanceMd(typeId: string, hitPath: string): string {
  return [
    "---",
    `question_type: ${typeId}`,
    "initial_candidates: 5",
    "residue_count: 1",
    "hits_count: 1",
    "recorded_at: 2026-05-10T00:00:00.000Z",
    "---",
    "",
    "## Question",
    "",
    "test",
    "",
    "## Judged Type",
    `- id: ${typeId}`,
    "",
    "## Applied Exclusions",
    "(no exclusions applied)",
    "",
    "## Residue",
    "1 candidates remained after exclusions.",
    "",
    "## Top Hits",
    `1. ${PP}/${hitPath} — score 1.00`,
    "",
  ].join("\n")
}

/** Directory shape the Rust list_directory command returns (recursive). */
function instancesDir(
  files: Array<{ month: string; name: string }>,
): FileNode[] {
  const byMonth = new Map<string, FileNode[]>()
  for (const { month, name } of files) {
    if (!byMonth.has(month)) byMonth.set(month, [])
    byMonth.get(month)!.push({
      name,
      path: `${PP}/exclusions/instances/${month}/${name}`,
      is_dir: false,
    })
  }
  return [...byMonth.entries()].map(([month, children]) => ({
    name: month,
    path: `${PP}/exclusions/instances/${month}`,
    is_dir: true,
    children,
  }))
}

beforeEach(() => {
  mockList.mockReset().mockResolvedValue([])
  mockRead.mockReset().mockRejectedValue(new Error("not found"))
  mockWrite.mockReset().mockResolvedValue(undefined)
  mockExists.mockReset().mockResolvedValue(false)
  mockCommit
    .mockReset()
    .mockResolvedValue({ committed: true, commitHash: "abc1234" })
  __resetProjectLocksForTesting()
})

describe("analyzePromotionCandidates", () => {
  it("aggregates (typeId, path) frequency across instance files", async () => {
    const files = [
      { month: "2026-05", name: "q-1.md" },
      { month: "2026-05", name: "q-2.md" },
      { month: "2026-05", name: "q-3.md" },
      { month: "2026-05", name: "q-4.md" },
      { month: "2026-05", name: "q-5.md" },
      { month: "2026-05", name: "q-6.md" },
    ]
    mockList.mockImplementation(async (path: string) => {
      if (path === `${PP}/exclusions/instances`) return instancesDir(files)
      return []
    })
    mockExists.mockResolvedValue(false) // no promotion_rules.md, no dismissals
    mockRead.mockImplementation(async (path: string) => {
      const m = path.match(/q-(\d+)\.md$/)
      if (!m) throw new Error("not found")
      // 5 of 6 instances hit the same path with typeId X; one hits a
      // different path so we can verify multi-pair aggregation.
      if (m[1] === "6") return instanceMd("policy_violation", "db/other.md")
      return instanceMd("policy_violation", "db/instance_server/server_structure.md")
    })

    const out = await analyzePromotionCandidates(PP)

    // Only the 5-hit pair crosses the default threshold (5). The 1-hit
    // pair stays below and must be filtered out.
    expect(out).toHaveLength(1)
    expect(out[0].typeId).toBe("policy_violation")
    expect(out[0].path).toBe("db/instance_server/server_structure.md")
    expect(out[0].count).toBe(5)
    expect(out[0].instances).toHaveLength(5)
    expect(
      out[0].instances.every((p) =>
        p.startsWith("exclusions/instances/2026-05/"),
      ),
    ).toBe(true)
  })

  it("filters out candidates whose count is below the configured threshold", async () => {
    mockList.mockImplementation(async (path: string) => {
      if (path === `${PP}/exclusions/instances`)
        return instancesDir([
          { month: "2026-05", name: "q-1.md" },
          { month: "2026-05", name: "q-2.md" },
        ])
      return []
    })
    mockRead.mockResolvedValue(instanceMd("policy_violation", "db/policy.md"))
    mockExists.mockResolvedValue(false)

    // Default threshold is 5; with 2 instances we get nothing.
    expect(await analyzePromotionCandidates(PP)).toEqual([])

    // Drop the threshold via opts to surface the candidate.
    const lowered = await analyzePromotionCandidates(PP, {
      thresholds: { patternMinCount: 2 },
    })
    expect(lowered).toHaveLength(1)
    expect(lowered[0].count).toBe(2)
  })

  it("dedups against existing pattern/axiom entries (including archived) and dismissals", async () => {
    const files = Array.from({ length: 5 }, (_, i) => ({
      month: "2026-05",
      name: `q-${i + 1}.md`,
    }))
    mockList.mockImplementation(async (path: string) => {
      if (path === `${PP}/exclusions/instances`) return instancesDir(files)
      if (path === `${PP}/exclusions/by_question_type`) {
        return [
          {
            name: "policy_violation.md",
            path: `${PP}/exclusions/by_question_type/policy_violation.md`,
            is_dir: false,
          },
        ]
      }
      return []
    })
    mockExists.mockImplementation(async (path: string) =>
      path.endsWith("/promotion-dismissals.jsonl"),
    )
    mockRead.mockImplementation(async (path: string) => {
      if (path.endsWith("/policy_violation.md")) {
        // db/already-covered.md is archived — must still block re-promotion.
        return [
          "# policy_violation",
          "## 배제",
          "- db/already-covered.md",
          "  archived: true",
          "  근거: 사람이 보류 결정",
          "",
        ].join("\n")
      }
      if (path.endsWith("/promotion-dismissals.jsonl")) {
        return (
          JSON.stringify({
            timestamp: "2026-05-01T00:00:00.000Z",
            typeId: "policy_violation",
            path: "db/dismissed.md",
            reason: "not relevant",
          }) + "\n"
        )
      }
      const m = path.match(/q-(\d+)\.md$/)
      if (!m) throw new Error("not found")
      // Alternate hits between two paths so each accumulates ≥ threshold.
      const target =
        Number(m[1]) <= 3 ? "db/already-covered.md" : "db/dismissed.md"
      // Add a third path that should pass through cleanly so we know the
      // dedup is targeted, not a blanket skip.
      const extra = "db/fresh.md"
      return [
        instanceMd("policy_violation", target),
        // append a second hit per instance
        `2. ${PP}/${extra} — score 0.50`,
      ].join("\n")
    })

    const out = await analyzePromotionCandidates(PP, {
      thresholds: { patternMinCount: 3 },
    })

    const paths = out.map((c) => c.path).sort()
    expect(paths).toEqual(["db/fresh.md"])
    // already-covered.md (archived in pattern file) and dismissed.md
    // (in dismissals.jsonl) both filtered out, even though each had ≥3
    // instances.
  })

  it("falls back to defaults when promotion_rules.md is missing or unparseable", async () => {
    mockExists.mockResolvedValue(false)
    const noFile = await loadThresholds(PP)
    expect(noFile).toEqual(DEFAULT_THRESHOLDS)

    mockExists.mockResolvedValue(true)
    mockRead.mockResolvedValue(
      [
        "# 승격 규칙",
        "## 임계값",
        "- `pattern_min_count: 7` — custom",
        "- garbage line that doesn't parse",
        "- `freshness_days: 30`",
      ].join("\n"),
    )
    const parsed = await loadThresholds(PP)
    expect(parsed.patternMinCount).toBe(7)
    expect(parsed.freshnessDays).toBe(30)
    // axiom_min_patterns wasn't in the file — falls back to default.
    expect(parsed.axiomMinPatterns).toBe(DEFAULT_THRESHOLDS.axiomMinPatterns)
  })
})

describe("promoteToPattern", () => {
  it("appends an entry citing the contributing instances and commits", async () => {
    const candidate: PromotionCandidate = {
      typeId: "policy_violation",
      path: "db/instance_server/server_structure.md",
      count: 5,
      instances: [
        "exclusions/instances/2026-05/q-1.md",
        "exclusions/instances/2026-05/q-2.md",
      ],
    }
    // Existing pattern file with one prior entry — must append, not clobber.
    mockExists.mockResolvedValue(true)
    mockRead.mockResolvedValue(
      ["# policy_violation", "", "## 배제", "- db/old.md", "  근거: 기존", ""].join(
        "\n",
      ),
    )

    const out = await promoteToPattern(PP, candidate)

    expect(mockWrite).toHaveBeenCalledTimes(1)
    const [absPath, body] = mockWrite.mock.calls[0]
    expect(absPath).toBe(
      `${PP}/exclusions/by_question_type/policy_violation.md`,
    )
    // Prior entry preserved.
    expect(body).toContain("- db/old.md")
    // New entry present with citations.
    expect(body).toContain(
      "- db/instance_server/server_structure.md",
    )
    expect(body).toContain("instance 5회 누적")
    expect(body).toContain(
      "출처: exclusions/instances/2026-05/q-1.md, exclusions/instances/2026-05/q-2.md",
    )

    expect(mockCommit).toHaveBeenCalledTimes(1)
    const [, message, paths] = mockCommit.mock.calls[0]
    expect(message).toBe(
      "promote: pattern policy_violation — db/instance_server/server_structure.md",
    )
    expect(paths).toEqual(["exclusions/by_question_type/policy_violation.md"])
    expect(out.commitHash).toBe("abc1234")
  })

  it("creates the pattern file with a fresh `## 배제` section when none exists", async () => {
    mockExists.mockResolvedValue(false)
    const candidate: PromotionCandidate = {
      typeId: "regression_test",
      path: "db/x.md",
      count: 5,
      instances: ["exclusions/instances/2026-05/q-1.md"],
    }
    await promoteToPattern(PP, candidate)
    const body = mockWrite.mock.calls[0][1]
    expect(body).toContain("## 배제")
    expect(body).toContain("- db/x.md")
  })
})

describe("promoteToAxiom", () => {
  it("creates a new axiom file with applies_to frontmatter when none exists", async () => {
    mockExists.mockResolvedValue(false)
    const candidate: PromotionCandidate = {
      typeId: "policy_violation",
      path: "db/infra/spawn_rules.md",
      count: 5,
      instances: ["exclusions/instances/2026-05/q-1.md"],
    }
    const out = await promoteToAxiom(PP, candidate, "infrastructure-only")

    expect(mockWrite).toHaveBeenCalledTimes(1)
    const [absPath, body] = mockWrite.mock.calls[0]
    expect(absPath).toBe(`${PP}/exclusions/axioms/infrastructure-only.md`)
    expect(body).toMatch(/^---\napplies_to: \[policy_violation\]\n---/)
    expect(body).toContain("## 배제")
    expect(body).toContain("- db/infra/spawn_rules.md")

    expect(mockCommit).toHaveBeenCalledTimes(1)
    expect(mockCommit.mock.calls[0][1]).toBe(
      "promote: axiom infrastructure-only — db/infra/spawn_rules.md",
    )
    expect(out.filePath).toBe("exclusions/axioms/infrastructure-only.md")
  })

  it("extends applies_to and appends entry when the axiom already exists", async () => {
    mockExists.mockResolvedValue(true)
    mockRead.mockResolvedValue(
      [
        "---",
        "applies_to: [regression_test]",
        "---",
        "",
        "# infra-only",
        "",
        "## 배제",
        "- db/foo.md",
        "  근거: 기존",
        "",
      ].join("\n"),
    )
    const candidate: PromotionCandidate = {
      typeId: "policy_violation",
      path: "db/infra/spawn_rules.md",
      count: 5,
      instances: ["exclusions/instances/2026-05/q-1.md"],
    }
    await promoteToAxiom(PP, candidate, "infrastructure-only")

    const body = mockWrite.mock.calls[0][1]
    expect(body).toMatch(
      /applies_to: \[regression_test, policy_violation\]/,
    )
    expect(body).toContain("- db/foo.md")
    expect(body).toContain("- db/infra/spawn_rules.md")
  })
})

describe("dismissCandidate", () => {
  it("appends a JSONL line that future analyses use to dedup the candidate", async () => {
    const candidate: PromotionCandidate = {
      typeId: "policy_violation",
      path: "db/noise.md",
      count: 5,
      instances: ["exclusions/instances/2026-05/q-1.md"],
    }
    // Existing dismissal log with one earlier entry.
    mockExists.mockResolvedValue(true)
    mockRead.mockResolvedValue(
      JSON.stringify({
        timestamp: "2026-05-01T00:00:00.000Z",
        typeId: "other",
        path: "db/old.md",
        reason: "prior",
      }) + "\n",
    )
    await dismissCandidate(PP, candidate, "irrelevant for this type")

    expect(mockWrite).toHaveBeenCalledTimes(1)
    const [absPath, body] = mockWrite.mock.calls[0]
    expect(absPath).toBe(`${PP}/.llm-wiki/promotion-dismissals.jsonl`)
    // Two lines now: the prior plus our new entry.
    const lines = body.trim().split("\n")
    expect(lines).toHaveLength(2)
    const parsed = JSON.parse(lines[1])
    expect(parsed.typeId).toBe("policy_violation")
    expect(parsed.path).toBe("db/noise.md")
    expect(parsed.reason).toBe("irrelevant for this type")
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
