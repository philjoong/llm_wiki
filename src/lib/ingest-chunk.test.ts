/**
 * Tests for the source-content chunker used by autoIngest.
 *
 * Big sources used to be hard-truncated at 50000 chars; the LLM then
 * had to emit FILE blocks for the whole document in one round, which
 * regularly hit max_tokens mid-block. The chunker splits on markdown
 * structural boundaries so each LLM round is small enough to finish.
 */
import { describe, it, expect } from "vitest"
import { chunkSourceContent, normalizeEntityName } from "./ingest"

describe("chunkSourceContent", () => {
  it("returns a single chunk when content fits", () => {
    const small = "# Title\n\nSome body text.\n"
    expect(chunkSourceContent(small, 1000)).toEqual([small])
  })

  it("preserves the full content across chunks (no data loss)", () => {
    const sections = Array.from({ length: 8 }, (_, i) =>
      `## Section ${i}\n\n${"x".repeat(200)}\n`,
    ).join("")
    const chunks = chunkSourceContent(sections, 500)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join("")).toBe(sections)
  })

  it("breaks on level-2 headers when possible", () => {
    const text =
      "# Doc\n\nIntro paragraph.\n" +
      `## A\n\n${"a".repeat(400)}\n` +
      `## B\n\n${"b".repeat(400)}\n` +
      `## C\n\n${"c".repeat(400)}\n`
    const chunks = chunkSourceContent(text, 600)
    // Every chunk after the first should start at a header boundary
    // (the splitter re-attaches `\n## ` to the leading edge).
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].startsWith("\n## ")).toBe(true)
    }
  })

  it("falls back to level-3 headers when level-2 sections are too big", () => {
    const text =
      `## Big\n` +
      `### Sub A\n${"a".repeat(400)}\n` +
      `### Sub B\n${"b".repeat(400)}\n` +
      `### Sub C\n${"c".repeat(400)}\n`
    const chunks = chunkSourceContent(text, 500)
    expect(chunks.length).toBeGreaterThan(1)
    // At least one chunk should start with a level-3 boundary, since
    // level-2 alone couldn't satisfy the budget.
    expect(chunks.some((c) => c.includes("### Sub"))).toBe(true)
    expect(chunks.join("")).toBe(text)
  })

  it("falls back to paragraph splits when there are no headers", () => {
    const text = Array.from({ length: 10 }, (_, i) =>
      `Paragraph ${i} ${"y".repeat(200)}`,
    ).join("\n\n")
    const chunks = chunkSourceContent(text, 500)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join("")).toBe(text)
  })

  it("hard-splits a single unbroken run as a last resort", () => {
    // No newlines, no spaces — nothing to break on. Must still chunk
    // rather than throw or return one giant string.
    const text = "z".repeat(2500)
    const chunks = chunkSourceContent(text, 1000)
    expect(chunks.length).toBe(3)
    expect(chunks[0].length).toBe(1000)
    expect(chunks[1].length).toBe(1000)
    expect(chunks[2].length).toBe(500)
    expect(chunks.join("")).toBe(text)
  })

  it("each chunk is ≤ maxChars when there's any breakable boundary", () => {
    const text = Array.from({ length: 20 }, (_, i) =>
      `## Section ${i}\n\n${"w".repeat(300)}\n`,
    ).join("")
    const limit = 800
    const chunks = chunkSourceContent(text, limit)
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(limit)
    }
  })

  it("doesn't drop or duplicate header text when re-attaching the separator", () => {
    const text =
      `## Alpha\nbody-a\n` +
      `## Beta\nbody-b\n` +
      `## Gamma\nbody-c\n`
    const chunks = chunkSourceContent(text, 20)
    expect(chunks.join("")).toBe(text)
    // Each header appears exactly once across all chunks.
    const joined = chunks.join("")
    expect((joined.match(/## Alpha/g) ?? []).length).toBe(1)
    expect((joined.match(/## Beta/g) ?? []).length).toBe(1)
    expect((joined.match(/## Gamma/g) ?? []).length).toBe(1)
  })

  it("handles empty input", () => {
    expect(chunkSourceContent("", 1000)).toEqual([""])
  })
})

describe("normalizeEntityName", () => {
  it("strips a trailing parenthetical qualifier", () => {
    expect(normalizeEntityName("진명왕의 집행검(무기)")).toBe("진명왕의 집행검")
    expect(normalizeEntityName("Sword (weapon)")).toBe("Sword")
  })

  it("strips a full-width parenthetical qualifier", () => {
    expect(normalizeEntityName("집행검（무기）")).toBe("집행검")
  })

  it("collapses internal whitespace and trims", () => {
    expect(normalizeEntityName("  진명왕의   집행검  ")).toBe("진명왕의 집행검")
  })

  it("leaves a name without qualifiers unchanged", () => {
    expect(normalizeEntityName("진명왕의 집행검")).toBe("진명왕의 집행검")
  })

  it("only removes a trailing parenthetical, not a leading or mid one", () => {
    expect(normalizeEntityName("(전설) 집행검")).toBe("(전설) 집행검")
  })
})
