import { invoke } from "@tauri-apps/api/core"
import { loadFalkordbUrl } from "@/lib/project-store"

async function getUrl(): Promise<string | undefined> {
  return (await loadFalkordbUrl()) ?? undefined
}

/**
 * All graph operations are prefixed with the project name to ensure isolation
 * between different projects sharing the same FalkorDB instance.
 */
function getPrefixedName(projectName: string, graphName: string): string {
  // Use a separator that is unlikely to be in project names or graph names
  return `${projectName}___${graphName}`
}

export async function createGraphDb(projectName: string, graphName: string): Promise<void> {
  const prefixedName = getPrefixedName(projectName, graphName)
  return invoke<void>("graph_db_create", { graphName: prefixedName, url: await getUrl() })
}

export async function deleteGraphDb(projectName: string, graphName: string): Promise<void> {
  const prefixedName = getPrefixedName(projectName, graphName)
  return invoke<void>("graph_db_delete", { graphName: prefixedName, url: await getUrl() })
}

export async function listGraphDb(projectName: string): Promise<string[]> {
  const allGraphs = await invoke<string[]>("graph_db_list", { url: await getUrl() })
  const prefix = `${projectName}___`
  return allGraphs
    .filter((name) => name.startsWith(prefix))
    .map((name) => name.slice(prefix.length))
}

export async function queryGraphDb(projectName: string, graphName: string, cypher: string): Promise<any> {
  const prefixedName = getPrefixedName(projectName, graphName)
  return invoke<any>("graph_db_query", { graphName: prefixedName, cypher, url: await getUrl() })
}

export async function exportGraphDb(projectName: string, graphName: string): Promise<any> {
  const prefixedName = getPrefixedName(projectName, graphName)
  return invoke<any>("graph_db_export", { graphName: prefixedName, url: await getUrl() })
}

export async function pingGraphDb(): Promise<void> {
  return invoke<void>("graph_db_ping", { url: await getUrl() })
}
