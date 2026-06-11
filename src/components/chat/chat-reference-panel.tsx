import { useEffect, useRef, useState } from "react"
import { X, ExternalLink } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { useWikiStore } from "@/stores/wiki-store"
import { readFile } from "@/commands/fs"
import { normalizePath, getFileName } from "@/lib/path-utils"

export function ChatReferencePanel() {
  const preview = useWikiStore((s) => s.chatReferencePreview)
  const setChatReferencePreview = useWikiStore((s) => s.setChatReferencePreview)
  const setPendingOpenFile = useWikiStore((s) => s.setPendingOpenFile)
  const setActiveView = useWikiStore((s) => s.setActiveView)

  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const highlightRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!preview) {
      setContent(null)
      return
    }
    setLoading(true)
    setContent(null)
    readFile(preview.path)
      .then((c) => setContent(c))
      .catch(() => setContent("(파일을 읽을 수 없습니다)"))
      .finally(() => setLoading(false))
  }, [preview?.path])

  // Scroll highlighted section into view after render
  useEffect(() => {
    if (!preview?.highlightSection || !highlightRef.current) return
    const el = highlightRef.current.querySelector("[data-highlighted]")
    el?.scrollIntoView({ behavior: "smooth", block: "center" })
  }, [content, preview?.highlightSection])

  if (!preview) return null

  const fileName = getFileName(normalizePath(preview.path))

  return (
    <div className="flex h-full w-[380px] flex-shrink-0 flex-col border-l bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className="flex-1 truncate text-sm font-medium text-foreground" title={fileName}>
          {fileName.replace(/\.md$/, "")}
        </span>
        <button
          type="button"
          title="그래프에서 열기"
          onClick={() => {
            setPendingOpenFile(preview.path)
            setActiveView("graph")
          }}
          className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="닫기"
          onClick={() => setChatReferencePreview(null)}
          className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Body */}
      <div ref={highlightRef} className="flex-1 overflow-y-auto px-4 py-3 text-sm">
        {loading && (
          <p className="text-muted-foreground text-xs">불러오는 중...</p>
        )}
        {!loading && content !== null && (
          <HighlightedMarkdown
            content={content}
            highlightSection={preview.highlightSection}
          />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section-level highlight renderer
// ---------------------------------------------------------------------------

interface HighlightedMarkdownProps {
  content: string
  highlightSection?: string
}

function HighlightedMarkdown({ content, highlightSection }: HighlightedMarkdownProps) {
  // Strip YAML frontmatter
  const body = content.replace(/^---[\s\S]*?---\n?/, "")

  if (!highlightSection) {
    return <PlainMarkdown content={body} />
  }

  // Split on ATX headings (# / ## / ### …)
  // Each section = heading line + following content until next heading
  const sectionRegex = /^(#{1,6} .+)$/m
  const parts = body.split(sectionRegex)
  // parts: [preface?, heading, body, heading, body, ...]

  const sections: Array<{ heading: string | null; body: string }> = []
  if (parts[0].trim()) {
    sections.push({ heading: null, body: parts[0] })
  }
  for (let i = 1; i < parts.length; i += 2) {
    sections.push({ heading: parts[i], body: parts[i + 1] ?? "" })
  }

  // Tokenize snippet into meaningful words (4+ chars, alpha/CJK)
  const needleTokens = highlightSection
    .toLowerCase()
    .split(/[\s,.()\[\]{}<>:;!?'"\/\\|]+/)
    .filter((t) => t.length >= 4)

  // Find best-matching section by token overlap score
  let bestIdx = -1
  let bestScore = 0
  sections.forEach((sec, idx) => {
    const sectionText = ((sec.heading ?? "") + " " + sec.body).toLowerCase()
    const matches = needleTokens.filter((t) => sectionText.includes(t)).length
    const score = needleTokens.length > 0 ? matches / needleTokens.length : 0
    if (score > bestScore) {
      bestScore = score
      bestIdx = idx
    }
  })
  // Require at least 30% token overlap to highlight
  const highlightIdx = bestScore >= 0.3 ? bestIdx : -1

  return (
    <div className="space-y-0">
      {sections.map((sec, idx) => {
        const isHighlighted = idx === highlightIdx
        const md = (sec.heading ? sec.heading + "\n" : "") + sec.body

        return (
          <div
            key={idx}
            data-highlighted={isHighlighted ? "" : undefined}
            className={
              isHighlighted
                ? "rounded-md bg-yellow-100 dark:bg-yellow-900/40 px-2 py-1 -mx-2"
                : undefined
            }
          >
            <PlainMarkdown content={md} />
          </div>
        )
      })}
    </div>
  )
}

function PlainMarkdown({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:my-2 prose-code:text-xs prose-code:before:content-none prose-code:after:content-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}
