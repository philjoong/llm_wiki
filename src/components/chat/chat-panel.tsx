import { useRef, useEffect, useCallback, useState } from "react"
import { Plus, Trash2, MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ChatMessage, StreamingMessage, useSourceFiles } from "./chat-message"
import { ChatInput } from "./chat-input"
import { ChatReferencePanel } from "./chat-reference-panel"
import { useChatStore, chatMessagesToLLM, type ChatStoreHook } from "@/stores/chat-store"
import { useWikiStore } from "@/stores/wiki-store"
import { streamChat, type ChatMessage as LLMMessage } from "@/lib/llm-client"
import { deleteFile } from "@/commands/fs"
import { getQueue } from "@/lib/ingest-queue"
import { getGraphContextWithEntities } from "@/lib/graph-qna"
import { findKnowledgeEntities } from "@/commands/knowledge"
import { normalizePath } from "@/lib/path-utils"
import { getOutputLanguage, buildLanguageReminder } from "@/lib/output-language"
import { isGreeting } from "@/lib/greeting-detector"
import { loadQuestionTypes, type QuestionType } from "@/lib/question-types"
import { buildRequiredInfoPrompt, parseJsonAnswer, parseInformationRequests } from "@/lib/json-answer"
import { formatInfoAnswer, parseInfoAnswer, injectLinkAnswer, injectFileAnswers } from "@/lib/chat-info-injection"
import { ChatInfoForms, type InfoRequestResolution } from "./chat-info-forms"
import { buildGraphPathsBlock, citationPrompt, finalizeCitations, issueCitationMap } from "@/lib/chat-citations"
import { predicatesForAxes, resolveAllowedGraphIds, searchSectionCandidatesWithPaths, type GraphPath, type SectionCandidate } from "@/lib/knowledge"
import { EMPTY_SCOPE, type ChatScopeSelection } from "./chat-scope-selector"
import { type HistoryPointSelection } from "./chat-history-picker"
import { buildPreviousVersionsBlock, collectPreviousVersions } from "@/lib/git-history"


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
  const embeddingConfig = useWikiStore((s) => s.embeddingConfig)

  // Question type selection is owned here so the empty-state picker and the
  // ChatInput dropdown share one value.
  const [questionTypes, setQuestionTypes] = useState<QuestionType[]>([])
  const [selectedTypeId, setSelectedTypeId] = useState<string>("")

  // Answer-scope selection is kept per conversation (Step 07): switching
  // conversations restores that conversation's scope; a fresh conversation
  // starts unrestricted. Held in-memory for the session (durability deferred).
  const [scopeByConversation, setScopeByConversation] = useState<Record<string, ChatScopeSelection>>({})
  const activeScope = (activeConversationId && scopeByConversation[activeConversationId]) || EMPTY_SCOPE
  const setActiveScope = useCallback((next: ChatScopeSelection) => {
    const convId = useStore.getState().activeConversationId
    if (!convId) return
    setScopeByConversation((prev) => ({ ...prev, [convId]: next }))
  }, [useStore])

  // The scope selector is shown only when the selected type opts in via
  // `retrieval.scope === "selectable"` — no question-type id hardcoding.
  const scopeSelectable = questionTypes.find((t) => t.id === selectedTypeId)?.retrieval?.scope === "selectable"

  // Comparison-point selection is kept per conversation (Step 09), sharing
  // the Step 07 scope-state pattern: in-memory for the session, restored on
  // conversation switch; null means "use the Step 08 per-file default".
  const [historyPointByConversation, setHistoryPointByConversation] = useState<Record<string, HistoryPointSelection>>({})
  const activeHistoryPoint = (activeConversationId && historyPointByConversation[activeConversationId]) || null
  const setActiveHistoryPoint = useCallback((next: HistoryPointSelection) => {
    const convId = useStore.getState().activeConversationId
    if (!convId) return
    setHistoryPointByConversation((prev) => ({ ...prev, [convId]: next }))
  }, [useStore])

  // The history picker is shown only when the selected type opts in via
  // `retrieval.include_history: true` — no question-type id hardcoding.
  const historySelectable = questionTypes.find((t) => t.id === selectedTypeId)?.retrieval?.includeHistory === true

  // Info items the user marked "unavailable" via an inline back-question form
  // (Step 11 §4). Kept per conversation AND per question type, in-memory only:
  // never persisted, so a later wiki update lets a fresh conversation re-ask.
  // Feeds the Step 10 prompt so the model does not re-ask a marked item, and
  // marking every open request closes the ask-loop.
  const [unavailableInfoByConversation, setUnavailableInfoByConversation] =
    useState<Record<string, Record<string, string[]>>>({})
  const markInfoUnavailable = useCallback((questionTypeId: string, infoKey: string) => {
    const convId = useStore.getState().activeConversationId
    if (!convId) return
    setUnavailableInfoByConversation((prev) => {
      const forConv = prev[convId] ?? {}
      const forType = forConv[questionTypeId] ?? []
      if (forType.includes(infoKey)) return prev
      return { ...prev, [convId]: { ...forConv, [questionTypeId]: [...forType, infoKey] } }
    })
  }, [useStore])

  // The question type each conversation last asked with, so the last answer's
  // information_requests can be re-parsed against that type's required_info
  // keys at render time, and a resend re-asks with the same type (Step 11).
  const [lastTypeByConversation, setLastTypeByConversation] = useState<Record<string, string>>({})
  // The original question text per conversation, replayed by the resend button
  // after a file/link answer's ingest completes (Step 11 §5).
  const [lastQuestionByConversation, setLastQuestionByConversation] = useState<Record<string, string>>({})
  // Resolution state for each open back-question, conversation-scoped and
  // keyed by info_key (Step 11). Not persisted.
  const [infoResolutions, setInfoResolutions] = useState<Record<string, Record<string, InfoRequestResolution>>>({})
  const setInfoResolution = useCallback((convId: string, infoKey: string, resolution: InfoRequestResolution | null) => {
    setInfoResolutions((prev) => {
      const forConv = { ...(prev[convId] ?? {}) }
      if (resolution) forConv[infoKey] = resolution
      else delete forConv[infoKey]
      return { ...prev, [convId]: forConv }
    })
  }, [])

  useEffect(() => {
    if (!project) return
    loadQuestionTypes(normalizePath(project.path)).then(setQuestionTypes).catch(() => {})
  }, [project])

  // Watch file/link answers whose ingest is in flight (Step 11 §5). A task
  // leaves the queue on success (kept on failure); "no longer present" flips
  // the resolution to ingestDone, surfacing the badge + resend button. Polls
  // the queue the same way activity-panel does.
  const hasIngesting = Object.values(infoResolutions).some((forConv) =>
    Object.values(forConv).some((r) => r.state === "ingesting" && r.taskIds?.length),
  )
  useEffect(() => {
    if (!hasIngesting) return
    const interval = setInterval(() => {
      const present = new Set(getQueue().map((task) => task.id))
      setInfoResolutions((prev) => {
        let changed = false
        const next: typeof prev = {}
        for (const [convId, forConv] of Object.entries(prev)) {
          const nextConv: Record<string, InfoRequestResolution> = {}
          for (const [infoKey, res] of Object.entries(forConv)) {
            if (res.state === "ingesting" && res.taskIds?.length && !res.taskIds.some((id) => present.has(id))) {
              nextConv[infoKey] = { state: "ingestDone" }
              changed = true
            } else {
              nextConv[infoKey] = res
            }
          }
          next[convId] = nextConv
        }
        return changed ? next : prev
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [hasIngesting])

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
      // Step 13: `useEmbedding` (the ChatInput toggle) gates the section
      // provider's embedding merge. It does NOT resurrect the retired
      // file-search path — it only hands section-search the embedding config.
      // Auto-create a conversation if none is active
      let convId = useStore.getState().activeConversationId
      if (!convId) {
        convId = createConversation()
      }

      // Remember the question + type so the last answer's back-questions can be
      // parsed against this type's keys and a resend can replay them (Step 11).
      // An info-answer send (a tagged form submission) is NOT the original
      // question — keep the recorded question so a later file/link resend still
      // replays the real question, not the answer.
      const convIdForRecord = convId
      setLastTypeByConversation((prev) => ({ ...prev, [convIdForRecord]: questionTypeId ?? "" }))
      if (!parseInfoAnswer(text)) {
        setLastQuestionByConversation((prev) => ({ ...prev, [convIdForRecord]: text }))
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
        // only toggles the embedding merge inside section-search (Step 13); it
        // never re-enables the retired file-search path.
        // Prefixes are UI-only; resolve them once to stable graph IDs and
        // give the exact same allowlist to document traversal and graph context.
        const allowedGraphIds = await resolveAllowedGraphIds(pp, graphPrefixFilter)

        // Resolve the selected question type's retrieval hints (§3.1). Absent
        // block / unselected type → no hints → prior lexical-only behavior.
        const qt = questionTypeId ? (await loadQuestionTypes(pp)).find((t) => t.id === questionTypeId) : undefined
        const hints = qt?.retrieval
        const graphExpand = hints?.graphExpand ?? 0
        const allowedPredicates = hints?.predicateAxes ? predicatesForAxes(hints.predicateAxes) : undefined

        // Answer-scope content filter (Step 07). Only applies when the type
        // opts in AND the user picked a scope for this conversation; otherwise
        // undefined so retrieval keeps its whole-graph behavior. Enforced as a
        // retrieval filter (below), not a prompt request.
        const scope = hints?.scope === "selectable" ? scopeByConversation[convId] : undefined
        const allowedPageIds = scope?.pageIds.length ? scope.pageIds : undefined
        const allowedEntityIds = scope?.entityIds.length ? scope.entityIds : undefined
        // Graph-unit scope narrows the resolved graph allowlist directly.
        const scopedGraphIds = scope?.graphIds.length
          ? allowedGraphIds.filter((id) => scope.graphIds.includes(id))
          : allowedGraphIds

        // Graph context is fetched first so `seed: llm_entities` can reuse the
        // entities the relevance prompt already extracted (no extra LLM call).
        const graphContext = await getGraphContextWithEntities(text, pp, project.name, llmConfig, scopedGraphIds, { allowedPageIds, allowedEntityIds })
        const graphBlocks = graphContext.blocks
        const noGraphContext = graphBlocks.length === 0

        // seed: llm_entities — resolve extracted entity names to entity IDs via
        // alias exact-match and hand them to traversal as seeds.
        let seedEntityIds: string[] | undefined
        if (hints?.seed === "llm_entities" && graphContext.entities.length > 0) {
          const resolved = await Promise.all(graphContext.entities.map((name) => findKnowledgeEntities(pp, name)))
          const ids = new Set<string>()
          for (let i = 0; i < resolved.length; i++) {
            const wanted = graphContext.entities[i].trim().toLocaleLowerCase()
            for (const match of resolved[i]) {
              if (match.canonicalName.trim().toLocaleLowerCase() === wanted) ids.add(match.entityId)
            }
          }
          if (ids.size > 0) seedEntityIds = Array.from(ids)
        }

        const { candidates: sectionCandidates, graphPaths } = await searchSectionCandidatesWithPaths(pp, text, scopedGraphIds, { graphExpand, allowedPredicates, seedEntityIds, allowedPageIds, allowedEntityIds, embeddingConfig: useEmbedding ? embeddingConfig : undefined })
        void (graphPaths satisfies GraphPath[])

        citationEntries = issueCitationMap(sectionCandidates as SectionCandidate[])
        const noRelevantDocs = citationEntries.length === 0

        const outLang = getOutputLanguage(text)

        // Graph Paths block (Step 03/04). graphPaths is only populated when the
        // question type declares graphExpand > 0; empty otherwise, so the
        // existing noGraphContext empty-state rules still apply unchanged.
        const graphPathsBlock = buildGraphPathsBlock(graphPaths, citationEntries)

        // Previous Versions block (Step 08) — gated ONLY by the type's
        // `include_history` flag. The "current" side of the comparison is the
        // working tree (Citation Sections above); the past side is read at the
        // conversation's selected commit (Step 09) or, absent a selection, at
        // each file's most recent content-changing commit. No commits (Sync
        // never ran) → empty block → the prompt's "past unavailable" rule.
        let previousVersionsBlock = ""
        if (hints?.includeHistory && citationEntries.length > 0) {
          try {
            const previous = await collectPreviousVersions(pp, citationEntries, historyPointByConversation[convId] ?? null)
            previousVersionsBlock = buildPreviousVersionsBlock(previous)
          } catch { /* history is best-effort; the current-state answer still works */ }
        }

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
              // When a question type is selected the answer must be JSON (see the
              // Answer Format section below); the free-form markdown instruction
              // would conflict, so it is emitted only for general questions.
              qt ? "" : "Use markdown formatting for clarity.",
              "",
              `## Citation Sections\n\n${citationPrompt(citationEntries)}`,
              graphPathsBlock,
              previousVersionsBlock,
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

        // Inject Answer Format section if a question type is selected. The
        // answer is forced to a single JSON object keyed by the type's fields
        // (Step 05 §3.4) — no markdown answer, no {{...}} placeholder templating.
        if (qt) {
          {
            const formatLines: string[] = ["", "## Answer Format"]
            const keys = qt.fields ? Object.keys(qt.fields) : []
            if (keys.length > 0) {
              formatLines.push("Return ONLY a single JSON object with these keys (no prose before or after, no code fence):")
              for (const [key, desc] of Object.entries(qt.fields!)) {
                formatLines.push(`- "${key}": ${desc}`)
              }
              formatLines.push("Each value is a markdown string. Put [[CIT:key]] citation markers inside the relevant field values.")
            }
            if (qt.promptTemplate) {
              formatLines.push("", qt.promptTemplate)
            }
            // Input contract (Step 10): required_info judgment + information_requests
            // schema, plus the keys the user already marked unavailable (Step 11)
            // so the model does not re-ask them.
            const unavailableKeys = unavailableInfoByConversation[convId]?.[questionTypeId!] ?? []
            const requiredInfoPrompt = buildRequiredInfoPrompt(qt.requiredInfo, unavailableKeys)
            const sysMsg = systemMessages[systemMessages.length - 1]
            if (sysMsg) {
              sysMsg.content = sysMsg.content + formatLines.join("\n") + requiredInfoPrompt
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
    [llmConfig, embeddingConfig, addMessage, setStreaming, appendStreamToken, finalizeStream, createConversation, maxHistoryMessages, useStore, graphPrefixFilter, scopeByConversation, historyPointByConversation, unavailableInfoByConversation],
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

  // ── Inline back-question form handlers (Step 11) ──────────────────────────
  // A text/choice answer becomes a tagged user message and drives the next
  // turn; the LLM sees its own question + this answer in history (§2/§3).
  const handleInfoAnswer = useCallback((infoKey: string, answer: string) => {
    const convId = useStore.getState().activeConversationId
    if (!convId) return
    setInfoResolution(convId, infoKey, { state: "answered" })
    handleSend(formatInfoAnswer(infoKey, answer), lastTypeByConversation[convId] || undefined)
  }, [useStore, handleSend, lastTypeByConversation, setInfoResolution])

  // Marking every open request unavailable closes the ask-loop: the tagged
  // message + the Step 10 prompt's "don't re-ask" rule let the next turn
  // answer within what it has and state the limitation (§4).
  const handleInfoUnavailable = useCallback((infoKey: string) => {
    const convId = useStore.getState().activeConversationId
    if (!convId) return
    const typeId = lastTypeByConversation[convId] || ""
    if (typeId) markInfoUnavailable(typeId, infoKey)
    setInfoResolution(convId, infoKey, { state: "unavailable" })
    handleSend(formatInfoAnswer(infoKey, "", true), typeId || undefined)
  }, [useStore, handleSend, lastTypeByConversation, markInfoUnavailable, setInfoResolution])

  // file/link answers reuse the existing raw-injection queue and DON'T re-run
  // the question automatically (§5) — resolution goes to "ingesting", then the
  // completion watcher flips it to "ingestDone" (badge + resend).
  const handleInfoLink = useCallback(async (infoKey: string, url: string) => {
    const proj = useWikiStore.getState().project
    const convId = useStore.getState().activeConversationId
    if (!proj || !convId) return
    setInfoResolution(convId, infoKey, { state: "ingesting" })
    try {
      const taskId = await injectLinkAnswer(normalizePath(proj.path), proj.id, url)
      setInfoResolution(convId, infoKey, { state: "ingesting", taskIds: [taskId] })
    } catch (err) {
      console.error("[chat] link answer injection failed:", err)
      setInfoResolution(convId, infoKey, null)
    }
  }, [useStore, setInfoResolution])

  const handleInfoFile = useCallback(async (infoKey: string, paths: string[]) => {
    const proj = useWikiStore.getState().project
    const convId = useStore.getState().activeConversationId
    if (!proj || !convId) return
    setInfoResolution(convId, infoKey, { state: "ingesting" })
    try {
      const taskIds = await injectFileAnswers(normalizePath(proj.path), proj.id, paths)
      setInfoResolution(convId, infoKey, { state: "ingesting", taskIds })
    } catch (err) {
      console.error("[chat] file answer injection failed:", err)
      setInfoResolution(convId, infoKey, null)
    }
  }, [useStore, setInfoResolution])

  // Resend replays the original question with the same type once ingest is in
  // (§5). The freshly ingested content is now retrievable, so it can surface
  // as a citation this turn.
  const handleInfoResend = useCallback(() => {
    const convId = useStore.getState().activeConversationId
    if (!convId) return
    const question = lastQuestionByConversation[convId]
    if (!question) return
    handleSend(question, lastTypeByConversation[convId] || undefined)
  }, [useStore, handleSend, lastQuestionByConversation, lastTypeByConversation])

  // Parse the last assistant message's information_requests against the type
  // this conversation asked with, so the forms render below that answer card.
  const lastAssistant = [...activeMessages].reverse().find((m) => m.role === "assistant")
  const activeType = activeConversationId ? questionTypes.find((t) => t.id === lastTypeByConversation[activeConversationId]) : undefined
  const activeRequests = lastAssistant && activeType?.requiredInfo
    ? parseInformationRequests(parseJsonAnswer(lastAssistant.content), Object.keys(activeType.requiredInfo))
    : []
  const activeResolutions = activeConversationId ? (infoResolutions[activeConversationId] ?? {}) : {}

  return (
    <div className="flex h-full flex-row overflow-hidden">
      <ConversationSidebar useStore={useStore} />

      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {!activeConversationId ? (
          <div className="flex flex-1 items-center justify-center overflow-y-auto p-6 text-muted-foreground">
            <div className="w-full max-w-2xl text-center">
              <MessageSquare className="mx-auto mb-3 h-8 w-8 opacity-30" />
              <p className="text-sm">Start a new conversation</p>
              <p className="mt-1 text-xs opacity-60">Type below, or pick a question type to focus the answer</p>

              {questionTypes.length > 0 && (
                <div className="mt-6 grid grid-cols-1 gap-2 text-left sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setSelectedTypeId("")}
                    className={`rounded-lg border p-3 text-xs transition-colors ${
                      selectedTypeId === ""
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:bg-accent"
                    }`}
                  >
                    <div className="font-medium">General question</div>
                    <div className="mt-0.5 opacity-60">No specific answer format</div>
                  </button>
                  {questionTypes.map((qt) => (
                    <button
                      key={qt.id}
                      type="button"
                      onClick={() => setSelectedTypeId(qt.id)}
                      title={qt.description}
                      className={`rounded-lg border p-3 text-xs transition-colors ${
                        selectedTypeId === qt.id
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border hover:bg-accent"
                      }`}
                    >
                      <div className="font-medium line-clamp-2">{qt.name}</div>
                      {qt.description && (
                        <div className="mt-0.5 line-clamp-2 opacity-60">{qt.description}</div>
                      )}
                    </button>
                  ))}
                </div>
              )}
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
                {!isStreaming && activeRequests.length > 0 && (
                  <ChatInfoForms
                    requests={activeRequests}
                    resolutions={activeResolutions}
                    onAnswer={handleInfoAnswer}
                    onUnavailable={handleInfoUnavailable}
                    onLink={handleInfoLink}
                    onFile={handleInfoFile}
                    onResend={handleInfoResend}
                    projectPath={project ? normalizePath(project.path) : undefined}
                    disabled={isStreaming}
                  />
                )}
                <div ref={bottomRef} />
              </div>
            </div>
          </>
        )}

        <ChatInput
          onSend={handleSend}
          onStop={handleStop}
          isStreaming={isStreaming}
          projectPath={project ? normalizePath(project.path) : undefined}
          placeholder="Type a message..."
          questionTypes={questionTypes}
          selectedTypeId={selectedTypeId}
          onSelectType={setSelectedTypeId}
          scopeSelectable={scopeSelectable}
          scopeSelection={activeScope}
          onScopeChange={setActiveScope}
          historySelectable={historySelectable}
          historyPoint={activeHistoryPoint}
          onHistoryPointChange={setActiveHistoryPoint}
        />
      </div>

      {chatReferencePreview && <ChatReferencePanel />}
    </div>
  )
}
