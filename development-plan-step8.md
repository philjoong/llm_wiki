# Development Plan - Step 8: Document-KG Mapping

## Objective
Show which Knowledge Graphs (or sub-graphs) are related to a specific document and allow users to jump to the visualization.

## Requirements
- Maintain a mapping between injected documents and the triples generated from them.
- Selection of a document displays a list of related KGs.
- Clicking a list item navigates to the graph view.

## Implementation Details

### 1. Provenance Tracking
- When extracting triples (Step 4), store the `source_path` with each node AND edge in FalkorDB as a property.
- **Edge Provenance:** Since multiple documents can describe the same relationship, store `source_paths` as a list/array on the edge to allow multi-document attribution.
- Update `src/lib/graph-sync.ts` to include these properties during the `MERGE` process.

### 2. UI Implementation
- Update the document list view.
- When a document is clicked, query the database for all sub-graphs containing triples from this document.
- Display these as a clickable list.

### 3. Navigation
- Clicking a sub-graph in the list should switch the view to the Graph Visualization (Step 7), potentially highlighting the nodes/edges from that specific document.

## Verification Plan
- **Mapping Check:** Inject Doc A -> KG A. Inject Doc B -> KG B. Select Doc A, verify only KG A is listed.
- **Highlight Test:** (Optional) Verify that nodes from the selected document are visually distinct.
