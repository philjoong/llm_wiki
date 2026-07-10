import { useRef, useEffect, useCallback, useState } from "react"
import { BookOpen, Plus, Trash2, MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ChatMessage, StreamingMessage, useSourceFiles } from "./chat-message"
import { ChatInput } from "./chat-input"
import { ChatReferencePanel } from "./chat-reference-panel"
import { useChatStore, chatMessagesToLLM, type ChatStoreHook } from "@/stores/chat-store"
import { useWikiStore } from "@/stores/wiki-store"
import { streamChat, type ChatMessage as LLMMessage } from "@/lib/llm-client"
import { executeIngestWrites } from "@/lib/ingest"
import { listDirectory, readFile, deleteFile } from "@/commands/fs"
import { searchWiki } from "@/lib/search"
import { getGraphContext, formatGraphContextBlocks } from "@/lib/graph-qna"
import { normalizePath, getRelativePath } from "@/lib/path-utils"
import { getOutputLanguage, buildLanguageReminder } from "@/lib/output-language"
import { isGreeting } from "@/lib/greeting-detector"
import { computeContextBudget } from "@/lib/context-budget"
import { loadQuestionTypes } from "@/lib/question-types"

// Store the page mapping from the last query so SourceFilesBar can show which pages were cited
export let lastQueryPages: { title: string; path: string }[] = []

function formatDate(timestamp: number): string {
  const d = new Date(timestamp)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  if (isToday) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" })
}

