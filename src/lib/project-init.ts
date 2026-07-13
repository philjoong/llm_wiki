import { createDirectory, fileExists, writeFile, seedDataTypes, seedQuestionTypes } from "@/commands/fs"
import { bootstrapKnowledgeDb, listKnowledgeGraphs, registerGraph } from "@/commands/knowledge"
import { gitInit } from "@/commands/git"
import { ensureOriginalsGitignore } from "@/lib/originals"
import { recoverPendingIngests } from "@/lib/ingest-v2"

export const SYSTEM_PREFIX_DIRS = [
  "db",
  "pending",
  "question_types",
  "data_types",
] as const

export interface InitProjectOptions {
  projectPath: string
}

export async function initProject({ projectPath }: InitProjectOptions): Promise<void> {
  const pp = projectPath.replace(/\/+$/, "")
  await recoverPendingIngests(pp)

  for (const dir of SYSTEM_PREFIX_DIRS) {
    const dirPath = `${pp}/${dir}`
    await createDirectory(dirPath)
    await writeFile(`${dirPath}/.gitkeep`, "")
  }

  await seedQuestionTypes(pp)
  await seedDataTypes(pp)
  await bootstrapKnowledgeDb(pp)
  if ((await listKnowledgeGraphs(pp)).length === 0) {
    await registerGraph(pp, { graphId: `graph-${crypto.randomUUID()}`, graphName: "main", purpose: "General project knowledge" })
  }
  const tagSchemaPath = `${pp}/.llm-wiki/tag-schema.yaml`
  if (!await fileExists(tagSchemaPath)) {
    await writeFile(tagSchemaPath, "namespaces: {}\n")
  }

  // Seed .gitignore before `git init` so the initial commit doesn't
  // accidentally pick up an originals/ tree from a re-init scenario.
  // Existing projects pick up the same rules when originals are first
  // copied through ensureOriginalsGitignore().
  await ensureOriginalsGitignore(pp)

  await gitInit(pp)
}
