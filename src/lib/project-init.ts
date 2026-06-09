import { createDirectory, writeFile } from "@/commands/fs"
import { gitInit } from "@/commands/git"
import { ensureOriginalsGitignore } from "@/lib/originals"
import { saveGraphPolicy, DEFAULT_POLICY } from "@/lib/graph-policy"

export const SYSTEM_PREFIX_DIRS = [
  "db",
  "pending",
  "counterexamples",
  "question_types",
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

  await saveGraphPolicy(pp, DEFAULT_POLICY)

  // Seed .gitignore before `git init` so the initial commit doesn't
  // accidentally pick up an originals/ tree from a re-init scenario.
  // (Existing projects pick up the same rules on first import via
  // ensureOriginalsGitignore in sources-view.)
  await ensureOriginalsGitignore(pp)

  await gitInit(pp)
}
