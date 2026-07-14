import { createDirectory, fileExists, writeFile, seedDataTypes, seedQuestionTypes } from "@/commands/fs"
import { bootstrapKnowledgeDb } from "@/commands/knowledge"
import { gitInit } from "@/commands/git"
import { ensureOriginalsGitignore } from "@/lib/originals"
import { recoverPendingIngests } from "@/lib/ingest-v2"
import { ensureProjectId } from "@/lib/project-identity"

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

  await createDirectory(`${pp}/.llm-wiki`)
  await ensureProjectId(pp)

  for (const dir of SYSTEM_PREFIX_DIRS) {
    const dirPath = `${pp}/${dir}`
    await createDirectory(dirPath)
    await writeFile(`${dirPath}/.gitkeep`, "")
  }

  await seedQuestionTypes(pp)
  await seedDataTypes(pp)
  await bootstrapKnowledgeDb(pp)
  // No default graph is seeded. Graphs are created on demand by ingest's graph
  // assignment step (see extractKnowledgeAssertionWrites), each named for the
  // domain of the relationships it holds — a single catch-all "main" graph is
  // deliberately avoided.
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
