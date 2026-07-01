import { useCallback, useEffect, useState } from "react"
import { CheckCircle2, RefreshCw, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { pingGraphDb } from "@/commands/graph-db"
import { loadFalkordbUrl, saveFalkordbUrl } from "@/lib/project-store"

type PingStatus = "idle" | "checking" | "ok" | "error"

export function FalkordbSection() {
  const [urlDraft, setUrlDraft] = useState("")
  const [pingStatus, setPingStatus] = useState<PingStatus>("idle")
  const [pingError, setPingError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    loadFalkordbUrl().then((url) => {
      setUrlDraft(url ?? "")
    })
  }, [])

  const handleSave = useCallback(async () => {
    const url = urlDraft.trim()
    await saveFalkordbUrl(url)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }, [urlDraft])

  const handlePing = useCallback(async () => {
    setPingStatus("checking")
    setPingError(null)
    try {
      await pingGraphDb()
      setPingStatus("ok")
    } catch (err) {
      setPingStatus("error")
      setPingError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">FalkorDB</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Graph DB 연결 설정. FALKORDB_URL 환경변수보다 이 설정이 우선합니다.
        </p>
      </div>

      <div className="space-y-4 rounded-md border p-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Connection URL
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleSave() }}
              placeholder="redis://..."
              spellCheck={false}
              className="flex-1 rounded-md border bg-background px-2.5 py-1.5 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <Button size="sm" variant="outline" onClick={handleSave}>
              {saved ? "Saved" : "Save"}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            비워두면 SQLite 로컬 모드로 동작합니다.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            onClick={handlePing}
            disabled={pingStatus === "checking"}
            className="gap-1.5"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${pingStatus === "checking" ? "animate-spin" : ""}`} />
            {pingStatus === "checking" ? "Connecting..." : "Test Connection"}
          </Button>

          {pingStatus === "ok" && (
            <div className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
              Connected
            </div>
          )}
          {pingStatus === "error" && (
            <div className="flex items-center gap-1.5 text-sm text-destructive">
              <XCircle className="h-4 w-4 shrink-0" />
              <span className="truncate max-w-xs" title={pingError ?? undefined}>{pingError}</span>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-md border p-4 text-sm text-muted-foreground space-y-1">
        <div className="font-medium text-foreground text-xs">환경변수 오버라이드</div>
        <p className="text-xs">
          앱 외부에서 <code className="font-mono text-[11px] bg-muted px-1 rounded">FALKORDB_URL</code> 환경변수를
          설정하면 이 값보다 우선 적용됩니다.
        </p>
      </div>
    </div>
  )
}
