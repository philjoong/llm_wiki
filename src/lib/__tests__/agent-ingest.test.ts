/**
 * agent-ingest regression tests — Stage 1/2 pipeline via CLI transport.
 *
 * The CLI path runs the same Stage 1 → Stage 2 → buildFileBlocksFromAssignments
 * pipeline as autoIngestImpl, but calls the CLI subprocess instead of the HTTP API.
 * response_format is not available on CLI, so JSON is enforced via prompt only.
 *
 * Test cases:
 *  1. Clean Stage 1 + Stage 2 response → writes FILE blocks with graph + relations
 *  2. Stage 2 returns no assignments → throws with error detail
 *  3. Stage 2 assignments with invalid relation types → skipped, review item created, valid ones written
 *  4. CLI transport error on Stage 1 → throws
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
    relationTypes: ["WEAK_AGAINST", "USES_SKILL"],
    graphRelationTypes: { combat_graph: ["WEAK_AGAINST", "USES_SKILL"] },
  }),
  saveGraphPolicy: vi.fn().mockResolvedValue(undefined),
  buildGraphPolicyPrompt: vi.fn().mockReturnValue("## Graph Policy\n..."),
}))

vi.mock("../graph-sync", () => ({
  syncGraphToFalkorDb: vi.fn().mockResolvedValue("0 nodes, 0 edges synced"),
}))

vi.mock("@/lib/counterexample-index", () => ({
  loadCounterexamples: vi.fn().mockResolvedValue([]),
  loadRejectionLog: vi.fn().mockResolvedValue([]),
  findRelatedRejections: vi.fn().mockReturnValue([]),
  formatDismissalContext: vi.fn().mockReturnValue(""),
}))

vi.mock("@/stores/review-store", () => ({
  useReviewStore: {
    getState: vi.fn().mockReturnValue({ addItems: vi.fn() }),
  },
}))

import { readFile, writeFile, listDirectory } from "@/commands/fs"
import { streamClaudeCodeCli } from "../claude-cli-transport"
import { autoIngestViaAgent } from "../agent-ingest"
import { buildStage2Scaffold } from "../ingest"
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

const STAGE1_RESPONSE = JSON.stringify({
  sections: [
    {
      source_range: "## 고블린 전사",
      source_text: "고블린 전사는 불에 약하고 독침을 사용한다.",
    },
  ],
})

const STAGE2_RESPONSE = JSON.stringify({
  assignments: [
    {
      source_id: "s1",
      concept: "고블린 전사",
      page_path: "db/enemies/goblin-warrior.md",
      graph: "combat_graph",
      relations: [{ target: "불", type: "WEAK_AGAINST" }],
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
    relationTypes: ["WEAK_AGAINST", "USES_SKILL"],
    graphRelationTypes: { combat_graph: ["WEAK_AGAINST", "USES_SKILL"] },
    forbiddenTypes: [],
  })
  mockSaveGraphPolicy.mockReset().mockResolvedValue({
    managedGraphs: ["combat_graph"],
    relationTypes: ["WEAK_AGAINST", "USES_SKILL"],
    graphRelationTypes: { combat_graph: ["WEAK_AGAINST", "USES_SKILL"] },
    forbiddenTypes: [],
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

describe("autoIngestViaAgent — Stage 1/2 pipeline", () => {
  it("Stage 2 scaffold는 source_text를 sections에만 싣고 assignment는 source_id로 참조함", () => {
    const scaffold = JSON.parse(buildStage2Scaffold([
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
    expect(scaffold.assignments[0]).toEqual(expect.objectContaining({ source_id: "s1" }))
    expect(scaffold.assignments[0]).not.toHaveProperty("source_text")
    expect(scaffold.assignments[0]).not.toHaveProperty("source_range")
  })

  it("Stage 1+2 성공 시 graph frontmatter와 wikilink가 포함된 파일을 씀", async () => {
    mockSequentialResponses(STAGE1_RESPONSE, STAGE2_RESPONSE)

    const written = await autoIngestViaAgent(PROJECT, SOURCE, cliConfig)

    expect(written).toContain("db/enemies/goblin-warrior.md")
    expect(mockWriteFile).toHaveBeenCalled()
    const [, content] = mockWriteFile.mock.calls[0]
    expect(content).toContain("graph: combat_graph")
    expect(content).toContain("[[불|WEAK_AGAINST]]")
    const last = useActivityStore.getState().items[0]
    expect(last.status).toBe("done")
  })

  it("Stage 2가 assignments를 하나도 반환하지 않으면 에러를 던짐", async () => {
    mockSequentialResponses(
      STAGE1_RESPONSE,
      JSON.stringify({ assignments: [] }),
    )

    await expect(autoIngestViaAgent(PROJECT, SOURCE, cliConfig)).rejects.toThrow(
      /Stage 2.*no assignments/,
    )
    expect(mockWriteFile).not.toHaveBeenCalled()
    const last = useActivityStore.getState().items[0]
    expect(last.status).toBe("error")
  })

  it("기존 graph가 relation type 4개로 꽉 찬 상태에서 새 type을 쓰면 해당 assignment를 건너뛰고 review item을 생성함", async () => {
    const addItemsMock = vi.fn()
    vi.mocked(useReviewStore.getState).mockReturnValue(mockReviewState(addItemsMock) as unknown as ReturnType<typeof useReviewStore.getState>)
    mockLoadGraphPolicy.mockResolvedValueOnce({
      managedGraphs: ["combat_graph"],
      relationTypes: ["WEAK_AGAINST", "USES_SKILL", "RESISTS", "COUNTERS"],
      graphRelationTypes: { combat_graph: ["WEAK_AGAINST", "USES_SKILL", "RESISTS", "COUNTERS"] },
      forbiddenTypes: [],
    })

    mockSequentialResponses(
      STAGE1_RESPONSE,
      JSON.stringify({
        assignments: [
          {
            source_id: "s1",
            concept: "고블린 전사",
            page_path: "db/enemies/goblin-warrior.md",
            graph: "combat_graph",
            relations: [{ target: "불", type: "INVALID_TYPE" }],
            new_graph: false,
          },
        ],
      }),
    )

    const written = await autoIngestViaAgent(PROJECT, SOURCE, cliConfig)

    // 실패한 concept은 파일 쓰기 없음
    expect(written).toHaveLength(0)
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
      relationTypes: ["WEAK_AGAINST", "USES_SKILL", "RESISTS"],
      graphRelationTypes: { combat_graph: ["WEAK_AGAINST", "USES_SKILL", "RESISTS"] },
      forbiddenTypes: [],
    })

    mockSequentialResponses(
      STAGE1_RESPONSE,
      JSON.stringify({
        assignments: [
          {
            source_id: "s1",
            concept: "고블린 전사",
            page_path: "db/enemies/goblin-warrior.md",
            graph: "combat_graph",
            relations: [{ target: "독침", type: "USES_SKILL" }, { target: "얼음", type: "VULNERABLE_TO" }],
            new_graph: false,
            graph_relation_types: ["WEAK_AGAINST", "USES_SKILL", "RESISTS", "VULNERABLE_TO"],
          },
        ],
      }),
    )

    const written = await autoIngestViaAgent(PROJECT, SOURCE, cliConfig)

    expect(written).toContain("db/enemies/goblin-warrior.md")
    expect(mockSaveGraphPolicy).toHaveBeenCalledWith(
      PROJECT,
      expect.objectContaining({
        graphRelationTypes: expect.objectContaining({
          combat_graph: ["WEAK_AGAINST", "USES_SKILL", "RESISTS", "VULNERABLE_TO"],
        }),
      }),
    )
    const [, content] = mockWriteFile.mock.calls[0]
    expect(content).toContain("[[얼음|VULNERABLE_TO]]")
  })

  it("같은 concept의 다중 assignment 중 실패한 assignment만 건너뜀", async () => {
    const addItemsMock = vi.fn()
    vi.mocked(useReviewStore.getState).mockReturnValue(mockReviewState(addItemsMock) as unknown as ReturnType<typeof useReviewStore.getState>)
    mockLoadGraphPolicy.mockResolvedValueOnce({
      managedGraphs: ["combat_graph"],
      relationTypes: ["WEAK_AGAINST", "USES_SKILL", "RESISTS", "COUNTERS"],
      graphRelationTypes: { combat_graph: ["WEAK_AGAINST", "USES_SKILL", "RESISTS", "COUNTERS"] },
      forbiddenTypes: [],
    })

    mockSequentialResponses(
      STAGE1_RESPONSE,
      JSON.stringify({
        assignments: [
          {
            source_id: "s1",
            concept: "고블린 전사",
            page_path: "db/enemies/goblin-warrior-weakness.md",
            graph: "combat_graph",
            relations: [{ target: "불", type: "WEAK_AGAINST" }],
            new_graph: false,
          },
          {
            source_id: "s1",
            concept: "고블린 전사",
            page_path: "db/enemies/goblin-warrior-tactic.md",
            graph: "combat_graph",
            relations: [{ target: "기습", type: "AMBUSHES" }],
            new_graph: false,
          },
        ],
      }),
    )

    const written = await autoIngestViaAgent(PROJECT, SOURCE, cliConfig)

    expect(written).toEqual(["db/enemies/goblin-warrior-weakness.md"])
    expect(mockWriteFile).toHaveBeenCalledTimes(1)
    expect(addItemsMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          type: "suggestion",
          description: expect.stringContaining("goblin-warrior-tactic.md"),
        }),
      ]),
    )
  })

  it("CLI transport가 Stage 1에서 에러를 던지면 그대로 전파됨", async () => {
    mockStream.mockImplementation(async (_cfg, _msgs, callbacks) => {
      callbacks.onError(new Error("claude CLI exited with code 1"))
    })

    await expect(autoIngestViaAgent(PROJECT, SOURCE, cliConfig)).rejects.toThrow(
      /Stage 1 failed/,
    )
    const last = useActivityStore.getState().items[0]
    expect(last.status).toBe("error")
  })

  it("같은 graph에 여러 assignment를 추가해도 duplicate 실패로 처리하지 않음", async () => {
    mockSequentialResponses(
      JSON.stringify({
        sections: [
          {
            source_range: "## 고블린 전사",
            source_text: "고블린 전사는 불에 약하다.",
          },
          {
            source_range: "## 오크 전사",
            source_text: "오크 전사는 불에 약하다.",
          },
        ],
      }),
      JSON.stringify({
        assignments: [
          {
            source_id: "s1",
            concept: "고블린 전사",
            page_path: "db/enemies/goblin-warrior.md",
            graph: "combat_graph",
            relations: [{ target: "불", type: "WEAK_AGAINST" }],
            new_graph: false,
          },
          {
            source_id: "s2",
            concept: "오크 전사",
            page_path: "db/enemies/orc-warrior.md",
            graph: "combat_graph",
            relations: [{ target: "불", type: "WEAK_AGAINST" }],
            new_graph: false,
          },
        ],
      }),
    )

    const written = await autoIngestViaAgent(PROJECT, SOURCE, cliConfig)

    expect(written).toEqual([
      "db/enemies/goblin-warrior.md",
      "db/enemies/orc-warrior.md",
    ])
    expect(mockWriteFile).toHaveBeenCalledTimes(2)
  })
})
