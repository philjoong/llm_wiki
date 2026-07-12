import * as command from "@/commands/knowledge"
import type { AssertionRecord, EntityMatch, EntityRecord, GraphRecord, PageRecord, RelationTypeRecord, SectionRecord } from "./types"
import type { CreateAssertionInput, CreateEntityInput, KnowledgeRepository } from "./repository"

/** Thin UI-facing adapter: all writes remain use-case commands in Rust. */
export function createTauriKnowledgeRepository(projectPath: string): KnowledgeRepository & {
  bootstrap(): Promise<command.KnowledgeDbStatus>
  upsertPageDocument(page: PageRecord, sections: SectionRecord[]): Promise<PageRecord>
  registerGraph(graph: GraphRecord): Promise<GraphRecord>
  registerRelationType(type: RelationTypeRecord): Promise<RelationTypeRecord>
  resolveCardinalityConflict(assertionId: string): Promise<void>
  deletePage(pageId: string): Promise<void>
} {
  return {
    bootstrap: () => command.bootstrapKnowledgeDb(projectPath),
    upsertPageDocument: (page, sections) => command.upsertPageDocument(projectPath, page, sections),
    registerGraph: (graph) => command.registerGraph(projectPath, graph),
    registerRelationType: (type) => command.registerRelationType(projectPath, type),
    resolveCardinalityConflict: (assertionId) => command.resolveCardinalityConflict(projectPath, assertionId),
    deletePage: (pageId) => command.deleteKnowledgePage(projectPath, pageId),
    createEntity: (input: CreateEntityInput): Promise<EntityRecord> => command.createOrLinkEntity(projectPath, input),
    createManualAssertion: (input: CreateAssertionInput): Promise<AssertionRecord> => command.createManualAssertion(projectPath, input),
    getPage: (pageId) => command.getKnowledgePage(projectPath, pageId),
    getSection: (sectionId) => command.getKnowledgeSection(projectPath, sectionId),
    findEntities: async (query): Promise<EntityMatch[]> => command.findKnowledgeEntities(projectPath, query),
    getGraphSnapshot: (graphId) => command.getKnowledgeGraphSnapshot(projectPath, graphId),
    listAllowedRelationTypes: (graphId, sourceEntityId, targetEntityId) => command.listAllowedRelationTypes(projectPath, graphId, sourceEntityId, targetEntityId),
    getDeleteImpact: (input) => command.getKnowledgeDeleteImpact(projectPath, input),
    traverse: (request) => command.traverseKnowledgeGraph(projectPath, request),
    createOrLinkGraphNode: (input) => command.createOrLinkGraphNode(projectPath, input),
    deleteGraphProjection: (nodeId) => command.deleteGraphProjection(projectPath, nodeId),
    deleteAssertion: (assertionId) => command.deleteAssertion(projectPath, assertionId),
    rejectReviewAssertion: (assertionId) => command.rejectReviewAssertion(projectPath, assertionId),
  }
}
