/**
 * Stage 12 — Level 1 instance logging tests.
 *
 * Mocks the disk + git boundary (writeFile / fileExists / gitCommit) so
 * the assertions focus on filename derivation, markdown body shape, and
 * commit-call routing. The 5 cases below mirror the plan's checklist.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/commands/fs", () => ({
  writeFile: vi.fn(),
  fileExists: vi.fn(),
}))

vi.mock("@/commands/git", () => ({
  gitCommit: vi.fn(),
}))

import { writeFile, fileExists } from "@/commands/fs"
import { gitCommit } from "@/commands/git"
import { recordSearchInstance } from "../instance-log"
import { __resetProjectLocksForTesting } from "../project-mutex"
import type { ExcludeSearchResult } from "../exclude-search"

const mockWrite = vi.mocked(writeFile)
const mockExists = vi.mocked(fileExists)
const mockCommit = vi.mocked(gitCommit)

const PP = "/proj"

function baseResult(
  overrides: Partial<ExcludeSearchResult["trace"]> = {},
  hits: ExcludeSearchResult["hits"] = [],
): ExcludeSearchResult {
  return {
    hits,
    keptPaths: [],
    trace: {
      judgedType: {
        id: "policy_violation",
        name: "정책 위반 탐지",
        confidence: 0.9,
        reasoning: "정책 관련",
      },
      appliedEntries: [
        {
          pattern: "db/instance_server/server_structure.md",
          rationale: "서버 구조는 인프라.",
          matched: ["db/instance_server/server_structure.md"],
          filePath: "exclusions/by_question_type/policy_violation.md",
        },
      ],
      initialCandidateCount: 47,
      residueCount: 26,
      ...overrides,
    },
  }
}

beforeEach(() => {
  mockWrite.mockReset().mockResolvedValue(undefined)
  mockExists.mockReset().mockResolvedValue(false)
  mockCommit.mockReset().mockResolvedValue({ committed: true, commitHash: "abc1234" })
  __resetProjectLocksForTesting()
})

describe("recordSearchInstance", () => {
  it("writes a frontmatter+body markdown file under the YYYY-MM directory", async () => {
    const now = new Date("2026-05-10T14:30:52.123Z")
    const out = await recordSearchInstance(
      PP,
      "Fireball을 SafeZone에서 발사할 때 어떻게 되는가?",
      baseResult(),
      now,
    )

    // Path shape: exclusions/instances/2026-05/q-<compact-iso>-<slug>.md.
    expect(out.path).toMatch(
      /^exclusions\/instances\/2026-05\/q-2026-05-10T14-30-52-123Z-.+\.md$/,
    )
    // Slug carries the CJK question text — `makeQuerySlug` is Unicode-aware,
    // so we don't expect "query" fallback here.
    expect(out.path).toContain("fireball")

    expect(mockWrite).toHaveBeenCalledTimes(1)
    const [absPath, body] = mockWrite.mock.calls[0]
    expect(absPath).toBe(`${PP}/${out.path}`)

    // Frontmatter scalars present.
    expect(body).toContain("question_type: policy_violation")
    expect(body).toContain("initial_candidates: 47")
    expect(body).toContain("residue_count: 26")
    expect(body).toContain("hits_count: 0")
    expect(body).toContain("recorded_at: 2026-05-10T14:30:52.123Z")
    // Sections.
    expect(body).toContain("## Question")
    expect(body).toContain("Fireball을 SafeZone에서 발사할 때 어떻게 되는가?")
    expect(body).toContain("## Judged Type")
    expect(body).toContain("- id: policy_violation")
    expect(body).toContain("## Applied Exclusions")
    expect(body).toContain("- pattern: db/instance_server/server_structure.md")
    expect(body).toContain("## Residue")
    expect(body).toContain("## Top Hits")
  })

  it("derives the YYYY-MM directory from the timestamp month", async () => {
    // The Rust write_file impl create_dir_all's the parent, so the test
    // just asserts the parent path embedded in the file path is correct
    // — we never call createDirectory ourselves.
    const dec = new Date("2026-12-31T23:59:00.000Z")
    const r1 = await recordSearchInstance(PP, "q1", baseResult(), dec)
    expect(r1.path.startsWith("exclusions/instances/2026-12/")).toBe(true)

    const jan = new Date("2027-01-01T00:00:01.000Z")
    const r2 = await recordSearchInstance(PP, "q2", baseResult(), jan)
    expect(r2.path.startsWith("exclusions/instances/2027-01/")).toBe(true)
  })

  it("records zero-hit / zero-residue searches (IDEA §2.10 — residue 0 is a positive signal)", async () => {
    const now = new Date("2026-05-10T14:30:52.123Z")
    const result = baseResult(
      {
        residueCount: 0,
        zeroResidueMeaning: "잔존 0 = 위반 없음 (긍정적 신호).",
      },
      [], // no hits
    )
    const out = await recordSearchInstance(PP, "정책 위반?", result, now)

    expect(mockWrite).toHaveBeenCalledTimes(1)
    const body = mockWrite.mock.calls[0][1]
    expect(body).toContain("residue_count: 0")
    expect(body).toContain("hits_count: 0")
    expect(body).toContain("(no hits)")
    // Commit still fires — the audit row matters even when nothing came back.
    expect(mockCommit).toHaveBeenCalledTimes(1)
    expect(out.commitHash).toBe("abc1234")
  })

  it("avoids overwriting on same-millisecond filename collision", async () => {
    // First write: file doesn't exist. Second write: same timestamp +
    // slug, but the previous file is now on disk — must get a `-1`
    // suffix instead of clobbering.
    const now = new Date("2026-05-10T14:30:52.123Z")
    const taken = new Set<string>()
    mockExists.mockImplementation(async (path: string) => taken.has(path))
    mockWrite.mockImplementation(async (path: string) => {
      taken.add(path)
    })

    const r1 = await recordSearchInstance(PP, "duplicate", baseResult(), now)
    const r2 = await recordSearchInstance(PP, "duplicate", baseResult(), now)

    expect(r1.path).not.toBe(r2.path)
    expect(r2.path).toMatch(/-1\.md$/)
    expect(mockWrite).toHaveBeenCalledTimes(2)
  })

  it("commits the new instance file with a structured search subject", async () => {
    const now = new Date("2026-05-10T14:30:52.123Z")
    const result = baseResult({}, [
      { path: `${PP}/db/policy.md`, title: "policy", snippet: "...", titleMatch: true, score: 1.0 },
      { path: `${PP}/db/foo.md`, title: "foo", snippet: "...", titleMatch: false, score: 0.5 },
    ])
    const out = await recordSearchInstance(PP, "정책 위반?", result, now)

    expect(mockCommit).toHaveBeenCalledTimes(1)
    const [projectPath, message, paths] = mockCommit.mock.calls[0]
    expect(projectPath).toBe(PP)
    expect(paths).toEqual([out.path])
    // Subject: `search: <typeId> → <hits> hits (<excluded> excluded)`.
    // 47 initial − 26 residue = 21 excluded; 2 hits.
    expect(message).toBe("search: policy_violation → 2 hits (21 excluded)")

    // No type → "untyped" in the subject.
    mockCommit.mockClear()
    const untyped = baseResult({ judgedType: null, appliedEntries: [], residueCount: 47 })
    await recordSearchInstance(PP, "이거 봐줘", untyped, now)
    const [, untypedMsg] = mockCommit.mock.calls[0]
    expect(untypedMsg).toBe("search: untyped → 0 hits (0 excluded)")
  })
})
