import { useEffect, useRef, useState } from "react"
import { gitLsRemote } from "@/commands/git"
import { useWikiStore } from "@/stores/wiki-store"
import { getRecentProjects, saveSelectedBranch } from "@/lib/project-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Loader2, GitBranch, HardDrive } from "lucide-react"

const GIT_TOKEN = import.meta.env.VITE_GIT_TOKEN
const REPO_BASE_URL = import.meta.env.VITE_GIT_REPO_URL || ""

const getRepoUrl = () => {
  if (GIT_TOKEN) {
    return `https://oauth2:${encodeURIComponent(GIT_TOKEN)}@${REPO_BASE_URL}`
  }
  return `https://${REPO_BASE_URL}`
}

interface BranchItem {
  name: string
  localOnly: boolean
}

export function ProjectBranchSelector() {
  const [items, setItems] = useState<BranchItem[]>([])
  const [loading, setLoading] = useState(true)
  const [remoteError, setRemoteError] = useState<string | null>(null)
  const [newBranchName, setNewBranchName] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const setSelectedBranch = useWikiStore((s) => s.setSelectedBranch)

  useEffect(() => {
    fetchAll()
  }, [])

  async function fetchAll() {
    setLoading(true)
    setRemoteError(null)

    // Fetch remote branches and local recent projects in parallel
    const [remoteResult, localProjects] = await Promise.all([
      gitLsRemote(getRepoUrl()).then(
        (list) => ({ ok: true as const, list }),
        (err) => ({ ok: false as const, error: String(err) }),
      ),
      getRecentProjects(),
    ])

    const remoteBranches: string[] = remoteResult.ok ? remoteResult.list : []
    if (!remoteResult.ok) {
      console.error("[ProjectBranchSelector] gitLsRemote failed:", remoteResult.error)
      setRemoteError(remoteResult.error)
    }

    const remoteSet = new Set(remoteBranches)

    // Local-only: recent projects whose name isn't already in remote branches
    const localOnlyItems: BranchItem[] = localProjects
      .filter((p) => !remoteSet.has(p.name))
      .map((p) => ({ name: p.name, localOnly: true }))

    const remoteItems: BranchItem[] = remoteBranches.map((b) => ({ name: b, localOnly: false }))

    setItems([...remoteItems, ...localOnlyItems])
    setLoading(false)
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

  if (loading) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Fetching projects...</p>
      </div>
    )
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

        {remoteError && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive break-all">
            Remote unavailable: {remoteError}
          </div>
        )}

        {items.length > 0 && (
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
        )}

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
          {remoteError && (
            <Button variant="outline" size="sm" onClick={fetchAll}>
              Retry connection
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
