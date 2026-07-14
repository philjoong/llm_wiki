import { invoke } from "@tauri-apps/api/core"
import type { AssertionRecord, CreateOrLinkGraphNodeInput, DeleteImpact, EntityNeighborhood, EntityRecord, GraphNodeRecord, GraphRecord, KnowledgeGraphSnapshot, PageRecord, RelationTypeRecord, SectionRecord, TraversalHit, TraversalRequest } from "@/lib/knowledge/types"

export interface KnowledgeDbStatus { schemaVersion: number; foreignKeysEnabled: boolean; bootstrapped: boolean }
export interface IntegrityIssue { category: string; message: string; recordId?: string }
export interface CreateEvidenceInput { pageId?: string; sectionId?: string; quote?: string; confidence?: number }
export interface CreateAssertionInput { graphId: string; subjectEntityId: string; predicate: string; objectEntityId: string; evidence?: CreateEvidenceInput[] }

const args = (projectPath: string) => ({ projectPath })
export const bootstrapKnowledgeDb = (projectPath: string) => invoke<KnowledgeDbStatus>("bootstrap_knowledge_db", args(projectPath))
export const getKnowledgeDbStatus = (projectPath: string) => invoke<KnowledgeDbStatus>("get_knowledge_db_status", args(projectPath))
export const upsertPageDocument = (projectPath: string, page: PageRecord, sections: SectionRecord[]) => invoke<PageRecord>("upsert_page_document", { ...args(projectPath), input: { page, sections } })
export const createOrLinkEntity = (projectPath: string, input: { entityId?: string; canonicalName: string; entityType: string; description?: string; aliases?: string[] }) => invoke<EntityRecord>("create_or_link_entity", { ...args(projectPath), input })
export const registerGraph = (projectPath: string, graph: GraphRecord) => invoke<GraphRecord>("register_graph", { ...args(projectPath), graph })
export const renameKnowledgeGraph = (projectPath: string, graphId: string, graphName: string) => invoke<GraphRecord>("rename_knowledge_graph", { ...args(projectPath), input: { graphId, graphName } })
export const deleteKnowledgeGraph = (projectPath: string, graphId: string) => invoke<void>("delete_knowledge_graph", { ...args(projectPath), graphId })
export const listKnowledgeGraphs = (projectPath: string) => invoke<GraphRecord[]>("list_knowledge_graphs", args(projectPath))
export const registerRelationType = (projectPath: string, relationType: RelationTypeRecord) => invoke<RelationTypeRecord>("register_relation_type", { ...args(projectPath), input: { relationType } })
export const listKnowledgeRelationTypes = (projectPath: string, graphId: string) => invoke<RelationTypeRecord[]>("list_knowledge_relation_types", { ...args(projectPath), graphId })
export const renameKnowledgeRelationType = (projectPath: string, graphId: string, oldName: string, newName: string) => invoke<void>("rename_knowledge_relation_type", { ...args(projectPath), input: { graphId, oldName, newName } })
export const deleteKnowledgeRelationType = (projectPath: string, graphId: string, name: string) => invoke<void>("delete_knowledge_relation_type", { ...args(projectPath), graphId, name })
export const createAssertionWithEvidence = (projectPath: string, input: CreateAssertionInput) => invoke<AssertionRecord>("create_assertion_with_evidence", { ...args(projectPath), input })
export const createManualAssertion = (projectPath: string, input: CreateAssertionInput) => invoke<AssertionRecord>("create_manual_assertion", { ...args(projectPath), input })
export interface EditAssertionInput extends CreateAssertionInput { assertionId: string }
export const editKnowledgeAssertion = (projectPath: string, input: EditAssertionInput) => invoke<AssertionRecord>("edit_knowledge_assertion", { ...args(projectPath), input })
export const resolveCardinalityConflict = (projectPath: string, assertionId: string) => invoke<void>("resolve_cardinality_conflict", { ...args(projectPath), input: { assertionId } })
export const deleteKnowledgePage = (projectPath: string, pageId: string) => invoke<void>("delete_page", { ...args(projectPath), pageId })
export const runKnowledgeIntegrityCheck = (projectPath: string) => invoke<IntegrityIssue[]>("run_knowledge_integrity_check", args(projectPath))
export const getKnowledgePage = (projectPath: string, pageId: string) => invoke<PageRecord | null>("get_knowledge_page", { ...args(projectPath), pageId })
export const getKnowledgeSection = (projectPath: string, sectionId: string) => invoke<SectionRecord | null>("get_knowledge_section", { ...args(projectPath), sectionId })
export const findKnowledgeEntities = (projectPath: string, query: string) => invoke<EntityRecord[]>("find_knowledge_entities", { ...args(projectPath), query })
export interface EntityDetail extends EntityRecord { aliases: string[]; nodeIds: string[] }
export const listKnowledgeEntities = (projectPath: string) => invoke<EntityDetail[]>("list_knowledge_entities", args(projectPath))
export const renameKnowledgeEntity = (projectPath: string, entityId: string, canonicalName: string) => invoke<EntityRecord>("rename_knowledge_entity", { ...args(projectPath), input: { entityId, canonicalName } })
export const addKnowledgeEntityAlias = (projectPath: string, entityId: string, alias: string) => invoke<void>("add_knowledge_entity_alias", { ...args(projectPath), input: { entityId, alias } })
export const removeKnowledgeEntityAlias = (projectPath: string, entityId: string, alias: string) => invoke<void>("remove_knowledge_entity_alias", { ...args(projectPath), input: { entityId, alias } })
export const mergeKnowledgeEntities = (projectPath: string, sourceEntityId: string, targetEntityId: string) => invoke<void>("merge_knowledge_entities", { ...args(projectPath), input: { sourceEntityId, targetEntityId } })
export interface EntityMergeSuggestion { a: EntityRecord; b: EntityRecord; score: number; reason: string }
export const suggestEntityMerges = (projectPath: string) => invoke<EntityMergeSuggestion[]>("suggest_entity_merges", args(projectPath))
export const splitKnowledgeEntity = (projectPath: string, entityId: string, canonicalName: string, nodeIds: string[]) => invoke<EntityRecord>("split_knowledge_entity", { ...args(projectPath), input: { entityId, canonicalName, nodeIds } })
export const deleteKnowledgeEntity = (projectPath: string, entityId: string, impactRevision: string) => invoke<void>("delete_knowledge_entity", { ...args(projectPath), input: { entityId, impactRevision } })
export const getKnowledgeGraphSnapshot = (projectPath: string, graphId: string) => invoke<KnowledgeGraphSnapshot>("get_knowledge_graph_snapshot", { ...args(projectPath), graphId })
export const getEntityNeighborhood = (projectPath: string, entityId: string) => invoke<EntityNeighborhood>("get_entity_neighborhood", { ...args(projectPath), entityId })
export const listGraphsForPage = (projectPath: string, pagePath: string) => invoke<GraphRecord[]>("list_graphs_for_page", { ...args(projectPath), pagePath })
export const createOrLinkGraphNode = (projectPath: string, input: CreateOrLinkGraphNodeInput) => invoke<{ node: GraphNodeRecord; entity: EntityRecord }>("create_or_link_graph_node", { ...args(projectPath), input })
export const listAllowedRelationTypes = (projectPath: string, graphId: string, sourceEntityId: string, targetEntityId: string) => invoke<RelationTypeRecord[]>("list_allowed_relation_types", { ...args(projectPath), graphId, sourceEntityId, targetEntityId })
export const getKnowledgeDeleteImpact = (projectPath: string, input: { nodeId?: string; assertionId?: string; entityId?: string }) => invoke<DeleteImpact>("get_knowledge_delete_impact", { ...args(projectPath), input })
export const deleteGraphProjection = (projectPath: string, nodeId: string) => invoke<void>("delete_graph_projection", { ...args(projectPath), nodeId })
export const deleteAssertion = (projectPath: string, assertionId: string) => invoke<void>("delete_assertion", { ...args(projectPath), assertionId })
export const rejectReviewAssertion = (projectPath: string, assertionId: string) => invoke<void>("reject_review_assertion", { ...args(projectPath), assertionId })
export const discardSectionAssertions = (projectPath: string, sectionId: string) => invoke<void>("discard_section_assertions", { ...args(projectPath), sectionId })
export const traverseKnowledgeGraph = (projectPath: string, request: TraversalRequest) => invoke<TraversalHit[]>("traverse_knowledge_graph", { ...args(projectPath), request })
export interface IngestPageDocument { relativePath: string; content: string; page: PageRecord; sections: SectionRecord[] }
export interface IngestAssertionWrite { graphId:string;subjectName:string;subjectType:string;predicate:string;relationDescription:string;objectName:string;objectType:string;pageId:string;sectionId:string;quote?:string }
export const commitIngestPlan = (projectPath: string, operationId: string, pages: IngestPageDocument[], assertions: IngestAssertionWrite[] = []) => invoke<void>("commit_ingest_plan", { ...args(projectPath), input: { operationId, pages, assertions } })
export const recoverIngestTransactions = (projectPath: string) => invoke<void>("recover_ingest_transactions", args(projectPath))
