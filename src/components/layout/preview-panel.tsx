import { useEffect, useCallback, useRef, useState } from "react"
import { X } from "lucide-react"
import { readFile, writeFile } from "@/commands/fs"
import { getFileCategory, isBinary } from "@/lib/file-types"
import { WikiEditor } from "@/components/editor/wiki-editor"
import { FilePreview } from "@/components/editor/file-preview"
import { getFileName } from "@/lib/path-utils"
import { usePageTitles, titleForPath } from "@/lib/use-page-titles"
import { useWikiStore } from "@/stores/wiki-store"

interface PreviewPanelProps {
  filePath: string
  onClose: () => void
}

export function PreviewPanel({ filePath: selectedFile, onClose }: PreviewPanelProps) {
  const [fileContent, setFileContent] = useState("")
  const project = useWikiStore((s) => s.project)
  const pageTitles = usePageTitles()
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Snapshot of what was most recently loaded from disk. Milkdown re-emits
  // `markdownUpdated` on initial parse (before the user types anything),
  // which used to trigger an auto-save that could write back a placeholder
  // marker if read_file had returned one for a missing/locked file. We
  // skip save when the incoming markdown equals the last-loaded content.
  const lastLoadedRef = useRef<string>("")

  useEffect(() => {
    const category = getFileCategory(selectedFile)

    if (isBinary(category)) {
      setFileContent("")
      lastLoadedRef.current = ""
      return
    }

    readFile(selectedFile)
      .then((content) => {
        lastLoadedRef.current = content
        setFileContent(content)
      })
      .catch((err) => {
        lastLoadedRef.current = ""
        setFileContent(`Error loading file: ${err}`)
      })
  }, [selectedFile])

  const handleSave = useCallback(
    (markdown: string) => {
      // Ignore no-op saves from the editor's initial re-emit. Only write
      // when the user has actually changed the content relative to the
      // last disk read.
      if (markdown === lastLoadedRef.current) return
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        writeFile(selectedFile, markdown)
          .then(() => {
            // Our own write becomes the new "last loaded" — subsequent
            // re-emits from Milkdown that match this content must not
            // trigger another save.
            lastLoadedRef.current = markdown
          })
          .catch((err) => console.error("Failed to save:", err))
      }, 1000)
    },
    [selectedFile]
  )

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

  const category = getFileCategory(selectedFile)
  const displayName = project ? titleForPath(pageTitles, selectedFile, project.path) : getFileName(selectedFile)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-1.5">
        <span className="truncate text-xs text-muted-foreground" title={selectedFile}>
          {displayName}
        </span>
        <button
          onClick={onClose}
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex-1 min-w-0 overflow-auto">
        {category === "markdown" ? (
          <WikiEditor
            key={selectedFile}
            content={fileContent}
            onSave={handleSave}
          />
        ) : (
          <FilePreview
            key={selectedFile}
            filePath={selectedFile}
            textContent={fileContent}
          />
        )}
      </div>
    </div>
  )
}
