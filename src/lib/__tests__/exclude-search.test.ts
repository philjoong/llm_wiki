/**
 * Stage 11 — runExcludeSearch pipeline tests.
 *
 * Mocks the four collaborators (loadQuestionTypes, classifyQuestion,
 * loadExclusions, listDirectory) and asserts the trace shape matches what
 * the search-view UI relies on. searchPaths is mocked too — the search
 * algorithm itself is out of scope (Part 3).
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"

vi.mock("@/commands/fs", () => ({
  listDirectory: vi.fn(),
  readFile: vi.fn(),
}))

vi.mock("../classify-question", () => ({
  classifyQuestion: vi.fn(),
}))

vi.mock("../question-types", () => ({
  loadQuestionTypes: vi.fn(),
  // parseFrontmatter is re-exported by question-types but exclusions.ts
  // imports it; the loadExclusions mock below intercepts before that path
  // is touched, so we don't need a real implementation here.
  parseFrontmatter: vi.fn(),
}))

vi.mock("../exclusions", async () => {
  const actual = await vi.importActual<typeof import("../exclusions")>(
    "../exclusions",
  )
  return {
    ...actual,
    loadExclusions: vi.fn(),
  }
})

vi.mock("../search", () => ({
  searchPaths: vi.fn(),
}))

import { listDirectory } from "@/commands/fs"
import { classifyQuestion } from "../classify-question"
import { loadQuestionTypes } from "../question-types"
import { loadExclusions } from "../exclusions"
import { searchPaths } from "../search"
import { runExcludeSearch } from "../exclude-search"
import type { FileNode } from "@/types/wiki"

const mockList = vi.mocked(listDirectory)
const mockClassify = vi.mocked(classifyQuestion)
const mockLoadTypes = vi.mocked(loadQuestionTypes)
const mockLoadExcl = vi.mocked(loadExclusions)
const mockSearch = vi.mocked(searchPaths)

const PP = "/proj"
const cfg: LlmConfig = {
  provider: "openai",
  apiKey: "k",
  model: "gpt-4",
  ollamaUrl: "",
  customEndpoint: "",
  maxContextSize: 128000,
}

function dbTree(): FileNode[] {
  // Mimics the recursive tree returned by the Tauri list_directory
  // command — directories carry `children`, files don't.
  return [
    {
      name: "instance_server",
      path: `${PP}/db/instance_server`,
      is_dir: true,
      children: [
        {
          name: "server_structure.md",
          path: `${PP}/db/instance_server/server_structure.md`,
          is_dir: false,
        },
        {
          name: "spawn_rules.md",
          path: `${PP}/db/instance_server/spawn_rules.md`,
          is_dir: false,
        },
      ],
    },
    {
      name: "policy.md",
      path: `${PP}/db/policy.md`,
      is_dir: false,
    },
    // dotfiles must be skipped
    {
      name: ".gitkeep",
      path: `${PP}/db/.gitkeep`,
      is_dir: false,
    },
    // non-md must be skipped
    {
      name: "image.png",
      path: `${PP}/db/image.png`,
      is_dir: false,
    },
  ]
}

beforeEach(() => {
  mockList.mockReset()
  mockClassify.mockReset()
  mockLoadTypes.mockReset()
  mockLoadExcl.mockReset()
  mockSearch.mockReset()

  // Default: a happy db/ tree.
  mockList.mockImplementation(async (path: string) => {
    if (path === `${PP}/db`) return dbTree()
    return []
  })
})

describe("runExcludeSearch", () => {
  it("classifies, applies pattern exclusions, and produces a populated trace", async () => {
    mockLoadTypes.mockResolvedValue([
      {
        id: "policy_violation",
        name: "정책 위반 탐지",
        description: "정책 위반",
      },
    ])
    mockClassify.mockResolvedValue({
      typeId: "policy_violation",
      confidence: 0.9,
      reasoning: "정책 관련 동작",
    })
    mockLoadExcl.mockResolvedValue([
      {
        questionTypeIds: ["policy_violation"],
        level: "pattern",
        filePath: "exclusions/by_question_type/policy_violation.md",
        entries: [
          {
            pattern: "db/instance_server/server_structure.md",
            rationale: "서버 구조는 인프라.",
            sources: ["사람 검토"],
          },
          {
            pattern: "db/**/spawn_rules.md",
            rationale: "스폰 규칙은 운영 데이터.",
            sources: ["사람 검토"],
          },
        ],
      },
    ])
    mockSearch.mockResolvedValue([
      {
        path: `${PP}/db/policy.md`,
        title: "policy",
        snippet: "...",
        titleMatch: true,
        score: 1,
      },
    ])

    const out = await runExcludeSearch("정책을 위반하는가?", PP, cfg)

    // searchPaths only runs against the residue.
    expect(mockSearch).toHaveBeenCalledTimes(1)
    expect(mockSearch.mock.calls[0][2]).toEqual([`${PP}/db/policy.md`])

    expect(out.hits).toHaveLength(1)
    expect(out.trace.judgedType).toEqual({
      id: "policy_violation",
      name: "정책 위반 탐지",
      confidence: 0.9,
      reasoning: "정책 관련 동작",
    })
    expect(out.trace.initialCandidateCount).toBe(3) // 2 in subdir + 1 top-level .md
    expect(out.trace.residueCount).toBe(1)
    expect(out.trace.appliedEntries).toHaveLength(2)
    expect(
      out.trace.appliedEntries.find(
        (e) => e.pattern === "db/instance_server/server_structure.md",
      )?.matched,
    ).toEqual(["db/instance_server/server_structure.md"])
    expect(
      out.trace.appliedEntries.find(
        (e) => e.pattern === "db/**/spawn_rules.md",
      )?.matched,
    ).toEqual(["db/instance_server/spawn_rules.md"])
    expect(out.trace.zeroResidueMeaning).toBeUndefined()
  })

  it("falls back to no-exclusion when classifier returns null", async () => {
    mockLoadTypes.mockResolvedValue([
      { id: "policy_violation", name: "정책 위반", description: "" },
    ])
    mockClassify.mockResolvedValue(null)
    mockLoadExcl.mockResolvedValue([
      {
        questionTypeIds: ["policy_violation"],
        level: "pattern",
        filePath: "exclusions/by_question_type/policy_violation.md",
        entries: [
          {
            pattern: "db/**/*.md",
            rationale: "would remove all",
            sources: [],
          },
        ],
      },
    ])
    mockSearch.mockResolvedValue([])

    const out = await runExcludeSearch("이거 좀 봐줘", PP, cfg)

    expect(out.trace.judgedType).toBeNull()
    expect(out.trace.appliedEntries).toEqual([])
    // All 3 db/ candidates pass through to searchPaths despite a permissive
    // pattern — without a typeId no exclusions apply.
    expect(out.trace.residueCount).toBe(3)
    expect(mockSearch.mock.calls[0][2]).toHaveLength(3)
  })

  it("skips classifier and exclusions when question_types/ is empty", async () => {
    mockLoadTypes.mockResolvedValue([])
    mockLoadExcl.mockResolvedValue([])
    mockSearch.mockResolvedValue([])

    await runExcludeSearch("뭔가", PP, cfg)

    expect(mockClassify).not.toHaveBeenCalled()
  })

  it("includes axioms whose applies_to contains the judged typeId", async () => {
    mockLoadTypes.mockResolvedValue([
      { id: "policy_violation", name: "정책 위반", description: "" },
    ])
    mockClassify.mockResolvedValue({
      typeId: "policy_violation",
      confidence: 0.7,
      reasoning: "",
    })
    mockLoadExcl.mockResolvedValue([
      {
        questionTypeIds: ["other_type"], // not applicable
        level: "pattern",
        filePath: "exclusions/by_question_type/other_type.md",
        entries: [
          { pattern: "db/policy.md", rationale: "x", sources: [] },
        ],
      },
      {
        questionTypeIds: ["policy_violation", "regression_test"],
        level: "axiom",
        filePath: "exclusions/axioms/infra.md",
        entries: [
          {
            pattern: "db/instance_server/**",
            rationale: "infra always out",
            sources: [],
          },
        ],
      },
    ])
    mockSearch.mockResolvedValue([])

    const out = await runExcludeSearch("정책 위반?", PP, cfg)

    // Only the axiom should fire — the unrelated pattern doc is skipped.
    expect(out.trace.appliedEntries).toHaveLength(1)
    expect(out.trace.appliedEntries[0].pattern).toBe("db/instance_server/**")
    expect(out.trace.appliedEntries[0].filePath).toBe(
      "exclusions/axioms/infra.md",
    )
    // policy.md survives, both instance_server files removed.
    expect(out.trace.residueCount).toBe(1)
  })

  it("attaches zeroResidueMeaning when residue is 0 and the type defines one", async () => {
    mockLoadTypes.mockResolvedValue([
      {
        id: "policy_violation",
        name: "정책 위반",
        description: "",
        zeroResidueMeaning: "잔존 0 = 위반 없음 (긍정적 신호).",
      },
    ])
    mockClassify.mockResolvedValue({
      typeId: "policy_violation",
      confidence: 0.9,
      reasoning: "",
    })
    mockLoadExcl.mockResolvedValue([
      {
        questionTypeIds: ["policy_violation"],
        level: "pattern",
        filePath: "exclusions/by_question_type/policy_violation.md",
        entries: [
          { pattern: "db/**", rationale: "all", sources: [] },
        ],
      },
    ])

    const out = await runExcludeSearch("정책 위반?", PP, cfg)

    expect(out.trace.residueCount).toBe(0)
    expect(out.trace.zeroResidueMeaning).toBe("잔존 0 = 위반 없음 (긍정적 신호).")
    // searchPaths is NOT called when residue is empty — no point.
    expect(mockSearch).not.toHaveBeenCalled()
    expect(out.hits).toEqual([])
  })

  it("omits entries that matched zero candidates from appliedEntries", async () => {
    mockLoadTypes.mockResolvedValue([
      { id: "t", name: "T", description: "" },
    ])
    mockClassify.mockResolvedValue({
      typeId: "t",
      confidence: 0.5,
      reasoning: "",
    })
    mockLoadExcl.mockResolvedValue([
      {
        questionTypeIds: ["t"],
        level: "pattern",
        filePath: "exclusions/by_question_type/t.md",
        entries: [
          // hits
          { pattern: "db/policy.md", rationale: "r", sources: [] },
          // misses — refers to a path that doesn't exist in the tree
          {
            pattern: "db/nonexistent/*.md",
            rationale: "r2",
            sources: [],
          },
        ],
      },
    ])
    mockSearch.mockResolvedValue([])

    const out = await runExcludeSearch("q", PP, cfg)

    expect(out.trace.appliedEntries).toHaveLength(1)
    expect(out.trace.appliedEntries[0].pattern).toBe("db/policy.md")
  })

  it("treats a missing db/ tree as 0 candidates without throwing", async () => {
    mockList.mockImplementation(async () => {
      throw new Error("not found")
    })
    mockLoadTypes.mockResolvedValue([])
    mockLoadExcl.mockResolvedValue([])

    const out = await runExcludeSearch("anything", PP, cfg)

    expect(out.trace.initialCandidateCount).toBe(0)
    expect(out.trace.residueCount).toBe(0)
    expect(out.hits).toEqual([])
    expect(mockSearch).not.toHaveBeenCalled()
  })
})
