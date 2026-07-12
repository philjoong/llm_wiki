import { describe, expect, it } from "vitest"
import { finalizeCitations, issueCitationMap, locateCitation, type SectionCitationCandidate } from "./chat-citations"

const candidate: SectionCitationCandidate = {
  pageId: "page-00000000000000000000000000",
  sectionId: "sec-00000000000000000000000000",
  ordinal: 0,
  text: "Alpha evidence appears here. Alpha evidence appears here.",
  matchedRanges: [{ startOffset: 0, endOffset: 14 }],
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

  it("uses prefix/suffix to disambiguate an exact quote after a move or rename", () => {
    const citation = { citationId: "c", quotedText: "Alpha", prefix: "Before ", suffix: " after", startOffset: 99, endOffset: 104 }
    expect(locateCitation("Alpha then. Before Alpha after.", citation)).toEqual({ startOffset: 19, endOffset: 24 })
    expect(locateCitation("Alpha then.", citation)).toEqual({ startOffset: 0, endOffset: 5 })
  })
})
