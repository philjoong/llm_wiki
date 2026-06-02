import { useWikiStore } from "@/stores/wiki-store"
import { ChatPanel } from "@/components/chat/chat-panel"
import { SettingsView } from "@/components/settings/settings-view"
import { ReviewView } from "@/components/review/review-view"
import { LintView } from "@/components/lint/lint-view"
import { GraphView } from "@/components/graph/graph-view"
import { HistoryView } from "@/components/history/history-view"
import { PromotionPanel } from "@/components/exclusions/promotion-panel"

export function ContentArea() {
  const activeView = useWikiStore((s) => s.activeView)

  switch (activeView) {
    case "settings":
      return <SettingsView />
    case "review":
      return <ReviewView />
    case "promotion":
      return <PromotionPanel />
    case "lint":
      return <LintView />
    case "graph":
      return <GraphView />
    case "history":
      return <HistoryView />
    default:
      return <ChatPanel />
  }
}
