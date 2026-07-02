import { describe, it, expect } from "vitest"
import { buildEntityHintsForPrompt, type EntityDict, type EntityEntry } from "@/lib/entity-dict"
import { approveTagLink, fuzzyCandidates, linkExactTags } from "./entity-links"

function makeEntry(id: string, canonicalName: string, aliases: string[] = []): EntityEntry {
  return { id, canonicalName, aliases, pagePaths: [], graphNodes: [] }
}

const DICT: EntityDict = {
  "e-fireball": makeEntry("e-fireball", "파이어볼", ["화염구"]),
  "e-cooldown": makeEntry("e-cooldown", "쿨타임"),
}

describe("linkExactTags", () => {
  it("auto-links tags that exactly match a canonical name or alias", () => {
    const tags = linkExactTags([{ tag: "파이어볼" }, { tag: "화염구" }], DICT)
    expect(tags).toEqual([
      { tag: "파이어볼", entityId: "e-fireball" },
      { tag: "화염구", entityId: "e-fireball" },
    ])
  })

  it("leaves fuzzy-only and unmatched tags unlinked", () => {
    const tags = linkExactTags([{ tag: "쿨타임 존재" }, { tag: "마나 소모" }], DICT)
    expect(tags).toEqual([{ tag: "쿨타임 존재" }, { tag: "마나 소모" }])
  })

  it("does not overwrite an existing link", () => {
    const tags = linkExactTags([{ tag: "파이어볼", entityId: "e-cooldown" }], DICT)
    expect(tags[0].entityId).toBe("e-cooldown")
  })
})

describe("fuzzyCandidates", () => {
  it("returns fuzzy candidates for an unlinked tag", () => {
    const candidates = fuzzyCandidates({ tag: "쿨타임 존재" }, DICT)
    expect(candidates.map((c) => c.entry.id)).toEqual(["e-cooldown"])
    expect(candidates[0].match).toBe("fuzzy")
  })

  it("returns nothing for linked or unrelated tags", () => {
    expect(fuzzyCandidates({ tag: "쿨타임 존재", entityId: "e-cooldown" }, DICT)).toEqual([])
    expect(fuzzyCandidates({ tag: "PvP 영향 있음" }, DICT)).toEqual([])
  })
})

describe("approveTagLink", () => {
  it("links the tag and records it as an alias on the entity", () => {
    const { tags, dict } = approveTagLink([{ tag: "쿨타임 존재" }], "쿨타임 존재", "e-cooldown", DICT)
    expect(tags).toEqual([{ tag: "쿨타임 존재", entityId: "e-cooldown" }])
    expect(dict["e-cooldown"].aliases).toContain("쿨타임 존재")
    // other entries and the input dict are untouched
    expect(dict["e-fireball"]).toBe(DICT["e-fireball"])
    expect(DICT["e-cooldown"].aliases).toEqual([])
    // the approved alias feeds future prompt hints (ingest + abstraction)
    expect(buildEntityHintsForPrompt(dict)).toContain("쿨타임 존재")
  })

  it("does not duplicate an existing alias", () => {
    const once = approveTagLink([{ tag: "화염구" }], "화염구", "e-fireball", DICT)
    expect(once.dict["e-fireball"].aliases).toEqual(["화염구"])
  })
})
