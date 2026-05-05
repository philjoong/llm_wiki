import { useState, useCallback } from "react"
import { Search, FileText } from "lucide-react"
import { useWikiStore } from "@/stores/wiki-store"
import { readFile } from "@/commands/fs"
import type { SearchResult } from "@/lib/search"
import {
  runExcludeSearch,
  type SearchTrace,
} from "@/lib/exclude-search"
import { useTranslation } from "react-i18next"
import { normalizePath } from "@/lib/path-utils"
import { ExclusionTrace } from "./exclusion-trace"

export function SearchView() {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setFileContent = useWikiStore((s) => s.setFileContent)
  const setActiveView = useWikiStore((s) => s.setActiveView)

  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const [trace, setTrace] = useState<SearchTrace | null>(null)
  const [searching, setSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)

  const doSearch = useCallback(
    async (q: string) => {
      if (!project || !q.trim()) {
        setResults([])
        setTrace(null)
        return
      }
      setSearching(true)
      setHasSearched(true)
      try {
        const out = await runExcludeSearch(
          q,
          normalizePath(project.path),
          llmConfig,
        )
        setResults(out.hits)
        setTrace(out.trace)
      } catch (err) {
        console.error("Search failed:", err)
        setResults([])
        setTrace(null)
      } finally {
        setSearching(false)
      }
    },
    [project, llmConfig],
  )

  async function handleOpen(result: SearchResult) {
    try {
      const content = await readFile(result.path)
      setSelectedFile(result.path)
      setFileContent(content)
      setActiveView("wiki")
    } catch (err) {
      console.error("Failed to open search result:", err)
    }
  }

  // §2.10 — when residue is 0 AND a type was judged, show its
  // zeroResidueMeaning instead of the generic "no results" copy.
  const zeroResidueMessage =
    trace &&
    trace.judgedType !== null &&
    trace.residueCount === 0 &&
    trace.zeroResidueMeaning

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b px-4 py-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") doSearch(query) }}
            placeholder={t("search.placeholder") + " (Enter to search)"}
            autoFocus
            className="w-full rounded-md border bg-background py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {searching ? (
          <div className="p-4 text-center text-sm text-muted-foreground">Searching...</div>
        ) : !hasSearched ? (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
            <Search className="h-8 w-8 text-muted-foreground/30" />
            <p>Press Enter to search</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1 p-2">
            {trace && <ExclusionTrace trace={trace} />}

            {results.length === 0 ? (
              zeroResidueMessage ? (
                <div className="rounded-md border border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-950/20 p-3 text-sm">
                  <div className="font-medium text-emerald-700 dark:text-emerald-400 mb-1">
                    {t("search.zeroResidue.label")}
                  </div>
                  <div className="text-emerald-900/80 dark:text-emerald-200/70 whitespace-pre-wrap">
                    {trace!.zeroResidueMeaning}
                  </div>
                </div>
              ) : (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  {t("search.noResults")} <span className="font-medium">"{query}"</span>
                </div>
              )
            ) : (
              <>
                <div className="px-2 py-1 text-xs text-muted-foreground">
                  {results.length} result{results.length !== 1 ? "s" : ""}
                </div>
                {results.map((result) => (
                  <SearchResultCard
                    key={result.path}
                    result={result}
                    query={query}
                    onClick={() => handleOpen(result)}
                  />
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function SearchResultCard({
  result,
  query,
  onClick,
}: {
  result: SearchResult
  query: string
  onClick: () => void
}) {
  // db/ 우선, 그다음 wiki/, 둘 다 아니면 풀 path. 패스에 둘 다 있으면 더 깊은
  // 분기를 살린다 (보통 db/ 트리 안에 있는 결과).
  const dbIdx = result.path.lastIndexOf("/db/")
  const wikiIdx = result.path.lastIndexOf("/wiki/")
  const shortPath =
    dbIdx >= 0
      ? result.path.slice(dbIdx + 1)
      : wikiIdx >= 0
        ? result.path.slice(wikiIdx + 1)
        : result.path

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-lg border p-3 text-left text-sm hover:bg-accent transition-colors"
    >
      <div className="flex items-start gap-2 mb-1.5">
        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">
            <HighlightedText text={result.title} query={query} />
          </div>
          <div className="text-[11px] text-muted-foreground truncate">{shortPath}</div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground line-clamp-2">
        <HighlightedText text={result.snippet} query={query} />
      </p>
    </button>
  )
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>

  const regex = new RegExp(`(${escapeRegex(query)})`, "gi")
  const parts = text.split(regex)

  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark key={i} className="bg-yellow-200 dark:bg-yellow-800 rounded px-0.5">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  )
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
