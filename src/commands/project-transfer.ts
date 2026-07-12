import { invoke } from "@tauri-apps/api/core"
import { save, open } from "@tauri-apps/plugin-dialog"

/**
 * Export a project to a .llmwiki zip file.
 * The knowledge database is authoritative.  In particular, this deliberately
 * does not synthesize a legacy graph compatibility snapshot before zipping.
 */
export async function exportProject(projectName: string, projectPath: string): Promise<void> {
  const destZipPath = await save({
    defaultPath: `${projectName}.llmwiki`,
    filters: [{ name: "LLM Wiki Project", extensions: ["llmwiki"] }],
  })
  if (!destZipPath) return

  await invoke<void>("project_export", { projectPath, destZipPath })
}

/**
 * Import a project from a .llmwiki zip file.
 * Prompts for zip file and destination folder, then extracts and validates the
 * complete v2 project. Missing knowledge.sqlite is an import error, never a
 * request to reconstruct graph state from a snapshot.
 * Returns the path of the newly created project folder, or null if cancelled.
 */
export async function importProject(newProjectName: string): Promise<string | null> {
  const zipPath = await open({
    filters: [{ name: "LLM Wiki Project", extensions: ["llmwiki"] }],
    multiple: false,
    directory: false,
  })
  if (!zipPath || Array.isArray(zipPath)) return null

  const destFolder = await open({
    directory: true,
    multiple: false,
    title: "Select folder to extract project into",
  })
  if (!destFolder || Array.isArray(destFolder)) return null

  const projectPath = `${destFolder}/${newProjectName}`
  await invoke<void>("project_import", { zipPath, destFolder: projectPath })

  return projectPath
}
