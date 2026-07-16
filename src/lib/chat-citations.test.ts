import { describe, expect, it } from "vitest"
import { buildGraphPathsBlock, citationPrompt, finalizeCitations, issueCitationMap, locateCitation, type SectionCitationCandidate } from "./chat-citations"

const candidate: SectionCitationCandidate = {
  pageId: "page-00000000000000000000000000",
  sectionId: "sec-00000000000000000000000000",
  ordinal: 0,
  text: "Alpha evidence appears here. Alpha evidence appears here.",
  matchedRanges: [{ startOffset: 0, endOffset: 14 }],
  title: "결과 모달",
  headingText: "레이아웃",
  sectionType: "ui",
  evidenceState: "documented",
}

describe("structured chat citations", () => {
  it("persists only issued keys and deduplicates repeated markers", () => {
    const [entry] = issueCitationMap([candidate], () => "issued")
    const refs = finalizeCitations("Answer [[CIT:issued]] again [[CIT:issued]] and [[CIT:fake]]", [entry])
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({ pageId: candidate.pageId, sectionId: candidate.sectionId, quotedText: "Alpha evidence" })
  })

  it("does not invent an anchor when a candidate has no matched range", () => {
    const [entry] = issueCitationMap([{ ...candidate, matchedRanges: [] }], () => "empty")
    expect(finalizeCitations("[[CIT:empty]]", [entry])[0]).toMatchObject({ quotedText: "" })
  })

  it("does not issue two keys for duplicate section candidates", () => {
    expect(issueCitationMap([candidate, candidate], () => "once")).toHaveLength(1)
  })

  it("exposes semantic fields but no opaque IDs in the prompt", () => {
    const entries = issueCitationMap([candidate], () => "issued")
    const prompt = citationPrompt(entries)
    expect(prompt).toContain('title="결과 모달"')
    expect(prompt).toContain('section="레이아웃"')
    expect(prompt).toContain("type=ui")
    expect(prompt).not.toContain("page-")
    expect(prompt).not.toContain("sec-")
    expect(prompt).not.toContain("assertions=")
  })

  it("uses prefix/suffix to disambiguate an exact quote after a move or rename", () => {
    const citation = { citationId: "c", quotedText: "Alpha", prefix: "Before ", suffix: " after", startOffset: 99, endOffset: 104 }
    expect(locateCitation("Alpha then. Before Alpha after.", citation)).toEqual({ startOffset: 19, endOffset: 24 })
    expect(locateCitation("Alpha then.", citation)).toEqual({ startOffset: 0, endOffset: 5 })
  })
})

describe("graph paths block", () => {
  const entries = issueCitationMap([{ ...candidate, sectionId: "sec-A0000000000000000000000000" }], () => "keyA")

  it("returns empty string when there are no paths", () => {
    expect(buildGraphPathsBlock([], entries)).toBe("")
  })

  it("preserves direction: forward keeps the arrow, backward flips it", () => {
    const block = buildGraphPathsBlock([
      { edges: [
        { predicate: "DEPENDS_ON", forward: true, fromName: "A", toName: "B", evidenceSectionIds: [] },
        { predicate: "AFFECTS", forward: false, fromName: "C", toName: "B", evidenceSectionIds: [] },
      ] },
    ], entries)
    expect(block).toContain("A --DEPENDS_ON--> B")
    expect(block).toContain("C <--AFFECTS-- B")
  })

  it("annotates a path line with the [CIT:key] of an issued evidence section", () => {
    const block = buildGraphPathsBlock([
      { edges: [{ predicate: "DEPENDS_ON", forward: true, fromName: "A", toName: "B", evidenceSectionIds: ["sec-A0000000000000000000000000"] }] },
    ], entries)
    expect(block).toContain("[CIT:keyA]")
  })

  it("omits [CIT] when the evidence section was not issued a key", () => {
    const block = buildGraphPathsBlock([
      { edges: [{ predicate: "DEPENDS_ON", forward: true, fromName: "A", toName: "B", evidenceSectionIds: ["sec-unissued00000000000000000"] }] },
    ], entries)
    expect(block).toContain("A --DEPENDS_ON--> B")
    expect(block).not.toContain("[CIT:")
  })
})
