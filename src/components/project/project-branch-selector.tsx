import { useEffect, useRef, useState } from "react"
import { gitLsRemote } from "@/commands/git"
import { useWikiStore } from "@/stores/wiki-store"
import { getRecentProjects, saveSelectedBranch, saveGitRemoteUrl, loadGitRemoteUrl } from "@/lib/project-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Loader2, GitBranch, HardDrive, RefreshCw } from "lucide-react"

const ENV_GIT_TOKEN = import.meta.env.VITE_GIT_TOKEN
const ENV_REPO_BASE_URL = import.meta.env.VITE_GIT_REPO_URL || ""

function buildRepoUrl(baseUrl: string): string {
  const cleaned = baseUrl.replace(/^https?:\/\//, "")
  if (!cleaned) return ""
  if (ENV_GIT_TOKEN) {
    return `https://oauth2:${encodeURIComponent(ENV_GIT_TOKEN)}@${cleaned}`
  }
  return `https://${cleaned}`
}

interface BranchItem {
  name: string
  localOnly: boolean
}

export function ProjectBranchSelector() {
  const [remoteUrlInput, setRemoteUrlInput] = useState("")
  const [items, setItems] = useState<BranchItem[]>([])
  const [loading, setLoading] = useState(true)
  const [remoteError, setRemoteError] = useState<string | null>(null)
  const [newBranchName, setNewBranchName] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const setSelectedBranch = useWikiStore((s) => s.setSelectedBranch)

  // Load cached remote URL on mount, then fetch branch list
  useEffect(() => {
    async function init() {
      const cached = await loadGitRemoteUrl()
      const initial = cached ?? ENV_REPO_BASE_URL
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
      .map((p) => ({ name: p.name, localOnly: true }))
    const remoteItems: BranchItem[] = remoteBranches.map((b) => ({ name: b, localOnly: false }))

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
    await handleSelectBranch(name)
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
                    <span className="ml-auto text-xs text-muted-foreground">local only</span>
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
        </div>
      </div>
    </div>
  )
}
