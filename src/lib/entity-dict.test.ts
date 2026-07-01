import { describe, it, expect, vi, beforeEach } from "vitest"

const mockUpdateNodeName = vi.fn<(projectName: string, graphName: string, nodeId: string, newName: string) => Promise<void>>()

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  createDirectory: vi.fn(),
}))

vi.mock("@/lib/graph-backend", () => ({
  getGraphBackend: vi.fn().mockResolvedValue({
    updateNodeName: (...args: [string, string, string, string]) => mockUpdateNodeName(...args),
  }),
}))

import {
  levenshteinDistance,
  isSimilar,
  findCandidates,
  upsertEntity,
  addEntityPagePath,
  linkGraphNode,
  renameEntity,
  addAlias,
  removeAlias,
  mergeEntities,
  splitEntity,
  buildEntityHintsForPrompt,
  findEntityByGraphNode,
  unlinkGraphNode,
  type EntityDict,
  type EntityEntry,
} from "./entity-dict"

function makeEntry(overrides: Partial<EntityEntry> & { id: string; canonicalName: string }): EntityEntry {
  return {
    aliases: [],
    pagePaths: [],
    graphNodes: [],
    ...overrides,
  }
}

beforeEach(() => {
  mockUpdateNodeName.mockReset()
  mockUpdateNodeName.mockResolvedValue(undefined)
})

describe("levenshteinDistance", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshteinDistance("고블린", "고블린")).toBe(0)
  })

  it("returns the length of the other string when one is empty", () => {
    expect(levenshteinDistance("", "abc")).toBe(3)
    expect(levenshteinDistance("abc", "")).toBe(3)
  })

  it("counts a single substitution as distance 1", () => {
    expect(levenshteinDistance("cat", "cot")).toBe(1)
  })
})

describe("isSimilar", () => {
  it("returns exact for case/whitespace-insensitive identical names", () => {
    expect(isSimilar("고블린 전사", "  고블린 전사  ")).toBe("exact")
    expect(isSimilar("Goblin", "goblin")).toBe("exact")
  })

  it("returns fuzzy for substring relationships", () => {
    expect(isSimilar("고블린전사", "고블린전사대장")).toBe("fuzzy")
  })

  it("returns fuzzy for Levenshtein distance <= 2", () => {
    expect(isSimilar("고블린전사", "고블린 전사")).toBe("fuzzy") // one space inserted
  })

  it("returns none for unrelated names", () => {
    expect(isSimilar("고블린 전사", "오크 마법사")).toBe("none")
  })
})

describe("findCandidates", () => {
  const dict: EntityDict = {
    "id-1": makeEntry({ id: "id-1", canonicalName: "고블린 전사", aliases: ["Goblin Warrior"] }),
    "id-2": makeEntry({ id: "id-2", canonicalName: "오크 전사", aliases: [] }),
  }

  it("finds an exact match against canonicalName", () => {
    const result = findCandidates("고블린 전사", dict)
    expect(result).toHaveLength(1)
    expect(result[0].match).toBe("exact")
    expect(result[0].entry.id).toBe("id-1")
  })

  it("finds an exact match against an alias", () => {
    const result = findCandidates("Goblin Warrior", dict)
    expect(result[0].match).toBe("exact")
  })

  it("finds a fuzzy match for a near-miss name", () => {
    const result = findCandidates("고블린전사", dict)
    expect(result[0].match).toBe("fuzzy")
    expect(result[0].entry.id).toBe("id-1")
  })

  it("returns empty for unrelated names", () => {
    expect(findCandidates("던전 A", dict)).toEqual([])
  })
})

describe("upsertEntity", () => {
  it("creates a new entry with a generated id when none is given", () => {
    const dict = upsertEntity({ canonicalName: "고블린 전사" }, {})
    const entries = Object.values(dict)
    expect(entries).toHaveLength(1)
    expect(entries[0].canonicalName).toBe("고블린 전사")
    expect(entries[0].id).toBeTruthy()
  })

  it("updates the existing entry in place when id matches", () => {
    const dict = { "id-1": makeEntry({ id: "id-1", canonicalName: "고블린 전사", aliases: ["a"] }) }
    const next = upsertEntity({ id: "id-1", canonicalName: "고블린 전사" }, dict)
    expect(next["id-1"].aliases).toEqual(["a"]) // preserved, not wiped
  })
})

