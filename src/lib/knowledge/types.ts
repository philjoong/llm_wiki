import type { EntityType, PageType, SectionType, UiAnchor, UiAspect, UiLayer, UiScope } from "./vocabularies"

export type AssertionOrigin = "ingest" | "manual"
export type AssertionStatus = "active" | "review" | "superseded"
export type EvidenceType = "supports" | "contradicts" | "mentions"
export type ObjectCardinality = "one" | "many"
export type PageEntityRole = "subject" | "mentions" | "ui_target" | "content_target"
export type EvidenceState = "documented" | "manual" | "contradicted"

export interface PageRecord {
  pageId: string
  /** Current location only. It is never a relation identifier. */
  pagePath: string
  title: string
  pageType: PageType
  summary?: string
  primaryEntityId?: string
  updatedAt: string
}

export interface SectionRecord {
  sectionId: string
  pageId: string
  parentId?: string
  headingLevel: number
  headingText: string
  sectionType: SectionType
  uiScope?: UiScope
  uiAnchor?: UiAnchor
  uiLayer?: UiLayer
  uiAspect?: UiAspect
  contentEntityId?: string
  hostEntityId?: string
  ordinal: number
  summary?: string
}

export interface EntityRecord {
  entityId: string
  canonicalName: string
  entityType: EntityType
  description?: string
}

export interface EntityAliasRecord { entityId: string; alias: string; normalizedAlias: string }
export interface GraphRecord { graphId: string; graphName: string; purpose: string }

/**
 * The legacy catch-all graph. New projects no longer seed it; ingest names
 * every graph for its domain instead. Hidden from graph pickers/lists so users
 * never see or write into it, while any residue in older projects stays intact.
 */
export const HIDDEN_GRAPH_NAME = "main"
export const isUserVisibleGraph = (graph: GraphRecord): boolean => graph.graphName !== HIDDEN_GRAPH_NAME
export interface GraphNodeRecord { nodeId: string; graphId: string; entityId: string; role?: string }

export interface RelationTypeRecord {
  graphId: string
  name: string
  description: string
  subjectTypes: EntityType[]
  objectTypes: EntityType[]
  inverseName?: string
  symmetric: boolean
  objectCardinality: ObjectCardinality
}

export interface AssertionRecord {
  assertionId: string
  graphId: string
  subjectEntityId: string
  predicate: string
  objectEntityId: string
  origin: AssertionOrigin
  status: AssertionStatus
  createdAt: string
}

export interface AssertionEvidenceRecord {
  evidenceId: string
  assertionId: string
  pageId?: string
  sectionId?: string
  evidenceType: EvidenceType
  quote?: string
  confidence?: number
}

export interface PageEntityRecord { pageId: string; sectionId?: string; entityId: string; role: PageEntityRole }
export interface TagRecord { tagId: string; namespace: string; value: string }
export interface PageTagRecord { pageId: string; tagId: string }

export interface EntityMatch extends EntityRecord { matchedAlias?: string }
export interface KnowledgeGraphSnapshot {
  graph: GraphRecord
  nodes: Array<GraphNodeRecord & { entity: EntityRecord }>
  assertions: Array<AssertionRecord & { evidenceState: EvidenceState; evidence: AssertionEvidenceRecord[] }>
}

/** Every graph an entity appears in, merged. `graphs` lists the distinct graphs touched. */
export interface EntityNeighborhood {
  graphs: GraphRecord[]
  nodes: Array<GraphNodeRecord & { entity: EntityRecord }>
  assertions: Array<AssertionRecord & { evidenceState: EvidenceState; evidence: AssertionEvidenceRecord[] }>
}

export interface DeleteImpact { nodeIds: string[]; assertionIds: string[]; evidenceIds: string[]; pageIds: string[]; revision: string }
export interface CreateOrLinkGraphNodeInput { graphId: string; entityId?: string; canonicalName?: string; entityType?: EntityType; description?: string; aliases?: string[]; role?: string }
export interface TraversalRequest { seedPageIds?: string[]; seedEntityIds?: string[]; allowedGraphIds?: string[]; maxCost?: number; maxGraphSwitches?: number }
export interface TraversalStep { kind: "assertion" | "graph_switch"; graphId: string; entityId: string; assertionId?: string; predicate?: string; forward?: boolean }
export interface TraversalHit { entityId: string; assertionId?: string; cost: number; graphSwitches: number; path: TraversalStep[] }
