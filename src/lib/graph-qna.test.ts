import { beforeEach, describe, expect, it, vi } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"

vi.mock("@/lib/llm-client", () => ({ streamChat: vi.fn() }))
vi.mock("@/commands/knowledge", () => ({
  listKnowledgeGraphs: vi.fn(),
  getKnowledgeGraphSnapshot: vi.fn(),
}))

import { streamChat } from "@/lib/llm-client"
import { getKnowledgeGraphSnapshot, listKnowledgeGraphs } from "@/commands/knowledge"
import { formatGraphContextBlocks, getGraphContext } from "./graph-qna"

const llm: LlmConfig = { provider: "openai", apiKey: "test", model: "test", ollamaUrl: "", customEndpoint: "", maxContextSize: 1000 }
const graph = { graphId: "graph-combat", graphName: "combat_graph", purpose: "test" }
const snapshot = {
  graph,
  nodes: [
    { nodeId: "node-a", graphId: graph.graphId, entityId: "ent-a", entity: { entityId: "ent-a", canonicalName: "Skill A", entityType: "concept" as const } },
    { nodeId: "node-b", graphId: graph.graphId, entityId: "ent-b", entity: { entityId: "ent-b", canonicalName: "Cooldown", entityType: "concept" as const } },
  ],
  assertions: [{ assertionId: "assert-1", graphId: graph.graphId, subjectEntityId: "ent-a", predicate: "HAS_COOLDOWN", objectEntityId: "ent-b", origin: "ingest" as const, status: "active" as const, createdAt: "2026-01-01", evidenceState: "documented" as const, evidence: [{ evidenceId: "evidence-1", assertionId: "assert-1", pageId: "page-1", sectionId: "sec-1", evidenceType: "supports" as const }] }],
}

beforeEach(() => {
  vi.mocked(streamChat).mockReset()
  vi.mocked(listKnowledgeGraphs).mockReset()
  vi.mocked(getKnowledgeGraphSnapshot).mockReset()
})

function selection(value: unknown) {
  vi.mocked(streamChat).mockImplementation(async (_config, _messages, callbacks) => {
    callbacks.onToken(JSON.stringify(value)); callbacks.onDone()
  })
}

describe("knowledge graph Q&A", () => {
  it("does not call the model when the knowledge DB has no graphs", async () => {
    vi.mocked(listKnowledgeGraphs).mockResolvedValue([])
    expect(await getGraphContext("hello", "/project", "ignored", llm)).toEqual([])
    expect(streamChat).not.toHaveBeenCalled()
  })

  it("formats assertion IDs from a knowledge snapshot without page-path properties", async () => {
    vi.mocked(listKnowledgeGraphs).mockResolvedValue([graph])
    vi.mocked(getKnowledgeGraphSnapshot).mockResolvedValue(snapshot)
    selection({ selections: [{ graph: graph.graphName, relationTypes: ["HAS_COOLDOWN"], entities: [] }] })
    const blocks = await getGraphContext("Which skills have cooldowns?", "/project", "ignored", llm)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].lines).toEqual(["- Skill A --HAS_COOLDOWN--> Cooldown"])
  })

  it("resolves a name prefix to allowed graph IDs before loading snapshots", async () => {
    const other = { graphId: "graph-other", graphName: "persona_graph", purpose: "test" }
    vi.mocked(listKnowledgeGraphs).mockResolvedValue([graph, other])
    vi.mocked(getKnowledgeGraphSnapshot).mockResolvedValue(snapshot)
    selection({ selections: [] })
    await getGraphContext("question", "/project", "ignored", llm, "combat_")
    expect(getKnowledgeGraphSnapshot).toHaveBeenCalledTimes(1)
    expect(getKnowledgeGraphSnapshot).toHaveBeenCalledWith("/project", graph.graphId)
  })

  it("renders a deterministic context block", () => {
    expect(formatGraphContextBlocks([{ graphName: "g", reasoning: "selected", lines: ["- A --P--> B"], truncated: false }])).toContain("### Graph: g")
    expect(formatGraphContextBlocks([])).toBe("")
  })

  describe("content scope (Step 07)", () => {
    // Two assertions: assert-1 touches ent-a/ent-b (page-1); assert-2 touches
    // ent-c/ent-d (page-2). Scope should keep only the matching assertion.
    const scopedSnapshot = {
      graph,
      nodes: [
        ...snapshot.nodes,
        { nodeId: "node-c", graphId: graph.graphId, entityId: "ent-c", entity: { entityId: "ent-c", canonicalName: "Skill C", entityType: "concept" as const } },
        { nodeId: "node-d", graphId: graph.graphId, entityId: "ent-d", entity: { entityId: "ent-d", canonicalName: "Range", entityType: "concept" as const } },
      ],
      assertions: [
        snapshot.assertions[0],
        { assertionId: "assert-2", graphId: graph.graphId, subjectEntityId: "ent-c", predicate: "HAS_COOLDOWN", objectEntityId: "ent-d", origin: "ingest" as const, status: "active" as const, createdAt: "2026-01-01", evidenceState: "documented" as const, evidence: [{ evidenceId: "evidence-2", assertionId: "assert-2", pageId: "page-2", sectionId: "sec-2", evidenceType: "supports" as const }] },
      ],
    }

    beforeEach(() => {
      vi.mocked(listKnowledgeGraphs).mockResolvedValue([graph])
      vi.mocked(getKnowledgeGraphSnapshot).mockResolvedValue(scopedSnapshot)
      selection({ selections: [{ graph: graph.graphName, relationTypes: ["HAS_COOLDOWN"], entities: [] }] })
    })

    it("keeps only assertions touching an allowed entity", async () => {
      const blocks = await getGraphContext("q", "/project", "ignored", llm, undefined, { allowedEntityIds: ["ent-a"] })
      expect(blocks[0].lines).toEqual(["- Skill A --HAS_COOLDOWN--> Cooldown"])
    })

    it("keeps only assertions whose evidence cites an allowed page", async () => {
      const blocks = await getGraphContext("q", "/project", "ignored", llm, undefined, { allowedPageIds: ["page-2"] })
      expect(blocks[0].lines).toEqual(["- Skill C --HAS_COOLDOWN--> Range"])
    })

    it("applies no filter when scope is empty (regression)", async () => {
      const blocks = await getGraphContext("q", "/project", "ignored", llm, undefined, { allowedPageIds: [], allowedEntityIds: [] })
      expect(blocks[0].lines).toHaveLength(2)
    })
  })
})
