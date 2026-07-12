import { invoke } from "@tauri-apps/api/core"
import type { FileNode, WikiProject } from "@/types/wiki"
import { ensureProjectId, upsertProjectInfo } from "@/lib/project-identity"
import { getKnowledgeDbStatus, runKnowledgeIntegrityCheck } from "@/commands/knowledge"

/** Raw shape returned by the Rust commands — id is attached client-side. */
interface RawProject {
  name: string
  path: string
}

export async function readFile(path: string): Promise<string> {
  return invoke<string>("read_file", { path })
}

export async function writeFile(path: string, contents: string): Promise<void> {
  return invoke<void>("write_file", { path, contents })
}

export async function listDirectory(path: string): Promise<FileNode[]> {
  return invoke<FileNode[]>("list_directory", { path })
}

export async function copyFile(
  source: string,
  destination: string
): Promise<void> {
  return invoke("copy_file", { source, destination })
}

export async function copyDirectory(
  source: string,
  destination: string
): Promise<string[]> {
  return invoke<string[]>("copy_directory", { source, destination })
}

export async function preprocessFile(path: string): Promise<string> {
  return invoke<string>("preprocess_file", { path })
}

export async function deleteFile(path: string): Promise<void> {
  return invoke("delete_file", { path })
}

export async function findRelatedWikiPages(
  projectPath: string,
  sourceName: string
): Promise<string[]> {
  return invoke<string[]>("find_related_wiki_pages", { projectPath, sourceName })
}

export async function createDirectory(path: string): Promise<void> {
  return invoke<void>("create_directory", { path })
}

export async function fileExists(path: string): Promise<boolean> {
  return invoke<boolean>("file_exists", { path })
}

export async function seedQuestionTypes(projectPath: string): Promise<void> {
  return invoke<void>("seed_question_types", { projectPath })
}

export async function seedDataTypes(projectPath: string): Promise<void> {
  return invoke<void>("seed_data_types", { projectPath })
}

export async function createProject(
  name: string,
  path: string,
): Promise<WikiProject> {
  const raw = await invoke<RawProject>("create_project", { name, path })
  // Project-local identity is created only as part of creating a new project.
  await createDirectory(`${raw.path}/.llm-wiki`)
  const id = await ensureProjectId(raw.path)
  await upsertProjectInfo(id, raw.path, raw.name)
  return { id, name: raw.name, path: raw.path }
}

export async function openProject(path: string): Promise<WikiProject> {
  const raw = await invoke<RawProject>("open_project", { path })
  await getKnowledgeDbStatus(raw.path)
  const integrityIssues = await runKnowledgeIntegrityCheck(raw.path)
  if (integrityIssues.length > 0) {
    throw new Error(`Knowledge integrity check failed: ${integrityIssues.map((issue) => issue.category).join(", ")}`)
  }
  let id: string
  try {
    const identity = JSON.parse(await readFile(`${raw.path}/.llm-wiki/project.json`)) as { id?: unknown }
    if (typeof identity.id !== "string" || !identity.id) throw new Error("missing id")
    id = identity.id
  } catch {
    throw new Error("Invalid v2 project: missing .llm-wiki/project.json. Create a new v2 project and restore a v2 export instead.")
  }
  await upsertProjectInfo(id, raw.path, raw.name)
  return { id, name: raw.name, path: raw.path }
}

export async function clipServerStatus(): Promise<string> {
  return invoke<string>("clip_server_status")
}
