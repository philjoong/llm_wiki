import { invoke } from "@tauri-apps/api/core"
import { loadFalkordbUrl } from "@/lib/project-store"
import { parseFalkorQueryResult } from "@/lib/falkor-visualization"

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
  
  // Filter only graphs belonging to this project and remove the prefix for UI display
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

function escapeCypherString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

function hasQueryResults(result: any): boolean {
  const parsed = parseFalkorQueryResult(result)
  return parsed.nodes.length > 0 || parsed.links.length > 0
}

export async function findRelatedGraphs(
  projectName: string,
  fileName: string,
  filePath?: string,
  assignedGraph?: string | null,
): Promise<string[]> {
  const graphs = await listGraphDb(projectName)
  const related: string[] = []
  const candidates = assignedGraph
    ? graphs.includes(assignedGraph) ? [assignedGraph] : []
    : graphs
  const id = fileName.replace(/\.md$/i, "")
  const safeId = escapeCypherString(id)
  const safePath = filePath ? escapeCypherString(filePath.replace(/\\/g, "/")) : null

  for (const g of candidates) {
    try {
      const nodeRes = await queryGraphDb(projectName, g, `MATCH (n:Page {id: '${safeId}'}) RETURN n LIMIT 1`)
      if (hasQueryResults(nodeRes)) {
        related.push(g)
        continue
      }

      if (!safePath) continue
      const pathRes = await queryGraphDb(projectName, g, `MATCH (n) WHERE n.path = '${safePath}' RETURN n LIMIT 1`)
      if (hasQueryResults(pathRes)) {
        related.push(g)
      }
    } catch (err) {
      console.warn(`[findRelatedGraphs] Failed to query graph ${g}:`, err)
    }
  }
  
  return related
}

export async function pingGraphDb(): Promise<void> {
  return invoke<void>("graph_db_ping", { url: await getUrl() })
}
