import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/commands/fs",()=>({listDirectory:vi.fn(),readFile:vi.fn()}))
vi.mock("@/commands/knowledge",()=>({getKnowledgePage:vi.fn(),getKnowledgeSection:vi.fn(),listKnowledgeGraphs:vi.fn(),getKnowledgeGraphSnapshot:vi.fn(),traverseKnowledgeGraph:vi.fn()}))
vi.mock("@/lib/embedding",()=>({searchByEmbedding:vi.fn()}))
import { listDirectory, readFile } from "@/commands/fs"
import { getKnowledgeGraphSnapshot,getKnowledgePage,getKnowledgeSection,listKnowledgeGraphs,traverseKnowledgeGraph } from "@/commands/knowledge"
import { searchByEmbedding } from "@/lib/embedding"
import { searchSectionCandidates } from "./section-search"
import { parseMarkdownV2 } from "@/lib/markdown-v2"

const embeddingCfg={source:"external" as const,enabled:true,endpoint:"http://x",apiKey:"",model:"m"}

const pageId="page-01ARZ3NDEKTSV4RRFFQ69G5FAV"
const sectionId="sec-01ARZ3NDEKTSV4RRFFQ69G5FAW"
const sectionId2="sec-01ARZ3NDEKTSV4RRFFQ69G5FAX"
const markdown=`---\nschema: llm-wiki/page/v2\npage_id: ${pageId}\ntitle: Test\npage_type: guide\nsummary: Test facts\nsections:\n  ${sectionId}:\n    section_type: overview\n---\n# Test\n## Facts {#${sectionId}}\nAlpha depends on Beta.\n`
// Two-section fixture: only the first section lexically mentions "Alpha".
const markdown2=`---\nschema: llm-wiki/page/v2\npage_id: ${pageId}\ntitle: Test\npage_type: guide\nsummary: Test facts\nsections:\n  ${sectionId}:\n    section_type: overview\n  ${sectionId2}:\n    section_type: behavior\n---\n# Test\n## Facts {#${sectionId}}\nAlpha depends on Beta.\n## Details {#${sectionId2}}\nBeta owns Gamma.\n`
const graph={graphId:"graph-allowed",graphName:"casemap_main",purpose:"test"}
const assertion={assertionId:"assert-1",graphId:graph.graphId,subjectEntityId:"ent-a",predicate:"DEPENDS_ON",objectEntityId:"ent-b",origin:"ingest" as const,status:"active" as const,createdAt:"now",evidenceState:"documented" as const,evidence:[{evidenceId:"ev-1",assertionId:"assert-1",pageId,sectionId,evidenceType:"supports" as const}]}

beforeEach(()=>{
 vi.mocked(listDirectory).mockResolvedValue([{name:"test.md",path:"/project/db/test.md",is_dir:false}])
 vi.mocked(readFile).mockResolvedValue(markdown)
 vi.mocked(getKnowledgePage).mockResolvedValue({pageId,pagePath:"db/test.md",title:"Test",pageType:"guide",updatedAt:"now"})
 vi.mocked(getKnowledgeSection).mockImplementation(async(_p,id)=>id===sectionId2
   ?{sectionId:sectionId2,pageId,headingLevel:2,headingText:"Details",sectionType:"behavior",ordinal:1}
   :{sectionId,pageId,headingLevel:2,headingText:"Facts",sectionType:"overview",ordinal:0})
 vi.mocked(listKnowledgeGraphs).mockResolvedValue([graph,{graphId:"graph-out",graphName:"persona_main",purpose:"out"}])
 vi.mocked(getKnowledgeGraphSnapshot).mockResolvedValue({graph,nodes:[],assertions:[assertion]})
 vi.mocked(traverseKnowledgeGraph).mockResolvedValue([{entityId:"ent-b",assertionId:"assert-1",cost:1,graphSwitches:0,path:[{kind:"assertion",graphId:graph.graphId,entityId:"ent-b",assertionId:"assert-1",predicate:"DEPENDS_ON",forward:true}]}])
 vi.mocked(searchByEmbedding).mockResolvedValue([])
})

