import type { StructuredCitation } from "@/stores/chat-store"

export interface SectionCitationCandidate {
  pageId: string
  sectionId: string
  ordinal: number
  text: string
  /** Ranges are UTF-16 offsets relative to text. */
  matchedRanges: Array<{ startOffset: number; endOffset: number }>
  assertionIds?: string[]
  evidenceState?: "documented" | "manual" | "contradicted"
  graphPath?: string[]
}

export interface CitationMapEntry extends SectionCitationCandidate {
  key: string
}

const MARKER = /\[\[CIT:([A-Za-z0-9_-]+)\]\]/g

export function issueCitationMap(candidates: SectionCitationCandidate[], random = defaultKey): CitationMapEntry[] {
  const used = new Set<string>()
  const sections = new Set<string>()
  return candidates.flatMap((candidate) => {
    const identity = `${candidate.pageId}:${candidate.sectionId}`
    if (sections.has(identity)) return []
    sections.add(identity)
    let key = random()
    while (used.has(key)) key = random()
    used.add(key)
    return [{ ...candidate, key }]
  })
}

function defaultKey(): string {
  const bytes = new Uint8Array(5)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

export function citationPrompt(entries: CitationMapEntry[]): string {
  if (!entries.length) return "(No relevant wiki sections were found.)"
  return entries.map((entry) =>
    `[CIT:${entry.key}] page_id=${entry.pageId} section_id=${entry.sectionId} assertions=${(entry.assertionIds??[]).join(",")} evidence=${entry.evidenceState??"none"} graph_path=${(entry.graphPath??[]).join("->")}\n${entry.text}`,
  ).join("\n\n---\n\n")
}

/** Only issued keys become persisted citations. Duplicate markers retain one anchor. */
export function finalizeCitations(answer: string, entries: CitationMapEntry[]): StructuredCitation[] {
  const byKey = new Map(entries.map((entry) => [entry.key, entry]))
  const seen = new Set<string>()
  const references: StructuredCitation[] = []
  for (const match of answer.matchAll(MARKER)) {
    const key = match[1]
    if (seen.has(key)) continue
    seen.add(key)
    const entry = byKey.get(key)
    if (!entry) {
      console.warn("Ignoring unissued chat citation key", key)
      continue
    }
    const range = entry.matchedRanges[0]
    const quotedText = range ? entry.text.slice(range.startOffset, range.endOffset) : ""
    references.push({
      citationId: `cit-${key}`,
      pageId: entry.pageId,
      sectionId: entry.sectionId,
      quotedText,
      ...(range ? {
        startOffset: range.startOffset,
        endOffset: range.endOffset,
        prefix: entry.text.slice(Math.max(0, range.startOffset - 48), range.startOffset),
        suffix: entry.text.slice(range.endOffset, range.endOffset + 48),
      } : {}),
    })
  }
  return references
}

export function findMatchedRanges(text: string, query: string): Array<{ startOffset: number; endOffset: number }> {
  const terms = query.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter((term) => term.length > 1)
  const ranges: Array<{ startOffset: number; endOffset: number }> = []
  const lower = text.toLocaleLowerCase()
  for (const term of terms) {
    const startOffset = lower.indexOf(term)
    if (startOffset >= 0) ranges.push({ startOffset, endOffset: startOffset + term.length })
  }
  return ranges.sort((a, b) => a.startOffset - b.startOffset).slice(0, 1)
}

export function locateCitation(text: string, citation: Pick<StructuredCitation, "quotedText" | "prefix" | "suffix" | "startOffset" | "endOffset">): { startOffset: number; endOffset: number } | null {
  if (citation.quotedText && citation.startOffset !== undefined && citation.endOffset !== undefined &&
      text.slice(citation.startOffset, citation.endOffset) === citation.quotedText) {
    return { startOffset: citation.startOffset, endOffset: citation.endOffset }
  }
  if (!citation.quotedText) return null
  const matches: number[] = []
  let at = text.indexOf(citation.quotedText)
  while (at >= 0) { matches.push(at); at = text.indexOf(citation.quotedText, at + 1) }
  if (matches.length === 1) return { startOffset: matches[0], endOffset: matches[0] + citation.quotedText.length }
  const matchingContext = matches.find((start) =>
    (!citation.prefix || text.slice(Math.max(0, start - citation.prefix.length), start) === citation.prefix) &&
    (!citation.suffix || text.slice(start + citation.quotedText.length, start + citation.quotedText.length + citation.suffix.length) === citation.suffix),
  )
  return matchingContext === undefined ? null : { startOffset: matchingContext, endOffset: matchingContext + citation.quotedText.length }
}
