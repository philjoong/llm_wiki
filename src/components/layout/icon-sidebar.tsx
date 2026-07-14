import { useState, useEffect } from "react"
import {
  FileText, Settings, ClipboardList, History, Network, DatabaseZap, Link2, ChevronLeft, FolderOpen, Upload, Grid3x3, UsersRound,
} from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { useWikiStore } from "@/stores/wiki-store"
import { useReviewStore } from "@/stores/review-store"
import { useUpdateStore, shouldShowUpdateBanner } from "@/stores/update-store"
import { useTranslation } from "react-i18next"
import type { WikiState } from "@/stores/wiki-store"
import { open } from "@tauri-apps/plugin-dialog"
import { enqueueIngest } from "@/lib/ingest-queue"
import { normalizePath } from "@/lib/path-utils"
import { writeFile, fileExists } from "@/commands/fs"
import { fetchUrlAsMarkdown } from "@/lib/url-import"
import { loadDataTypes, type DataType } from "@/lib/data-types"
import { loadGitRemoteUrl, loadGitToken } from "@/lib/project-store"
import { SyncConflictDialog } from "@/components/project/sync-conflict-dialog"

type NavView = WikiState["activeView"]
type PendingInjection = { rels: string[]; source: "file" | "url" }

const NAV_ITEMS: { view: NavView; icon: typeof FileText; labelKey: string }[] = [
  { view: "wiki", icon: FileText, labelKey: "nav.wiki" },
  { view: "graph", icon: Network, labelKey: "nav.graph" },
  { view: "review", icon: ClipboardList, labelKey: "nav.review" },
  { view: "history", icon: History, labelKey: "nav.history" },
  { view: "casemap", icon: Grid3x3, labelKey: "nav.casemap" },
  { view: "persona", icon: UsersRound, labelKey: "nav.persona" },
]

interface IconSidebarProps {
  onSwitchProject: () => void
  onSync: () => Promise<void>
  isLocalOnly: boolean
}

