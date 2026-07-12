import { listDirectory, readFile } from "@/commands/fs"
import type { FileNode } from "@/types/wiki"
import { normalizePath } from "@/lib/path-utils"
import { parseMarkdownV2 } from "@/lib/markdown-v2"
import { getKnowledgeGraphSnapshot, getKnowledgePage, getKnowledgeSection, listKnowledgeGraphs, traverseKnowledgeGraph } from "@/commands/knowledge"
import { findMatchedRanges } from "@/lib/chat-citations"

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
export async function searchSectionCandidates(projectPath: string, query: string, graphPrefix?: string): Promise<SectionCandidate[]> {
  if (!query.trim()) return []
  const root = normalizePath(projectPath)
  let files: FileNode[]
  try { files = markdownFiles(await listDirectory(`${root}/db`)) } catch { return [] }
  const candidates: SectionCandidate[] = []
  for (const file of files) {
    try {
      const parsed = parseMarkdownV2(await readFile(file.path))
      const page = await getKnowledgePage(root, parsed.page.page_id)
      if (!page || normalizePath(`${root}/${page.pagePath}`) !== normalizePath(file.path)) continue
      for (const section of parsed.sections) {
        const current = await getKnowledgeSection(root, section.sectionId)
        if (!current || current.pageId !== page.pageId) continue
        const matchedRanges = findMatchedRanges(section.body, query)
        if (!matchedRanges.length) continue
        candidates.push({
          pageId: page.pageId,
          sectionId: section.sectionId,
          ordinal: current.ordinal,
          text: section.body,
          matchedRanges,
          // Assertion provenance is added by the graph traversal provider.
          // Empty values are explicit rather than inferred from file paths.
          assertionIds: [],
          evidenceState: "documented",
          graphPath: [],
        })
      }
    } catch { /* deleted, stale, or invalid documents are excluded */ }
  }
  const graphs=(await listKnowledgeGraphs(root)).filter((graph)=>!graphPrefix||graph.graphName.startsWith(graphPrefix))
  if(graphPrefix&&graphs.length===0)return []
  const snapshots=await Promise.all(graphs.map((graph)=>getKnowledgeGraphSnapshot(root,graph.graphId)))
  const bySection=new Map<string,Array<{assertionId:string;evidenceState:SectionCandidate["evidenceState"];graphId:string}>>()
  for(const snapshot of snapshots)for(const assertion of snapshot.assertions)for(const evidence of assertion.evidence){if(!evidence.sectionId)continue;const values=bySection.get(evidence.sectionId)??[];values.push({assertionId:assertion.assertionId,evidenceState:assertion.evidenceState,graphId:snapshot.graph.graphId});bySection.set(evidence.sectionId,values)}
  const hits=await traverseKnowledgeGraph(root,{seedPageIds:Array.from(new Set(candidates.map((candidate)=>candidate.pageId))),allowedGraphIds:graphs.map((graph)=>graph.graphId),maxCost:3,maxGraphSwitches:2})
  const graphPathByAssertion=new Map<string,string[]>()
  for(const hit of hits)for(const step of hit.path)if(step.assertionId&&!graphPathByAssertion.has(step.assertionId))graphPathByAssertion.set(step.assertionId,hit.path.map((item)=>item.graphId))
  return candidates.flatMap((candidate)=>{const provenance=bySection.get(candidate.sectionId)??[];if(graphPrefix&&!provenance.length)return[];const assertionIds=Array.from(new Set(provenance.map((item)=>item.assertionId)));const evidenceState:SectionCandidate["evidenceState"]=provenance.some((item)=>item.evidenceState==="contradicted")?"contradicted":provenance.some((item)=>item.evidenceState==="documented")?"documented":"manual";const graphPath=Array.from(new Set(assertionIds.flatMap((id)=>graphPathByAssertion.get(id)??provenance.filter((item)=>item.assertionId===id).map((item)=>item.graphId))));return[{...candidate,assertionIds,evidenceState,graphPath}]}).sort((a,b)=>a.ordinal-b.ordinal).slice(0,12)
}