describe("addEntityPagePath", () => {
  it("adds a page path and sets primaryPagePath when unset", () => {
    const dict = { "id-1": makeEntry({ id: "id-1", canonicalName: "고블린 전사" }) }
    const next = addEntityPagePath("id-1", "db/enemies/goblin.md", dict)
    expect(next["id-1"].pagePaths).toEqual(["db/enemies/goblin.md"])
    expect(next["id-1"].primaryPagePath).toBe("db/enemies/goblin.md")
  })

  it("does not duplicate an already-present page path", () => {
    const dict = {
      "id-1": makeEntry({ id: "id-1", canonicalName: "고블린 전사", pagePaths: ["db/a.md"], primaryPagePath: "db/a.md" }),
    }
    const next = addEntityPagePath("id-1", "db/a.md", dict)
    expect(next["id-1"].pagePaths).toEqual(["db/a.md"])
  })
})

describe("linkGraphNode", () => {
  it("adds a graph node ref", () => {
    const dict = { "id-1": makeEntry({ id: "id-1", canonicalName: "고블린 전사" }) }
    const next = linkGraphNode("id-1", { graphName: "combat_graph", nodeId: "42" }, dict)
    expect(next["id-1"].graphNodes).toEqual([{ graphName: "combat_graph", nodeId: "42" }])
  })

  it("allows multiple nodeIds for the same graphName", () => {
    const dict = {
      "id-1": makeEntry({ id: "id-1", canonicalName: "고블린 전사", graphNodes: [{ graphName: "combat_graph", nodeId: "42" }] }),
    }
    const next = linkGraphNode("id-1", { graphName: "combat_graph", nodeId: "88" }, dict)
    expect(next["id-1"].graphNodes).toHaveLength(2)
  })

  it("does not duplicate an identical ref", () => {
    const dict = {
      "id-1": makeEntry({ id: "id-1", canonicalName: "고블린 전사", graphNodes: [{ graphName: "combat_graph", nodeId: "42" }] }),
    }
    const next = linkGraphNode("id-1", { graphName: "combat_graph", nodeId: "42" }, dict)
    expect(next["id-1"].graphNodes).toHaveLength(1)
  })
})

describe("renameEntity", () => {
  it("updates canonicalName and moves the old name into aliases", () => {
    const dict = { "id-1": makeEntry({ id: "id-1", canonicalName: "고블린전사" }) }
    const next = renameEntity("id-1", "고블린 전사", dict)
    expect(next["id-1"].canonicalName).toBe("고블린 전사")
    expect(next["id-1"].aliases).toContain("고블린전사")
  })

  it("is a no-op when the new name equals the current name", () => {
    const dict = { "id-1": makeEntry({ id: "id-1", canonicalName: "고블린 전사" }) }
    const next = renameEntity("id-1", "고블린 전사", dict)
    expect(next).toBe(dict)
  })
})

describe("addAlias / removeAlias", () => {
  it("adds an alias", () => {
    const dict = { "id-1": makeEntry({ id: "id-1", canonicalName: "고블린 전사" }) }
    const next = addAlias("id-1", "Goblin Warrior", dict)
    expect(next["id-1"].aliases).toEqual(["Goblin Warrior"])
  })

  it("does not add a duplicate alias or the canonicalName itself", () => {
    const dict = { "id-1": makeEntry({ id: "id-1", canonicalName: "고블린 전사", aliases: ["Goblin Warrior"] }) }
    expect(addAlias("id-1", "Goblin Warrior", dict)["id-1"].aliases).toEqual(["Goblin Warrior"])
    expect(addAlias("id-1", "고블린 전사", dict)["id-1"].aliases).toEqual(["Goblin Warrior"])
  })

  it("removes an alias", () => {
    const dict = { "id-1": makeEntry({ id: "id-1", canonicalName: "고블린 전사", aliases: ["Goblin Warrior", "고블린전사"] }) }
    const next = removeAlias("id-1", "Goblin Warrior", dict)
    expect(next["id-1"].aliases).toEqual(["고블린전사"])
  })
})

