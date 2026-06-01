import { useState } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import { useTranslation } from "react-i18next"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FolderOpen } from "lucide-react"
import { createProject } from "@/commands/fs"
import { gitRemoteAdd, gitCreateBranch, gitPush } from "@/commands/git"
import { createGraphDb } from "@/commands/graph-db"
import { initProject } from "@/lib/project-init"
import type { WikiProject } from "@/types/wiki"

const GIT_TOKEN = import.meta.env.VITE_GIT_TOKEN
const REPO_BASE_URL = import.meta.env.VITE_GIT_REPO_URL || ""

const getRepoUrl = () => {
  if (GIT_TOKEN) {
    return `https://oauth2:${encodeURIComponent(GIT_TOKEN)}@${REPO_BASE_URL}`
  }
  return `https://${REPO_BASE_URL}`
}

interface CreateProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (project: WikiProject) => void
}

export function CreateProjectDialog({ open: isOpen, onOpenChange, onCreated }: CreateProjectDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState("")
  const [path, setPath] = useState("")
  const [error, setError] = useState("")
  const [creating, setCreating] = useState(false)

  async function handleBrowse() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: t("project.parentDir"),
    })
    if (selected) {
      setPath(selected)
    }
  }

  async function handleCreate() {
    const projectName = name.trim()
    const parentPath = path.trim()
    if (!projectName || !parentPath) {
      setError(t("project.error.nameAndPath"))
      return
    }
    setCreating(true)
    setError("")
    try {
      // 1. Create project directory and metadata
      const project = await createProject(projectName, parentPath)
      
      // 2. Initialize local Git repo and seed files
      await initProject({ projectPath: project.path })

      // 3. Authenticated Git Setup
      const authenticatedUrl = getRepoUrl()
      await gitRemoteAdd(project.path, "origin", authenticatedUrl)
      
      // 4. Create and push project-specific branch
      await gitCreateBranch(project.path, projectName)
      await gitPush(project.path, "origin", projectName)

      // 5. FalkorDB Initialization (isolated via prefix)
      await createGraphDb(projectName, "main")

      onCreated(project)
      onOpenChange(false)
      setName("")
      setPath("")
    } catch (err) {
      setError(String(err))
    } finally {
      setCreating(false)
    }
  }

  const canCreate = !!name.trim() && !!path.trim() && !creating

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("project.createTitle")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">{t("project.name")}</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("project.namePlaceholder")} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="path">{t("project.parentDir")}</Label>
            <div className="flex gap-2">
              <Input id="path" value={path} onChange={(e) => setPath(e.target.value)} placeholder="/Users/you/projects" className="flex-1" />
              <Button variant="outline" size="icon" onClick={handleBrowse} type="button">
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("project.cancel")}</Button>
          <Button onClick={handleCreate} disabled={!canCreate}>{creating ? t("project.creating") : t("project.create")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
