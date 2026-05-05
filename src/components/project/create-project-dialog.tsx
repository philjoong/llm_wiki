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
import { initProject } from "@/lib/project-init"
import { SchemaPicker } from "@/components/project/schema-picker"
import type { WikiProject } from "@/types/wiki"

interface CreateProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (project: WikiProject) => void
}

export function CreateProjectDialog({ open: isOpen, onOpenChange, onCreated }: CreateProjectDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState("")
  const [path, setPath] = useState("")
  const [schemaSourcePath, setSchemaSourcePath] = useState("")
  const [purposeMarkdown, setPurposeMarkdown] = useState("")
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
    if (!name.trim() || !path.trim()) {
      setError(t("project.error.nameAndPath"))
      return
    }
    if (!schemaSourcePath) {
      setError(t("project.error.schemaRequired"))
      return
    }
    setCreating(true)
    setError("")
    try {
      const project = await createProject(name.trim(), path.trim())
      await initProject({
        projectPath: project.path,
        schemaSourcePath,
        purposeMarkdown,
      })

      onCreated(project)
      onOpenChange(false)
      setName("")
      setPath("")
      setSchemaSourcePath("")
      setPurposeMarkdown("")
    } catch (err) {
      setError(String(err))
    } finally {
      setCreating(false)
    }
  }

  const canCreate = !!name.trim() && !!path.trim() && !!schemaSourcePath && !creating

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
            <Label>{t("project.schema.label")}</Label>
            <SchemaPicker selectedPath={schemaSourcePath} onSelect={setSchemaSourcePath} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="purpose">{t("project.purpose.label")}</Label>
            <textarea
              id="purpose"
              value={purposeMarkdown}
              onChange={(e) => setPurposeMarkdown(e.target.value)}
              placeholder={t("project.purpose.placeholder")}
              rows={6}
              className="w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 font-mono text-sm leading-relaxed transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
            />
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
