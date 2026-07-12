import type { AssertionRecord, CreateOrLinkGraphNodeInput, DeleteImpact, EntityMatch, EntityRecord, GraphNodeRecord, KnowledgeGraphSnapshot, PageRecord, RelationTypeRecord, SectionRecord, TraversalHit, TraversalRequest } from "./types"

export interface CreateEntityInput {
  canonicalName: string
  entityType: EntityRecord["entityType"]
  description?: string
  aliases?: string[]
}

export interface CreateAssertionInput {
  graphId: string
  subjectEntityId: string
  predicate: string
  objectEntityId: string
  evidence?: { pageId?: string; sectionId?: string; quote?: string; confidence?: number }[]
}

/** Read operations are deliberately separate from state-changing use cases. */
export interface KnowledgeQueries {
  getPage(pageId: string): Promise<PageRecord | null>
  getSection(sectionId: string): Promise<SectionRecord | null>
  findEntities(query: string): Promise<EntityMatch[]>
  getGraphSnapshot(graphId: string): Promise<KnowledgeGraphSnapshot>
  listAllowedRelationTypes(graphId: string, sourceEntityId: string, targetEntityId: string): Promise<RelationTypeRecord[]>
  getDeleteImpact(input: { nodeId?: string; assertionId?: string; entityId?: string }): Promise<DeleteImpact>
  traverse(request: TraversalRequest): Promise<TraversalHit[]>
}

export interface KnowledgeCommands {
  createEntity(input: CreateEntityInput): Promise<EntityRecord>
  createManualAssertion(input: CreateAssertionInput): Promise<AssertionRecord>
  createOrLinkGraphNode(input: CreateOrLinkGraphNodeInput): Promise<{ node: GraphNodeRecord; entity: EntityRecord }>
  deleteGraphProjection(nodeId: string): Promise<void>
  deleteAssertion(assertionId: string): Promise<void>
  rejectReviewAssertion(assertionId: string): Promise<void>
}

export type KnowledgeRepository = KnowledgeQueries & KnowledgeCommands
