import { loadGraphPolicy, saveGraphPolicy } from "./graph-policy"
import type { SchemaProposal } from "@/stores/review-store"
import { syncGraphToFalkorDb } from "./graph-sync"

export async function approveSchemaChange(
  projectPath: string,
  projectName: string,
  proposal: SchemaProposal
): Promise<void> {
  const policy = await loadGraphPolicy(projectPath)

  if (proposal.type === "relation_type") {
    if (!policy.relationTypes.includes(proposal.name)) {
      policy.relationTypes.push(proposal.name)
    }
  }
  // For node_type, we don't necessarily need to add it to a list in policy
  // unless we want to track "approved node types". For now, syncGraphToFalkorDb
  // checks FalkorDB's own labels, so once it's synced once, it's "approved".
  // But to trigger that first sync, we might need a way to tell the sync
  // that this specific type is now okay.

  await saveGraphPolicy(projectPath, policy)

  // Re-trigger sync to actually push the newly approved type to FalkorDB
  await syncGraphToFalkorDb(projectPath, projectName)
}

export async function rejectSchemaChange(
  projectPath: string,
  proposal: SchemaProposal
): Promise<void> {
  const policy = await loadGraphPolicy(projectPath)

  if (!policy.forbiddenTypes.includes(proposal.name)) {
    policy.forbiddenTypes.push(proposal.name)
  }

  await saveGraphPolicy(projectPath, policy)
}
