import { getGraphBackend } from "@/lib/graph-backend"
import { loadGraphPolicy } from "./graph-policy"
import type { GraphNode, GraphEdge } from "./wiki-graph"
import type { SchemaProposal } from "@/stores/review-store"

export async function detectSchemaDrift(
  projectPath: string,
  projectName: string,
  nodes: GraphNode[],
  _edges: GraphEdge[]
): Promise<SchemaProposal[]> {
  const policy = await loadGraphPolicy(projectPath)
  const proposals: SchemaProposal[] = []

  // 1. Get managed graphs — schema check only runs against graphs that exist.
  // If none are configured, there's nothing to check against yet.
  if (policy.managedGraphs.length === 0) return proposals
  const managedGraphs = policy.managedGraphs

  // 2. Fetch existing types from each graph
  const existingLabels = new Set<string>()
  const backend = await getGraphBackend(projectPath)

  for (const gName of managedGraphs) {
    try {
      const snapshot = await backend.exportGraph(projectName, gName)
      for (const node of snapshot.nodes) {
        for (const label of node.labels) existingLabels.add(label.toLowerCase())
      }
    } catch (err) {
      // Graph might not exist yet, which is fine
      console.warn(`[schema-validation] Could not fetch schema for ${gName}:`, err)
    }
  }

  // 3. Compare with incoming nodes
  const incomingLabels = new Set(nodes.map(n => n.type.toLowerCase()))
  for (const label of incomingLabels) {
    if (label === "other" || label === "page") continue // skip default/base types
    if (!existingLabels.has(label) && !policy.forbiddenTypes.map(t => t.toLowerCase()).includes(label)) {
      proposals.push({
        type: "node_type",
        name: label,
      })
    }
  }

  // Relation types are managed by graph-policy (registered during ingest Stage 2).
  // We don't propose schema drift for relation types here — doing so would
  // cause every edge to be filtered out pending approval, leaving graphs empty.

  return proposals
}
