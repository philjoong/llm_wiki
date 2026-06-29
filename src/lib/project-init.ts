import { createDirectory, writeFile, seedDataTypes, seedQuestionTypes } from "@/commands/fs"
import { gitInit } from "@/commands/git"
import { ensureOriginalsGitignore } from "@/lib/originals"
import { saveGraphPolicy, DEFAULT_POLICY } from "@/lib/graph-policy"

export const SYSTEM_PREFIX_DIRS = [
  "db",
  "pending",
  "counterexamples",
  "question_types",
  "data_types",
] as const

export interface InitProjectOptions {
  projectPath: string
}

export async function initProject({ projectPath }: InitProjectOptions): Promise<void> {
  const pp = projectPath.replace(/\/+$/, "")

  for (const dir of SYSTEM_PREFIX_DIRS) {
    const dirPath = `${pp}/${dir}`
    await createDirectory(dirPath)
    await writeFile(`${dirPath}/.gitkeep`, "")
  }

  await seedQuestionTypes(pp)
  await seedDataTypes(pp)

  await saveGraphPolicy(pp, DEFAULT_POLICY)

  // Seed .gitignore before `git init` so the initial commit doesn't
  // accidentally pick up an originals/ tree from a re-init scenario.
  // Existing projects pick up the same rules when originals are first
  // copied through ensureOriginalsGitignore().
  await ensureOriginalsGitignore(pp)

  await gitInit(pp)
}