describe("mergeEntities", () => {
  it("combines aliases, graphNodes, pagePaths and renames source's SQLite nodes", async () => {
    const dict: EntityDict = {
      source: makeEntry({
        id: "source",
        canonicalName: "고블린전사",
        aliases: ["Goblin"],
        pagePaths: ["db/a.md"],
        graphNodes: [{ graphName: "combat_graph", nodeId: "1" }],
      }),
      target: makeEntry({
        id: "target",
        canonicalName: "고블린 전사",
        aliases: [],
        pagePaths: ["db/b.md"],
        graphNodes: [{ graphName: "combat_graph", nodeId: "2" }],
      }),
    }

    const next = await mergeEntities("source", "target", dict, "/proj", "myproject")

    expect(next.source).toBeUndefined()
    expect(next.target.aliases.sort()).toEqual(["Goblin", "고블린전사"].sort())
    expect(next.target.pagePaths.sort()).toEqual(["db/a.md", "db/b.md"].sort())
    expect(next.target.graphNodes).toHaveLength(2)
    expect(mockUpdateNodeName).toHaveBeenCalledWith("myproject", "combat_graph", "1", "고블린 전사")
  })

  it("promotes source's primaryPagePath when target has none", async () => {
    const dict: EntityDict = {
      source: makeEntry({ id: "source", canonicalName: "a", primaryPagePath: "db/a.md" }),
      target: makeEntry({ id: "target", canonicalName: "b" }),
    }
    const next = await mergeEntities("source", "target", dict, "/proj", "myproject")
    expect(next.target.primaryPagePath).toBe("db/a.md")
  })

  it("is a no-op when either id is missing", async () => {
    const dict: EntityDict = { target: makeEntry({ id: "target", canonicalName: "b" }) }
    const next = await mergeEntities("missing", "target", dict, "/proj", "myproject")
    expect(next).toBe(dict)
  })
})

describe("splitEntity", () => {
  it("moves selected graph node refs into a new entity", () => {
    const dict: EntityDict = {
      "id-1": makeEntry({
        id: "id-1",
        canonicalName: "고블린 전사",
        graphNodes: [
          { graphName: "combat_graph", nodeId: "42" },
          { graphName: "combat_graph", nodeId: "88" },
          { graphName: "enemy_graph", nodeId: "17" },
        ],
      }),
    }

    const next = splitEntity(
      "id-1",
      "고블린 대장",
      [{ graphName: "enemy_graph", nodeId: "17" }],
      dict,
    )

    expect(next["id-1"].graphNodes).toHaveLength(2)
    const newEntries = Object.values(next).filter((e) => e.canonicalName === "고블린 대장")
    expect(newEntries).toHaveLength(1)
    expect(newEntries[0].graphNodes).toEqual([{ graphName: "enemy_graph", nodeId: "17" }])
  })
})

describe("buildEntityHintsForPrompt", () => {
  it("flattens canonicalName and aliases across the dictionary", () => {
    const dict: EntityDict = {
      "id-1": makeEntry({ id: "id-1", canonicalName: "고블린 전사", aliases: ["Goblin Warrior"] }),
      "id-2": makeEntry({ id: "id-2", canonicalName: "오크 전사" }),
    }
    const hints = buildEntityHintsForPrompt(dict)
    expect(hints).toBe("고블린 전사, Goblin Warrior, 오크 전사")
  })

  it("caps the list at 200 names", () => {
    const dict: EntityDict = {}
    for (let i = 0; i < 250; i++) {
      dict[`id-${i}`] = makeEntry({ id: `id-${i}`, canonicalName: `entity-${i}` })
    }
    const hints = buildEntityHintsForPrompt(dict)
    expect(hints.split(", ")).toHaveLength(200)
  })
})

describe("findEntityByGraphNode / unlinkGraphNode", () => {
  it("finds the owning entity for a graph node ref", () => {
    const dict: EntityDict = {
      "id-1": makeEntry({ id: "id-1", canonicalName: "고블린 전사", graphNodes: [{ graphName: "g", nodeId: "1" }] }),
    }
    expect(findEntityByGraphNode("g", "1", dict)?.id).toBe("id-1")
    expect(findEntityByGraphNode("g", "2", dict)).toBeUndefined()
  })

  it("removes the ref but keeps the entity when pagePaths remain", () => {
    const dict: EntityDict = {
      "id-1": makeEntry({
        id: "id-1",
        canonicalName: "고블린 전사",
        pagePaths: ["db/a.md"],
        graphNodes: [{ graphName: "g", nodeId: "1" }],
      }),
    }
    const next = unlinkGraphNode("g", "1", dict)
    expect(next["id-1"].graphNodes).toEqual([])
  })

  it("deletes the entity entirely when no refs or pagePaths remain", () => {
    const dict: EntityDict = {
      "id-1": makeEntry({ id: "id-1", canonicalName: "고블린 전사", graphNodes: [{ graphName: "g", nodeId: "1" }] }),
    }
    const next = unlinkGraphNode("g", "1", dict)
    expect(next["id-1"]).toBeUndefined()
  })
})
