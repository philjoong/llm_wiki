import { describe, it, expect, beforeEach, vi } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"

vi.mock("@/lib/llm-client", () => ({
  streamChat: vi.fn(),
}))
vi.mock("@/lib/graph-policy", () => ({
  loadGraphPolicy: vi.fn(),
}))
vi.mock("@/lib/entity-dict", () => ({
  loadEntityDict: vi.fn(),
  findCandidates: vi.fn(),
  resolveEntitySeeds: vi.fn(),
}))

const mockQueryGraph = vi.fn()
vi.mock("@/lib/graph-backend", () => ({
  getGraphBackend: vi.fn().mockResolvedValue({
    queryGraph: (...args: unknown[]) => mockQueryGraph(...args),
  }),
}))

import { streamChat } from "@/lib/llm-client"
import { loadGraphPolicy } from "@/lib/graph-policy"
import { loadEntityDict, findCandidates, resolveEntitySeeds } from "@/lib/entity-dict"
import { getGraphContext, formatGraphContextBlocks } from "./graph-qna"
import type { GraphSnapshot } from "@/lib/graph-backend"

const mockStreamChat = vi.mocked(streamChat)
const mockLoadGraphPolicy = vi.mocked(loadGraphPolicy)
const mockLoadEntityDict = vi.mocked(loadEntityDict)
const mockFindCandidates = vi.mocked(findCandidates)
const mockResolveEntitySeeds = vi.mocked(resolveEntitySeeds)

function fakeLlmConfig(): LlmConfig {
  return {
    provider: "openai",
    apiKey: "test-key",
    model: "gpt-4",
    ollamaUrl: "",
    customEndpoint: "",
    maxContextSize: 128000,
  }
}

function mockLlmReturns(json: unknown) {
  mockStreamChat.mockImplementation(async (_config, _msgs, callbacks) => {
    callbacks.onToken(JSON.stringify(json))
    callbacks.onDone()
  })
}

function edge(overrides: Partial<{ relationType: string; subject: string; object: string; pagePath: string }>) {
  return {
    id: "e1",
    sourceId: "1",
    targetId: "2",
    relationType: overrides.relationType ?? "HAS_COOLDOWN",
    properties: {
      subject: overrides.subject ?? "스킬A",
      object: overrides.object ?? "쿨타임",
      page_path: overrides.pagePath ?? "db/skills/skill-a.md",
    },
  }
}

function snapshotWithEdges(edges: ReturnType<typeof edge>[]): GraphSnapshot {
  return { nodes: [], edges }
}

function node(id: string, name: string, pagePath = "db/dummy.md") {
  return { id, name, labels: [], pagePath, properties: {} }
}

beforeEach(() => {
  mockStreamChat.mockReset()
  mockLoadGraphPolicy.mockReset()
  mockLoadEntityDict.mockReset()
  mockFindCandidates.mockReset()
  mockResolveEntitySeeds.mockReset()
  mockQueryGraph.mockReset()

  mockLoadEntityDict.mockResolvedValue({})
  mockFindCandidates.mockReturnValue([])
})

