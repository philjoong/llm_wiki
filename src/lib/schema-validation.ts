import { queryGraphDb } from "@/commands/graph-db"
import { loadGraphPolicy } from "./graph-policy"
import type { GraphNode, GraphEdge } from "./wiki-graph"
import type { SchemaProposal } from "@/stores/review-store"

export async function detectSchemaDrift(
  projectPath: string,
  projectName: string,
  nodes: GraphNode[],
  edges: GraphEdge[]
): Promise<SchemaProposal[]> {
  const policy = await loadGraphPolicy(projectPath)
  const proposals: SchemaProposal[] = []

  // 1. Get managed graphs
  const managedGraphs = policy.managedGraphs.length > 0 
    ? policy.managedGraphs 
    : ["main_graph"]

  // 2. Fetch existing types from each graph
  const existingLabels = new Set<string>()
  const existingRelTypes = new Set<string>()

  for (const gName of managedGraphs) {
    try {
      // Get Labels
      const labelsRes = await queryGraphDb(projectName, gName, "CALL db.labels()")
      // FalkorDB returns results as an array of rows. 
      // Each row is an array of values.
      // CALL db.labels() returns [[label1], [label2], ...]
      if (Array.isArray(labelsRes)) {
        labelsRes.forEach((row: any) => {
          if (Array.isArray(row) && row[0]) {
            existingLabels.add(String(row[0]).toLowerCase())
          }
        })
      }

      // Get Relationship Types
      const relTypesRes = await queryGraphDb(projectName, gName, "CALL db.relationshipTypes()")
      if (Array.isArray(relTypesRes)) {
        relTypesRes.forEach((row: any) => {
          if (Array.isArray(row) && row[0]) {
            existingRelTypes.add(String(row[0]).toLowerCase())
          }
        })
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

  // 4. Compare with incoming edges
  const incomingRelTypes = new Set(edges.map(e => (e.type || "LINKS_TO").toLowerCase()))
  for (const relType of incomingRelTypes) {
    if (relType === "links_to") continue
    if (!existingRelTypes.has(relType) && !policy.forbiddenTypes.map(t => t.toLowerCase()).includes(relType)) {
      // Also check against allowed relationTypes in policy
      const isAllowedByPolicy = policy.relationTypes.some(t => t.toLowerCase() === relType)
      if (!isAllowedByPolicy && !existingRelTypes.has(relType)) {
        proposals.push({
          type: "relation_type",
          name: relType,
        })
      }
    }
  }

  return proposals
}
