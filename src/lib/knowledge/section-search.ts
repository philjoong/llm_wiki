import { listDirectory, readFile } from "@/commands/fs"
import type { FileNode } from "@/types/wiki"
import { normalizePath } from "@/lib/path-utils"
import { parseMarkdownV2 } from "@/lib/markdown-v2"
import { getKnowledgeGraphSnapshot, getKnowledgePage, getKnowledgeSection, listKnowledgeGraphs, traverseKnowledgeGraph } from "@/commands/knowledge"
import { findMatchedRanges } from "@/lib/chat-citations"
import { searchByEmbedding } from "@/lib/embedding"
import type { EmbeddingConfig } from "@/stores/wiki-store"

/**
 * One hop of a traversal path (Step 03). `forward` records whether traversal
 * followed the assertion subject→object (true) or object→subject (false) so
 * the caller can render the arrow in the real influence direction. `evidenceSectionIds`
 * are the sections carrying this assertion's evidence — the caller pairs them
 * with issued [CIT:key] markers.
 */
export interface GraphPathEdge {
  assertionId: string
  predicate: string
  forward: boolean
  fromName: string
  toName: string
  evidenceSectionIds: string[]
}

/** A traversal hit rendered as an ordered sequence of edges. */
export interface GraphPath {
  edges: GraphPathEdge[]
}

/** The only document payload Chat may receive from retrieval. */
export interface SectionCandidate {
  pageId: string
  sectionId: string
  ordinal: number
  text: string
  matchedRanges: Array<{ startOffset: number; endOffset: number }>
  assertionIds: string[]
  evidenceState: "documented" | "manual" | "contradicted"
  graphPath: string[]
  /**
   * Human-readable display fields carried straight from the already-loaded
   * page/section records. The model reads these (not the opaque IDs) to judge
   * document relevance and citations.
   */
  title: string
  headingText: string
  pageType: string
  sectionType: string
  pageSummary?: string
  sectionSummary?: string
  /**
   * Semantic relevance score (Step 13) when this candidate was surfaced or
   * corroborated by embedding search. Used only as the primary ranking key
   * when any embedding candidate is present; undefined for lexical/promoted-
   * only candidates and for the entire embedding-off path.
   */
  embeddingScore?: number
}

function markdownFiles(nodes: FileNode[]): FileNode[] {
  return nodes.flatMap((node) => node.is_dir
    ? markdownFiles(node.children ?? [])
    : node.name.endsWith(".md") ? [node] : [])
}

/**
 * Resolve current v2 sections directly from their stable page/section IDs.
 * This intentionally has no path-result compatibility layer: stale files,
 * caches and non-v2 Markdown cannot become a Chat citation candidate.
 */
/**
 * Retrieval options layered on top of lexical section matching.
 * `graphExpand` is the traversal hop budget (§3.3): 0 / undefined keeps the
 * legacy label-only traversal and promotes nothing. `allowedPredicates`
 * restricts which edges traversal follows (Step 01).
 */
export interface SectionSearchOptions {
  graphExpand?: number
  allowedPredicates?: string[]
  /**
   * Extra traversal seed entity IDs (Step 04 `seed: llm_entities`). Merged with
   * the seeds derived from lexical candidate pages so entity-focused questions
   * reach relations even when no page lexically matched.
   */
  seedEntityIds?: string[]
  /**
   * Content-scope allowlist (Step 07). When either is provided, a candidate
   * survives only if its page is in `allowedPageIds` OR one of its evidence
   * assertions touches an entity in `allowedEntityIds`. Both undefined/empty →
   * no content filter (prior graph-only behavior). Applied to lexical AND
   * promoted candidates alike so a promoted section can't smuggle in
   * out-of-scope content.
   */
  allowedPageIds?: string[]
  allowedEntityIds?: string[]
  /**
   * Embedding search config (Step 13). When present and enabled, semantic
   * candidates are merged in and embedding score becomes the primary ranking
   * key. Absent / disabled / empty index → lexical-only behavior (regression
   * safe). chat-panel passes this only when the user's Embedding toggle is on.
   */
  embeddingConfig?: EmbeddingConfig
}

