# Development Plan - Step 8: Document-KG Mapping (Completed)

## Objective
Show which Knowledge Graphs (or sub-graphs) are related to a specific document and allow users to jump to the visualization.

## Requirements
- [x] Maintain a mapping between injected documents and the triples generated from them.
- [x] Selection of a document displays a list of related KGs.
- [x] Clicking a list item navigates to the graph view.

## Implementation Details

### 1. Provenance Tracking (Completed)
- [x] When extracting triples, store the `source_path` with each node AND edge in FalkorDB as a property.
- [x] **Edge Provenance:** Since multiple documents can describe the same relationship, store `source_paths` as a list/array on the edge to allow multi-document attribution.
- [x] Update `src/lib/graph-sync.ts` to include these properties during the `MERGE` process.

### 2. UI Implementation (Completed)
- [x] Update the document list view (`SourcesView`).
- [x] When a document is clicked, query the database for all sub-graphs containing triples from this document using `findRelatedGraphs`.
- [x] Display these as a clickable list.

### 3. Navigation (Completed)
- [x] Clicking a sub-graph in the list should switch the view to the Graph Visualization, selecting the correct sub-graph and highlighting the nodes/edges from that specific document.

## Verification Plan
- **Mapping Check:** [x] Inject Doc A -> KG A. Inject Doc B -> KG B. Select Doc A, verify only KG A is listed.
- **Highlight Test:** [x] Verify that nodes from the selected document are visually distinct (implemented using red color and larger size).
