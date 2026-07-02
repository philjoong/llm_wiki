import { readFile, writeFile, createDirectory } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { getGraphBackend } from "@/lib/graph-backend"

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

/** Remove a page_path entry entirely from the index and persist. */
export async function removePageFromIndex(projectPath: string, pagePath: string): Promise<void> {
  const pp = normalizePath(projectPath)
  const current = await loadPageGraphIndex(pp)
  if (!(pagePath in current)) return
  delete current[pagePath]
  await createDirectory(`${pp}/.llm-wiki`)
  await writeFile(`${pp}/${INDEX_PATH}`, JSON.stringify(current, null, 2))
}

/** Remove a graphName from every page entry (e.g. after deleting the graph). Drops entries left with no graphs. */
export async function removeGraphFromIndex(projectPath: string, graphName: string): Promise<void> {
  const pp = normalizePath(projectPath)
  const current = await loadPageGraphIndex(pp)
  let changed = false
  for (const [pagePath, graphs] of Object.entries(current)) {
    if (!graphs.includes(graphName)) continue
    changed = true
    const remaining = graphs.filter((g) => g !== graphName)
    if (remaining.length === 0) delete current[pagePath]
    else current[pagePath] = remaining
  }
  if (!changed) return
  await createDirectory(`${pp}/.llm-wiki`)
  await writeFile(`${pp}/${INDEX_PATH}`, JSON.stringify(current, null, 2))
}

/**
 * Rebuild the index from scratch by scanning every graph's nodes for their
 * page_path. Overwrites the persisted index so it matches SQLite exactly —
 * this repairs drift left behind by manual edits that don't touch the index.
 */
export async function rebuildPageGraphIndex(projectName: string, projectPath: string): Promise<PageGraphIndex> {
  const pp = normalizePath(projectPath)
  const backend = await getGraphBackend(pp)
  const graphNames = await backend.listGraphs(projectName)

  const rebuilt: PageGraphIndex = {}
  for (const graphName of graphNames) {
    const snapshot = await backend.queryGraph(projectName, graphName, { type: "all" })
    for (const node of snapshot.nodes) {
      if (!node.pagePath) continue
      const existing = rebuilt[node.pagePath] ?? []
      if (!existing.includes(graphName)) existing.push(graphName)
      rebuilt[node.pagePath] = existing
    }
  }

  await createDirectory(`${pp}/.llm-wiki`)
  await writeFile(`${pp}/${INDEX_PATH}`, JSON.stringify(rebuilt, null, 2))
  return rebuilt
}
