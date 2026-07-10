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

interface FieldRow { key: string; value: string }

function fieldsToRows(fields: Record<string, string> | undefined): FieldRow[] {
  if (!fields) return [{ key: "", value: "" }]
  const rows = Object.entries(fields).map(([key, value]) => ({ key, value }))
  return rows.length > 0 ? rows : [{ key: "", value: "" }]
}

function rowsToFields(rows: FieldRow[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const { key, value } of rows) {
    if (key.trim()) out[key.trim()] = value
  }
  return out
}

export function QuestionTypesSection() {
  const { t } = useTranslation()
  const projectPath = useWikiStore((s) => s.project?.path ?? null)
  const [types, setTypes] = useState<QuestionType[]>([])
  const [editing, setEditing] = useState<QuestionType | null>(null)
  const [editingId, setEditingId] = useState("")
  const [isNew, setIsNew] = useState(false)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [promptTemplate, setPromptTemplate] = useState("")
  const [fieldRows, setFieldRows] = useState<FieldRow[]>([{ key: "", value: "" }])
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!projectPath) return
    const qts = await loadQuestionTypes(projectPath)
    setTypes(qts)
  }, [projectPath])

  useEffect(() => { reload() }, [reload])

  const openEditor = (qt: QuestionType, asNew: boolean) => {
    setEditing(qt)
    setEditingId(qt.id)
    setIsNew(asNew)
    setName(qt.name)
    setDescription(qt.description)
    setPromptTemplate(qt.promptTemplate ?? "")
    setFieldRows(fieldsToRows(qt.fields))
    setError(null)
  }

  const handleEdit = (qt: QuestionType) => openEditor(qt, false)

  const handleNew = () => {
    openEditor({
      id: "new_type",
      name: "New Question Type",
      description: "",
      fields: { answer: "Description" },
      promptTemplate: "",
      _filePath: "",
    }, true)
  }

  const handleSave = async () => {
    if (!editing || !projectPath) return
    try {
      const id = editingId.trim() || "unnamed"
      const fields = rowsToFields(fieldRows)
      const doc: Record<string, unknown> = { name, description, fields }
      if (promptTemplate.trim()) doc.prompt_template = promptTemplate
      const yamlText = yaml.dump(doc)

      const savePath = `${projectPath}/question_types/${id}.yaml`

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

  const addFieldRow = () => setFieldRows((r) => [...r, { key: "", value: "" }])
  const removeFieldRow = (i: number) => setFieldRows((r) => r.filter((_, idx) => idx !== i))
  const updateFieldRow = (i: number, patch: Partial<FieldRow>) =>
    setFieldRows((r) => r.map((row, idx) => idx === i ? { ...row, ...patch } : row))

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
          {/* Header */}
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

          {/* Name */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Question Type Name" />
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Description</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description" />
          </div>

          {/* Fields key-value editor */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Fields</label>
              <button
                type="button"
                onClick={addFieldRow}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <Plus className="h-3 w-3" /> Add field
              </button>
            </div>
            <div className="rounded-md border divide-y">
              {fieldRows.map((row, i) => (
                <div key={i} className="flex items-center gap-2 px-2 py-1.5">
                  <input
                    value={row.key}
                    onChange={(e) => updateFieldRow(i, { key: e.target.value })}
                    placeholder="key"
                    className="w-32 shrink-0 rounded border-0 bg-transparent px-1 py-0.5 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <span className="text-muted-foreground text-xs">:</span>
                  <input
                    value={row.value}
                    onChange={(e) => updateFieldRow(i, { value: e.target.value })}
                    placeholder="description"
                    className="min-w-0 flex-1 rounded border-0 bg-transparent px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <button
                    type="button"
                    onClick={() => removeFieldRow(i)}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Prompt template (multiline) */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Prompt Template <span className="normal-case font-normal">(optional)</span></label>
            <textarea
              value={promptTemplate}
              onChange={(e) => setPromptTemplate(e.target.value)}
              rows={5}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="Optional LLM prompt template..."
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

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
                </div>
                <p className="truncate text-xs text-muted-foreground mt-0.5">
                  {qt.description}
                </p>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-4">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(qt)}>
                  <Edit2 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost" size="icon"
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
