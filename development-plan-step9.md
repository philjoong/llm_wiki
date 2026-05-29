# Development Plan - Step 9: RAG & Graph-based Q&A

## Objective
Implement an AI assistant that answers questions using both RAG (vector search on documents) and the Knowledge Graph.

## Requirements
- Hybrid search: Vector search + Cypher queries.
- LLM synthesizes an answer from both sources.

## Implementation Details

### 1. Vector Search (RAG)
- Utilize the existing embedding pipeline in `src/lib/embedding.ts`.
- Perform similarity search on user queries to retrieve relevant document chunks.

### 2. Graph Search
- Use LLM to translate natural language questions into Cypher queries.
- **Strict Isolation:** Ensure the LLM-generated queries respect the `projectName___graphName` prefixing convention for all graph operations.
- Execute Cypher on FalkorDB via the established `queryGraphDb` command.

### 3. Answer Generation
- Combine context from RAG and Graph results.
- Send to LLM (Codex, Claude, etc.) for final response.

## Verification Plan
- **Accuracy Test:** Ask a question that requires graph traversal (e.g., "What is the relationship between X and Y?").
- **Hybrid Test:** Ask a question that requires both specific document text and structural knowledge.