describe("getGraphContext", () => {
  it("returns [] when there are no managed graphs", async () => {
    mockLoadGraphPolicy.mockResolvedValue({ managedGraphs: [], graphRelationTypes: {} })
    const result = await getGraphContext("hello", "/proj", "p", fakeLlmConfig())
    expect(result).toEqual([])
    expect(mockStreamChat).not.toHaveBeenCalled()
  })

  it("returns [] when the LLM selects no graphs (unrelated question)", async () => {
    mockLoadGraphPolicy.mockResolvedValue({
      managedGraphs: ["combat_graph"],
      graphRelationTypes: { combat_graph: ["HAS_COOLDOWN"] },
    })
    mockLlmReturns({ selections: [], reasoning: "unrelated" })
    const result = await getGraphContext("안녕", "/proj", "p", fakeLlmConfig())
    expect(result).toEqual([])
    expect(mockQueryGraph).not.toHaveBeenCalled()
  })

  it("runs a relation query when only relationTypes are selected (enumeration question)", async () => {
    mockLoadGraphPolicy.mockResolvedValue({
      managedGraphs: ["combat_graph"],
      graphRelationTypes: { combat_graph: ["HAS_COOLDOWN"] },
    })
    mockLlmReturns({
      selections: [{ graph: "combat_graph", relationTypes: ["HAS_COOLDOWN"], entities: [] }],
      reasoning: "enumeration",
    })
    mockQueryGraph.mockResolvedValueOnce(snapshotWithEdges([edge({})]))

    const result = await getGraphContext("쿨타임 있는 스킬 전부", "/proj", "p", fakeLlmConfig())

    expect(mockQueryGraph).toHaveBeenCalledWith("p", "combat_graph", { type: "relation", relationType: "HAS_COOLDOWN" })
    expect(result).toHaveLength(1)
    expect(result[0].lines).toEqual(["- 스킬A --HAS_COOLDOWN--> 쿨타임 (source: db/skills/skill-a.md)"])
  })

  it("runs a node query when only an entity is selected (entity-focused question)", async () => {
    mockLoadGraphPolicy.mockResolvedValue({
      managedGraphs: ["combat_graph"],
      graphRelationTypes: { combat_graph: ["HAS_EFFECT"] },
    })
    mockLlmReturns({
      selections: [{ graph: "combat_graph", relationTypes: [], entities: ["스킬A"] }],
      reasoning: "entity",
    })
    // First call: `{ type: "all" }` full-graph load for name resolution.
    mockQueryGraph.mockResolvedValueOnce(snapshotWithEdges([]))
    // Second call: the node query itself.
    mockQueryGraph.mockResolvedValueOnce(snapshotWithEdges([edge({ relationType: "HAS_EFFECT", object: "넉백" })]))

    const result = await getGraphContext("스킬A는 어떤 효과가 있어?", "/proj", "p", fakeLlmConfig())

    expect(mockQueryGraph).toHaveBeenNthCalledWith(1, "p", "combat_graph", { type: "all" })
    expect(mockQueryGraph).toHaveBeenNthCalledWith(2, "p", "combat_graph", { type: "node", nodeName: "스킬A" })
    expect(mockQueryGraph).toHaveBeenCalledTimes(2) // no path query — only one entity
    expect(result[0].lines).toEqual(["- 스킬A --HAS_EFFECT--> 넉백 (source: db/skills/skill-a.md)"])
  })

  it("runs both relation and node queries when a selection has both", async () => {
    mockLoadGraphPolicy.mockResolvedValue({
      managedGraphs: ["combat_graph"],
      graphRelationTypes: { combat_graph: ["HAS_COOLDOWN", "HAS_EFFECT"] },
    })
    mockLlmReturns({
      selections: [{ graph: "combat_graph", relationTypes: ["HAS_COOLDOWN"], entities: ["스킬A"] }],
      reasoning: "mixed",
    })
    mockQueryGraph.mockResolvedValueOnce(snapshotWithEdges([edge({ relationType: "HAS_COOLDOWN" })])) // relation
    mockQueryGraph.mockResolvedValueOnce(snapshotWithEdges([])) // all (name resolution)
    mockQueryGraph.mockResolvedValueOnce(snapshotWithEdges([edge({ relationType: "HAS_EFFECT", object: "넉백" })])) // node

    const result = await getGraphContext("스킬A 쿨타임?", "/proj", "p", fakeLlmConfig())

    expect(result[0].lines).toContain("- 스킬A --HAS_COOLDOWN--> 쿨타임 (source: db/skills/skill-a.md)")
    expect(result[0].lines).toContain("- 스킬A --HAS_EFFECT--> 넉백 (source: db/skills/skill-a.md)")
  })

  it("runs a path query and includes it in the context when 2+ entities are selected", async () => {
    mockLoadGraphPolicy.mockResolvedValue({
      managedGraphs: ["combat_graph"],
      graphRelationTypes: { combat_graph: ["CAUSED_BY"] },
    })
    mockLlmReturns({
      selections: [{ graph: "combat_graph", relationTypes: [], entities: ["스킬A", "스킬B"] }],
      reasoning: "relation between two entities",
    })
    mockQueryGraph.mockResolvedValueOnce(snapshotWithEdges([])) // all (name resolution)
    mockQueryGraph.mockResolvedValueOnce(snapshotWithEdges([])) // node query for 스킬A
    mockQueryGraph.mockResolvedValueOnce(snapshotWithEdges([])) // node query for 스킬B
    mockQueryGraph.mockResolvedValueOnce(
      snapshotWithEdges([
        edge({ relationType: "HAS_EFFECT", subject: "스킬A", object: "넉백" }),
        edge({ relationType: "CAUSED_BY", subject: "넉백", object: "스킬B" }),
      ]),
    ) // path

    const result = await getGraphContext("스킬A와 스킬B는 무슨 관계야?", "/proj", "p", fakeLlmConfig())

    expect(mockQueryGraph).toHaveBeenNthCalledWith(4, "p", "combat_graph", {
      type: "path",
      fromNode: "스킬A",
      toNode: "스킬B",
      maxDepth: 6,
    })
    expect(result[0].lines).toContain("- 스킬A --HAS_EFFECT--> 넉백 (source: db/skills/skill-a.md)")
    expect(result[0].lines).toContain("- 넉백 --CAUSED_BY--> 스킬B (source: db/skills/skill-a.md)")
  })

  it("omits the context block entirely when the selected queries return no edges", async () => {
    mockLoadGraphPolicy.mockResolvedValue({
      managedGraphs: ["combat_graph"],
      graphRelationTypes: { combat_graph: ["HAS_COOLDOWN"] },
    })
    mockLlmReturns({
      selections: [{ graph: "combat_graph", relationTypes: ["HAS_COOLDOWN"], entities: [] }],
      reasoning: "no matches",
    })
    mockQueryGraph.mockResolvedValueOnce(snapshotWithEdges([]))

    const result = await getGraphContext("쿨타임 있는 스킬 전부", "/proj", "p", fakeLlmConfig())
    expect(result).toEqual([])
  })

  it("uses resolveEntitySeeds() to normalize an entity name via the entity dictionary before querying", async () => {
    mockLoadGraphPolicy.mockResolvedValue({
      managedGraphs: ["combat_graph"],
      graphRelationTypes: { combat_graph: ["HAS_EFFECT"] },
    })
    mockLlmReturns({
      selections: [{ graph: "combat_graph", relationTypes: [], entities: ["스킬 A"] }], // LLM-extracted spelling
    })
    const entry = { id: "id-1", canonicalName: "스킬A", aliases: ["스킬 A"], pagePaths: [], graphNodes: [] }
    mockFindCandidates.mockReturnValue([{ entry, match: "exact", matchedName: "스킬 A" }])
    mockResolveEntitySeeds.mockReturnValue(["스킬A"]) // canonical spelling stored in the graph

    mockQueryGraph.mockResolvedValueOnce(snapshotWithEdges([])) // all
    mockQueryGraph.mockResolvedValueOnce(snapshotWithEdges([edge({ relationType: "HAS_EFFECT", object: "넉백" })])) // node

    await getGraphContext("스킬 A 효과?", "/proj", "p", fakeLlmConfig())

    expect(mockQueryGraph).toHaveBeenNthCalledWith(2, "p", "combat_graph", { type: "node", nodeName: "스킬A" })
  })

  it("narrows managed graphs to the given prefix before graph selection", async () => {
    mockLoadGraphPolicy.mockResolvedValue({
      managedGraphs: ["casemap_use_item", "persona_play_scenario", "wiki_general"],
      graphRelationTypes: {},
    })
    mockLlmReturns({ selections: [], reasoning: "n/a" })

    await getGraphContext("질문", "/proj", "p", fakeLlmConfig(), "casemap_")

    const promptArg = mockStreamChat.mock.calls[0][1][0].content as string
    expect(promptArg).toContain("casemap_use_item")
    expect(promptArg).not.toContain("persona_play_scenario")
    expect(promptArg).not.toContain("wiki_general")
  })

  it("returns [] without calling the LLM when the prefix filter matches no managed graphs", async () => {
    mockLoadGraphPolicy.mockResolvedValue({
      managedGraphs: ["wiki_general"],
      graphRelationTypes: {},
    })

    const result = await getGraphContext("질문", "/proj", "p", fakeLlmConfig(), "casemap_")

    expect(result).toEqual([])
    expect(mockStreamChat).not.toHaveBeenCalled()
  })

  it("expands an entity node query to indirect (2-hop) neighbors for impact-style questions", async () => {
    mockLoadGraphPolicy.mockResolvedValue({
      managedGraphs: ["combat_graph"],
      graphRelationTypes: { combat_graph: ["HAS_EFFECT"] },
    })
    mockLlmReturns({
      selections: [{ graph: "combat_graph", relationTypes: [], entities: ["스킬A"] }],
      reasoning: "impact",
    })

    // `{ type: "all" }` snapshot: A --HAS_EFFECT--> B --CAUSED_BY--> C (C is 2 hops from A)
    const fullSnapshot: GraphSnapshot = {
      nodes: [node("1", "스킬A"), node("2", "넉백"), node("3", "스킬C")],
      edges: [
        edge({ relationType: "HAS_EFFECT", subject: "스킬A", object: "넉백" }),
        { id: "e2", sourceId: "2", targetId: "3", relationType: "CAUSED_BY", properties: { subject: "넉백", object: "스킬C", page_path: "db/skills/skill-a.md" } },
      ],
    }
    mockQueryGraph.mockResolvedValueOnce(fullSnapshot) // all (name resolution + hop expansion source)
    mockQueryGraph.mockResolvedValueOnce(snapshotWithEdges([edge({ relationType: "HAS_EFFECT", object: "넉백" })])) // direct node query

    const result = await getGraphContext("스킬A의 영향도는?", "/proj", "p", fakeLlmConfig())

    expect(result[0].lines).toContain("- 넉백 --CAUSED_BY--> 스킬C (source: db/skills/skill-a.md)")
  })
})

describe("formatGraphContextBlocks", () => {
  it("returns an empty string for no blocks", () => {
    expect(formatGraphContextBlocks([])).toBe("")
  })

  it("joins blocks under a Knowledge Graph Context heading, noting truncation", () => {
    const result = formatGraphContextBlocks([
      { graphName: "casemap_use_item", reasoning: "matches feature", lines: ["- 기능C --HAS_TEST_CASE--> 입력값 X"], truncated: false },
      { graphName: "persona_play_scenario", reasoning: "matches persona", lines: ["- 신규유저 --PERFORMS--> 튜토리얼 스킵"], truncated: true },
    ])

    expect(result).toContain("## Knowledge Graph Context")
    expect(result).toContain("### Graph: casemap_use_item")
    expect(result).toContain("- 기능C --HAS_TEST_CASE--> 입력값 X")
    expect(result).toContain("### Graph: persona_play_scenario")
    expect(result).toContain("(Result limit reached — this list may be incomplete.)")
  })
})
