import { describe, it, expect, vi, beforeEach } from "vitest"

const mockReadFile = vi.fn<(path: string) => Promise<string>>()
const mockWriteFile = vi.fn<(path: string, content: string) => Promise<void>>()
const mockListGraphs = vi.fn<(projectName: string) => Promise<string[]>>()
const mockQueryGraph = vi.fn<(projectName: string, graphName: string, query: unknown) => Promise<{ nodes: unknown[]; edges: unknown[] }>>()

vi.mock("@/commands/fs", () => ({
  readFile: (...args: [string]) => mockReadFile(...args),
  writeFile: (...args: [string, string]) => mockWriteFile(...args),
  createDirectory: vi.fn(),
}))

vi.mock("@/lib/graph-backend", () => ({
  getGraphBackend: vi.fn().mockResolvedValue({
    listGraphs: (...args: [string]) => mockListGraphs(...args),
    queryGraph: (...args: [string, string, unknown]) => mockQueryGraph(...args),
  }),
}))

import { removeGraphFromIndex, rebuildPageGraphIndex, type PageGraphIndex } from "./page-graph-index"

beforeEach(() => {
  mockReadFile.mockReset()
  mockWriteFile.mockReset()
  mockWriteFile.mockResolvedValue(undefined)
  mockListGraphs.mockReset()
  mockQueryGraph.mockReset()
})

describe("removeGraphFromIndex", () => {
  it("drops the graph from entries that reference it, keeping other graphs", async () => {
    const existing: PageGraphIndex = {
      "db/a.md": ["combat-graph", "enemy-graph"],
      "db/b.md": ["combat-graph"],
    }
    mockReadFile.mockResolvedValue(JSON.stringify(existing))

    await removeGraphFromIndex("/proj", "combat-graph")

    expect(mockWriteFile).toHaveBeenCalledTimes(1)
    const written = JSON.parse(mockWriteFile.mock.calls[0][1]) as PageGraphIndex
    expect(written).toEqual({ "db/a.md": ["enemy-graph"] })
  })

  it("does not write when the graph is not present anywhere", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ "db/a.md": ["enemy-graph"] }))

    await removeGraphFromIndex("/proj", "combat-graph")

    expect(mockWriteFile).not.toHaveBeenCalled()
  })
})

describe("rebuildPageGraphIndex", () => {
  it("rebuilds pagePath -> graph[] from every graph's node snapshot", async () => {
    mockListGraphs.mockResolvedValue(["combat-graph", "enemy-graph"])
    mockQueryGraph.mockImplementation(async (_projectName, graphName) => {
      if (graphName === "combat-graph") {
        return {
          nodes: [
            { id: "1", labels: [], name: "고블린 전사", pagePath: "db/a.md", properties: {} },
            { id: "2", labels: [], name: "오크", properties: {} },
          ],
          edges: [],
        }
      }
      return {
        nodes: [{ id: "3", labels: [], name: "고블린 전사", pagePath: "db/a.md", properties: {} }],
        edges: [],
      }
    })

    const result = await rebuildPageGraphIndex("proj", "/proj")

    expect(result).toEqual({ "db/a.md": ["combat-graph", "enemy-graph"] })
    expect(mockWriteFile).toHaveBeenCalledTimes(1)
    const written = JSON.parse(mockWriteFile.mock.calls[0][1]) as PageGraphIndex
    expect(written).toEqual({ "db/a.md": ["combat-graph", "enemy-graph"] })
  })

  it("produces an empty index when no nodes have a pagePath", async () => {
    mockListGraphs.mockResolvedValue(["combat-graph"])
    mockQueryGraph.mockResolvedValue({
      nodes: [{ id: "1", labels: [], name: "오크", properties: {} }],
      edges: [],
    })

    const result = await rebuildPageGraphIndex("proj", "/proj")

    expect(result).toEqual({})
  })
})
