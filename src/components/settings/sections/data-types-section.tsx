import { useState, useEffect, useCallback } from "react"
import { confirm } from "@tauri-apps/plugin-dialog"
import { useTranslation } from "react-i18next"
import { Plus, Edit2, Trash2, Save, X, FileJson, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useWikiStore } from "@/stores/wiki-store"
import { loadDataTypes, type DataType } from "@/lib/data-types"
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

export function DataTypesSection() {
  const { t } = useTranslation()
  const projectPath = useWikiStore((s) => s.project?.path ?? null)
  const [types, setTypes] = useState<DataType[]>([])
  const [editing, setEditing] = useState<DataType | null>(null)
  const [editingId, setEditingId] = useState("")
  const [isNew, setIsNew] = useState(false)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [fieldRows, setFieldRows] = useState<FieldRow[]>([{ key: "", value: "" }])
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!projectPath) return
    const dts = await loadDataTypes(projectPath)
    setTypes(dts)
  }, [projectPath])

  useEffect(() => { reload() }, [reload])

  const openEditor = (dt: DataType, asNew: boolean) => {
    setEditing(dt)
    setEditingId(dt.id)
    setIsNew(asNew)
    setName(dt.name)
    setDescription(dt.description)
    setFieldRows(fieldsToRows(dt.fields))
    setError(null)
  }

  const handleEdit = (dt: DataType) => openEditor(dt, false)

  const handleNew = () => {
    openEditor({
      id: "new_data_type",
      name: "New Data Type",
      description: "",
      fields: { title: "Document title", summary: "Short summary" },
      _source: "project",
      _filePath: "",
    }, true)
  }

  const handleSave = async () => {
    if (!editing || !projectPath) return
    try {
      const id = editingId.trim() || "unnamed"
      const fields = rowsToFields(fieldRows)
      if (Object.keys(fields).length === 0) throw new Error("fields must have at least one entry")
      const doc = { name, description, fields }
      const yamlText = yaml.dump(doc)

      const savePath = editing._source === "user"
        ? `${projectPath}/.llm-wiki/data-types/${id}.yaml`
        : `${projectPath}/data_types/${id}.yaml`

      const dir = savePath.substring(0, savePath.lastIndexOf("/"))
      if (!(await fileExists(dir))) await createDirectory(dir)

      await writeFile(savePath, yamlText)
      setEditing(null)
      await reload()
    } catch (err: any) {
      setError(err.message)
    }
  }

  const handleDelete = async (dt: DataType) => {
    if (!projectPath) return
    if (!confirm(t("settings.dataTypes.confirmDelete", { id: dt.id }))) return
    await deleteFile(dt._filePath)
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
          <h3 className="text-lg font-medium">{t("settings.dataTypes.title", "Data Types")}</h3>
          <p className="text-sm text-muted-foreground">
            {t("settings.dataTypes.description", "Define schemas for structured extraction during ingest. When selected, Stage 1 fills each field instead of free-form decomposition.")}
          </p>
        </div>
        <Button onClick={handleNew} size="sm" variant="outline" className="gap-2">
          <Plus className="h-4 w-4" />
          {t("settings.dataTypes.add", "Add Type")}
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
                  placeholder="data_type_id"
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
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Data Type Name" />
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Description</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description" />
          </div>

          {/* Fields key-value editor */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Fields to extract</label>
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
                    placeholder="field_key"
                    className="w-36 shrink-0 rounded border-0 bg-transparent px-1 py-0.5 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <span className="text-muted-foreground text-xs">:</span>
                  <input
                    value={row.value}
                    onChange={(e) => updateFieldRow(i, { value: e.target.value })}
                    placeholder="what to extract"
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
          {types.map((dt) => (
            <div
              key={dt.id}
              className="group flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-accent/50"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{dt.name}</span>
                  <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded uppercase font-mono tracking-tighter">
                    {dt.id}
                  </span>
                  <span className="text-[10px] text-muted-foreground/60 bg-muted/50 px-1.5 py-0.5 rounded font-mono tracking-tighter">
                    {dt._source}
                  </span>
                </div>
                {dt.description && (
                  <p className="truncate text-xs text-muted-foreground mt-0.5">{dt.description}</p>
                )}
                <p className="text-xs text-muted-foreground/70 mt-0.5">
                  {Object.keys(dt.fields).join(", ")}
                </p>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-4">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(dt)}>
                  <Edit2 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost" size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => handleDelete(dt)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
          {types.length === 0 && (
            <div className="text-center py-8 border border-dashed rounded-lg text-muted-foreground italic text-sm">
              {t("settings.dataTypes.empty", "No data types defined. Add one to enable structured extraction.")}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
