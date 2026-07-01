import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useTranslation } from "react-i18next"
import { useState } from "react"
import { SyncConflictDialog } from "./sync-conflict-dialog"

interface SyncOnExitDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSync: () => Promise<void>
  onExit: () => void
  isLocalOnly?: boolean
  projectPath?: string
  remoteUrl?: string
}

export function SyncOnExitDialog({
  open,
  onOpenChange,
  onSync,
  onExit,
  isLocalOnly = false,
  projectPath = "",
  remoteUrl = "",
}: SyncOnExitDialogProps) {
  const { t } = useTranslation()
  const [syncing, setSyncing] = useState(false)
  const [conflictFiles, setConflictFiles] = useState<string[]>([])
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false)

  const handleSync = async () => {
    setSyncing(true)
    try {
      await onSync()
      onExit()
    } catch (err) {
      const e = err as Error & { conflicts?: string[] }
      if (e.message === "rebase-conflict" && e.conflicts && e.conflicts.length > 0) {
        setConflictFiles(e.conflicts)
        setConflictDialogOpen(true)
      } else {
        console.error("Sync failed:", err)
        window.alert(`Sync failed: ${err}`)
      }
    } finally {
      setSyncing(false)
    }
  }

  const handleConflictDone = (aborted: boolean) => {
    setConflictDialogOpen(false)
    setConflictFiles([])
    if (!aborted) {
      // Push succeeded after conflict resolution — close and exit
      onOpenChange(false)
      onExit()
    }
    // If aborted, keep the exit dialog open so the user can choose what to do next
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("sync.exit.title", "Save changes to remote?")}</DialogTitle>
            <DialogDescription>
              {t(
                "sync.exit.description",
                "You have unsaved changes. Would you like to sync them to the remote repository before exiting?",
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={syncing}>
              {t("common.cancel", "Cancel")}
            </Button>
            <Button variant="secondary" onClick={onExit} disabled={syncing}>
              {t("sync.exit.no_sync", "Exit without Sync")}
            </Button>
            <Button
              onClick={handleSync}
              disabled={syncing || isLocalOnly}
              title={isLocalOnly ? "Local-only project — no remote configured" : undefined}
            >
              {syncing ? t("sync.exit.syncing", "Syncing...") : t("sync.exit.sync", "Sync to Remote")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {conflictDialogOpen && projectPath && (
        <SyncConflictDialog
          open={conflictDialogOpen}
          onDone={handleConflictDone}
          projectPath={projectPath}
          initialConflicts={conflictFiles}
          remoteUrl={remoteUrl}
        />
      )}
    </>
  )
}
