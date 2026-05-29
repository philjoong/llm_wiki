import { useEffect, useState } from "react"
import { gitLsRemote } from "@/commands/git"
import { useWikiStore } from "@/stores/wiki-store"
import { saveSelectedBranch } from "@/lib/project-store"
import { Button } from "@/components/ui/button"
import { Loader2, GitBranch } from "lucide-react"

const GIT_USER = import.meta.env.VITE_GIT_USER
const GIT_PASSWORD = import.meta.env.VITE_GIT_PASSWORD
const REPO_BASE_URL = import.meta.env.VITE_GIT_REPO_URL || ""

const getRepoUrl = () => {
  const encodedUser = GIT_USER ? encodeURIComponent(GIT_USER) : ""
  const encodedPass = GIT_PASSWORD ? encodeURIComponent(GIT_PASSWORD) : ""

  if (encodedUser && encodedPass) {
    return `https://${encodedUser}:${encodedPass}@${REPO_BASE_URL}`
  }
  if (encodedUser) {
    return `https://${encodedUser}@${REPO_BASE_URL}`
  }
  return `https://${REPO_BASE_URL}`
}

export function ProjectBranchSelector() {
  const [branches, setBranches] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const setSelectedBranch = useWikiStore((s) => s.setSelectedBranch)

  useEffect(() => {
    async function fetchBranches() {
      try {
        setLoading(true)
        const url = getRepoUrl()
        const list = await gitLsRemote(url)
        setBranches(list)
        setError(null)
      } catch (err) {
        setError(String(err))
      } finally {
        setLoading(false)
      }
    }
    fetchBranches()
  }, [])

  async function handleSelectBranch(branch: string) {
    setSelectedBranch(branch)
    await saveSelectedBranch(branch)
  }

  if (loading) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Fetching projects...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center">
        <p className="text-destructive font-medium">Failed to fetch projects</p>
        <p className="text-sm text-muted-foreground break-all">{error}</p>
        <Button onClick={() => window.location.reload()}>Retry</Button>
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

        <div className="rounded-lg border bg-card">
          <div className="max-h-[400px] overflow-y-auto">
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
      </div>
    </div>
  )
}