describe("section candidate graph scope",()=>{
 it("passes prefix-resolved graph IDs to traversal and preserves provenance",async()=>{
  expect(parseMarkdownV2(markdown).sections[0].sectionId).toBe(sectionId)
  const result=await searchSectionCandidates("/project","Alpha",[graph.graphId])
  expect(traverseKnowledgeGraph).toHaveBeenCalledWith("/project",expect.objectContaining({allowedGraphIds:[graph.graphId]}))
  expect(result[0]).toMatchObject({pageId,sectionId,assertionIds:["assert-1"],evidenceState:"documented",graphPath:[graph.graphId],title:"Test",pageType:"guide",headingText:"Facts",sectionType:"overview"})
 })
 it("does not issue a scoped candidate for a section without allowed evidence",async()=>{
  vi.mocked(getKnowledgeGraphSnapshot).mockResolvedValue({graph,nodes:[],assertions:[]})
  expect(await searchSectionCandidates("/project","Alpha",[graph.graphId])).toEqual([])
 })
})

describe("content scope filter (Step 07)",()=>{
 it("drops a lexical candidate whose page is not in allowedPageIds",async()=>{
  const result=await searchSectionCandidates("/project","Alpha",[graph.graphId],{allowedPageIds:["page-other"]})
  expect(result).toEqual([])
 })
 it("keeps a lexical candidate whose page is in allowedPageIds",async()=>{
  const result=await searchSectionCandidates("/project","Alpha",[graph.graphId],{allowedPageIds:[pageId]})
  expect(result.some((c)=>c.sectionId===sectionId)).toBe(true)
 })
 it("keeps a candidate via allowedEntityIds when its assertion touches an allowed entity",async()=>{
  // assert-1 touches ent-a/ent-b; page is not allowed but the entity is.
  const result=await searchSectionCandidates("/project","Alpha",[graph.graphId],{allowedPageIds:["page-other"],allowedEntityIds:["ent-b"]})
  expect(result.some((c)=>c.sectionId===sectionId)).toBe(true)
 })
 it("drops a candidate when neither page nor entity is allowed",async()=>{
  const result=await searchSectionCandidates("/project","Alpha",[graph.graphId],{allowedEntityIds:["ent-zzz"]})
  expect(result).toEqual([])
 })
 it("does not filter when both scope lists are empty (regression)",async()=>{
  const result=await searchSectionCandidates("/project","Alpha",[graph.graphId],{allowedPageIds:[],allowedEntityIds:[]})
  expect(result.some((c)=>c.sectionId===sectionId)).toBe(true)
 })
 it("filters promoted candidates by content scope too",async()=>{
  // Promote section2 via traversal, then scope it out by page/entity.
  const promotedAssertion={...assertion,evidence:[{evidenceId:"ev-2",assertionId:"assert-1",pageId,sectionId:sectionId2,quote:"Beta owns Gamma.",evidenceType:"supports" as const}]}
  vi.mocked(readFile).mockResolvedValue(markdown2)
  vi.mocked(getKnowledgeGraphSnapshot).mockResolvedValue({graph,nodes:[],assertions:[promotedAssertion]})
  const scopedOut=await searchSectionCandidates("/project","Alpha",[graph.graphId],{graphExpand:3,allowedPageIds:["page-other"],allowedEntityIds:["ent-zzz"]})
  expect(scopedOut.some((c)=>c.sectionId===sectionId2)).toBe(false)
 })
})

