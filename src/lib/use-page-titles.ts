import { useEffect, useState } from "react"
import { listKnowledgePages } from "@/commands/knowledge"
import { useWikiStore } from "@/stores/wiki-store"
import { getFileName, getRelativePath, normalizePath } from "@/lib/path-utils"

/**
 * Map of v2 page path (relative to the project root, forward-slashed) → title.
 * Built once per project load / data change, not per file-tree node — a bulk
 * `list_knowledge_pages` query instead of one `get_knowledge_page` per row,
 * so a large document tree does not fan out into thousands of DB calls.
 */
export type PageTitleMap = Map<string, string>

export function usePageTitles(): PageTitleMap {
  const project = useWikiStore((s) => s.project)
  const dataVersion = useWikiStore((s) => s.dataVersion)
  const [map, setMap] = useState<PageTitleMap>(new Map())

  useEffect(() => {
    if (!project) { setMap(new Map()); return }
    let cancelled = false
    listKnowledgePages(normalizePath(project.path))
      .then((pages) => {
        if (cancelled) return
        const next: PageTitleMap = new Map()
        for (const page of pages) {
          if (page.title?.trim()) next.set(normalizePath(page.pagePath), page.title.trim())
        }
        setMap(next)
      })
      .catch(() => { if (!cancelled) setMap(new Map()) })
    return () => { cancelled = true }
  }, [project, dataVersion])

  return map
}

/**
 * Resolve a display name for an absolute file path. Prefers the v2 page title;
 * falls back to the file name (without .md) when the doc is not a v2 page, the
 * DB has no row for it, or the title is empty — i.e. the previous behavior.
 */
export function titleForPath(map: PageTitleMap, absPath: string, projectPath: string): string {
  const rel = getRelativePath(normalizePath(absPath), normalizePath(projectPath))
  const title = map.get(rel)
  if (title) return title
  return getFileName(absPath).replace(/\.md$/, "")
}
