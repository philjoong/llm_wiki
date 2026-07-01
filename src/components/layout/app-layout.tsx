import { useCallback, useEffect, useRef } from "react"
import { useWikiStore } from "@/stores/wiki-store"
import { listDirectory } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { IconSidebar } from "./icon-sidebar"
import { ContentArea } from "./content-area"
import { ActivityPanel } from "./activity-panel"
import { PreviewPanel } from "./preview-panel"
import { ErrorBoundary } from "@/components/error-boundary"
import { Dialog, DialogContent } from "@/components/ui/dialog"

interface AppLayoutProps {
  onSwitchProject: () => void
  onSync: () => Promise<void>
  isLocalOnly: boolean
}

export function AppLayout({ onSwitchProject, onSync, isLocalOnly }: AppLayoutProps) {
  const project = useWikiStore((s) => s.project)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const editingFile = useWikiStore((s) => s.editingFile)
  const setEditingFile = useWikiStore((s) => s.setEditingFile)
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
      <IconSidebar onSwitchProject={onSwitchProject} onSync={onSync} isLocalOnly={isLocalOnly} />
      <div ref={containerRef} className="relative min-w-0 flex-1 overflow-hidden">
        <ErrorBoundary>
          <ContentArea />
        </ErrorBoundary>
        {/* Floating activity log — bottom-right, visible only when tasks exist */}
        <div className="absolute bottom-4 right-4 z-50 w-80">
          <ActivityPanel />
        </div>
      </div>
      <Dialog open={editingFile != null} onOpenChange={(open) => { if (!open) setEditingFile(null) }}>
        <DialogContent className="flex h-[85vh] max-w-4xl flex-col p-0 sm:max-w-4xl">
          {editingFile && (
            <PreviewPanel filePath={editingFile} onClose={() => setEditingFile(null)} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