export function IconSidebar({ onSwitchProject, onSync, isLocalOnly }: IconSidebarProps) {
  const { t } = useTranslation()
  const activeView = useWikiStore((s) => s.activeView)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const pendingCount = useReviewStore((s) => s.items.filter((i) => !i.resolved).length)
  const updateBannerVisible = useUpdateStore((s) => shouldShowUpdateBanner(s))
  const project = useWikiStore((s) => s.project)
  const navHistory = useWikiStore((s) => s.navHistory)
  const goBack = useWikiStore((s) => s.goBack)
  const [injecting, setInjecting] = useState(false)
  const [injectingUrl, setInjectingUrl] = useState(false)
  const [urlDialogOpen, setUrlDialogOpen] = useState(false)
  const [urlValue, setUrlValue] = useState("")
  const [dataTypes, setDataTypes] = useState<DataType[]>([])
  const [selectedDataTypeIds, setSelectedDataTypeIds] = useState<string[]>([])
  const [pendingInjection, setPendingInjection] = useState<PendingInjection | null>(null)
  const [dataTypeDialogOpen, setDataTypeDialogOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [conflictFiles, setConflictFiles] = useState<string[]>([])
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false)
  const [conflictRemoteUrl, setConflictRemoteUrl] = useState("")

  // Recompute the authenticated remote URL (per-project token) whenever the
  // active project changes, for use by the sync-conflict resolution dialog.
  useEffect(() => {
    if (!project) {
      setConflictRemoteUrl("")
      return
    }
    const projectName = project.name
    let cancelled = false
    async function compute() {
      const base = (await loadGitRemoteUrl()) || ""
      const token = await loadGitToken(projectName)
      if (cancelled) return
      setConflictRemoteUrl(token ? `https://oauth2:${encodeURIComponent(token)}@${base}` : `https://${base}`)
    }
    void compute()
    return () => {
      cancelled = true
    }
  }, [project])

  async function enqueueWithOptionalDataType(rels: string[], source: PendingInjection["source"]) {
    if (!project) return
    let available: DataType[] = []
    try {
      available = await loadDataTypes(normalizePath(project.path))
    } catch (err) {
      console.warn("Failed to load data types:", err)
    }

    if (available.length === 0) {
      for (const rel of rels) {
        await enqueueIngest(project.id, rel)
      }
      return
    }

    setDataTypes(available)
    setSelectedDataTypeIds([])
    setPendingInjection({ rels, source })
    setDataTypeDialogOpen(true)
  }

  function toggleDataType(id: string) {
    setSelectedDataTypeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  async function confirmDataTypeInjection() {
    if (!project || !pendingInjection) return
    const rels = pendingInjection.rels
    // No data type selected → ingest once per file with the standard
    // (non-structured) decomposition. Otherwise ingest once per file PER
    // selected data type, so N selected types produce N documents.
    const dataTypeIds = selectedDataTypeIds.length > 0 ? selectedDataTypeIds : [undefined]
    setInjecting(pendingInjection.source === "file")
    setInjectingUrl(pendingInjection.source === "url")
    try {
      for (const rel of rels) {
        for (const dataTypeId of dataTypeIds) {
          await enqueueIngest(project.id, rel, "", dataTypeId)
        }
      }
      setDataTypeDialogOpen(false)
      setPendingInjection(null)
      setSelectedDataTypeIds([])
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error("Failed to enqueue ingest:", err)
      window.alert(`Failed to enqueue ingest:\n\n${msg}`)
    } finally {
      setInjecting(false)
      setInjectingUrl(false)
    }
  }

  async function handleSyncToRemote() {
    if (!project || syncing || isLocalOnly) return
    setSyncing(true)
    try {
      await onSync()
    } catch (err) {
      const e = err as Error & { conflicts?: string[] }
      if (e.message === "rebase-conflict" && e.conflicts && e.conflicts.length > 0) {
        setConflictFiles(e.conflicts)
        setConflictDialogOpen(true)
      } else {
        window.alert(`Sync failed: ${err}`)
      }
    } finally {
      setSyncing(false)
    }
  }

  async function handleInject() {
    if (!project || injecting) return
    const pp = normalizePath(project.path)
    const selected = await open({
      multiple: true,
      defaultPath: `${pp}/raw/sources`,
      title: t("fileTree.injectDialogTitle"),
      filters: [{ name: "All Files", extensions: ["*"] }],
    })
    if (!selected || selected.length === 0) return
    const paths = Array.isArray(selected) ? selected : [selected]
    setInjecting(true)
    try {
      const rels = paths.map((filePath) =>
        filePath.startsWith(pp)
          ? filePath.slice(pp.length).replace(/^[\\/]/, "")
          : filePath,
      )
      await enqueueWithOptionalDataType(rels, "file")
    } catch (err) {
      console.error("Failed to enqueue ingest:", err)
    } finally {
      setInjecting(false)
    }
  }

  // URL injection == file injection minus the file picker. We fetch the
  // static page, convert it to markdown (same Readability + Turndown
  // path as imported .html files), write it under raw/sources/, then
  // enqueue it for ingest exactly like a picked file.
  async function handleInjectUrl() {
    if (!project || injectingUrl) return
    const url = urlValue.trim()
    if (!url) return
    setInjectingUrl(true)
    try {
      const pp = normalizePath(project.path)
      const { markdown, baseName } = await fetchUrlAsMarkdown(url)
      const rel = await uniqueSourceRel(pp, baseName)
      const destPath = `${pp}/${rel}`
      await writeFile(destPath, markdown)
      await enqueueWithOptionalDataType([rel], "url")
      setUrlDialogOpen(false)
      setUrlValue("")
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error("Failed to inject URL:", err)
      window.alert(`Failed to inject URL:\n\n${msg}`)
    } finally {
      setInjectingUrl(false)
    }
  }

  // Daemon health check
  const [daemonStatus, setDaemonStatus] = useState<string>("starting")
  useEffect(() => {
    const check = async () => {
      try {
        const { clipServerStatus } = await import("@/commands/fs")
        const status = await clipServerStatus()
        setDaemonStatus(status)
      } catch {
        setDaemonStatus("error")
      }
    }
    check()
    const interval = setInterval(check, 30000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    setDataTypeDialogOpen(false)
    setPendingInjection(null)
    setSelectedDataTypeIds([])
    setDataTypes([])
  }, [project?.id])

  return (
    <>
    <TooltipProvider delay={300}>
      <div className="flex h-full w-12 flex-col items-center border-r bg-muted/50 py-2">
        {/* Back button */}
        <Tooltip>
          <TooltipTrigger
            onClick={goBack}
            disabled={navHistory.length === 0}
            className="mb-2 flex h-9 w-9 items-center justify-center rounded-md transition-colors disabled:opacity-30 disabled:cursor-default text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
          >
            <ChevronLeft className="h-5 w-5" />
          </TooltipTrigger>
          <TooltipContent side="right">뒤로</TooltipContent>
        </Tooltip>
        {/* Top: main nav items */}
        <div className="flex flex-1 flex-col items-center gap-1">
          {NAV_ITEMS.map(({ view, icon: Icon, labelKey }) => (
            <Tooltip key={view}>
              <TooltipTrigger
                onClick={() => setActiveView(view)}
                className={`relative flex h-10 w-10 items-center justify-center rounded-md transition-colors ${
                  activeView === view
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
                }`}
              >
                <Icon className="h-5 w-5" />
                {view === "review" && pendingCount > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                    {pendingCount > 99 ? "99+" : pendingCount}
                  </span>
                )}
              </TooltipTrigger>
              <TooltipContent side="right">
                {t(labelKey)}
                {view === "review" && pendingCount > 0 && ` (${pendingCount})`}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
        {/* Bottom: inject from URL + inject + daemon status + settings + switch project */}
        <div className="flex flex-col items-center gap-1 pb-1">
          {project && (
            <Tooltip>
              <TooltipTrigger
                onClick={() => setUrlDialogOpen(true)}
                className={`flex h-10 w-10 items-center justify-center rounded-md transition-colors text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground ${injectingUrl ? "animate-pulse" : ""}`}
              >
                <Link2 className="h-5 w-5" />
              </TooltipTrigger>
              <TooltipContent side="right">{t("fileTree.injectUrl")}</TooltipContent>
            </Tooltip>
          )}
          {project && (
            <Tooltip>
              <TooltipTrigger
                onClick={handleInject}
                className={`flex h-10 w-10 items-center justify-center rounded-md transition-colors text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground ${injecting ? "animate-pulse" : ""}`}
              >
                <DatabaseZap className="h-5 w-5" />
              </TooltipTrigger>
              <TooltipContent side="right">{t("fileTree.inject")}</TooltipContent>
            </Tooltip>
          )}
          {/* Daemon status indicator */}
          <Tooltip>
            <TooltipTrigger className="flex h-6 w-6 items-center justify-center">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  daemonStatus === "running" ? "bg-emerald-500" :
                  daemonStatus === "starting" ? "bg-amber-400 animate-pulse" :
                  daemonStatus === "port_conflict" ? "bg-red-500" :
                  "bg-red-500 animate-pulse"
                }`}
              />
            </TooltipTrigger>
            <TooltipContent side="right">
              {daemonStatus === "running" && "Clip server running"}
              {daemonStatus === "starting" && "Clip server starting..."}
              {daemonStatus === "port_conflict" && "Port 19827 is occupied. Web Clipper unavailable."}
              {daemonStatus === "error" && "Clip server error. Restarting..."}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              onClick={() => setActiveView("settings")}
              className={`relative flex h-10 w-10 items-center justify-center rounded-md transition-colors ${
                activeView === "settings"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
              }`}
            >
              <Settings className="h-5 w-5" />
              {updateBannerVisible && (
                // Small dot at the top-right of the Settings icon when
                // a new release is available; dismissed versions clear
                // it automatically via shouldShowUpdateBanner.
                <span
                  className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary ring-2 ring-muted/50"
                  title={t("nav.updateAvailable")}
                />
              )}
            </TooltipTrigger>
            <TooltipContent side="right">
              {t("nav.settings")}
              {updateBannerVisible ? t("nav.updateAvailableSuffix") : ""}
            </TooltipContent>
          </Tooltip>
          {project && !isLocalOnly && (
            <Tooltip>
              <TooltipTrigger
                onClick={handleSyncToRemote}
                disabled={syncing}
                className={`flex h-10 w-10 items-center justify-center rounded-md transition-colors text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground disabled:opacity-50 disabled:cursor-default ${syncing ? "animate-pulse" : ""}`}
              >
                <Upload className="h-5 w-5" />
              </TooltipTrigger>
              <TooltipContent side="right">
                {syncing ? "Syncing..." : "Sync to Remote"}
              </TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger
              onClick={onSwitchProject}
              className="flex h-10 w-10 items-center justify-center rounded-md transition-colors text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
            >
              <FolderOpen className="h-5 w-5" />
            </TooltipTrigger>
            <TooltipContent side="right">Switch Project</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <Dialog
        open={urlDialogOpen}
        onOpenChange={(o) => {
          setUrlDialogOpen(o)
          if (!o) setUrlValue("")
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("fileTree.injectUrl")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-2">
            <Label htmlFor="inject-url">{t("fileTree.injectUrlPrompt")}</Label>
            <Input
              id="inject-url"
              autoFocus
              type="url"
              value={urlValue}
              onChange={(e) => setUrlValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleInjectUrl()
              }}
              placeholder="https://example.com/article"
              disabled={injectingUrl}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUrlDialogOpen(false)} disabled={injectingUrl}>
              {t("project.cancel")}
            </Button>
            <Button onClick={handleInjectUrl} disabled={injectingUrl || !urlValue.trim()}>
              {injectingUrl ? t("fileTree.injecting") : t("fileTree.inject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={dataTypeDialogOpen}
        onOpenChange={(o) => {
          setDataTypeDialogOpen(o)
          if (!o) {
            setPendingInjection(null)
            setSelectedDataTypeIds([])
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Select data type(s)</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-2">
            <Label>Data types</Label>
            <p className="text-xs text-muted-foreground">
              Select none for the standard ingest, or one or more data types — each selected type produces its own document.
            </p>
            <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto rounded-md border border-input p-2">
              {dataTypes.map((dt) => (
                <label
                  key={dt.id}
                  htmlFor={`inject-data-type-${dt.id}`}
                  className="flex items-start gap-2 rounded-sm px-1 py-1 text-sm hover:bg-accent"
                >
                  <input
                    id={`inject-data-type-${dt.id}`}
                    type="checkbox"
                    className="mt-0.5"
                    checked={selectedDataTypeIds.includes(dt.id)}
                    onChange={() => toggleDataType(dt.id)}
                    disabled={injecting || injectingUrl}
                  />
                  <span>
                    <span className="text-foreground">{dt.name} ({dt.id})</span>
                    {dt.description && (
                      <span className="block text-xs text-muted-foreground">{dt.description}</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDataTypeDialogOpen(false)}
              disabled={injecting || injectingUrl}
            >
              {t("project.cancel")}
            </Button>
            <Button onClick={confirmDataTypeInjection} disabled={injecting || injectingUrl}>
              {injecting || injectingUrl ? t("fileTree.injecting") : t("fileTree.inject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>

    {conflictDialogOpen && project && (
      <SyncConflictDialog
        open={conflictDialogOpen}
        onDone={(aborted) => {
          setConflictDialogOpen(false)
          setConflictFiles([])
          if (!aborted) {
            // Push succeeded — nothing else needed, just close
          }
        }}
        projectPath={project.path}
        initialConflicts={conflictFiles}
        remoteUrl={conflictRemoteUrl}
      />
    )}
    </>
  )
}

/**
 * Pick a project-relative `raw/sources/<name>.md` path that isn't already
 * taken, appending a date (then a counter) on collision — same convention
 * as the file-import flow's getUniqueDestPath, so re-injecting a URL whose
 * slug already exists doesn't clobber the earlier capture.
 */
async function uniqueSourceRel(projectPath: string, baseName: string): Promise<string> {
  const base = `raw/sources/${baseName}.md`
  if (!(await fileExists(`${projectPath}/${base}`))) return base
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "")
  const dated = `raw/sources/${baseName}-${date}.md`
  if (!(await fileExists(`${projectPath}/${dated}`))) return dated
  for (let i = 2; i <= 99; i++) {
    const numbered = `raw/sources/${baseName}-${date}-${i}.md`
    if (!(await fileExists(`${projectPath}/${numbered}`))) return numbered
  }
  return dated
}
