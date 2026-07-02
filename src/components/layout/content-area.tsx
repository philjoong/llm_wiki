import { useWikiStore } from "@/stores/wiki-store"
import { ChatPanel } from "@/components/chat/chat-panel"
import { SettingsView } from "@/components/settings/settings-view"
import { ReviewView } from "@/components/review/review-view"
import { GraphView } from "@/components/graph/graph-view"
import { HistoryView } from "@/components/history/history-view"
import { CasemapView } from "@/components/casemap/casemap-view"
import { PersonaView } from "@/components/persona/persona-view"

export function ContentArea() {
  const activeView = useWikiStore((s) => s.activeView)

  switch (activeView) {
    case "settings":
      return <SettingsView />
    case "review":
      return <ReviewView />
    case "graph":
      return <GraphView />
    case "history":
      return <HistoryView />
    case "casemap":
      return <CasemapView />
    case "persona":
      return <PersonaView />
    default:
      return <ChatPanel />
  }
}
