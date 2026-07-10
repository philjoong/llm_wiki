import { describe, it, expect } from "vitest"
import { filterSnapshotByHops, mergeSnapshots } from "./graph-hop"
import type { GraphNodeRecord, GraphEdgeRecord, GraphSnapshot } from "@/lib/graph-backend"

function makeNode(overrides: Partial<GraphNodeRecord> & { id: string; name: string }): GraphNodeRecord {
  return {
    labels: ["Page"],
    properties: {},
    pagePath: "db/dummy.md",
    ...overrides,
  }
}

function makeEdge(overrides: Partial<GraphEdgeRecord> & { id: string; sourceId: string; targetId: string }): GraphEdgeRecord {
  return {
    relationType: "RELATED",
    properties: {},
    ...overrides,
  }
}

function makeSnapshot(nodes: GraphNodeRecord[], edges: GraphEdgeRecord[]): GraphSnapshot {
  return { nodes, edges }
}

describe("filterSnapshotByHops", () => {
  it("includes nodes at exactly N hops and excludes N+1 (N=1)", () => {
    const nodes = [makeNode({ id: "a", name: "A" }), makeNode({ id: "b", name: "B" }), makeNode({ id: "c", name: "C" })]
    const edges = [makeEdge({ id: "e1", sourceId: "a", targetId: "b" }), makeEdge({ id: "e2", sourceId: "b", targetId: "c" })]
    const snapshot = makeSnapshot(nodes, edges)

    const result = filterSnapshotByHops(snapshot, ["a"], 1)
    expect(result.nodes.map((n) => n.id).sort()).toEqual(["a", "b"])
  })

  it("includes nodes at exactly N hops and excludes N+1 (N=3)", () => {
    const nodes = ["a", "b", "c", "d", "e"].map((id) => makeNode({ id, name: id }))
    const edges = [
      makeEdge({ id: "e1", sourceId: "a", targetId: "b" }),
      makeEdge({ id: "e2", sourceId: "b", targetId: "c" }),
      makeEdge({ id: "e3", sourceId: "c", targetId: "d" }),
      makeEdge({ id: "e4", sourceId: "d", targetId: "e" }),
    ]
    const snapshot = makeSnapshot(nodes, edges)

    const result = filterSnapshotByHops(snapshot, ["a"], 3)
    expect(result.nodes.map((n) => n.id).sort()).toEqual(["a", "b", "c", "d"])
  })

  it("maxHops = Infinity returns the seed's full connected component, excluding disconnected components", () => {
    const nodes = [
      makeNode({ id: "a", name: "A" }),
      makeNode({ id: "b", name: "B" }),
      makeNode({ id: "c", name: "C" }),
      makeNode({ id: "x", name: "X" }),
      makeNode({ id: "y", name: "Y" }),
    ]
    const edges = [
      makeEdge({ id: "e1", sourceId: "a", targetId: "b" }),
      makeEdge({ id: "e2", sourceId: "b", targetId: "c" }),
      makeEdge({ id: "e3", sourceId: "x", targetId: "y" }),
    ]
    const snapshot = makeSnapshot(nodes, edges)

    const result = filterSnapshotByHops(snapshot, ["a"], Infinity)
    expect(result.nodes.map((n) => n.id).sort()).toEqual(["a", "b", "c"])
  })

  it("removes edges whose endpoints are not both retained", () => {
    const nodes = [makeNode({ id: "a", name: "A" }), makeNode({ id: "b", name: "B" }), makeNode({ id: "c", name: "C" })]
    const edges = [makeEdge({ id: "e1", sourceId: "a", targetId: "b" }), makeEdge({ id: "e2", sourceId: "b", targetId: "c" })]
    const snapshot = makeSnapshot(nodes, edges)

    const result = filterSnapshotByHops(snapshot, ["a"], 1)
    expect(result.edges.map((e) => e.id)).toEqual(["e1"])
  })

  it("does not expand past a node with no pagePath", () => {
    const nodes = [
      makeNode({ id: "a", name: "A" }),
      makeNode({ id: "hub", name: "Hub", pagePath: undefined }),
      makeNode({ id: "c", name: "C" }),
    ]
    const edges = [
      makeEdge({ id: "e1", sourceId: "a", targetId: "hub" }),
      makeEdge({ id: "e2", sourceId: "hub", targetId: "c" }),
    ]
    const snapshot = makeSnapshot(nodes, edges)

    const result = filterSnapshotByHops(snapshot, ["a"], Infinity)
    expect(result.nodes.map((n) => n.id).sort()).toEqual(["a", "hub"])
  })
})

describe("mergeSnapshots", () => {
  it("merges same-id nodes from different graphs without collision", () => {
    const snapA = makeSnapshot([makeNode({ id: "1", name: "A-Node" })], [])
    const snapB = makeSnapshot([makeNode({ id: "1", name: "B-Node" })], [])

    const merged = mergeSnapshots([
      { graphName: "graphA", snapshot: snapA },
      { graphName: "graphB", snapshot: snapB },
    ])

    expect(merged.nodes.map((n) => n.id).sort()).toEqual(["graphA:1", "graphB:1"])
  })

  it("keeps edge references valid after prefixing", () => {
    const snap = makeSnapshot(
      [makeNode({ id: "1", name: "A" }), makeNode({ id: "2", name: "B" })],
      [makeEdge({ id: "e1", sourceId: "1", targetId: "2" })],
    )

    const merged = mergeSnapshots([{ graphName: "g", snapshot: snap }])

    expect(merged.edges).toEqual([
      expect.objectContaining({ id: "g:e1", sourceId: "g:1", targetId: "g:2" }),
    ])
    const nodeIds = new Set(merged.nodes.map((n) => n.id))
    expect(nodeIds.has(merged.edges[0].sourceId)).toBe(true)
    expect(nodeIds.has(merged.edges[0].targetId)).toBe(true)
  })

  it("injects properties.graphName on every merged node", () => {
    const snap = makeSnapshot([makeNode({ id: "1", name: "A" })], [])
    const merged = mergeSnapshots([{ graphName: "g", snapshot: snap }])
    expect(merged.nodes[0].properties.graphName).toBe("g")
  })

  it("preserves the pre-prefix original id as properties.rawId for backend edit calls", () => {
    const snap = makeSnapshot(
      [makeNode({ id: "1", name: "A" })],
      [makeEdge({ id: "e1", sourceId: "1", targetId: "1" })],
    )
    const merged = mergeSnapshots([{ graphName: "g", snapshot: snap }])
    expect(merged.nodes[0].properties.rawId).toBe("1")
    expect(merged.edges[0].properties.rawId).toBe("e1")
  })
})
