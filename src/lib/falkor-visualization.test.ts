/**
 * parseFalkorQueryResult — pinned against the REAL FalkorDB GRAPH.QUERY reply
 * shape (Fix 26).
 *
 * Fixtures below were captured from the live FalkorDB (raw RESP over the
 * socket) for graphs `Mydev___lore_reference_graph` (node) and
 * `Mydev___event_chain_graph` (edge). The Rust `redis_value_to_json` emits
 * only arrays/scalars, so every node/edge arrives as an array of [key,value]
 * pairs — never the JSON object the old parser assumed.
 */
import { describe, it, expect } from "vitest"
import { parseFalkorQueryResult } from "./falkor-visualization"

// MATCH (n) RETURN n LIMIT 1  →  [header, rows, stats]
const NODE_RESULT = [
  ["n"],
  [
    [
      [
        ["id", 0],
        ["labels", ["Page"]],
        [
          "properties",
          [
            ["id", "lineage-influences"],
            ["label", "리니지(게임)"],
            ["type", "other"],
            ["path", "/Users/muktop/Documents/my-dev/mymydev/Mydev/db/games/lineage-influences.md"],
            ["sources", "[namu-wiki.md]"],
          ],
        ],
      ],
    ],
  ],
  ["Cached execution: 1", "Query internal execution time: 0.77 milliseconds"],
]

// MATCH (n)-[r]->(m) RETURN n, r, m LIMIT 1
const EDGE_RESULT = [
  ["n", "r", "m"],
  [
    [
      [
        ["id", 0],
        ["labels", ["Page"]],
        ["properties", [["id", "a"], ["path", "/x/a.md"]]],
      ],
      [
        ["id", 0],
        ["type", "BRANCHES_INTO"],
        ["src_node", 0],
        ["dest_node", 1],
        ["properties", []],
      ],
      [
        ["id", 1],
        ["labels", ["Page"]],
        ["properties", [["id", "b"], ["path", "/x/b.md"]]],
      ],
    ],
  ],
  ["Cached execution: 1", "Query internal execution time: 0.5 milliseconds"],
]

describe("parseFalkorQueryResult — real array-of-pairs shape (Fix 26)", () => {
  it("decodes a node, ignoring header/stats", () => {
    const { nodes, links } = parseFalkorQueryResult(NODE_RESULT)
    expect(nodes).toHaveLength(1)
    expect(links).toHaveLength(0)
    const n = nodes[0]
    expect(n.id).toBe(0)
    expect(n.labels).toEqual(["Page"])
    // properties (themselves a pair-array) become a plain object
    expect(n.data.path).toContain("lineage-influences.md")
    expect(n.data.label).toBe("리니지(게임)")
    expect(n.data.id).toBe("lineage-influences")
  })

  it("decodes nodes + a typed edge from an n,r,m row", () => {
    const { nodes, links } = parseFalkorQueryResult(EDGE_RESULT)
    expect(nodes.map((n) => n.id).sort()).toEqual([0, 1])
    expect(links).toHaveLength(1)
    const e = links[0]
    expect(e.relationship).toBe("BRANCHES_INTO")
    expect(e.source).toBe(0)
    expect(e.target).toBe(1)
  })

  it("header/stats alone produce no phantom nodes", () => {
    const empty = [["n"], [], ["Cached execution: 0", "..."]]
    expect(parseFalkorQueryResult(empty)).toEqual({ nodes: [], links: [] })
  })

  it("returns empty for non-array / null input", () => {
    expect(parseFalkorQueryResult(null)).toEqual({ nodes: [], links: [] })
    expect(parseFalkorQueryResult("OK")).toEqual({ nodes: [], links: [] })
    expect(parseFalkorQueryResult(undefined)).toEqual({ nodes: [], links: [] })
  })

  it("dedupes a node repeated across rows", () => {
    const dup = [
      ["n"],
      [
        [[["id", 7], ["labels", ["Page"]], ["properties", [["path", "/x.md"]]]]],
        [[["id", 7], ["labels", ["Page"]], ["properties", [["path", "/x.md"]]]]],
      ],
      ["stats"],
    ]
    expect(parseFalkorQueryResult(dup).nodes).toHaveLength(1)
  })

  it("defensive: also accepts a future object-shape (RESP3 map) reply", () => {
    const objShape = [
      [{ id: 3, labels: ["Page"], properties: { path: "/y.md" } }],
    ]
    const { nodes } = parseFalkorQueryResult(objShape)
    expect(nodes).toHaveLength(1)
    expect(nodes[0].data.path).toBe("/y.md")
  })
})
