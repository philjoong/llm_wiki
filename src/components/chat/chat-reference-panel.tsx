import { useEffect, useState } from "react"
import { X, ExternalLink } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { useWikiStore } from "@/stores/wiki-store"
import { readFile } from "@/commands/fs"
import { getKnowledgePage } from "@/commands/knowledge"
import { parseMarkdownV2 } from "@/lib/markdown-v2"
import { locateCitation } from "@/lib/chat-citations"
import { normalizePath, getFileName } from "@/lib/path-utils"

export function ChatReferencePanel() {
  const preview = useWikiStore((s) => s.chatReferencePreview)
  const setChatReferencePreview = useWikiStore((s) => s.setChatReferencePreview)
  const setPendingOpenFile = useWikiStore((s) => s.setPendingOpenFile)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const project = useWikiStore((s) => s.project)
  const [state, setState] = useState<{ path: string; title: string; heading: string; text: string; range: { startOffset: number; endOffset: number } | null } | null>(null)

  useEffect(() => {
    if (!preview || !project) { setState(null); return }
    let cancelled = false
    const pp = normalizePath(project.path)
    Promise.all([getKnowledgePage(pp, preview.pageId), Promise.resolve(preview)])
      .then(async ([page, citation]) => {
        if (!page) throw new Error("page missing")
        const path = `${pp}/${page.pagePath}`
        const parsed = parseMarkdownV2(await readFile(path))
        if (parsed.page.page_id !== citation.pageId) throw new Error("page identity changed")
        const section = parsed.sections.find((item) => item.sectionId === citation.sectionId)
        if (!section) throw new Error("section missing")
        // Prefer the page's display title over the file name; fall back to it.
        const title = page.title?.trim() || getFileName(path).replace(/\.md$/, "")
        if (!cancelled) setState({ path, title, heading: section.headingText, text: section.body, range: locateCitation(section.body, citation) })
      })
      .catch(() => { if (!cancelled) setState(null) })
    return () => { cancelled = true }
  }, [preview, project])

  if (!preview) return null
  const displayName = state ? state.title : "Reference"
  return <div className="flex h-full w-[380px] flex-shrink-0 flex-col border-l bg-background">
    <div className="flex items-center gap-2 border-b px-3 py-2">
      <span className="flex-1 truncate text-sm font-medium" title={displayName}>{displayName}</span>
      <button type="button" title="그래프에서 열기" disabled={!state} onClick={() => { if (state) { setPendingOpenFile(state.path); setActiveView("graph") } }} className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-40"><ExternalLink className="h-3.5 w-3.5" /></button>
      <button type="button" title="닫기" onClick={() => setChatReferencePreview(null)} className="rounded p-1 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
    </div>
    <div className="flex-1 overflow-y-auto px-4 py-3 text-sm">
      {!state ? <p className="text-xs text-muted-foreground">근거 구간을 찾을 수 없음</p> : <>
        <h3 className="mb-2 font-medium">{state.heading}</h3>
        {!state.range && <p className="mb-2 text-xs text-muted-foreground">근거 구간을 찾을 수 없음</p>}
        <SectionMarkdown text={state.text} range={state.range} />
      </>}
    </div>
  </div>
}

function SectionMarkdown({ text, range }: { text: string; range: { startOffset: number; endOffset: number } | null }) {
  if (!range) return <Markdown text={text} />
  return <div><Markdown text={text.slice(0, range.startOffset)} /><mark className="rounded bg-yellow-200 px-0.5 dark:bg-yellow-900/60">{text.slice(range.startOffset, range.endOffset)}</mark><Markdown text={text.slice(range.endOffset)} /></div>
}

function Markdown({ text }: { text: string }) {
  return <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1"><ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown></div>
}
