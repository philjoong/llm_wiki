use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageRecord {
    pub page_id: String,
    pub page_path: String,
    pub title: String,
    pub page_type: String,
    pub summary: Option<String>,
    pub primary_entity_id: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionRecord {
    pub section_id: String,
    pub page_id: String,
    pub parent_id: Option<String>,
    pub heading_level: i32,
    pub heading_text: String,
    pub section_type: String,
    pub ui_scope: Option<String>,
    pub ui_anchor: Option<String>,
    pub ui_layer: Option<String>,
    pub ui_aspect: Option<String>,
    pub content_entity_id: Option<String>,
    pub host_entity_id: Option<String>,
    pub ordinal: i32,
    pub summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityRecord {
    pub entity_id: String,
    pub canonical_name: String,
    pub entity_type: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityAliasRecord {
    pub entity_id: String,
    pub alias: String,
    pub normalized_alias: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityDetail { #[serde(flatten)] pub entity: EntityRecord, pub aliases: Vec<String>, pub node_ids: Vec<String> }

/// A pair of entities that likely denote the same real-world thing. `score` is
/// a 0..1 name-similarity heuristic; `reason` labels why they were paired.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityMergeSuggestion { pub a: EntityRecord, pub b: EntityRecord, pub score: f64, pub reason: String }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphRecord {
    pub graph_id: String,
    pub graph_name: String,
    pub purpose: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNodeRecord {
    pub node_id: String,
    pub graph_id: String,
    pub entity_id: String,
    pub role: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationTypeRecord {
    pub graph_id: String,
    pub name: String,
    pub description: String,
    pub subject_types: Vec<String>,
    pub object_types: Vec<String>,
    pub inverse_name: Option<String>,
    pub symmetric: bool,
    pub object_cardinality: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssertionRecord {
    pub assertion_id: String,
    pub graph_id: String,
    pub subject_entity_id: String,
    pub predicate: String,
    pub object_entity_id: String,
    pub origin: String,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssertionEvidenceRecord {
    pub evidence_id: String,
    pub assertion_id: String,
    pub page_id: Option<String>,
    pub section_id: Option<String>,
    pub evidence_type: String,
    pub quote: Option<String>,
    pub confidence: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotNode { #[serde(flatten)] pub node: GraphNodeRecord, pub entity: EntityRecord }

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotAssertion { #[serde(flatten)] pub assertion: AssertionRecord, pub evidence_state: String, pub evidence: Vec<AssertionEvidenceRecord> }

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeGraphSnapshot { pub graph: GraphRecord, pub nodes: Vec<SnapshotNode>, pub assertions: Vec<SnapshotAssertion> }

/// Every graph an entity appears in, merged into one view. `graphs` lists the
/// distinct graphs touched so the UI can label edges by their source graph.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityNeighborhood { pub graphs: Vec<GraphRecord>, pub nodes: Vec<SnapshotNode>, pub assertions: Vec<SnapshotAssertion> }

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateOrLinkGraphNodeResult { pub node: GraphNodeRecord, pub entity: EntityRecord }

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteImpact { pub node_ids: Vec<String>, pub assertion_ids: Vec<String>, pub evidence_ids: Vec<String>, pub page_ids: Vec<String>, pub revision: String }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraversalRequest { pub seed_page_ids: Option<Vec<String>>, pub seed_entity_ids: Option<Vec<String>>, pub allowed_graph_ids: Option<Vec<String>>, pub max_cost: Option<i32>, pub max_graph_switches: Option<i32>, pub allowed_predicates: Option<Vec<String>> }

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TraversalStep { pub kind: String, pub graph_id: String, pub entity_id: String, pub assertion_id: Option<String>, pub predicate: Option<String>, pub forward: Option<bool> }

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TraversalHit { pub entity_id: String, pub assertion_id: Option<String>, pub cost: i32, pub graph_switches: i32, pub path: Vec<TraversalStep> }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageEntityRecord {
    pub page_id: String,
    pub section_id: Option<String>,
    pub entity_id: String,
    pub role: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagRecord {
    pub tag_id: String,
    pub namespace: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageTagRecord {
    pub page_id: String,
    pub tag_id: String,
}

/// Input DTOs are intentionally use-case shaped; raw table writes are not a
/// frontend contract.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAssertionInput {
    pub graph_id: String,
    pub subject_entity_id: String,
    pub predicate: String,
    pub object_entity_id: String,
    pub evidence: Option<Vec<CreateEvidenceInput>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditAssertionInput {
    pub assertion_id: String,
    pub graph_id: String,
    pub subject_entity_id: String,
    pub predicate: String,
    pub object_entity_id: String,
    pub evidence: Option<Vec<CreateEvidenceInput>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateEvidenceInput {
    pub page_id: Option<String>,
    pub section_id: Option<String>,
    pub quote: Option<String>,
    pub confidence: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertPageDocumentInput { pub page: PageRecord, pub sections: Vec<SectionRecord> }

/// A fully hydrated v2 markdown replacement and its matching database rows.
/// This is intentionally a use-case input: the webview cannot issue raw SQL
/// writes, and the command commits every document in one SQLite transaction.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestPageDocument {
    pub relative_path: String,
    pub content: String,
    pub page: PageRecord,
    pub sections: Vec<SectionRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestAssertionWrite {
    pub graph_id: String,
    pub subject_name: String,
    pub subject_type: String,
    pub predicate: String,
    pub relation_description: String,
    pub object_name: String,
    pub object_type: String,
    pub page_id: String,
    pub section_id: String,
    pub quote: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitIngestPlanInput {
    pub operation_id: String,
    pub pages: Vec<IngestPageDocument>,
    #[serde(default)]
    pub assertions: Vec<IngestAssertionWrite>,
    /// Assertion origin for this commit (Step 12). Defaults to "ingest"; the
    /// "위키에 저장" chat-answer path passes "user_chat" so those assertions
    /// stay traceable. Validated against the schema CHECK before use.
    #[serde(default)]
    pub origin: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateOrLinkEntityInput { pub entity_id: Option<String>, pub canonical_name: String, pub entity_type: String, pub description: Option<String>, pub aliases: Option<Vec<String>> }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateOrLinkGraphNodeInput { pub graph_id: String, pub entity_id: Option<String>, pub canonical_name: Option<String>, pub entity_type: Option<String>, pub description: Option<String>, pub aliases: Option<Vec<String>>, pub role: Option<String> }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteImpactInput { pub node_id: Option<String>, pub assertion_id: Option<String>, pub entity_id: Option<String> }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteEntityInput { pub entity_id: String, pub impact_revision: String }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterRelationTypeInput { pub relation_type: RelationTypeRecord }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameGraphInput { pub graph_id: String, pub graph_name: String }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameRelationTypeInput { pub graph_id: String, pub old_name: String, pub new_name: String }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameEntityInput { pub entity_id: String, pub canonical_name: String }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityAliasInput { pub entity_id: String, pub alias: String }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeEntitiesInput { pub source_entity_id: String, pub target_entity_id: String }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitEntityInput { pub entity_id: String, pub canonical_name: String, pub node_ids: Vec<String> }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveCardinalityConflictInput { pub assertion_id: String }

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeDbStatus { pub schema_version: i32, pub foreign_keys_enabled: bool, pub bootstrapped: bool }

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrityIssue { pub category: String, pub message: String, pub record_id: Option<String> }
