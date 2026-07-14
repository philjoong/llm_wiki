import { useEffect, useRef, useState } from "react"
import { gitLsRemote, gitRemoteAdd, gitCreateBranch, gitPush } from "@/commands/git"
import { useWikiStore } from "@/stores/wiki-store"
import { getRecentProjects, saveSelectedBranch, saveGitRemoteUrl, loadGitRemoteUrl, removeFromRecentProjects, saveGitToken, loadGitToken } from "@/lib/project-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Loader2, GitBranch, HardDrive, RefreshCw, Upload, Trash2, Download, PackageOpen } from "lucide-react"
import { exportProject, importProject } from "@/commands/project-transfer"
import { openProject } from "@/commands/fs"

function buildRepoUrl(baseUrl: string, token?: string | null): string {
  const cleaned = baseUrl.replace(/^https?:\/\//, "")
  if (!cleaned) return ""
  if (token) {
    return `https://oauth2:${encodeURIComponent(token)}@${cleaned}`
  }
  return `https://${cleaned}`
}

interface BranchItem {
  name: string
  localOnly: boolean
  path?: string
}

export function ProjectBranchSelector() {
  const [remoteUrlInput, setRemoteUrlInput] = useState("")
  const [items, setItems] = useState<BranchItem[]>([])
  const [loading, setLoading] = useState(true)
  const [remoteError, setRemoteError] = useState<string | null>(null)
  const [pushingBranch, setPushingBranch] = useState<string | null>(null)
  const [pushError, setPushError] = useState<string | null>(null)
  const [newBranchName, setNewBranchName] = useState("")
  const [newBranchToken, setNewBranchToken] = useState("")
  const [exportingBranch, setExportingBranch] = useState<string | null>(null)
  const [importingProject, setImportingProject] = useState(false)
  const [transferError, setTransferError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const setSelectedBranch = useWikiStore((s) => s.setSelectedBranch)

  // Load cached remote URL on mount, then fetch branch list
  useEffect(() => {
    async function init() {
      const cached = await loadGitRemoteUrl()
      const initial = cached ?? ""
      setRemoteUrlInput(initial)
      await fetchAll(initial)
    }
    void init()
  }, [])

  async function fetchAll(baseUrl: string) {
    setLoading(true)
    setRemoteError(null)

    const repoUrl = buildRepoUrl(baseUrl)

    const [remoteResult, localProjects] = await Promise.all([
      repoUrl
        ? gitLsRemote(repoUrl).then(
            (list) => ({ ok: true as const, list }),
            (err) => ({ ok: false as const, error: String(err) }),
          )
        : Promise.resolve({ ok: true as const, list: [] as string[] }),
      getRecentProjects(),
    ])

    const remoteBranches: string[] = remoteResult.ok ? remoteResult.list : []
    if (!remoteResult.ok) {
      console.error("[ProjectBranchSelector] gitLsRemote failed:", remoteResult.error)
      setRemoteError(remoteResult.error)
    }

    const remoteSet = new Set(remoteBranches)
    const localOnlyItems: BranchItem[] = localProjects
      .filter((p) => !remoteSet.has(p.name))
      .map((p) => ({ name: p.name, localOnly: true, path: p.path }))
    const remoteItems: BranchItem[] = remoteBranches.filter((b) => b !== "main").map((b) => ({ name: b, localOnly: false }))

    setItems([...remoteItems, ...localOnlyItems])
    setLoading(false)
  }

  async function handleRefresh() {
    await saveGitRemoteUrl(remoteUrlInput.trim())
    await fetchAll(remoteUrlInput.trim())
  }

  async function handleSelectBranch(branch: string) {
    setSelectedBranch(branch)
    await saveSelectedBranch(branch)
  }

  async function handleCreateBranch() {
    const name = newBranchName.trim()
    if (!name) return
    const token = newBranchToken.trim()
    if (token) {
      await saveGitToken(name, token)
    }
    await handleSelectBranch(name)
  }

  async function handleDelete(item: BranchItem) {
    if (!item.path) return
    await removeFromRecentProjects(item.path)
    setItems((prev) => prev.filter((i) => i.name !== item.name))
  }

  async function handleExport(item: BranchItem) {
    if (!item.path) return
    setExportingBranch(item.name)
    setTransferError(null)
    try {
      await exportProject(item.name, item.path)
    } catch (err) {
      setTransferError(String(err))
    } finally {
      setExportingBranch(null)
    }
  }

  async function handleImport() {
    const name = newBranchName.trim()
    if (!name) return
    setImportingProject(true)
    setTransferError(null)
    try {
      const projectPath = await importProject(name)
      if (!projectPath) return
      const project = await openProject(projectPath)
      setSelectedBranch(project.name)
      await saveSelectedBranch(project.name)
    } catch (err) {
      setTransferError(String(err))
    } finally {
      setImportingProject(false)
    }
  }

  async function handlePushToRemote(item: BranchItem) {
    if (!item.path || !remoteUrlInput.trim()) return
    setPushingBranch(item.name)
    setPushError(null)
    try {
      const token = await loadGitToken(item.name)
      const repoUrl = buildRepoUrl(remoteUrlInput.trim(), token)
      const remoteBranches = await gitLsRemote(repoUrl)
      if (remoteBranches.includes(item.name)) {
        throw new Error(`Branch "${item.name}" already exists on remote`)
      }
      await gitRemoteAdd(item.path, "origin", repoUrl)
      await gitCreateBranch(item.path, item.name)
      await gitPush(item.path, "origin", item.name)
      await fetchAll(remoteUrlInput.trim())
    } catch (err) {
      setPushError(String(err))
    } finally {
      setPushingBranch(null)
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="flex w-full max-w-md flex-col gap-6 px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Select Project</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Choose a project to open
          </p>
        </div>

        {/* Remote URL input */}
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Remote Git URL</p>
          <div className="flex gap-2">
            <Input
              placeholder="gitlab.example.com/group/repo.git"
              value={remoteUrlInput}
              onChange={(e) => setRemoteUrlInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleRefresh()}
              className="font-mono text-xs"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={handleRefresh}
              disabled={loading}
              title="Refresh branch list"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          </div>
          {remoteError && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive break-all">
              Remote unavailable: {remoteError}
            </p>
          )}
          {pushError && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive break-all">
              Push failed: {pushError}
            </p>
          )}
          {transferError && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive break-all">
              {transferError}
            </p>
          )}
        </div>

        {/* Branch list */}
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-4 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Fetching projects...</span>
          </div>
        ) : items.length > 0 ? (
          <div className="rounded-lg border bg-card">
            <div className="max-h-[300px] overflow-y-auto">
              {items.map((item) => (
                <button
                  key={item.name}
                  onClick={() => handleSelectBranch(item.name)}
                  className="flex w-full items-center gap-3 border-b px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-accent"
                >
                  {item.localOnly ? (
                    <HardDrive className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="text-sm font-medium">{item.name}</span>
                  {item.localOnly && (
                    <>
                      <span className="ml-auto text-xs text-muted-foreground">local only</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0"
                        disabled={exportingBranch === item.name}
                        title="Export as .llmwiki"
                        onClick={(e) => {
                          e.stopPropagation()
                          void handleExport(item)
                        }}
                      >
                        {exportingBranch === item.name ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Download className="h-3 w-3" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0"
                        disabled={!remoteUrlInput.trim() || pushingBranch === item.name}
                        title={remoteUrlInput.trim() ? "Push to remote" : "Remote URL을 먼저 입력하세요"}
                        onClick={(e) => {
                          e.stopPropagation()
                          void handlePushToRemote(item)
                        }}
                      >
                        {pushingBranch === item.name ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Upload className="h-3 w-3" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                        title="목록에서 제거"
                        onClick={(e) => {
                          e.stopPropagation()
                          void handleDelete(item)
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </>
                  )}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-center text-sm text-muted-foreground">No projects found</p>
        )}

        {/* Create new project */}
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Or create a new project</p>
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              placeholder="branch-name"
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateBranch()}
            />
            <Button onClick={handleCreateBranch} disabled={!newBranchName.trim()}>
              Create
            </Button>
          </div>
          <Input
            placeholder="Git token (optional, remote push용)"
            value={newBranchToken}
            onChange={(e) => setNewBranchToken(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreateBranch()}
            type="password"
            className="font-mono text-xs"
          />
          <Button
            variant="outline"
            className="w-full gap-2"
            disabled={!newBranchName.trim() || importingProject}
            onClick={() => void handleImport()}
            title="프로젝트 이름을 입력한 뒤 .llmwiki 파일을 선택해 가져옵니다"
          >
            {importingProject ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <PackageOpen className="h-4 w-4" />
            )}
            Import .llmwiki
          </Button>
        </div>
      </div>
    </div>
  )
}