describe("graph expansion promotion",()=>{
 it("promotes a traversal-reached section that lexical matching missed",async()=>{
  // Evidence for the traversed assertion points at the non-matching second section.
  const promotedAssertion={...assertion,evidence:[{evidenceId:"ev-2",assertionId:"assert-1",pageId,sectionId:sectionId2,quote:"Beta owns Gamma.",evidenceType:"supports" as const}]}
  vi.mocked(readFile).mockResolvedValue(markdown2)
  vi.mocked(getKnowledgeGraphSnapshot).mockResolvedValue({graph,nodes:[],assertions:[promotedAssertion]})
  const result=await searchSectionCandidates("/project","Alpha",undefined,{graphExpand:3})
  const promoted=result.find((c)=>c.sectionId===sectionId2)
  expect(promoted).toBeDefined()
  expect(promoted).toMatchObject({sectionId:sectionId2,assertionIds:["assert-1"],headingText:"Details"})
  // Quote re-located in section body → matchedRanges populated.
  expect(promoted!.matchedRanges.length).toBe(1)
 })
 it("does not promote when graphExpand is 0 or unset (regression)",async()=>{
  vi.mocked(readFile).mockResolvedValue(markdown2)
  const promotedAssertion={...assertion,evidence:[{evidenceId:"ev-2",assertionId:"assert-1",pageId,sectionId:sectionId2,quote:"Beta owns Gamma.",evidenceType:"supports" as const}]}
  vi.mocked(getKnowledgeGraphSnapshot).mockResolvedValue({graph,nodes:[],assertions:[promotedAssertion]})
  const unset=await searchSectionCandidates("/project","Alpha")
  expect(unset.some((c)=>c.sectionId===sectionId2)).toBe(false)
  const zero=await searchSectionCandidates("/project","Alpha",undefined,{graphExpand:0})
  expect(zero.some((c)=>c.sectionId===sectionId2)).toBe(false)
 })
 it("caps promoted candidates at 8 without displacing lexical hits",async()=>{
  // 10 sections, none matching "Alpha", each evidence for a distinct traversed assertion.
  // Section IDs must be ULID-shaped (26 Crockford base32 chars); vary the last.
  const suffix="0123456789"
  const ids=Array.from({length:10},(_,i)=>`sec-01ARZ3NDEKTSV4RRFFQ69G5G0${suffix[i]}`)
  const sectionYaml=ids.map((id)=>`  ${id}:\n    section_type: behavior`).join("\n")
  const bodies=ids.map((id)=>`## Extra ${id} {#${id}}\nGamma relates to node ${id}.`).join("\n")
  const md=`---\nschema: llm-wiki/page/v2\npage_id: ${pageId}\ntitle: Test\npage_type: guide\nsummary: s\nsections:\n  ${sectionId}:\n    section_type: overview\n${sectionYaml}\n---\n# Test\n## Facts {#${sectionId}}\nAlpha depends on Beta.\n${bodies}\n`
  vi.mocked(readFile).mockResolvedValue(md)
  vi.mocked(getKnowledgeSection).mockImplementation(async(_p,id)=>id===sectionId
    ?{sectionId,pageId,headingLevel:2,headingText:"Facts",sectionType:"overview",ordinal:0}
    :{sectionId:id,pageId,headingLevel:2,headingText:`Extra ${id}`,sectionType:"behavior",ordinal:1})
  const assertions=ids.map((id,i)=>({assertionId:`a-${i}`,graphId:graph.graphId,subjectEntityId:"ent-a",predicate:"DEPENDS_ON",objectEntityId:`ent-${i}`,origin:"ingest" as const,status:"active" as const,createdAt:"now",evidenceState:"documented" as const,evidence:[{evidenceId:`ev-${i}`,assertionId:`a-${i}`,pageId,sectionId:id,quote:`node ${id}`,evidenceType:"supports" as const}]}))
  vi.mocked(getKnowledgeGraphSnapshot).mockResolvedValue({graph,nodes:[],assertions})
  vi.mocked(traverseKnowledgeGraph).mockResolvedValue(assertions.map((a,i)=>({entityId:`ent-${i}`,assertionId:a.assertionId,cost:1,graphSwitches:0,path:[{kind:"assertion" as const,graphId:graph.graphId,entityId:`ent-${i}`,assertionId:a.assertionId,predicate:"DEPENDS_ON",forward:true}]})))
  const result=await searchSectionCandidates("/project","Alpha",undefined,{graphExpand:3})
  const promotedCount=result.filter((c)=>ids.includes(c.sectionId)).length
  expect(promotedCount).toBe(8)
  // Lexical "Facts" hit still present.
  expect(result.some((c)=>c.sectionId===sectionId)).toBe(true)
 })
})

