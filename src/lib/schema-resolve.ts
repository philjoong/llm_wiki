import { loadGraphPolicy, saveGraphPolicy } from "./graph-policy"
import type { SchemaProposal } from "@/stores/review-store"

export async function approveSchemaChange(
  projectPath: string,
  projectName: string,
  proposal: SchemaProposal
): Promise<void> {
  void projectName
  const policy = await loadGraphPolicy(projectPath)

  if (proposal.type === "relation_type") {
    if (!policy.relationTypes.includes(proposal.name)) {
      policy.relationTypes.push(proposal.name)
    }
  }

  await saveGraphPolicy(projectPath, policy)
  // Re-sync happens naturally on next ingest with the updated policy.
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
