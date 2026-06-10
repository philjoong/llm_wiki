import { invoke } from "@tauri-apps/api/core"
import { save, open } from "@tauri-apps/plugin-dialog"
import { exportGraphDb, importGraphDb, listGraphDb } from "@/commands/graph-db"
import { loadGraphPolicy } from "@/lib/graph-policy"
import { readFile, writeFile, deleteFile } from "@/commands/fs"
import { FalkorNode, FalkorEdge } from "@/lib/falkor-visualization"

type Pair = [string, unknown]

function isPairArray(x: unknown): x is Pair[] {
  return (
    Array.isArray(x) &&
    x.length > 0 &&
    x.every((p) => Array.isArray(p) && p.length === 2 && typeof p[0] === "string")
  )
}

function pairsToObject(pairs: Pair[]): Record<string, any> {
  const obj: Record<string, any> = {}
  for (const [k, v] of pairs) obj[k] = v
  return obj
}

/** Convert raw graph_db_export response into clean node/edge arrays for graphs.json */
function parseExportToClean(raw: any): { nodes: FalkorNode[]; edges: FalkorEdge[] } {
  const nodesMap = new Map<number, FalkorNode>()
  const edgesMap = new Map<number, FalkorEdge>()

  const addNode = (o: Record<string, any>) => {
    const id = Number(o.id)
    if (Number.isNaN(id) || nodesMap.has(id)) return
    const properties = isPairArray(o.properties) ? pairsToObject(o.properties) : (o.properties ?? {})
    nodesMap.set(id, {
      id,
      labels: Array.isArray(o.labels) ? (o.labels as string[]) : [],
      properties,
    })
  }

  const addEdge = (o: Record<string, any>) => {
    const id = Number(o.id)
    if (Number.isNaN(id) || edgesMap.has(id)) return
    const properties = isPairArray(o.properties) ? pairsToObject(o.properties) : (o.properties ?? {})
    edgesMap.set(id, {
      id,
      type: String(o.type ?? ""),
      sourceId: Number(o.src_node ?? o.sourceId ?? 0),
      targetId: Number(o.dest_node ?? o.destinationId ?? 0),
      properties,
    })
  }

  const walk = (value: any): void => {
    if (Array.isArray(value)) {
      if (isPairArray(value)) {
        const keys = new Set(value.map((p) => p[0]))
        if (keys.has("labels") && keys.has("id")) {
          addNode(pairsToObject(value))
          return
        }
        if (keys.has("src_node") && keys.has("dest_node")) {
          addEdge(pairsToObject(value))
          return
        }
      }
      for (const item of value) walk(item)
      return
    }
    if (value && typeof value === "object") {
      if ("labels" in value && "id" in value) {
        addNode(value)
      } else if (("src_node" in value || "sourceId" in value) && "id" in value) {
        addEdge(value)
      } else {
        for (const v of Object.values(value)) walk(v)
      }
    }
  }

  walk(raw)

  return {
    nodes: Array.from(nodesMap.values()),
    edges: Array.from(edgesMap.values()),
  }
}

export interface GraphsJson {
  graphs: Record<string, { nodes: FalkorNode[]; edges: FalkorEdge[] }>
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
  const graphsData: GraphsJson["graphs"] = {}

  for (const graphName of policy.managedGraphs) {
    try {
      const raw = await exportGraphDb(projectName, graphName)
      graphsData[graphName] = parseExportToClean(raw)
    } catch {
      // Graph not yet created in FalkorDB — skip
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
 * Prompts for zip file and destination folder, extracts, restores FalkorDB graphs.
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

  // Restore FalkorDB graphs from graphs.json
  const graphsJsonPath = `${projectPath}/graphs.json`
  try {
    const content = await readFile(graphsJsonPath)
    const graphsJson: GraphsJson = JSON.parse(content)
    const existingGraphs = await listGraphDb(newProjectName)

    for (const [graphName, { nodes, edges }] of Object.entries(graphsJson.graphs)) {
      if (existingGraphs.includes(graphName)) continue
      // Import edges with src_node/dest_node field names that Rust expects
      const rustEdges = edges.map((e) => ({
        id: e.id,
        type: e.type,
        src_node: e.sourceId,
        dest_node: e.targetId,
        properties: e.properties,
      }))
      await importGraphDb(newProjectName, graphName, nodes, rustEdges)
    }
  } catch {
    // graphs.json absent or malformed — skip graph restore
  }

  return projectPath
}
