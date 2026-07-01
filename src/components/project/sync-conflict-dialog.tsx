import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { gitRebaseAbort, gitRebaseContinue, gitDiff, gitPush, gitRemoteAdd } from "@/commands/git"
import { useWikiStore } from "@/stores/wiki-store"

interface SyncConflictDialogProps {
  open: boolean
  /** Called when the conflict is fully resolved and push succeeded, or when the user aborts. */
  onDone: (aborted: boolean) => void
  projectPath: string
  initialConflicts: string[]
  remoteUrl: string
}

export function SyncConflictDialog({
  open,
  onDone,
  projectPath,
  initialConflicts,
  remoteUrl,
}: SyncConflictDialogProps) {
  const [conflicts, setConflicts] = useState<string[]>(initialConflicts)
  const [selectedFile, setSelectedFile] = useState<string | null>(initialConflicts[0] ?? null)
  const [diffText, setDiffText] = useState<string | null>(null)
  const [loadingDiff, setLoadingDiff] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSelectFile(file: string) {
    setSelectedFile(file)
    setLoadingDiff(true)
    setDiffText(null)
    try {
      // During a rebase conflict, `git diff` shows the conflict markers in the
      // working tree — the most useful view for the user to see what to resolve.
      const text = await gitDiff(projectPath, "HEAD", file, undefined)
      setDiffText(text || "(no diff output)")
    } catch {
      // Fall back to showing the raw conflict markers hint
      setDiffText("(diff unavailable — open the file in an external editor to resolve)")
    } finally {
      setLoadingDiff(false)
    }
  }

  async function handleAbort() {
    setBusy(true)
    setError(null)
    try {
      await gitRebaseAbort(projectPath)
      onDone(true)
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleContinue() {
    setBusy(true)
    setError(null)
    try {
      const result = await gitRebaseContinue(projectPath)
      if (!result.success) {
        // More conflicts remain — update the list and stay open
        setConflicts(result.conflicts)
        setSelectedFile(result.conflicts[0] ?? null)
        setDiffText(null)
        return
      }
      // Rebase finished — push
      await gitRemoteAdd(projectPath, "origin", remoteUrl)
      const branch = useWikiStore.getState().selectedBranch || "main"
      await gitPush(projectPath, "origin", branch)
      onDone(false)
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Sync Conflict</DialogTitle>
          <DialogDescription>
            Rebase 중 충돌이 발생했습니다. 아래 파일을 외부 편집기에서 직접 수정한 후 &quot;Resolved &amp; Continue&quot;를 클릭하세요.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-3 min-h-[320px]">
          {/* Conflict file list */}
          <div className="w-56 shrink-0 flex flex-col gap-1">
            <p className="text-xs font-semibold text-muted-foreground mb-1">충돌 파일 ({conflicts.length})</p>
            <ScrollArea className="flex-1 rounded border">
              <div className="p-1 flex flex-col gap-0.5">
                {conflicts.map((f) => (
                  <button
                    key={f}
                    onClick={() => handleSelectFile(f)}
                    className={`w-full text-left rounded px-2 py-1 text-xs truncate transition-colors ${
                      selectedFile === f
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-accent/50 text-foreground"
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* Diff viewer */}
          <div className="flex-1 min-w-0 flex flex-col gap-1">
            <p className="text-xs font-semibold text-muted-foreground mb-1">
              {selectedFile ? selectedFile : "파일을 선택하세요"}
            </p>
            <ScrollArea className="flex-1 rounded border bg-muted/30">
              <pre className="p-3 text-[11px] font-mono whitespace-pre leading-relaxed">
                {loadingDiff
                  ? "로딩 중..."
                  : diffText
                  ? diffText
                  : selectedFile
                  ? "파일을 클릭하면 diff가 표시됩니다."
                  : "파일을 선택하세요."}
              </pre>
            </ScrollArea>
          </div>
        </div>

        {error && (
          <p className="text-xs text-destructive rounded border border-destructive/30 bg-destructive/10 px-3 py-2">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="destructive" onClick={handleAbort} disabled={busy}>
            Abort Rebase
          </Button>
          <Button onClick={handleContinue} disabled={busy}>
            {busy ? "처리 중..." : "Resolved & Continue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
