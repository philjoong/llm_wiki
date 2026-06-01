import { useEffect, useRef, useState } from "react"
import { gitLsRemote } from "@/commands/git"
import { useWikiStore } from "@/stores/wiki-store"
import { saveSelectedBranch } from "@/lib/project-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Loader2, GitBranch } from "lucide-react"

const GIT_TOKEN = import.meta.env.VITE_GIT_TOKEN
const REPO_BASE_URL = import.meta.env.VITE_GIT_REPO_URL || ""

const getRepoUrl = () => {
  if (GIT_TOKEN) {
    return `https://oauth2:${encodeURIComponent(GIT_TOKEN)}@${REPO_BASE_URL}`
  }
  return `https://${REPO_BASE_URL}`
}

export function ProjectBranchSelector() {
  const [branches, setBranches] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newBranchName, setNewBranchName] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const setSelectedBranch = useWikiStore((s) => s.setSelectedBranch)

  useEffect(() => {
    fetchBranches()
  }, [])

  async function fetchBranches() {
    try {
      setLoading(true)
      setError(null)
      const url = getRepoUrl()
      console.log("[ProjectBranchSelector] fetching branches from:", url)
      const list = await gitLsRemote(url)
      console.log("[ProjectBranchSelector] branches:", list)
      setBranches(list)
    } catch (err) {
      console.error("[ProjectBranchSelector] gitLsRemote failed:", err)
      setError(String(err))
    } finally {
      setLoading(false)
    }
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
            Choose a branch from the remote repository
          </p>
        </div>

        {error ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive break-all">
            {error}
          </div>
        ) : (
          <div className="rounded-lg border bg-card">
            <div className="max-h-[300px] overflow-y-auto">
              {branches.map((branch) => (
                <button
                  key={branch}
                  onClick={() => handleSelectBranch(branch)}
                  className="flex w-full items-center gap-3 border-b px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-accent"
                >
                  <GitBranch className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{branch}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">
            {error ? "Enter branch name manually" : "Or create a new project"}
          </p>
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              placeholder="branch-name"
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateBranch()}
            />
            <Button onClick={handleCreateBranch} disabled={!newBranchName.trim()}>
              {error ? "Enter" : "Create"}
            </Button>
          </div>
          {error && (
            <Button variant="outline" size="sm" onClick={fetchBranches}>
              Retry connection
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
