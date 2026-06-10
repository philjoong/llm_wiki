import { useState, useEffect, useCallback } from "react"
import { confirm } from "@tauri-apps/plugin-dialog"
import { useTranslation } from "react-i18next"
import { Plus, Edit2, Trash2, Save, X, FileJson, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useWikiStore } from "@/stores/wiki-store"
import { loadQuestionTypes, type QuestionType } from "@/lib/question-types"
import { writeFile, deleteFile, createDirectory, fileExists } from "@/commands/fs"
import yaml from "js-yaml"

export function QuestionTypesSection() {
  const { t } = useTranslation()
  const projectPath = useWikiStore((s) => s.project?.path ?? null)
  const [types, setTypes] = useState<QuestionType[]>([])
  const [editing, setEditing] = useState<QuestionType | null>(null)
  const [editingId, setEditingId] = useState("")
  const [isNew, setIsNew] = useState(false)
  const [yamlText, setYamlText] = useState("")
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!projectPath) return
    const qts = await loadQuestionTypes(projectPath)
    setTypes(qts)
  }, [projectPath])

  useEffect(() => {
    reload()
  }, [reload])

  const handleEdit = (qt: QuestionType) => {
    setEditing(qt)
    setEditingId(qt.id)
    setIsNew(false)
    const { id, _source, _filePath, ...rest } = qt
    setYamlText(yaml.dump(rest))
    setError(null)
  }

  const handleNew = () => {
    const placeholder: QuestionType = {
      id: "new_type",
      name: "New Question Type",
      description: "",
      fields: { answer: "Description" },
      promptTemplate: "",
      _source: "project",
      _filePath: "",
    }
    setEditing(placeholder)
    setEditingId("new_type")
    setIsNew(true)
    setYamlText(yaml.dump({ name: "New Question Type", description: "", fields: { answer: "Description" }, prompt_template: "" }))
    setError(null)
  }

  const handleSave = async () => {
    if (!editing || !projectPath) return
    try {
      const parsed = yaml.load(yamlText) as any
      if (!parsed || typeof parsed !== "object") throw new Error("Invalid YAML")

      const id = editingId.trim() || "unnamed"
      const savePath = editing._source === "user"
        ? `${projectPath}/.llm-wiki/question-types/${id}.yaml`
        : `${projectPath}/question_types/${id}.yaml`

      const dir = savePath.substring(0, savePath.lastIndexOf("/"))
      if (!(await fileExists(dir))) await createDirectory(dir)

      await writeFile(savePath, yamlText)
      setEditing(null)
      await reload()
    } catch (err: any) {
      setError(err.message)
    }
  }

  const handleDelete = async (qt: QuestionType) => {
    if (!projectPath) return
    if (!confirm(t("settings.questionTypes.confirmDelete", { id: qt.id }))) return
    await deleteFile(qt._filePath)
    await reload()
  }

  const sourceLabel = (qt: QuestionType) => {
    if (qt._source === "app") return "app"
    if (qt._source === "project") return "project"
    return "user"
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">{t("settings.questionTypes.title", "Question Types")}</h3>
          <p className="text-sm text-muted-foreground">
            {t("settings.questionTypes.description", "Manage specialized question types and their LLM templates.")}
          </p>
        </div>
        <Button onClick={handleNew} size="sm" variant="outline" className="gap-2">
          <Plus className="h-4 w-4" />
          {t("settings.questionTypes.add", "Add Type")}
        </Button>
      </div>

      {editing ? (
        <div className="rounded-lg border bg-card p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileJson className="h-4 w-4 text-primary" />
              {isNew ? (
                <Input
                  value={editingId}
                  onChange={(e) => setEditingId(e.target.value)}
                  placeholder="type_id"
                  className="h-7 font-mono text-sm w-48"
                />
              ) : (
                <span className="font-mono text-sm">{editing.id}.yaml</span>
              )}
            </div>
            <Button onClick={() => setEditing(null)} variant="ghost" size="sm">
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-2">
            <textarea
              value={yamlText}
              onChange={(e) => setYamlText(e.target.value)}
              className="min-h-[300px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="name: ...\ndescription: ...\nfields:\n  key: value\nprompt_template: |"
            />
            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button onClick={() => setEditing(null)} variant="outline" size="sm">
              {t("common.cancel", "Cancel")}
            </Button>
            <Button onClick={handleSave} size="sm" className="gap-2">
              <Save className="h-4 w-4" />
              {t("common.save", "Save")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          {types.map((qt) => (
            <div
              key={qt.id}
              className="group flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-accent/50"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{qt.name}</span>
                  <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded uppercase font-mono tracking-tighter">
                    {qt.id}
                  </span>
                  <span className="text-[10px] text-muted-foreground/60 bg-muted/50 px-1.5 py-0.5 rounded font-mono tracking-tighter">
                    {sourceLabel(qt)}
                  </span>
                </div>
                <p className="truncate text-xs text-muted-foreground mt-0.5">
                  {qt.description}
                </p>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-4">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => handleEdit(qt)}
                >
                  <Edit2 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => handleDelete(qt)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
          {types.length === 0 && (
            <div className="text-center py-8 border border-dashed rounded-lg text-muted-foreground italic text-sm">
              {t("settings.questionTypes.empty", "No specialized question types found.")}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
