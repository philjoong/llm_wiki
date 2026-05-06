import { invoke } from "@tauri-apps/api/core"
import type { FileNode, WikiProject } from "@/types/wiki"
import { ensureProjectId, upsertProjectInfo } from "@/lib/project-identity"

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

export async function createProject(
  name: string,
  path: string,
): Promise<WikiProject> {
  const raw = await invoke<RawProject>("create_project", { name, path })
  const id = await ensureProjectId(raw.path)
  await upsertProjectInfo(id, raw.path, raw.name)
  return { id, name: raw.name, path: raw.path }
}

export async function openProject(path: string): Promise<WikiProject> {
  const raw = await invoke<RawProject>("open_project", { path })
  // Phase B one-shot migration: rename wiki/ → db/ for legacy projects.
  // The Rust side records a stamp in .llm-wiki/project.json so the second
  // open is a cheap no-op. If the migration moved data, the stale LanceDB
  // v2 chunks (indexed under stem-only ids) must be dropped — the user
  // will be prompted to re-embed from Settings → Embedding.
  try {
    const result = await invoke<{ migrated: boolean }>("migrate_wiki_to_db", {
      projectPath: raw.path,
    })
    if (result?.migrated) {
      try {
        await invoke("vector_drop_v2", { projectPath: raw.path })
      } catch (err) {
        console.warn("[migrate] vector_drop_v2 failed:", err)
      }
    }
  } catch (err) {
    // Migration is best-effort. A failure here shouldn't block opening
    // the project — the user gets the legacy layout and can retry from
    // Settings later. Surface it in the console for diagnostics.
    console.warn("[migrate] migrate_wiki_to_db failed:", err)
  }
  const id = await ensureProjectId(raw.path)
  await upsertProjectInfo(id, raw.path, raw.name)
  return { id, name: raw.name, path: raw.path }
}

export async function clipServerStatus(): Promise<string> {
  return invoke<string>("clip_server_status")
}
