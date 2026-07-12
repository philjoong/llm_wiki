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
import { listDirectory, deleteFile } from "@/commands/fs"
import { getGraphContext } from "@/lib/graph-qna"
import { normalizePath } from "@/lib/path-utils"
import { getOutputLanguage, buildLanguageReminder } from "@/lib/output-language"
import { isGreeting } from "@/lib/greeting-detector"
import { loadQuestionTypes } from "@/lib/question-types"
import { citationPrompt, finalizeCitations, issueCitationMap } from "@/lib/chat-citations"
import { searchSectionCandidates, type SectionCandidate } from "@/lib/knowledge"


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
      // The v2 section provider currently has deterministic lexical retrieval;
      // retain this argument for the ChatInput contract until its embedding
      // provider is added without resurrecting file-search fallback.
      void useEmbedding
      // Auto-create a conversation if none is active
      let convId = useStore.getState().activeConversationId
      if (!convId) {
        convId = createConversation()
      }

      addMessage("user", text)
      setStreaming(true)

      // Build system prompt with wiki context using graph-enhanced retrieval
      const systemMessages: LLMMessage[] = []
      let citationEntries: ReturnType<typeof issueCitationMap> = []
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

        // Section retrieval is the sole document input for Chat. `useEmbedding`
        // is deliberately not used to re-enable the retired file-search path.
        const sectionCandidates = await searchSectionCandidates(pp, text, graphPrefixFilter)

        // Preserve graph empty-state behavior, but do not inject graph output
        // as a second, uncitable document source.
        const graphBlocks = await getGraphContext(text, pp, project.name, llmConfig, graphPrefixFilter)
        const noGraphContext = graphBlocks.length === 0
        citationEntries = issueCitationMap(sectionCandidates as SectionCandidate[])
        const noRelevantDocs = citationEntries.length === 0

        const outLang = getOutputLanguage(text)

        systemMessages.push({
            role: "system",
            content: [
              "You are a knowledgeable wiki assistant. Answer questions based on the wiki content provided below.",
              "",
              "## Rules",
              "- Answer based ONLY on the issued citation sections provided below.",
              "- If the provided pages don't contain enough information, say so honestly.",
              noRelevantDocs
                ? "- No wiki page relevant to this question was found. State honestly that you could not find a relevant document in the wiki — do NOT invent an answer or use unrelated background knowledge."
                : "",
              noGraphContext
                ? "- No relevant knowledge graph relations, entities, or connecting path were found for this question. If the question asks how two things relate and the graph has no data on it, say honestly that you could not find a direct connection — do NOT invent a relationship."
                : "",
              "- If the user's message contains multiple distinct questions, answer each one separately and clearly (e.g. numbered or with a short heading per question) rather than blending them into a single combined answer.",
              "- Cite only with the exact marker syntax [[CIT:key]] for an issued key. Never invent a key, page ID, path, or quote.",
              "",
              "Use markdown formatting for clarity.",
              "",
              `## Citation Sections\n\n${citationPrompt(citationEntries)}`,
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
            finalizeStream(accumulated, finalizeCitations(accumulated, citationEntries))
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
