import { useCallback, useEffect, useRef } from "react"
import { useWikiStore } from "@/stores/wiki-store"
import { listDirectory } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { IconSidebar } from "./icon-sidebar"
import { ContentArea } from "./content-area"
import { ActivityPanel } from "./activity-panel"
import { ErrorBoundary } from "@/components/error-boundary"

interface AppLayoutProps {
  onSwitchProject: () => void
}

export function AppLayout({ onSwitchProject }: AppLayoutProps) {
  const project = useWikiStore((s) => s.project)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const containerRef = useRef<HTMLDivElement>(null)

  const loadFileTree = useCallback(async () => {
    if (!project) return
    try {
      const tree = await listDirectory(normalizePath(project.path))
      setFileTree(tree)
    } catch (err) {
      console.error("Failed to load file tree:", err)
    }
  }, [project, setFileTree])

  useEffect(() => {
    loadFileTree()
  }, [loadFileTree])

  return (
    <div className="flex h-screen bg-background text-foreground">
      <IconSidebar onSwitchProject={onSwitchProject} />
      <div ref={containerRef} className="relative min-w-0 flex-1 overflow-hidden">
        <ErrorBoundary>
          <ContentArea />
        </ErrorBoundary>
        {/* Floating activity log — bottom-right, visible only when tasks exist */}
        <div className="absolute bottom-4 right-4 z-50 w-80">
          <ActivityPanel />
        </div>
      </div>
    </div>
  )
}