describe("embedding merge (Step 13)",()=>{
 it("does not call searchByEmbedding and keeps lexical order when no config is given (regression)",async()=>{
  const result=await searchSectionCandidates("/project","Alpha",[graph.graphId])
  expect(searchByEmbedding).not.toHaveBeenCalled()
  expect(result[0].sectionId).toBe(sectionId)
  expect(result[0].embeddingScore).toBeUndefined()
 })
 it("does not call searchByEmbedding when the config is disabled (regression)",async()=>{
  await searchSectionCandidates("/project","Alpha",[graph.graphId],{embeddingConfig:{...embeddingCfg,enabled:false}})
  expect(searchByEmbedding).not.toHaveBeenCalled()
 })
 it("surfaces a section lexical missed, relocated from the matched chunk text",async()=>{
  // "Alpha" lexically matches only section 1; embedding returns the page with a
  // chunk quoting section 2's body, so section 2 is relocated and merged in.
  vi.mocked(readFile).mockResolvedValue(markdown2)
  vi.mocked(searchByEmbedding).mockResolvedValue([{id:pageId,score:0.9,matchedChunks:[{text:"Beta owns Gamma.",headingPath:"Details",score:0.9}]}])
  const result=await searchSectionCandidates("/project","Alpha",undefined,{embeddingConfig:embeddingCfg})
  const merged=result.find((c)=>c.sectionId===sectionId2)
  expect(merged).toBeDefined()
  expect(merged!.embeddingScore).toBe(0.9)
  // Embedding score is the primary key: the semantic hit outranks the
  // lower-ordinal lexical hit that has no score.
  expect(result[0].sectionId).toBe(sectionId2)
 })
 it("attaches the score to an existing lexical candidate rather than duplicating it",async()=>{
  vi.mocked(readFile).mockResolvedValue(markdown2)
  vi.mocked(searchByEmbedding).mockResolvedValue([{id:pageId,score:0.8,matchedChunks:[{text:"Alpha depends on Beta.",headingPath:"Facts",score:0.8}]}])
  const result=await searchSectionCandidates("/project","Alpha",undefined,{embeddingConfig:embeddingCfg})
  const forSection1=result.filter((c)=>c.sectionId===sectionId)
  expect(forSection1).toHaveLength(1)
  expect(forSection1[0].embeddingScore).toBe(0.8)
 })
 it("falls back to the page's first section when no chunk text relocates",async()=>{
  vi.mocked(readFile).mockResolvedValue(markdown2)
  // Chunk text matches no section body → first-section (ordinal 0) fallback.
  vi.mocked(searchByEmbedding).mockResolvedValue([{id:pageId,score:0.7,matchedChunks:[{text:"totally unrelated text not in any body",headingPath:"x",score:0.7}]}])
  const result=await searchSectionCandidates("/project","Beta",undefined,{embeddingConfig:embeddingCfg})
  const first=result.find((c)=>c.embeddingScore===0.7)
  expect(first).toBeDefined()
  expect(first!.sectionId).toBe(sectionId)
 })
 it("orders multiple embedding hits by descending score",async()=>{
  vi.mocked(readFile).mockResolvedValue(markdown2)
  vi.mocked(searchByEmbedding).mockResolvedValue([
   {id:pageId,score:0.4,matchedChunks:[{text:"Alpha depends on Beta.",headingPath:"Facts",score:0.4}]},
   {id:pageId,score:0.95,matchedChunks:[{text:"Beta owns Gamma.",headingPath:"Details",score:0.95}]},
  ])
  const result=await searchSectionCandidates("/project","Alpha",undefined,{embeddingConfig:embeddingCfg})
  expect(result[0].sectionId).toBe(sectionId2)
  expect(result[0].embeddingScore).toBe(0.95)
  expect(result[1].sectionId).toBe(sectionId)
  expect(result[1].embeddingScore).toBe(0.4)
 })
 it("falls back to lexical when searchByEmbedding throws",async()=>{
  vi.mocked(searchByEmbedding).mockRejectedValue(new Error("endpoint down"))
  const result=await searchSectionCandidates("/project","Alpha",[graph.graphId],{embeddingConfig:embeddingCfg})
  expect(result[0].sectionId).toBe(sectionId)
  expect(result[0].embeddingScore).toBeUndefined()
 })
 it("ignores an embedding hit for a page not present on disk",async()=>{
  vi.mocked(searchByEmbedding).mockResolvedValue([{id:"page-not-on-disk",score:0.99,matchedChunks:[{text:"x",headingPath:"y",score:0.99}]}])
  const result=await searchSectionCandidates("/project","Alpha",[graph.graphId],{embeddingConfig:embeddingCfg})
  // No section resolved → nothing merged; lexical result stands unchanged.
  expect(result.every((c)=>c.embeddingScore===undefined)).toBe(true)
  expect(result[0].sectionId).toBe(sectionId)
 })
 it("enforces content scope on a merged embedding section",async()=>{
  vi.mocked(readFile).mockResolvedValue(markdown2)
  vi.mocked(searchByEmbedding).mockResolvedValue([{id:pageId,score:0.9,matchedChunks:[{text:"Beta owns Gamma.",headingPath:"Details",score:0.9}]}])
  // Section 2 has no assertion touching an allowed entity and its page isn't
  // allowed → scoped out even though embedding surfaced it.
  const result=await searchSectionCandidates("/project","Alpha",[graph.graphId],{embeddingConfig:embeddingCfg,allowedPageIds:["page-other"],allowedEntityIds:["ent-zzz"]})
  expect(result.some((c)=>c.sectionId===sectionId2)).toBe(false)
 })
})