/** A promoted candidate is capped separately so it never displaces lexical hits. */
const PROMOTED_LIMIT = 8

/** Result of the paths-aware search: lexical+promoted candidates plus the
 * traversal paths (Step 03). `graphPaths` is empty unless `graphExpand > 0`. */
export interface SectionSearchResult {
  candidates: SectionCandidate[]
  graphPaths: GraphPath[]
}

/** Backward-compatible entry point: returns candidates only. */
export async function searchSectionCandidates(projectPath: string, query: string, allowedGraphIds?: readonly string[], options?: SectionSearchOptions): Promise<SectionCandidate[]> {
  return (await searchSectionCandidatesWithPaths(projectPath, query, allowedGraphIds, options)).candidates
}

export async function searchSectionCandidatesWithPaths(projectPath: string, query: string, allowedGraphIds?: readonly string[], options?: SectionSearchOptions): Promise<SectionSearchResult> {
  if (!query.trim()) return { candidates: [], graphPaths: [] }
  const root = normalizePath(projectPath)
  let files: FileNode[]
  try { files = markdownFiles(await listDirectory(`${root}/db`)) } catch { return { candidates: [], graphPaths: [] } }
  const candidates: SectionCandidate[] = []
  // Base candidate (without query-specific matchedRanges) for every parsed
  // section, so graph promotion can turn a traversal-reached section into a
  // full SectionCandidate without re-reading files.
  const sectionBase = new Map<string, Omit<SectionCandidate, "matchedRanges">>()
  // pageId → its section IDs in document order (Step 13). Embedding hits carry
  // only a page_id; this resolves them to the page's sections for the
  // chunk→section relocation (and first-section fallback).
  const pageSectionIds = new Map<string, string[]>()
  for (const file of files) {
    try {
      const parsed = parseMarkdownV2(await readFile(file.path))
      const page = await getKnowledgePage(root, parsed.page.page_id)
      if (!page || normalizePath(`${root}/${page.pagePath}`) !== normalizePath(file.path)) continue
      for (const section of parsed.sections) {
        const current = await getKnowledgeSection(root, section.sectionId)
        if (!current || current.pageId !== page.pageId) continue
        const base: Omit<SectionCandidate, "matchedRanges"> = {
          pageId: page.pageId,
          sectionId: section.sectionId,
          ordinal: current.ordinal,
          text: section.body,
          // Assertion provenance is added by the graph traversal provider.
          // Empty values are explicit rather than inferred from file paths.
          assertionIds: [],
          evidenceState: "documented",
          graphPath: [],
          // Display fields from records already in hand — no extra DB calls.
          title: page.title,
          pageType: page.pageType,
          pageSummary: page.summary,
          headingText: current.headingText,
          sectionType: current.sectionType,
          sectionSummary: current.summary,
        }
        sectionBase.set(section.sectionId, base)
        const forPage = pageSectionIds.get(page.pageId) ?? []
        forPage.push(section.sectionId)
        pageSectionIds.set(page.pageId, forPage)
        const matchedRanges = findMatchedRanges(section.body, query)
        if (!matchedRanges.length) continue
        candidates.push({ ...base, matchedRanges })
      }
    } catch { /* deleted, stale, or invalid documents are excluded */ }
  }
  const graphs=(await listKnowledgeGraphs(root)).filter((graph)=>!allowedGraphIds||allowedGraphIds.includes(graph.graphId))
  if(allowedGraphIds&&graphs.length===0)return { candidates: [], graphPaths: [] }
  const snapshots=await Promise.all(graphs.map((graph)=>getKnowledgeGraphSnapshot(root,graph.graphId)))
  const bySection=new Map<string,Array<{assertionId:string;evidenceState:SectionCandidate["evidenceState"];graphId:string}>>()
  for(const snapshot of snapshots)for(const assertion of snapshot.assertions)for(const evidence of assertion.evidence){if(!evidence.sectionId)continue;const values=bySection.get(evidence.sectionId)??[];values.push({assertionId:assertion.assertionId,evidenceState:assertion.evidenceState,graphId:snapshot.graph.graphId});bySection.set(evidence.sectionId,values)}
  // Evidence quote per (assertion, section), for reconstructing matchedRanges
  // on a promoted section.
  const quoteBySectionAssertion=new Map<string,string>()
  for(const snapshot of snapshots)for(const assertion of snapshot.assertions)for(const evidence of assertion.evidence){if(!evidence.sectionId||!evidence.quote)continue;const key=`${evidence.sectionId}:${assertion.assertionId}`;if(!quoteBySectionAssertion.has(key))quoteBySectionAssertion.set(key,evidence.quote)}
  // Assertion records and entity display names, for serializing traversal paths.
  const assertionById=new Map<string,{subjectEntityId:string;predicate:string;objectEntityId:string}>()
  for(const snapshot of snapshots)for(const assertion of snapshot.assertions)if(!assertionById.has(assertion.assertionId))assertionById.set(assertion.assertionId,{subjectEntityId:assertion.subjectEntityId,predicate:assertion.predicate,objectEntityId:assertion.objectEntityId})
  const entityNameById=new Map<string,string>()
  for(const snapshot of snapshots)for(const node of snapshot.nodes)if(!entityNameById.has(node.entity.entityId))entityNameById.set(node.entity.entityId,node.entity.canonicalName)
  // Content-scope filter (Step 07). Both lists absent/empty → no filter. A
  // section is in scope when its page is allowed, or any of its evidence
  // assertions touches an allowed entity (subject or object). Shared by lexical
  // and promotion so scope can't be bypassed via traversal promotion.
  const allowedPageIds=options?.allowedPageIds?.length?new Set(options.allowedPageIds):undefined
  const allowedEntityIds=options?.allowedEntityIds?.length?new Set(options.allowedEntityIds):undefined
  const contentFilterActive=Boolean(allowedPageIds||allowedEntityIds)
  const inContentScope=(pageId:string,sectionId:string):boolean=>{
    if(!contentFilterActive)return true
    if(allowedPageIds&&allowedPageIds.has(pageId))return true
    if(allowedEntityIds){
      for(const item of bySection.get(sectionId)??[]){
        const assertion=assertionById.get(item.assertionId)
        if(assertion&&(allowedEntityIds.has(assertion.subjectEntityId)||allowedEntityIds.has(assertion.objectEntityId)))return true
      }
    }
    return false
  }
  const graphExpand=options?.graphExpand??0
  const hits=await traverseKnowledgeGraph(root,{seedPageIds:Array.from(new Set(candidates.map((candidate)=>candidate.pageId))),seedEntityIds:options?.seedEntityIds,allowedGraphIds:graphs.map((graph)=>graph.graphId),maxCost:graphExpand>0?graphExpand:3,maxGraphSwitches:2,allowedPredicates:options?.allowedPredicates})
  const graphPathByAssertion=new Map<string,string[]>()
  for(const hit of hits)for(const step of hit.path)if(step.assertionId&&!graphPathByAssertion.has(step.assertionId))graphPathByAssertion.set(step.assertionId,hit.path.map((item)=>item.graphId))
  const lexical=candidates.flatMap((candidate)=>{const provenance=bySection.get(candidate.sectionId)??[];if(allowedGraphIds&&!provenance.length)return[];if(!inContentScope(candidate.pageId,candidate.sectionId))return[];const assertionIds=Array.from(new Set(provenance.map((item)=>item.assertionId)));const evidenceState:SectionCandidate["evidenceState"]=provenance.some((item)=>item.evidenceState==="contradicted")?"contradicted":provenance.some((item)=>item.evidenceState==="documented")?"documented":"manual";const graphPath=Array.from(new Set(assertionIds.flatMap((id)=>graphPathByAssertion.get(id)??provenance.filter((item)=>item.assertionId===id).map((item)=>item.graphId))));return[{...candidate,assertionIds,evidenceState,graphPath}]}).sort((a,b)=>a.ordinal-b.ordinal).slice(0,12)

  // Embedding merge (Step 13). Blends semantic candidates into a base set and,
  // when any embedding candidate exists, promotes embedding score to the
  // primary ranking key. Off / empty index / no config → returns `base`
  // untouched, so every prior (lexical-only) path is byte-for-byte unchanged.
  const mergeEmbedding = async (base: SectionCandidate[]): Promise<SectionCandidate[]> => {
    const cfg = options?.embeddingConfig
    if (!cfg?.enabled) return base
    let pages: Awaited<ReturnType<typeof searchByEmbedding>>
    try { pages = await searchByEmbedding(root, query, cfg, 12) } catch { return base }
    if (!pages.length) return base

    // Resolve each page hit to a section: relocate each matched chunk's text in
    // the page's section bodies (Step 02 quote-relocation pattern); on a miss,
    // fall back to the page's first section. Keep the best score per section.
    const scoreBySection = new Map<string, number>()
    const relocate = (pageId: string, chunkText: string): string | undefined => {
      const sectionIds = pageSectionIds.get(pageId)
      if (!sectionIds || !sectionIds.length) return undefined
      // A distinctive head slice of the chunk is enough to pin the section;
      // chunk bodies are verbatim substrings of the section they came from.
      const needle = chunkText.trim().slice(0, 120)
      if (needle.length >= 8) {
        for (const sectionId of sectionIds) {
          const body = sectionBase.get(sectionId)?.text ?? ""
          if (body.includes(needle)) return sectionId
        }
      }
      return undefined
    }
    for (const page of pages) {
      const sectionIds = pageSectionIds.get(page.id)
      if (!sectionIds || !sectionIds.length) continue
      const firstSectionId = sectionIds
        .map((id) => sectionBase.get(id))
        .filter((b): b is Omit<SectionCandidate, "matchedRanges"> => Boolean(b))
        .sort((a, b) => a.ordinal - b.ordinal)[0]?.sectionId
      const targets = new Set<string>()
      for (const chunk of page.matchedChunks ?? []) {
        const hit = relocate(page.id, chunk.text)
        if (hit) targets.add(hit)
      }
      if (targets.size === 0 && firstSectionId) targets.add(firstSectionId)
      for (const sectionId of targets) {
        const prev = scoreBySection.get(sectionId)
        if (prev === undefined || page.score > prev) scoreBySection.set(sectionId, page.score)
      }
    }
    if (scoreBySection.size === 0) return base

    // Attach the score to any base candidate that already covers the section;
    // build fresh candidates (subject to content scope) for the rest.
    const byId = new Map(base.map((c) => [c.sectionId, { ...c }]))
    for (const [sectionId, score] of scoreBySection) {
      const existing = byId.get(sectionId)
      if (existing) { existing.embeddingScore = score; continue }
      const baseSection = sectionBase.get(sectionId)
      if (!baseSection) continue
      if (!inContentScope(baseSection.pageId, sectionId)) continue
      byId.set(sectionId, { ...baseSection, matchedRanges: [], embeddingScore: score })
    }
    // Embedding present → score is the primary key (undefined sinks to the
    // bottom, preserving ordinal order among score-less candidates).
    return Array.from(byId.values()).sort((a, b) => {
      const sa = a.embeddingScore ?? -Infinity
      const sb = b.embeddingScore ?? -Infinity
      return sb === sa ? a.ordinal - b.ordinal : sb - sa
    }).slice(0, 12)
  }

  // Graph expansion: promote sections reached via traversal that lexical
  // matching missed. graphExpand<=0 keeps the legacy label-only behavior.
  if (graphExpand <= 0) return { candidates: await mergeEmbedding(lexical), graphPaths: [] }

  // Serialize each traversal hit into an ordered edge list (Step 03). Each
  // assertion step becomes one edge; `forward` is carried through so the
  // caller can flip the arrow to the real influence direction.
  const nameOf = (entityId: string): string => entityNameById.get(entityId) ?? entityId
  const sectionsForAssertion = (assertionId: string): string[] => {
    const out: string[] = []
    for (const [sectionId, provenance] of bySection) if (provenance.some((item) => item.assertionId === assertionId)) out.push(sectionId)
    return out
  }
  const graphPaths: GraphPath[] = []
  const seenPaths = new Set<string>()
  for (const hit of hits) {
    const edges: GraphPathEdge[] = []
    for (const step of hit.path) {
      if (!step.assertionId) continue
      const assertion = assertionById.get(step.assertionId)
      if (!assertion) continue
      const forward = step.forward !== false
      edges.push({
        assertionId: step.assertionId,
        predicate: step.predicate ?? assertion.predicate,
        forward,
        fromName: forward ? nameOf(assertion.subjectEntityId) : nameOf(assertion.objectEntityId),
        toName: forward ? nameOf(assertion.objectEntityId) : nameOf(assertion.subjectEntityId),
        evidenceSectionIds: sectionsForAssertion(step.assertionId),
      })
    }
    if (!edges.length) continue
    const key = edges.map((edge) => `${edge.assertionId}:${edge.forward}`).join("|")
    if (seenPaths.has(key)) continue
    seenPaths.add(key)
    graphPaths.push({ edges })
  }
  const lexicalSectionIds = new Set(lexical.map((candidate) => candidate.sectionId))
  const promoted: SectionCandidate[] = []
  const promotedSectionIds = new Set<string>()
  for (const hit of hits) {
    for (const step of hit.path) {
      if (!step.assertionId) continue
      // Every section carrying evidence for this traversed assertion.
      for (const [sectionId, provenance] of bySection) {
        if (!provenance.some((item) => item.assertionId === step.assertionId)) continue
        if (lexicalSectionIds.has(sectionId) || promotedSectionIds.has(sectionId)) continue
        const base = sectionBase.get(sectionId)
        if (!base) continue
        if (!inContentScope(base.pageId, sectionId)) continue
        promotedSectionIds.add(sectionId)
        const assertionIds = Array.from(new Set(provenance.map((item) => item.assertionId)))
        const evidenceState: SectionCandidate["evidenceState"] = provenance.some((item) => item.evidenceState === "contradicted") ? "contradicted" : provenance.some((item) => item.evidenceState === "documented") ? "documented" : "manual"
        const graphPath = Array.from(new Set(assertionIds.flatMap((id) => graphPathByAssertion.get(id) ?? provenance.filter((item) => item.assertionId === id).map((item) => item.graphId))))
        // Rebuild matchedRanges from the evidence quote; empty on miss —
        // citation works off the key alone, so a missing range is harmless.
        const quote = quoteBySectionAssertion.get(`${sectionId}:${step.assertionId}`)
        const at = quote ? base.text.indexOf(quote) : -1
        const matchedRanges = at >= 0 ? [{ startOffset: at, endOffset: at + quote!.length }] : []
        promoted.push({ ...base, matchedRanges, assertionIds, evidenceState, graphPath })
        if (promoted.length >= PROMOTED_LIMIT) break
      }
      if (promoted.length >= PROMOTED_LIMIT) break
    }
    if (promoted.length >= PROMOTED_LIMIT) break
  }
  return { candidates: await mergeEmbedding([...lexical, ...promoted]), graphPaths }
}
