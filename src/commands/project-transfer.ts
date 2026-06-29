import { invoke } from "@tauri-apps/api/core"
import { save, open } from "@tauri-apps/plugin-dialog"
import { loadGraphPolicy } from "@/lib/graph-policy"
import { readFile, writeFile, deleteFile } from "@/commands/fs"
import { getGraphBackend, type GraphSnapshot } from "@/lib/graph-backend"

export interface GraphsJson {
  graphs: Record<string, GraphSnapshot>
}

/**
 * Export a project to a .llmwiki zip file.
 * Prompts for save path, collects all graph data, writes graphs.json, zips, cleans up.
 */
export async function exportProject(projectName: string, projectPath: string): Promise<void> {
  const destZipPath = await save({
    defaultPath: `${projectName}.llmwiki`,
    filters: [{ name: "LLM Wiki Project", extensions: ["llmwiki"] }],
  })
  if (!destZipPath) return

  const policy = await loadGraphPolicy(projectPath)
  const backend = await getGraphBackend(projectPath)
  const graphsData: GraphsJson["graphs"] = {}

  for (const graphName of policy.managedGraphs) {
    try {
      graphsData[graphName] = await backend.exportGraph(projectName, graphName)
    } catch {
      // Graph not yet created in the active backend - skip.
    }
  }

  const graphsJsonPath = `${projectPath}/graphs.json`
  const graphsJsonContent: GraphsJson = { graphs: graphsData }
  await writeFile(graphsJsonPath, JSON.stringify(graphsJsonContent, null, 2))

  try {
    await invoke<void>("project_export", { projectPath, destZipPath })
  } finally {
    await deleteFile(graphsJsonPath).catch(() => {})
  }
}

/**
 * Import a project from a .llmwiki zip file.
 * Prompts for zip file and destination folder, extracts, restores graph snapshots.
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

  const graphsJsonPath = `${projectPath}/graphs.json`
  try {
    const content = await readFile(graphsJsonPath)
    const graphsJson: GraphsJson = JSON.parse(content)
    const backend = await getGraphBackend(projectPath)
    const existingGraphs = await backend.listGraphs(newProjectName)

    for (const [graphName, snapshot] of Object.entries(graphsJson.graphs)) {
      if (existingGraphs.includes(graphName)) continue
      await backend.importGraph(newProjectName, graphName, snapshot)
    }
  } catch {
    // graphs.json absent or malformed - skip graph restore.
  }

  return projectPath
}
