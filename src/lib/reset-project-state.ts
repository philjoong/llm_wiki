/**
 * Centralized reset of all per-project state.
 * MUST be called both when leaving a project and when opening a new one,
 * to prevent cross-project data contamination.
 */

import { useChatStore } from "@/stores/chat-store"
import { useReviewStore } from "@/stores/review-store"
import { useActivityStore } from "@/stores/activity-store"
import { useResearchStore } from "@/stores/research-store"

export function resetProjectState() {
  // Zustand stores — clear all per-project data
  useChatStore.setState({
    conversations: [],
    messages: [],
    activeConversationId: null,
    mode: "chat",
    ingestSource: null,
    isStreaming: false,
    streamingContent: "",
  })

  useReviewStore.setState({
    items: [],
  })

  useActivityStore.setState({
    items: [],
  })

  useResearchStore.setState({
    tasks: [],
    panelOpen: false,
  })

  // Module-level caches
  // Ingest queue
  import("@/lib/ingest-queue").then(({ clearQueueState }) => {
    clearQueueState()
  }).catch((err) => {
    console.warn("[Reset Project State] Failed to clear ingest queue:", err)
  })

  // Graph relevance cache
  import("@/lib/graph-relevance").then(({ clearGraphCache }) => {
    clearGraphCache()
  }).catch((err) => {
    console.warn("[Reset Project State] Failed to clear graph cache:", err)
  })
}
