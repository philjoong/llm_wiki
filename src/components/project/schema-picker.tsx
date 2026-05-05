import { open } from "@tauri-apps/plugin-dialog"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { FileText } from "lucide-react"

interface SchemaPickerProps {
  selectedPath: string
  onSelect: (path: string) => void
}

export function SchemaPicker({ selectedPath, onSelect }: SchemaPickerProps) {
  const { t } = useTranslation()

  async function handleBrowse() {
    const picked = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Markdown", extensions: ["md"] }],
      title: t("project.schema.dialogTitle"),
    })
    if (typeof picked === "string") {
      onSelect(picked)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button variant="outline" onClick={handleBrowse} type="button" className="justify-start gap-2">
        <FileText className="h-4 w-4" />
        {selectedPath ? t("project.schema.changeButton") : t("project.schema.button")}
      </Button>
      {selectedPath && (
        <p className="break-all text-xs text-muted-foreground">{selectedPath}</p>
      )}
    </div>
  )
}
