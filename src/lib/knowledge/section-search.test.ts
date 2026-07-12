import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/commands/fs",()=>({listDirectory:vi.fn(),readFile:vi.fn()}))
vi.mock("@/commands/knowledge",()=>({getKnowledgePage:vi.fn(),getKnowledgeSection:vi.fn(),listKnowledgeGraphs:vi.fn(),getKnowledgeGraphSnapshot:vi.fn(),traverseKnowledgeGraph:vi.fn()}))
import { listDirectory, readFile } from "@/commands/fs"
import { getKnowledgeGraphSnapshot,getKnowledgePage,getKnowledgeSection,listKnowledgeGraphs,traverseKnowledgeGraph } from "@/commands/knowledge"
import { searchSectionCandidates } from "./section-search"
import { parseMarkdownV2 } from "@/lib/markdown-v2"

const pageId="page-01ARZ3NDEKTSV4RRFFQ69G5FAV"
const sectionId="sec-01ARZ3NDEKTSV4RRFFQ69G5FAW"
const markdown=`---\nschema: llm-wiki/page/v2\npage_id: ${pageId}\ntitle: Test\npage_type: guide\nsummary: Test facts\nsections:\n  ${sectionId}:\n    section_type: overview\n---\n# Test\n## Facts {#${sectionId}}\nAlpha depends on Beta.\n`
const graph={graphId:"graph-allowed",graphName:"casemap_main",purpose:"test"}
const assertion={assertionId:"assert-1",graphId:graph.graphId,subjectEntityId:"ent-a",predicate:"DEPENDS_ON",objectEntityId:"ent-b",origin:"ingest" as const,status:"active" as const,createdAt:"now",evidenceState:"documented" as const,evidence:[{evidenceId:"ev-1",assertionId:"assert-1",pageId,sectionId,evidenceType:"supports" as const}]}

beforeEach(()=>{
 vi.mocked(listDirectory).mockResolvedValue([{name:"test.md",path:"/project/db/test.md",is_dir:false}])
 vi.mocked(readFile).mockResolvedValue(markdown)
 vi.mocked(getKnowledgePage).mockResolvedValue({pageId,pagePath:"db/test.md",title:"Test",pageType:"guide",updatedAt:"now"})
 vi.mocked(getKnowledgeSection).mockResolvedValue({sectionId,pageId,headingLevel:2,headingText:"Facts",sectionType:"overview",ordinal:0})
 vi.mocked(listKnowledgeGraphs).mockResolvedValue([graph,{graphId:"graph-out",graphName:"persona_main",purpose:"out"}])
 vi.mocked(getKnowledgeGraphSnapshot).mockResolvedValue({graph,nodes:[],assertions:[assertion]})
 vi.mocked(traverseKnowledgeGraph).mockResolvedValue([{entityId:"ent-b",assertionId:"assert-1",cost:1,graphSwitches:0,path:[{kind:"assertion",graphId:graph.graphId,entityId:"ent-b",assertionId:"assert-1",predicate:"DEPENDS_ON",forward:true}]}])
})

describe("section candidate graph scope",()=>{
 it("passes prefix-resolved graph IDs to traversal and preserves provenance",async()=>{
  expect(parseMarkdownV2(markdown).sections[0].sectionId).toBe(sectionId)
  const result=await searchSectionCandidates("/project","Alpha",[graph.graphId])
  expect(traverseKnowledgeGraph).toHaveBeenCalledWith("/project",expect.objectContaining({allowedGraphIds:[graph.graphId]}))
  expect(result[0]).toMatchObject({pageId,sectionId,assertionIds:["assert-1"],evidenceState:"documented",graphPath:[graph.graphId]})
 })
 it("does not issue a scoped candidate for a section without allowed evidence",async()=>{
  vi.mocked(getKnowledgeGraphSnapshot).mockResolvedValue({graph,nodes:[],assertions:[]})
  expect(await searchSectionCandidates("/project","Alpha",[graph.graphId])).toEqual([])
 })
})
