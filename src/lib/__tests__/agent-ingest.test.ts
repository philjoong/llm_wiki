/**
 * agent-ingest regression tests — decomposition + graph assignment pipeline
 * via CLI transport.
 *
 * The CLI path runs the same decomposition → file write → graph assignment
 * pipeline as autoIngestImpl, but calls the CLI subprocess instead of the
 * HTTP API. response_format is not available on CLI, so JSON is enforced
 * via prompt only.
 *
 * Test cases:
 *  1. Clean decomposition + graph assignment response → writes FILE blocks with source_range title (no graph, no wikilinks)
 *  2. Graph assignment returns no assignments → chunk skipped, review item created (no throw)
 *  3. Graph assignment with invalid relation types → skipped, review item created, valid ones written
 *  4. CLI transport error on decomposition → chunk skipped (no throw)
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  listDirectory: vi.fn(),
}))

vi.mock("../claude-cli-transport", () => ({
  streamClaudeCodeCli: vi.fn(),
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../graph-policy", () => ({
  loadGraphPolicy: vi.fn().mockResolvedValue({
    managedGraphs: ["combat_graph"],
    graphRelationTypes: { combat_graph: ["WEAK_AGAINST", "USES_SKILL"] },
  }),
  saveGraphPolicy: vi.fn().mockResolvedValue(undefined),
  buildGraphPolicyPrompt: vi.fn().mockReturnValue("## Graph Policy\n..."),
}))

vi.mock("../graph-sync", () => ({
  syncGraphToBackend: vi.fn().mockResolvedValue("0 triples (nothing to sync)"),
}))

vi.mock("@/lib/counterexample-index", () => ({
  loadCounterexamples: vi.fn().mockResolvedValue([]),
  loadRejectionLog: vi.fn().mockResolvedValue([]),
  findRelatedRejections: vi.fn().mockReturnValue([]),
  formatDismissalContext: vi.fn().mockReturnValue(""),
}))

// The unified pipeline runs caching + auto-commit for every provider.
// Stub the IO-heavy steps so the CLI unit test stays hermetic.
vi.mock("@/lib/ingest-cache", () => ({
  checkIngestCache: vi.fn().mockResolvedValue(null),
  saveIngestCache: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/stores/review-store", () => ({
  useReviewStore: {
    getState: vi.fn().mockReturnValue({ addItems: vi.fn() }),
  },
}))

import { readFile, writeFile, listDirectory } from "@/commands/fs"
import { streamClaudeCodeCli } from "../claude-cli-transport"
import { autoIngestImpl } from "../ingest"
import { buildGraphAssignmentScaffold } from "../ingest"
import { loadGraphPolicy, saveGraphPolicy } from "../graph-policy"
import { useActivityStore } from "@/stores/activity-store"
import { useWikiStore } from "@/stores/wiki-store"
import { useReviewStore } from "@/stores/review-store"
import type { LlmConfig } from "@/stores/wiki-store"
import type { FileNode } from "@/types/wiki"

const mockReadFile = vi.mocked(readFile)
const mockWriteFile = vi.mocked(writeFile)
const mockListDirectory = vi.mocked(listDirectory)
const mockStream = vi.mocked(streamClaudeCodeCli)
const mockLoadGraphPolicy = vi.mocked(loadGraphPolicy)
const mockSaveGraphPolicy = vi.mocked(saveGraphPolicy)
const mockReviewState = (addItems = vi.fn()) => ({
  items: [],
  addItem: vi.fn(),
  addItems,
  setItems: vi.fn(),
  resolveItem: vi.fn(),
  updateItem: vi.fn(),
  removeItem: vi.fn(),
  clearResolved: vi.fn(),
  transitionToRejectionHandling: vi.fn(),
  dismissItem: vi.fn(),
})

const PROJECT = "/proj"
const SOURCE = "/proj/raw/lorem.md"

const cliConfig: LlmConfig = {
  provider: "claude-code",
  apiKey: "",
  model: "claude-sonnet-4-5",
  ollamaUrl: "",
  customEndpoint: "",
  maxContextSize: 200000,
}

// Decomposition emits the delimiter-based SECTION format (not JSON), so
// verbatim source_text never round-trips through a JSON string. See Fix 25.
// Every opener carries a page_path (`source_range | db/...`) — decomposition
// must assign one to every section, or the chunk is skipped as a failure.
const DECOMPOSITION_RESPONSE = [
  "---SECTION: ## 고블린 전사 | db/enemies/goblin-warrior.md---",
  "고블린 전사는 불에 약하고 독침을 사용한다.",
  "---END SECTION---",
].join("\n")

const GRAPH_ASSIGNMENT_RESPONSE = JSON.stringify({
  triples: [
    {
      source_id: "s1",
      subject: "고블린 전사",
      predicate: "WEAK_AGAINST",
      object: "불",
      graph: "combat_graph",
      page_path: "db/enemies/goblin-warrior.md",
      new_graph: false,
    },
  ],
})

let callCount = 0
function mockSequentialResponses(...responses: string[]) {
  callCount = 0
  mockStream.mockImplementation(async (_cfg, _msgs, callbacks) => {
    const response = responses[callCount] ?? responses[responses.length - 1]
    callCount++
    callbacks.onToken(response)
    callbacks.onDone()
  })
}

beforeEach(() => {
  mockReadFile.mockReset()
  mockWriteFile.mockReset().mockResolvedValue(undefined)
  mockListDirectory.mockReset()
  mockStream.mockReset()
  mockLoadGraphPolicy.mockReset().mockResolvedValue({
    managedGraphs: ["combat_graph"],
    graphRelationTypes: { combat_graph: ["WEAK_AGAINST", "USES_SKILL"] },
  })
  mockSaveGraphPolicy.mockReset().mockResolvedValue({
    managedGraphs: ["combat_graph"],
    graphRelationTypes: { combat_graph: ["WEAK_AGAINST", "USES_SKILL"] },
  })
  callCount = 0
  useActivityStore.setState({ items: [] })
  useWikiStore.setState({ fileTree: [] })
  vi.mocked(useReviewStore.getState).mockReturnValue(mockReviewState() as unknown as ReturnType<typeof useReviewStore.getState>)

  mockReadFile.mockImplementation(async (p: string) => {
    if (p === SOURCE) return "고블린 전사는 불에 약하다."
    return ""
  })
  mockListDirectory.mockImplementation(async (_p: string) => [] as FileNode[])
})

describe("autoIngest (unified, CLI provider) — decomposition + graph assignment pipeline", () => {
  it("graph assignment scaffold는 source_text를 sections에만 싣고 triple은 source_id로 참조함", () => {
    const scaffold = JSON.parse(buildGraphAssignmentScaffold([
      {
        source_range: "## 고블린 전사",
        source_text: "고블린 전사는 불에 약하고 독침을 사용한다.",
      },
    ]))

    expect(scaffold.sections).toEqual([
      {
        source_id: "s1",
        source_range: "## 고블린 전사",
        source_text: "고블린 전사는 불에 약하고 독침을 사용한다.",
      },
    ])
    expect(scaffold.triples[0]).toEqual(expect.objectContaining({ source_id: "s1" }))
    expect(scaffold.triples[0]).not.toHaveProperty("source_text")
    expect(scaffold.triples[0]).not.toHaveProperty("source_range")
  })

  it("decomposition+graph assignment 성공 시 source_range를 title로 쓰고 graph/wikilink 없는 파일을 씀", async () => {
    mockSequentialResponses(DECOMPOSITION_RESPONSE, GRAPH_ASSIGNMENT_RESPONSE)

    const written = await autoIngestImpl(PROJECT, SOURCE, cliConfig)

    expect(written).toContain("db/enemies/goblin-warrior.md")
    expect(mockWriteFile).toHaveBeenCalled()
    const [, content] = mockWriteFile.mock.calls[0]
    // Fix 30: title은 source_range(섹션 제목)로, graph frontmatter와 wikilink는 제거됨
    expect(content).toContain("title: ## 고블린 전사")
    expect(content).not.toContain("graph:")
    expect(content).not.toContain("## Related")
    expect(content).not.toContain("[[불|WEAK_AGAINST]]")
    const last = useActivityStore.getState().items[0]
    expect(last.status).toBe("done")
  })

  it("Fix 25: source_text에 마크다운 이스케이프(\\[ \\( 등)가 있어도 섹션이 유실되지 않음", async () => {
    // 회귀: 이전 JSON 기반 decomposition에서는 verbatim source_text 안의 `\[8\]`,
    // `리니지\(게임\)` 같은 마크다운 백슬래시 이스케이프가 invalid JSON
    // escape라서 JSON.parse가 throw → 청크 전체가 "no sections"로 스킵됐다.
    // SECTION 구분자 포맷에서는 그대로 통과해야 한다.
    const hostileText = "리니지\\(게임\\)는 흥행했다.[\\[8\\]](#fn-8) 인용."
    mockSequentialResponses(
      ["---SECTION: ## 리니지 | db/games/lineage.md---", hostileText, "---END SECTION---"].join("\n"),
      JSON.stringify({
        triples: [
          {
            source_id: "s1",
            subject: "리니지",
            predicate: "WEAK_AGAINST",
            object: "흥행",
            graph: "combat_graph",
            page_path: "db/games/lineage.md",
            new_graph: false,
          },
        ],
      }),
    )

    const written = await autoIngestImpl(PROJECT, SOURCE, cliConfig)

    expect(written).toContain("db/games/lineage.md")
    const [, content] = mockWriteFile.mock.calls[0]
    // 원문이 백슬래시까지 그대로 보존되어 페이지 본문에 들어가야 한다.
    expect(content).toContain(hostileText)
  })

  it("decomposition이 page_path 없는 섹션을 만들면 해당 청크를 건너뜀 (단일 청크면 파일 없음 + error)", async () => {
    const addItemsMock = vi.fn()
    vi.mocked(useReviewStore.getState).mockReturnValue(mockReviewState(addItemsMock) as unknown as ReturnType<typeof useReviewStore.getState>)
    mockSequentialResponses(
      ["---SECTION: ## 고블린 전사---", "고블린 전사는 불에 약하다.", "---END SECTION---"].join("\n"),
    )

    const written = await autoIngestImpl(PROJECT, SOURCE, cliConfig)
    expect(written).toEqual([])
    expect(mockWriteFile).not.toHaveBeenCalled()
    expect(addItemsMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ title: expect.stringContaining("Ingest skipped") }),
      ]),
    )
    const last = useActivityStore.getState().items[0]
    expect(last.status).toBe("error")
  })

  it("graph assignment가 assignments를 하나도 반환하지 않으면 review item만 생성하고 파일은 이미 씀", async () => {
    const addItemsMock = vi.fn()
    vi.mocked(useReviewStore.getState).mockReturnValue(mockReviewState(addItemsMock) as unknown as ReturnType<typeof useReviewStore.getState>)
    mockSequentialResponses(
      DECOMPOSITION_RESPONSE,
      JSON.stringify({ triples: [] }),
    )

    const written = await autoIngestImpl(PROJECT, SOURCE, cliConfig)
    // 파일 쓰기는 decomposition의 page_path만으로 이미 완료됨 — graph
    // assignment는 그 이후 단계라 실패해도 문서는 남는다.
    expect(written).toContain("db/enemies/goblin-warrior.md")
    expect(addItemsMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ title: expect.stringContaining("no graph assignments produced") }),
      ]),
    )
    const last = useActivityStore.getState().items[0]
    expect(last.status).toBe("done")
  })

  it("기존 graph가 relation type 4개로 꽉 찬 상태에서 새 type을 쓰면 해당 assignment를 건너뛰고 review item을 생성함", async () => {
    const addItemsMock = vi.fn()
    vi.mocked(useReviewStore.getState).mockReturnValue(mockReviewState(addItemsMock) as unknown as ReturnType<typeof useReviewStore.getState>)
    mockLoadGraphPolicy.mockResolvedValueOnce({
      managedGraphs: ["combat_graph"],
      graphRelationTypes: { combat_graph: ["WEAK_AGAINST", "USES_SKILL", "RESISTS", "COUNTERS"] },
    })

    mockSequentialResponses(
      DECOMPOSITION_RESPONSE,
      JSON.stringify({
        triples: [
          {
            source_id: "s1",
            subject: "고블린 전사",
            predicate: "INVALID_TYPE",
            object: "불",
            graph: "combat_graph",
            page_path: "db/enemies/goblin-warrior.md",
            new_graph: false,
          },
        ],
      }),
    )

    const written = await autoIngestImpl(PROJECT, SOURCE, cliConfig)

    // decomposition이 이미 문서를 썼으므로 파일은 존재함 — 실패한 것은
    // graph assignment 뿐이다.
    expect(written).toContain("db/enemies/goblin-warrior.md")
    // review item이 생성됨
    expect(addItemsMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          type: "suggestion",
          title: expect.stringContaining("skipped 1 concept"),
        }),
      ]),
    )
  })

  it("기존 graph에 relation type slot이 남아 있으면 새 type을 추가하고 assignment를 통과시킴", async () => {
    mockLoadGraphPolicy.mockResolvedValueOnce({
      managedGraphs: ["combat_graph"],
      graphRelationTypes: { combat_graph: ["WEAK_AGAINST", "USES_SKILL", "RESISTS"] },
    })

    mockSequentialResponses(
      DECOMPOSITION_RESPONSE,
      JSON.stringify({
        triples: [
          {
            source_id: "s1",
            subject: "고블린 전사",
            predicate: "USES_SKILL",
            object: "독침",
            graph: "combat_graph",
            page_path: "db/enemies/goblin-warrior.md",
            new_graph: false,
            graph_relation_types: ["WEAK_AGAINST", "USES_SKILL", "RESISTS", "VULNERABLE_TO"],
          },
          {
            source_id: "s1",
            subject: "고블린 전사",
            predicate: "VULNERABLE_TO",
            object: "얼음",
            graph: "combat_graph",
            page_path: "db/enemies/goblin-warrior.md",
            new_graph: false,
          },
        ],
      }),
    )

    const written = await autoIngestImpl(PROJECT, SOURCE, cliConfig)

    expect(written).toContain("db/enemies/goblin-warrior.md")
    expect(mockSaveGraphPolicy).toHaveBeenCalledWith(
      PROJECT,
      expect.objectContaining({
        graphRelationTypes: expect.objectContaining({
          combat_graph: ["WEAK_AGAINST", "USES_SKILL", "RESISTS", "VULNERABLE_TO"],
        }),
      }),
    )
    // Fix 30: wikilink는 더 이상 파일에 포함되지 않음
    const [, content] = mockWriteFile.mock.calls[0]
    expect(content).not.toContain("[[얼음|VULNERABLE_TO]]")
    expect(content).not.toContain("## Related")
  })

  it("같은 concept의 다중 assignment 중 실패한 assignment만 건너뜀", async () => {
    const addItemsMock = vi.fn()
    vi.mocked(useReviewStore.getState).mockReturnValue(mockReviewState(addItemsMock) as unknown as ReturnType<typeof useReviewStore.getState>)
    mockLoadGraphPolicy.mockResolvedValueOnce({
      managedGraphs: ["combat_graph"],
      graphRelationTypes: { combat_graph: ["WEAK_AGAINST", "USES_SKILL", "RESISTS", "COUNTERS"] },
    })

    mockSequentialResponses(
      [
        "---SECTION: ## 고블린 전사 | db/enemies/goblin-warrior-weakness.md---",
        "고블린 전사는 불에 약하고 기습을 사용한다.",
        "---END SECTION---",
      ].join("\n"),
      JSON.stringify({
        triples: [
          {
            source_id: "s1",
            subject: "고블린 전사",
            predicate: "WEAK_AGAINST",
            object: "불",
            graph: "combat_graph",
            page_path: "db/enemies/goblin-warrior-weakness.md",
            new_graph: false,
          },
          {
            source_id: "s1",
            subject: "고블린 전사",
            predicate: "AMBUSHES",
            object: "기습",
            graph: "combat_graph",
            page_path: "db/enemies/goblin-warrior-tactic.md",
            new_graph: false,
          },
        ],
      }),
    )

    const written = await autoIngestImpl(PROJECT, SOURCE, cliConfig)

    // decomposition이 goblin-warrior-weakness.md 하나만 page_path로 지정했으므로
    // 파일 쓰기는 그 경로 하나뿐이다. goblin-warrior-tactic.md로 향한 두 번째
    // triple은 graph assignment 단계에서만 등장하고 별도 문서를 만들지 않는다.
    expect(written).toEqual(["db/enemies/goblin-warrior-weakness.md"])
    expect(mockWriteFile).toHaveBeenCalledTimes(1)
  })

  it("CLI transport가 decomposition에서 에러를 던지면 해당 청크를 건너뜀 (단일 청크면 파일 없음 + error)", async () => {
    mockStream.mockImplementation(async (_cfg, _msgs, callbacks) => {
      callbacks.onError(new Error("claude CLI exited with code 1"))
    })

    const written = await autoIngestImpl(PROJECT, SOURCE, cliConfig)
    expect(written).toEqual([])
    const last = useActivityStore.getState().items[0]
    expect(last.status).toBe("error")
  })

  it("같은 graph에 여러 assignment를 추가해도 duplicate 실패로 처리하지 않음", async () => {
    mockSequentialResponses(
      [
        "---SECTION: ## 고블린 전사 | db/enemies/goblin-warrior.md---",
        "고블린 전사는 불에 약하다.",
        "---END SECTION---",
        "",
        "---SECTION: ## 오크 전사 | db/enemies/orc-warrior.md---",
        "오크 전사는 불에 약하다.",
        "---END SECTION---",
      ].join("\n"),
      JSON.stringify({
        triples: [
          {
            source_id: "s1",
            subject: "고블린 전사",
            predicate: "WEAK_AGAINST",
            object: "불",
            graph: "combat_graph",
            page_path: "db/enemies/goblin-warrior.md",
            new_graph: false,
          },
          {
            source_id: "s2",
            subject: "오크 전사",
            predicate: "WEAK_AGAINST",
            object: "불",
            graph: "combat_graph",
            page_path: "db/enemies/orc-warrior.md",
            new_graph: false,
          },
        ],
      }),
    )

    const written = await autoIngestImpl(PROJECT, SOURCE, cliConfig)

    expect(written).toEqual([
      "db/enemies/goblin-warrior.md",
      "db/enemies/orc-warrior.md",
    ])
    expect(mockWriteFile).toHaveBeenCalledTimes(2)
  })
})
