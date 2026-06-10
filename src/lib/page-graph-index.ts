import { readFile, writeFile, createDirectory } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"

const INDEX_PATH = ".llm-wiki/page-graph-index.json"

/** page_path → graph[] mapping persisted to disk. */
export type PageGraphIndex = Record<string, string[]>

export async function loadPageGraphIndex(projectPath: string): Promise<PageGraphIndex> {
  try {
    const raw = await readFile(`${normalizePath(projectPath)}/${INDEX_PATH}`)
    return JSON.parse(raw) as PageGraphIndex
  } catch {
    return {}
  }
}

/**
 * Upsert: for each page_path, merge the new graph names into the existing list.
 * Existing entries for page_paths not in the update are preserved.
 */
export async function upsertPageGraphIndex(
  projectPath: string,
  updates: Record<string, string[]>,
): Promise<void> {
  const pp = normalizePath(projectPath)
  const current = await loadPageGraphIndex(pp)
  for (const [pagePath, graphs] of Object.entries(updates)) {
    const existing = new Set(current[pagePath] ?? [])
    for (const g of graphs) existing.add(g)
    current[pagePath] = Array.from(existing)
  }
  await createDirectory(`${pp}/.llm-wiki`)
  await writeFile(`${pp}/${INDEX_PATH}`, JSON.stringify(current, null, 2))
}

/** Look up which graphs are associated with a given page_path. Returns [] if not found. */
export function lookupPageGraphs(index: PageGraphIndex, pagePath: string): string[] {
  return index[pagePath] ?? []
}

/** Returns all page_paths associated with the given graphName. */
export function findPagesByGraph(index: PageGraphIndex, graphName: string): string[] {
  return Object.entries(index)
    .filter(([, graphs]) => graphs.includes(graphName))
    .map(([pagePath]) => pagePath)
}
