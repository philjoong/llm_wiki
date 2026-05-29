# Development Plan - Step 5: User Validation for Schema Changes

## Objective
Prompt the user for approval when the LLM suggests new node types, relationship types, or attributes that differ from the existing schema.

## Status: COMPLETED
- Implemented backend support for JSON-serializable graph query results in `src-tauri/src/commands/graph_db.rs`.
- Created `src/lib/schema-validation.ts` for detecting drift between local Markdown and FalkorDB.
- Integrated schema validation into `src/lib/graph-sync.ts`.
- Added `schema` review type to `src/stores/review-store.ts`.
- Implemented UI for schema approval/rejection in `src/components/review/review-view.tsx`.
- Created `src/lib/schema-resolve.ts` to handle approval (updating policy and re-syncing) and rejection (forbidding types).

## Requirements (Met)
- Compare AI-generated triples with the current graph schema (via `CALL db.labels()` and `CALL db.relationshipTypes()`).
- Identify "new" elements.
- Present a validation UI in the Review panel.

## Implementation Details

### 1. Schema Tracking
- Queried existing labels and relationship types from FalkorDB during sync.
- Compared against incoming `GraphNode` and `GraphEdge` types.

### 2. Validation UI
- New "Schema Change" review cards show the proposed type name and category (Node Label vs. Relationship Type).
- Provides "Approve" (allow and sync) and "Reject" (forbid and skip) buttons.

### 3. Feedback Loop
- approved relationship types are added to `relationTypes` in `.llm-wiki/graph-policy.json`.
- Rejected types are added to `forbiddenTypes` in `.llm-wiki/graph-policy.json`.
- The graph sync process filters out elements with pending or forbidden types.

## Verification
- **Detection Test:** Verified that new wikilink types trigger a Review card.
- **Approval Test:** Verified that clicking "Approve" updates the policy and pushes the data to FalkorDB.
- **Rejection Test:** Verified that clicking "Reject" prevents the data from being synced and adds the type to the forbidden list.
