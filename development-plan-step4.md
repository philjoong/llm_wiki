# Development Plan - Step 4: Knowledge Graph Generation (AI-based) [COMPLETED]

## Objective
Automatically generate small, focused Knowledge Graphs from Markdown files (in `raw/sources/`) using LLM, adhering to the 4-edge-type limit and managed graph policy.

## Requirements
- Split the project's knowledge into multiple "managed graphs" (e.g., `ui_graph`, `skill_graph`) as defined in `schema/graph-schema.md`. [DONE]
- Each managed graph is limited to **max 4 edge types**. [DONE]
- Maintain a `.llm-wiki/graph-policy.json` file in the project root to store `relationTypes` and `managedGraphs`. [DONE]
- Support a "forbidden edge types" list (as part of the policy) to prevent AI from creating unwanted relationships. [DONE]
- **Isolation:** All generated graphs must follow the `projectName___graphName` prefixing convention for FalkorDB isolation. [DONE]

## Implementation Details

### 1. Policy Management (`src/lib/graph-policy.ts`)
- Implemented `GraphPolicy` interface with `relationTypes`, `managedGraphs`, and `forbiddenTypes`.
- Functions `loadGraphPolicy`, `saveGraphPolicy`, and `buildGraphPolicyPrompt` handle persistence and prompt injection.

### 2. Prompt Engineering (`src/lib/graph-policy.ts`, `src/lib/ingest.ts`)
- Ingest prompts now include specific instructions to use allowed `relationTypes` and assign `graph:` in frontmatter.
- Instructed LLM to format relationships as `[[TargetPage|RELATION_TYPE]]`.

### 3. Graph Routing & Extraction (`src/lib/wiki-graph.ts`, `src/lib/graph-sync.ts`)
- Enhanced `wiki-graph.ts` to parse relationship types from `[[Target|TYPE]]` links.
- Created `graph-sync.ts` to synchronize the Markdown graph to FalkorDB.
- **Routing:** Nodes and edges are routed to sub-graphs based on the `graph` field or the source node's graph.
- **Isolation:** Used `projectName___graphName` for all FalkorDB operations.

### 4. Integration
- Integrated `syncGraphToFalkorDb` into `src/lib/ingest.ts` and `src/lib/agent-ingest.ts`.
- Synchronization occurs automatically after files are written and embeddings are generated.

## Verification Results
- **Extraction:** LLM successfully uses `[[Page|TYPE]]` format when policies are present.
- **Isolation:** Graphs appear in FalkorDB with the correct prefix and are isolated per project.
- **Routing:** Pages with `graph: skill_graph` and their relationships are correctly sent to the `skill_graph` sub-graph.

## Note for Step 5
- Current implementation performs **automatic** sync via `MERGE`.
- Step 5 will introduce a "Validation UI" which will likely change this flow from "Auto-Sync" to "Propose & Approval" for schema-drifting changes.

