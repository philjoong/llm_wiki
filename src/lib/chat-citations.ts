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
  /**
   * Human-readable display fields shown to the model in place of opaque IDs.
   * Optional so older/synthetic candidates without them still build a prompt.
   */
  title?: string
  headingText?: string
  sectionType?: string
  pageSummary?: string
  sectionSummary?: string
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
  // Header carries human-readable meaning (title/section/type/evidence), never
  // opaque page/section/assertion IDs — the model only needs the [CIT:key] to
  // cite, and finalizeCitations maps that key back to IDs deterministically.
  return entries.map((entry) => {
    const parts = [`[CIT:${entry.key}]`]
    if (entry.title) parts.push(`title="${entry.title}"`)
    if (entry.headingText) parts.push(`section="${entry.headingText}"`)
    if (entry.sectionType) parts.push(`type=${entry.sectionType}`)
    if (entry.evidenceState) parts.push(`evidence=${entry.evidenceState}`)
    const summary = entry.sectionSummary ?? entry.pageSummary
    const summaryLine = summary ? `\nsummary: ${summary}` : ""
    return `${parts.join(" ")}${summaryLine}\n${entry.text}`
  }).join("\n\n---\n\n")
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

/**
 * Direction- and predicate-preserving serialization of a single traversal edge.
 * `forward:false` flips the arrow so the LLM reads the real influence direction:
 *   forward  → `A --PRED--> B`
 *   backward → `B <--PRED-- A`
 */
function serializeEdge(edge: { predicate: string; forward: boolean; fromName: string; toName: string }): string {
  return edge.forward
    ? `${edge.fromName} --${edge.predicate}--> ${edge.toName}`
    : `${edge.fromName} <--${edge.predicate}-- ${edge.toName}`
}

/**
 * Build the "Graph Paths" prompt block (Step 03). Each path line is annotated
 * with the [CIT:key] of any evidence section that made it into the issued
 * citation map — so the path is a citable source, not the "uncitable second
 * source" the original chat-panel comment warned against. Returns "" when
 * there are no paths, so the caller can keep the existing empty-state rules.
 */
export function buildGraphPathsBlock(
  paths: Array<{ edges: Array<{ predicate: string; forward: boolean; fromName: string; toName: string; evidenceSectionIds: string[] }> }>,
  entries: CitationMapEntry[],
): string {
  if (!paths.length) return ""
  const keyBySection = new Map(entries.map((entry) => [entry.sectionId, entry.key]))
  const lines = paths.flatMap((path) => {
    if (!path.edges.length) return []
    const chain = path.edges.map(serializeEdge).join("  ")
    const keys = Array.from(new Set(
      path.edges.flatMap((edge) => edge.evidenceSectionIds.map((id) => keyBySection.get(id)).filter((key): key is string => Boolean(key))),
    ))
    const cites = keys.map((key) => `[CIT:${key}]`).join(" ")
    return [cites ? `- ${chain} ${cites}` : `- ${chain}`]
  })
  if (!lines.length) return ""
  return ["## Graph Paths", "Relationship paths found in the knowledge graph (arrow shows influence direction):", ...lines].join("\n")
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
