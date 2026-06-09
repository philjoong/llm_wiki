import { useRef, useState, useCallback, useEffect } from "react"
import { Send, Square, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { loadQuestionTypes, type QuestionType } from "@/lib/question-types"
import { useWikiStore } from "@/stores/wiki-store"

interface ChatInputProps {
  onSend: (text: string, questionTypeId?: string, useEmbedding?: boolean) => void
  onStop: () => void
  isStreaming: boolean
  placeholder?: string
  projectPath?: string
}

export function ChatInput({ onSend, onStop, isStreaming, placeholder, projectPath }: ChatInputProps) {
  const [value, setValue] = useState("")
  const [questionTypes, setQuestionTypes] = useState<QuestionType[]>([])
  const [selectedTypeId, setSelectedTypeId] = useState<string>("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const embeddingConfig = useWikiStore((s) => s.embeddingConfig)
  const embeddingAvailable =
    embeddingConfig.enabled &&
    (embeddingConfig.source === "builtin" || !!embeddingConfig.model)
  const [useEmbedding, setUseEmbedding] = useState(() => embeddingAvailable)

  // Sync initial embedding toggle state when embeddingConfig loads
  useEffect(() => {
    setUseEmbedding(embeddingAvailable)
  }, [embeddingAvailable])

  useEffect(() => {
    if (!projectPath) return
    loadQuestionTypes(projectPath).then(setQuestionTypes).catch(() => {})
  }, [projectPath])

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value)
    const ta = e.target
    ta.style.height = "auto"
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`
  }, [])

  const handleSend = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed || isStreaming) return
    onSend(trimmed, selectedTypeId || undefined, useEmbedding)
    setValue("")
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
    }
  }, [value, isStreaming, onSend, selectedTypeId, useEmbedding])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend],
  )

  return (
    <div className="flex flex-col border-t">
      <div className="flex items-end gap-2 p-3 pb-1">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? "Type a message... (Enter to send, Shift+Enter for newline)"}
          disabled={isStreaming}
          rows={1}
          className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          style={{ maxHeight: "120px", overflowY: "auto" }}
        />
        {isStreaming ? (
          <Button
            variant="destructive"
            size="icon"
            onClick={onStop}
            className="shrink-0"
            title="Stop generation"
          >
            <Square className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!value.trim()}
            className="shrink-0"
            title="Send message"
          >
            <Send className="h-4 w-4" />
          </Button>
        )}
      </div>
      {projectPath && (
        <div className="flex items-center justify-end gap-2 px-3 pb-2">
          <button
            type="button"
            onClick={() => embeddingAvailable && setUseEmbedding((v) => !v)}
            disabled={isStreaming || !embeddingAvailable}
            title={
              embeddingAvailable
                ? `Embedding search: ${useEmbedding ? "ON" : "OFF"}`
                : "Embedding not configured (set endpoint & model in Settings)"
            }
            className={`flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              useEmbedding && embeddingAvailable
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-background text-muted-foreground"
            }`}
          >
            <Zap className="h-3 w-3" />
            RAG
          </button>
          <select
            value={selectedTypeId}
            onChange={(e) => setSelectedTypeId(e.target.value)}
            disabled={isStreaming}
            className="w-36 rounded-md border bg-background px-2 py-1 text-xs text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="">None</option>
            {questionTypes.map((qt) => (
              <option key={qt.id} value={qt.id}>
                {qt.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  )
}
