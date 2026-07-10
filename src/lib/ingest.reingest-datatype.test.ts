/**
 * Focused unit tests for reIngestDocument()'s dataTypeId/prefilledFields
 * path (Phase J, entity-relation-plan.md). When prefilledFields is given,
 * decomposition's model call must be skipped entirely — the fields are
 * assembled directly into a single section and handed to graph assignment.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import type { LlmConfig } from "@/stores/wiki-store"

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn().mockResolvedValue(""),
  writeFile: vi.fn().mockResolvedValue(undefined),
  listDirectory: vi.fn().mockResolvedValue([]),
}))
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/claude-cli-transport", () => ({ streamClaudeCodeCli: vi.fn() }))
vi.mock("@/lib/gemini-cli-transport", () => ({ streamGeminiCli: vi.fn() }))
vi.mock("@/lib/codex-cli-transport", () => ({ streamCodexCli: vi.fn() }))
vi.mock("@/lib/graph-policy", () => ({
  loadGraphPolicy: vi.fn().mockResolvedValue({ managedGraphs: [], graphRelationTypes: {} }),
  saveGraphPolicy: vi.fn(),
  buildGraphPolicyPrompt: vi.fn().mockReturnValue(""),
}))
vi.mock("@/lib/page-graph-index", () => ({ removePageFromIndex: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/entity-dict", () => ({
  loadEntityDict: vi.fn().mockResolvedValue({}),
  buildEntityHintsForPrompt: vi.fn().mockReturnValue(""),
  findCandidates: vi.fn().mockReturnValue([]),
}))
vi.mock("@/lib/counterexample-index", () => ({
  loadCounterexamples: vi.fn().mockResolvedValue([]),
  loadRejectionLog: vi.fn().mockResolvedValue([]),
  findRelatedRejections: vi.fn().mockReturnValue([]),
  formatDismissalContext: vi.fn().mockReturnValue(""),
}))

const { mockDeleteEdgesByPagePath, mockSyncGraphToBackend } = vi.hoisted(() => ({
  mockDeleteEdgesByPagePath: vi.fn().mockResolvedValue(undefined),
  mockSyncGraphToBackend: vi.fn().mockResolvedValue("synced"),
}))
vi.mock("@/lib/graph-backend", () => ({
  getGraphBackend: vi.fn().mockResolvedValue({
    deleteEdgesByPagePath: mockDeleteEdgesByPagePath,
  }),
}))

vi.mock("@/lib/graph-sync", () => ({
  syncGraphToBackend: (...args: unknown[]) => mockSyncGraphToBackend(...args),
}))

let mockTriplesForNextCall: unknown[] = []
vi.mock("./llm-client", () => ({
  streamChat: vi.fn(async (_cfg, _msgs, cb) => {
    // Only graph assignment should ever reach here in the prefilledFields
    // path — decomposition's model call must be skipped.
    cb.onToken(JSON.stringify({ triples: mockTriplesForNextCall }))
    cb.onDone()
  }),
  isCliProvider: () => false,
}))

import { streamChat } from "./llm-client"
import { reIngestDocument } from "./ingest"

const mockStreamChat = vi.mocked(streamChat)

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

beforeEach(() => {
  mockStreamChat.mockClear()
  mockDeleteEdgesByPagePath.mockClear()
  mockSyncGraphToBackend.mockClear()
  mockTriplesForNextCall = []
})

describe("reIngestDocument — dataTypeId/prefilledFields", () => {
  it("skips the decomposition model call and makes exactly one call (graph assignment) when prefilledFields is given", async () => {
    mockTriplesForNextCall = [
      {
        source_id: "s1",
        subject: "기능C",
        predicate: "HAS_TEST_CASE",
        object: "입력값 X 조합",
        graph: "casemap_use_item",
        page_path: "db/casemap/feature-c.md",
        new_graph: true,
        graph_relation_types: ["HAS_TEST_CASE"],
      },
    ]

    await reIngestDocument(
      "/proj",
      "test-project",
      "db/casemap/feature-c.md",
      "",
      fakeLlmConfig(),
      "casemap",
      { "기능 정보": "기능C 설명", "테스트케이스": "1. [High] 입력값 X 조합" },
    )

    // Exactly one model call total (graph assignment) — decomposition's
    // call never happens when fields are prefilled.
    expect(mockStreamChat).toHaveBeenCalledTimes(1)
    expect(mockDeleteEdgesByPagePath).toHaveBeenCalledWith("test-project", "db/casemap/feature-c.md")
    expect(mockSyncGraphToBackend).toHaveBeenCalledTimes(1)
    const syncedTriples = mockSyncGraphToBackend.mock.calls[0][2]
    expect(syncedTriples).toHaveLength(1)
    expect(syncedTriples[0]).toMatchObject({ subject: "기능C", predicate: "HAS_TEST_CASE" })
  })

  it("still calls the model twice (decomposition + graph assignment) when prefilledFields is omitted", async () => {
    mockStreamChat.mockImplementationOnce(async (_cfg, _msgs, cb) => {
      cb.onToken("---SECTION: db/casemap/feature-c.md---\nsome text\n---END SECTION---")
      cb.onDone()
    })
    mockTriplesForNextCall = []

    await reIngestDocument("/proj", "test-project", "db/casemap/feature-c.md", "raw content", fakeLlmConfig())

    expect(mockStreamChat).toHaveBeenCalledTimes(2)
  })
})