function ConversationSidebar({ useStore }: { useStore: ChatStoreHook }) {
  const conversations = useStore((s) => s.conversations)
  const activeConversationId = useStore((s) => s.activeConversationId)
  const messages = useStore((s) => s.messages)
  const createConversation = useStore((s) => s.createConversation)
  const deleteConversation = useStore((s) => s.deleteConversation)
  const setActiveConversation = useStore((s) => s.setActiveConversation)

  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)

  function getMessageCount(convId: string): number {
    return messages.filter((m) => m.conversationId === convId).length
  }

  return (
    <div className="flex h-full w-[200px] flex-shrink-0 flex-col border-r bg-muted/30">
      <div className="border-b p-2">
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-2"
          onClick={() => createConversation()}
        >
          <Plus className="h-3.5 w-3.5" />
          New Chat
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {sorted.length === 0 ? (
          <p className="px-3 py-4 text-xs text-muted-foreground text-center">
            No conversations yet
          </p>
        ) : (
          sorted.map((conv) => {
            const isActive = conv.id === activeConversationId
            const msgCount = getMessageCount(conv.id)
            return (
              <div
                key={conv.id}
                className={`group relative mx-1 my-0.5 flex cursor-pointer flex-col rounded-md px-2 py-1.5 text-sm transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-accent text-foreground"
                }`}
                onClick={() => setActiveConversation(conv.id)}
                onMouseEnter={() => setHoveredId(conv.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                <div className="flex items-start justify-between gap-1">
                  <span className="line-clamp-2 flex-1 text-xs font-medium leading-snug">
                    {conv.title}
                  </span>
                  {hoveredId === conv.id && (
                    <button
                      className="flex-shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteConversation(conv.id)
                        // Delete persisted chat file
                        const proj = useWikiStore.getState().project
                        if (proj) {
                          deleteFile(`${proj.path}/.llm-wiki/chats/${conv.id}.json`).catch(() => {})
                        }
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <span>{formatDate(conv.updatedAt)}</span>
                  {msgCount > 0 && (
                    <>
                      <span>·</span>
                      <span>{msgCount} msgs</span>
                    </>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

export function ChatPanel({
  useStore = useChatStore,
  graphPrefixFilter,
}: {
  /** Store hook backing this panel's conversations. Defaults to the shared
   * main-Chat store; pass a separate instance (createChatStore()) for a
   * tab-scoped query widget so its conversations don't interleave with the
   * main Chat tab's. */
  useStore?: ChatStoreHook
  /** Restricts graph selection to graphs whose name starts with this
   * prefix (e.g. "casemap_"). Omit for the main Chat tab (all graphs). */
  graphPrefixFilter?: string
} = {}) {
  useSourceFiles() // Keep source file cache warm
  const chatReferencePreview = useWikiStore((s) => s.chatReferencePreview)
  const activeConversationId = useStore((s) => s.activeConversationId)
  const isStreaming = useStore((s) => s.isStreaming)
  const streamingContent = useStore((s) => s.streamingContent)
  const mode = useStore((s) => s.mode)
  const addMessage = useStore((s) => s.addMessage)
  const setStreaming = useStore((s) => s.setStreaming)
  const appendStreamToken = useStore((s) => s.appendStreamToken)
  const finalizeStream = useStore((s) => s.finalizeStream)
  const createConversation = useStore((s) => s.createConversation)
  const removeLastAssistantMessage = useStore((s) => s.removeLastAssistantMessage)
  const maxHistoryMessages = useStore((s) => s.maxHistoryMessages)

  // Derive active messages via selector to re-render on message changes
  const allMessages = useStore((s) => s.messages)
  const activeMessages = activeConversationId
    ? allMessages.filter((m) => m.conversationId === activeConversationId)
    : []

  const project = useWikiStore((s) => s.project)
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const setFileTree = useWikiStore((s) => s.setFileTree)

  const abortRef = useRef<AbortController | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when messages change or streaming content updates
  useEffect(() => {
    const container = scrollContainerRef.current
    if (container) {
      container.scrollTop = container.scrollHeight
    }
  }, [activeMessages, streamingContent])

  const handleSend = useCallback(
    async (text: string, questionTypeId?: string, useEmbedding?: boolean) => {
      // Auto-create a conversation if none is active
      let convId = useStore.getState().activeConversationId
      if (!convId) {
        convId = createConversation()
      }

      addMessage("user", text)
      setStreaming(true)

      // Build system prompt with wiki context using graph-enhanced retrieval
      const systemMessages: LLMMessage[] = []
      let queryRefs: { title: string; path: string }[] = []
      let langReminder: string | undefined
      // Pure greetings ("hi", "你好", "嗨") don't warrant running the whole
      // retrieval pipeline — it's slow, costs context, and drags in random
      // wiki pages the user clearly didn't ask about. Short-circuit with a
      // minimal system prompt and let the model reply conversationally.
      const greetingOnly = isGreeting(text)
      if (project && greetingOnly) {
        const outLang = getOutputLanguage(text)
        systemMessages.push({
          role: "system",
          content: [
            `You are a wiki assistant for the project "${project.name}".`,
            "The user sent a casual greeting — reply briefly and naturally, in one or two sentences.",
            "Do NOT invent wiki content or pretend to have retrieved pages. Invite the user to ask a concrete question if they want information from the wiki.",
            "",
            `Respond in ${outLang}.`,
          ].join("\n"),
        })
        // Skip retrieval; queryRefs stays empty so no "Sources" chip is shown.
      } else if (project) {
        const pp = normalizePath(project.path)

        // ── Budget allocation (see context-budget.ts) ─────────
        // Page budget scales with the LLM's context window; we now
        // also reserve ~15% as headroom for the response so the
        // model isn't truncated mid-sentence on a packed prompt.
        const {
          indexBudget: INDEX_BUDGET,
          pageBudget: PAGE_BUDGET,
          maxPageSize: MAX_PAGE_SIZE,
        } = computeContextBudget(llmConfig.maxContextSize)

        const rawIndex = await readFile(`${pp}/db/index.md`).catch(() => "")

        // ── Phase 1: Search retrieval ──────────────────────────
        // useEmbedding=false: temporarily override embeddingConfig so
        // fuseTokenAndVector skips vector search for this query only.
        const { useWikiStore: _wikiStore } = await import("@/stores/wiki-store")
        let embeddingRestoreValue: ReturnType<typeof _wikiStore.getState>["embeddingConfig"] | null = null
        if (useEmbedding === false) {
          embeddingRestoreValue = _wikiStore.getState().embeddingConfig
          _wikiStore.getState().setEmbeddingConfig({ ...embeddingRestoreValue, enabled: false })
        }
        let searchResults
        try {
          searchResults = await searchWiki(pp, text)
        } finally {
          if (embeddingRestoreValue !== null) {
            _wikiStore.getState().setEmbeddingConfig(embeddingRestoreValue)
          }
        }

        // ── Trim index by relevance if over budget ─────────────
        let index = rawIndex
        if (rawIndex.length > INDEX_BUDGET) {
          const { tokenizeQuery } = await import("@/lib/search")
          const tokens = tokenizeQuery(text)
          const lines = rawIndex.split("\n")
          const keptLines: string[] = []
          let keptSize = 0

          for (const line of lines) {
            const isHeader = line.startsWith("##")
            const lower = line.toLowerCase()
            const isRelevant = tokens.some((t) => lower.includes(t))

            if (isHeader || isRelevant) {
              if (keptSize + line.length + 1 <= INDEX_BUDGET) {
                keptLines.push(line)
                keptSize += line.length + 1
              }
            }
          }
          index = keptLines.join("\n")
          if (index.length < rawIndex.length) {
            index += "\n\n[...index trimmed to relevant entries...]"
          }
        }

        // ── Step 3: Graph Q&A (relation / entity / path queries) ─────
        const graphBlocks = await getGraphContext(text, pp, project.name, llmConfig, graphPrefixFilter)
        const noGraphContext = graphBlocks.length === 0
        const cypherContext = formatGraphContextBlocks(graphBlocks)

        // ── Phase 3 & 4: Page budget control ───────────────────
        let usedChars = 0
        type PageEntry = { title: string; path: string; content: string; priority: number }
        const relevantPages: PageEntry[] = []

        const tryAddPage = async (title: string, filePath: string, priority: number): Promise<boolean> => {
          if (usedChars >= PAGE_BUDGET) return false
          try {
            const raw = await readFile(filePath)
            const relativePath = getRelativePath(filePath, pp)
            const truncated = raw.length > MAX_PAGE_SIZE
              ? raw.slice(0, MAX_PAGE_SIZE) + "\n\n[...truncated...]"
              : raw
            if (usedChars + truncated.length > PAGE_BUDGET) return false
            usedChars += truncated.length
            relevantPages.push({ title, path: relativePath, content: truncated, priority })
            return true
          } catch { return false }
        }

        // P0: Title matches
        for (const r of searchResults.filter((r) => r.titleMatch)) {
          await tryAddPage(r.title, r.path, 0)
        }
        // P1: Content matches
        for (const r of searchResults.filter((r) => !r.titleMatch)) {
          await tryAddPage(r.title, r.path, 1)
        }
        // No relevant document → no fallback page. searchWiki's threshold
        // (Phase B) already means "empty" is a considered answer, not just
        // "nothing happened to match" — showing Overview here would violate
        // "관련 없으면 아무것도 반환하지 않는다" by handing the LLM an
        // unrelated page to answer from.
        const noRelevantDocs = relevantPages.length === 0

        const pagesContext = relevantPages.length > 0
          ? relevantPages.map((p, i) =>
              `### [${i + 1}] ${p.title}\nPath: ${p.path}\n\n${p.content}`
            ).join("\n\n---\n\n")
          : "(No db pages found)"

        const pageList = relevantPages.map((p, i) =>
          `[${i + 1}] ${p.title} (${p.path})`
        ).join("\n")

        const outLang = getOutputLanguage(text)

        systemMessages.push({
            role: "system",
            content: [
              "You are a knowledgeable wiki assistant. Answer questions based on the wiki content provided below.",
              "",
              "## Rules",
              "- Answer based ONLY on the numbered wiki pages provided below.",
              "- If the provided pages don't contain enough information, say so honestly.",
              noRelevantDocs
                ? "- No wiki page relevant to this question was found. State honestly that you could not find a relevant document in the wiki — do NOT invent an answer or use unrelated background knowledge."
                : "",
              noGraphContext
                ? "- No relevant knowledge graph relations, entities, or connecting path were found for this question. If the question asks how two things relate and the graph has no data on it, say honestly that you could not find a direct connection — do NOT invent a relationship."
                : "",
              "- If the user's message contains multiple distinct questions, answer each one separately and clearly (e.g. numbered or with a short heading per question) rather than blending them into a single combined answer.",
              "- Use [[wikilink]] syntax to reference wiki pages.",
              "- When citing information, use the page number in brackets, e.g. [1], [2].",
              "- At the END of your response, add a `## Sources` section listing every page you cited as a wikilink, one per line, in the order you cited them.",
              "  Example:",
              "  ## Sources",
              "  - [[entities/foo]]",
              "  - [[concepts/bar]]",
              "- After the `## Sources` section, add a hidden comment listing which page numbers you used:",
              "  <!-- cited: 1, 3, 5 -->",
              "",
              "Use markdown formatting for clarity.",
              "",
              cypherContext,
              "",
              index ? `## Wiki Index\n${index}` : "",
              relevantPages.length > 0 ? `## Page List\n${pageList}` : "",
              `## Wiki Pages\n\n${pagesContext}`,
              "",
              "---",
              "",
              `## ⚠️ MANDATORY OUTPUT LANGUAGE: ${outLang}`,
              "",
              `You MUST write your entire response in **${outLang}**.`,
              `The wiki content above may be in a different language, but this is IRRELEVANT to your output language.`,
              `Ignore the language of the wiki content. Write in ${outLang} only.`,
              `Even proper nouns should use standard ${outLang} transliteration when appropriate.`,
              `DO NOT use any other language. This overrides all other instructions.`,
            ].filter(Boolean).join("\n"),
          })

        // Reminder injected later, right before the user's current message
        // (after history so it's the last system instruction the LLM sees).
        langReminder = buildLanguageReminder(text)

        // Inject Answer Format section if a question type is selected
        if (questionTypeId) {
          const allTypes = await loadQuestionTypes(pp)
          const qt = allTypes.find((t) => t.id === questionTypeId)
          if (qt) {
            const formatLines: string[] = ["", "## Answer Format"]
            if (qt.fields && Object.keys(qt.fields).length > 0) {
              formatLines.push("Your answer must include each of the following fields:")
              for (const [key, desc] of Object.entries(qt.fields)) {
                formatLines.push(`- **${key}**: ${desc}`)
              }
            }
            if (qt.promptTemplate) {
              formatLines.push("", qt.promptTemplate)
            }
            const sysMsg = systemMessages[systemMessages.length - 1]
            if (sysMsg) {
              sysMsg.content = sysMsg.content + formatLines.join("\n")
            }
          }
        }

        lastQueryPages = relevantPages.map((p) => ({ title: p.title, path: p.path }))
        queryRefs = [...lastQueryPages]
      }

      // ── Conversation history with count limit ────────────────
      // Only include messages from the active conversation, last N messages
      const activeConvMessages = useStore
        .getState()
        .getActiveMessages()
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-maxHistoryMessages)

      // Prepend the language reminder onto the final user turn rather than
      // inserting a second {role:"system"} between history and the final
      // user message. vLLM / llama.cpp / Ollama drive their chat templates
      // from HF Jinja, and Qwen3-family templates enforce "system only at
      // index 0" — a mid-conversation system message gets rejected with
      // "System message must be at the beginning." (HTTP 400). OpenAI and
      // Anthropic are more lenient, but keeping a single system at the top
      // is the safest shape across every OpenAI-compatible backend.
      const historyMessages = chatMessagesToLLM(activeConvMessages)
      let llmMessages: LLMMessage[] = [...systemMessages, ...historyMessages]
      if (langReminder && historyMessages.length > 0) {
        const lastIdx = llmMessages.length - 1
        const last = llmMessages[lastIdx]
        if (last && last.role === "user") {
          llmMessages = [
            ...llmMessages.slice(0, lastIdx),
            { role: "user", content: `[${langReminder}]\n\n${last.content}` },
          ]
        }
      }

      const controller = new AbortController()
      abortRef.current = controller

      let accumulated = ""

      await streamChat(
        llmConfig,
        llmMessages,
        {
          onToken: (token) => {
            accumulated += token
            appendStreamToken(token)
          },
          onDone: () => {
            finalizeStream(accumulated, queryRefs)
            abortRef.current = null
            // save-worthy detection removed — user has direct "Save to Wiki" button on each message
          },
          onError: (err) => {
            finalizeStream(`Error: ${err.message}`)
            abortRef.current = null
          },
        },
        controller.signal,
      )
    },
    [llmConfig, addMessage, setStreaming, appendStreamToken, finalizeStream, createConversation, maxHistoryMessages, useStore, graphPrefixFilter],
  )

  const handleStop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  const handleRegenerate = useCallback(async () => {
    if (isStreaming) return
    // Find the last user message in active conversation
    const active = useStore.getState().getActiveMessages()
    const lastUserMsg = [...active].reverse().find((m) => m.role === "user")
    if (!lastUserMsg) return
    // Remove the last assistant reply, then re-send
    removeLastAssistantMessage()
    // Small delay to let state update
    await new Promise((r) => setTimeout(r, 50))
    // Trigger send with the same text (handleSend will add a new user message,
    // so also remove the original to avoid duplication)
    // Actually: just call handleSend — but it adds a user message. To avoid dupe,
    // we remove the last user message too and let handleSend re-add it.
    const store = useStore.getState()
    const updatedActive = store.getActiveMessages()
    const lastUser = [...updatedActive].reverse().find((m) => m.role === "user")
    if (lastUser) {
      useStore.setState((s) => ({
        messages: s.messages.filter((m) => m.id !== lastUser.id),
      }))
    }
    handleSend(lastUserMsg.content)
  }, [isStreaming, removeLastAssistantMessage, handleSend, useStore])

  const handleWriteToWiki = useCallback(async () => {
    if (!project) return
    const pp = normalizePath(project.path)
    try {
      await executeIngestWrites(pp, llmConfig, undefined, undefined)
      try {
        const tree = await listDirectory(pp)
        setFileTree(tree)
      } catch {
        // ignore
      }
    } catch (err) {
      console.error("Failed to write to wiki:", err)
    }
  }, [project, llmConfig, setFileTree])

  const hasAssistantMessages = activeMessages.some((m) => m.role === "assistant")
  const showWriteButton = mode === "ingest" && !isStreaming && hasAssistantMessages

  return (
    <div className="flex h-full flex-row overflow-hidden">
      <ConversationSidebar useStore={useStore} />

      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {!activeConversationId ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <div className="text-center">
              <MessageSquare className="mx-auto mb-3 h-8 w-8 opacity-30" />
              <p className="text-sm">Start a new conversation</p>
              <p className="mt-1 text-xs opacity-60">Click "New Chat" to begin</p>
            </div>
          </div>
        ) : (
          <>
            <div
              ref={scrollContainerRef}
              className="flex-1 overflow-y-auto px-3 py-2"
            >
              <div className="flex flex-col gap-3">
                {activeMessages.map((msg, idx) => {
                  // Check if this is the last assistant message
                  const isLastAssistant = msg.role === "assistant" &&
                    !activeMessages.slice(idx + 1).some((m) => m.role === "assistant")
                  return (
                    <ChatMessage
                      key={msg.id}
                      message={msg}
                      isLastAssistant={isLastAssistant && !isStreaming}
                      onRegenerate={isLastAssistant ? handleRegenerate : undefined}
                    />
                  )
                })}
                {isStreaming && <StreamingMessage content={streamingContent} />}
                <div ref={bottomRef} />
              </div>
            </div>

            {showWriteButton && (
              <div className="border-t px-3 py-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleWriteToWiki}
                  className="w-full gap-2"
                >
                  <BookOpen className="h-4 w-4" />
                  Write to Wiki
                </Button>
              </div>
            )}
          </>
        )}

        <ChatInput
          onSend={handleSend}
          onStop={handleStop}
          isStreaming={isStreaming}
          projectPath={project ? normalizePath(project.path) : undefined}
          placeholder={
            mode === "ingest"
              ? "Discuss the source or ask follow-up questions..."
              : "Type a message..."
          }
        />
      </div>

      {chatReferencePreview && <ChatReferencePanel />}
    </div>
  )
}

