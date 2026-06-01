import { useState, useEffect, useCallback } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import { invoke } from "@tauri-apps/api/core"
import { Plus, FileText, RefreshCw, BookOpen, Trash2, Folder, ChevronRight, ChevronDown, Network } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useWikiStore } from "@/stores/wiki-store"
import { useActivityStore } from "@/stores/activity-store"
import { listDirectory, readFile, writeFile, deleteFile, findRelatedWikiPages, preprocessFile } from "@/commands/fs"
import { gitCommit } from "@/commands/git"
import type { FileNode } from "@/types/wiki"
import { startIngest } from "@/lib/ingest"
import { enqueueIngest, enqueueBatch } from "@/lib/ingest-queue"
import { useTranslation } from "react-i18next"
import { normalizePath, getFileName } from "@/lib/path-utils"
import { convertHtmlToMarkdown } from "@/lib/html-convert"
import {
  buildDeletedKeys,
  cleanIndexListing,
  stripDeletedWikilinks,
  extractFrontmatterTitle,
  type DeletedPageInfo,
} from "@/lib/wiki-cleanup"
import { parseSources, writeSources } from "@/lib/sources-merge"
import { decidePageFate } from "@/lib/source-delete-decision"
import { copyOriginal, ensureOriginalsGitignore, injectOriginalRef } from "@/lib/originals"
import { findRelatedGraphs } from "@/commands/graph-db"

export function SourcesView() {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const selectedFile = useWikiStore((s) => s.selectedFile)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const setFileContent = useWikiStore((s) => s.setFileContent)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const setChatExpanded = useWikiStore((s) => s.setChatExpanded)
  const setSelectedGraph = useWikiStore((s) => s.setSelectedGraph)
  const setHighlightSource = useWikiStore((s) => s.setHighlightSource)
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const [sources, setSources] = useState<FileNode[]>([])
  const [importing, setImporting] = useState(false)
  const [ingestingPath, setIngestingPath] = useState<string | null>(null)
  const [relatedGraphs, setRelatedGraphs] = useState<string[]>([])
  const [loadingGraphs, setLoadingGraphs] = useState(false)

  const loadSources = useCallback(async () => {
    if (!project) return
    const pp = normalizePath(project.path)
    try {
      const tree = await listDirectory(`${pp}/raw/sources`)
      // Filter out hidden files/dirs and cache
      const filtered = filterTree(tree)
      setSources(filtered)
    } catch {
      setSources([])
    }
  }, [project])

  useEffect(() => {
    loadSources()
  }, [loadSources])

  useEffect(() => {
    if (project && selectedFile && selectedFile.includes("/raw/sources/")) {
      const fileName = selectedFile.split("/").pop() || ""
      setLoadingGraphs(true)
      findRelatedGraphs(project.name, fileName)
        .then(setRelatedGraphs)
        .catch(err => {
          console.error("Failed to find related graphs:", err)
          setRelatedGraphs([])
        })
        .finally(() => setLoadingGraphs(false))
    } else {
      setRelatedGraphs([])
    }
  }, [project, selectedFile])

  async function handleImport() {
    if (!project) return

    const selected = await open({
      multiple: true,
      title: "Import Source Files",
      filters: [
        {
          name: "Documents",
          extensions: [
            "md", "mdx", "txt", "rtf", "pdf",
            "html", "htm", "xml",
            "doc", "docx", "xls", "xlsx", "ppt", "pptx",
            "odt", "ods", "odp", "epub", "pages", "numbers", "key",
          ],
        },
        {
          name: "Data",
          extensions: ["json", "jsonl", "csv", "tsv", "yaml", "yml", "ndjson"],
        },
        {
          name: "Code",
          extensions: [
            "py", "js", "ts", "jsx", "tsx", "rs", "go", "java",
            "c", "cpp", "h", "rb", "php", "swift", "sql", "sh",
          ],
        },
        {
          name: "Images",
          extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "tiff", "avif", "heic"],
        },
        {
          name: "Media",
          extensions: ["mp4", "webm", "mov", "avi", "mkv", "mp3", "wav", "ogg", "flac", "m4a"],
        },
        { name: "All Files", extensions: ["*"] },
      ],
    })

    if (!selected || selected.length === 0) return

    setImporting(true)
    const pp = normalizePath(project.path)
    const paths = Array.isArray(selected) ? selected : [selected]

    const activityId = useActivityStore.getState().addItem({
      type: "import",
      title: paths.length === 1 ? getFileName(paths[0]) || "file" : `${paths.length} files`,
      status: "running",
      detail: "Preprocessing files...",
      filesWritten: [],
    })

    // Import == 1차 가공. We extract markdown from the original
    // (PDF/docx → text, plain text passthrough, etc.) and write
    // `raw/sources/<basename>.md`. We ALSO copy the binary into
    // `raw/originals/` (gitignored) so a human can round-trip back to
    // it for things 1차 가공 dropped — embedded charts, diagrams,
    // SmartArt, OLE objects. The frontmatter `original:` link makes
    // that round-trip discoverable from the preprocessed markdown.
    // Failures surface as alerts; we never silent-catch here because
    // that's how files used to vanish.
    await ensureOriginalsGitignore(pp)
    const importedPaths: string[] = []
    const failures: string[] = []
    for (const sourcePath of paths) {
      const originalName = getFileName(sourcePath) || "unknown"
      const mdName = toMarkdownName(originalName)
      const destPath = await getUniqueDestPath(`${pp}/raw/sources`, mdName)
      try {
        let markdown = await preprocessFile(sourcePath)

        // HTML conversion if needed
        const ext = sourcePath.split(".").pop()?.toLowerCase() ?? ""
        if (ext === "html" || ext === "htm") {
          markdown = convertHtmlToMarkdown(markdown)
        }

        // Copy binary first so a successful preprocess always has a
        // matching original on disk. If the copy fails (permission /
        // disk full / etc.), proceed without the link rather than
        // dropping the import entirely — the markdown is the primary
        // artifact.
        let originalRel: string | null = null
        try {
          originalRel = await copyOriginal(pp, sourcePath, originalName)
        } catch (err) {
          console.warn(`[import] failed to copy original for ${originalName}:`, err)
        }
        const finalMarkdown = originalRel ? injectOriginalRef(markdown, originalRel) : markdown
        await writeFile(destPath, finalMarkdown)

        // Auto-commit newly added or converted file
        try {
          const fileName = getFileName(destPath)
          const commitExt = originalName.split(".").pop() || "unknown"
          // Pass relative path to gitCommit
          const relDestPath = destPath.startsWith(pp) ? destPath.slice(pp.length + 1) : destPath
          await gitCommit(pp, `ingest: add ${fileName} (${commitExt})`, [relDestPath])
        } catch (gitErr) {
          console.error("Failed to auto-commit:", gitErr)
        }

        importedPaths.push(destPath)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`Failed to import ${originalName}:`, err)
        failures.push(`${originalName}: ${msg}`)
      }
    }

    useActivityStore.getState().updateItem(activityId, {
      status: failures.length === 0 ? "done" : "error",
      detail:
        failures.length === 0
          ? `Imported ${importedPaths.length} files`
          : `Imported ${importedPaths.length} files, ${failures.length} failed`,
      filesWritten: importedPaths,
    })

    setImporting(false)
    await loadSources()

    if (failures.length > 0) {
      window.alert(
        `Failed to import ${failures.length} file(s):\n\n${failures.join("\n")}`,
      )
    }

    // Enqueue for serial ingest (runs in background via ingest queue).
    // The queue itself fails the task with a visible error if no LLM is
    // configured — do not pre-gate here, or imports vanish without signal.
    for (const destPath of importedPaths) {
      enqueueIngest(project.id, destPath).catch((err) =>
        console.error(`Failed to enqueue ingest:`, err)
      )
    }
  }

  async function handleImportFolder() {
    if (!project) return

    const selected = await open({
      directory: true,
      title: "Import Source Folder",
    })

    if (!selected || typeof selected !== "string") return

    setImporting(true)
    const pp = normalizePath(project.path)
    const folderName = getFileName(selected) || "imported"
    const destDir = `${pp}/raw/sources/${folderName}`

    const activityId = useActivityStore.getState().addItem({
      type: "import",
      title: folderName,
      status: "running",
      detail: "Scanning folder...",
      filesWritten: [],
    })

    try {
      // Walk the source folder and discover every file. Each
      // ingestable file is preprocessed to markdown under
      // `raw/sources/<folderName>/<rel>.md`, AND the original binary
      // is copied to `raw/originals/<folderName>/<rel>` so a human
      // can round-trip back to it for things 1차 가공 dropped (charts,
      // diagrams, embedded images). The originals tree is gitignored
      // — see ensureOriginalsGitignore.
      await ensureOriginalsGitignore(pp)
      const sourceTree: FileNode[] = await invoke("list_directory", {
        path: selected,
      })
      const sourceRoot = normalizePath(selected)
      const flat = flattenAllFiles(sourceTree).map((n) => ({
        sourcePath: n.path,
        relPath: stripRoot(normalizePath(n.path), sourceRoot),
      }))

      useActivityStore.getState().updateItem(activityId, {
        detail: `Found ${flat.length} files. Preprocessing...`,
      })

      const preprocessable = new Set([
        "md", "mdx", "txt", "pdf", "docx", "pptx", "xlsx", "xls", "ods",
        "odt", "odp", "csv", "json", "jsonl", "html", "htm", "rtf",
        "xml", "yaml", "yml", "tsv", "ndjson",
      ])
      // Code-ish text files are also valid markdown content (preprocess_file
      // returns their content verbatim). Keep them in scope so a folder of
      // source code lands in the wiki the same way text files do.
      const codeExts = new Set([
        "py", "js", "ts", "jsx", "tsx", "rs", "go", "java",
        "c", "cpp", "h", "rb", "php", "swift", "sql", "sh",
      ])

      const importedTargets: { destPath: string; folderContext: string }[] = []
      const failures: string[] = []

      for (const { sourcePath, relPath } of flat) {
        const ext = relPath.split(".").pop()?.toLowerCase() ?? ""
        if (!preprocessable.has(ext) && !codeExts.has(ext)) {
          // Image / media / legacy doc — preprocess_file returns a stub,
          // which isn't useful for ingest and would clutter the wiki.
          // Skip silently for folder imports.
          continue
        }
        const dirParts = relPath.split("/")
        const fileName = dirParts.pop() ?? relPath
        const subdir = dirParts.length > 0 ? `${destDir}/${dirParts.join("/")}` : destDir
        const mdName = toMarkdownName(fileName)
        const destPath = await getUniqueDestPath(subdir, mdName)
        try {
          let markdown = await preprocessFile(sourcePath)

          // HTML conversion if needed
          const ext = sourcePath.split(".").pop()?.toLowerCase() ?? ""
          if (ext === "html" || ext === "htm") {
            markdown = convertHtmlToMarkdown(markdown)
          }

          // Copy original alongside preprocess output. Failure here is
          // logged but non-fatal — the markdown is the primary artifact.
          // Mirror the source folder structure so multi-file imports
          // keep their layout under raw/originals/<folderName>/...
          let originalRel: string | null = null
          try {
            originalRel = await copyOriginal(pp, sourcePath, `${folderName}/${relPath}`)
          } catch (err) {
            console.warn(`[folder-import] failed to copy original for ${relPath}:`, err)
          }
          const finalMarkdown = originalRel ? injectOriginalRef(markdown, originalRel) : markdown
          await writeFile(destPath, finalMarkdown)

          // Auto-commit newly added or converted file
          try {
            const fileName = getFileName(destPath)
            const commitExt = sourcePath.split(".").pop() || "unknown"
            await gitCommit(pp, `ingest: add ${fileName} (${commitExt})`, [destPath])
          } catch (gitErr) {
            console.error("Failed to auto-commit:", gitErr)
          }

          const context = dirParts.length > 0
            ? `${folderName} > ${dirParts.join(" > ")}`
            : folderName
          importedTargets.push({ destPath, folderContext: context })
          
          useActivityStore.getState().updateItem(activityId, {
            detail: `Imported ${importedTargets.length} / ${flat.length} files...`,
          })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.error(`Failed to import ${relPath}:`, err)
          failures.push(`${relPath}: ${msg}`)
        }
      }

      console.log(`[Folder Import] Imported ${importedTargets.length} files from ${folderName}`)

      useActivityStore.getState().updateItem(activityId, {
        status: failures.length === 0 ? "done" : "error",
        detail:
          failures.length === 0
            ? `Imported ${importedTargets.length} files`
            : `Imported ${importedTargets.length} files, ${failures.length} failed`,
        filesWritten: importedTargets.map((t) => t.destPath),
      })

      setImporting(false)
      await loadSources()

      if (failures.length > 0) {
        window.alert(
          `Failed to import ${failures.length} file(s):\n\n${failures.join("\n")}`,
        )
      }

      if (importedTargets.length > 0) {
        const tasks = importedTargets.map((t) => ({
          sourcePath: t.destPath,
          folderContext: t.folderContext,
        }))
        await enqueueBatch(project.id, tasks)
        console.log(`[Folder Import] Enqueued ${tasks.length} files for ingest`)
      }
    } catch (err) {
      console.error(`Failed to import folder:`, err)
      setImporting(false)
    }
  }

  async function handleOpenSource(node: FileNode) {
    setSelectedFile(node.path)
    setHighlightSource(null) // Clear highlight when switching files
    try {
      const content = await readFile(node.path)
      setFileContent(content)
    } catch (err) {
      console.error("Failed to read source:", err)
    }
  }

  function handleJumpToGraph(graphName: string) {
    if (!selectedFile) return
    setSelectedGraph(graphName)
    setHighlightSource(selectedFile)
    setActiveView("graph")
  }

  async function handleDelete(node: FileNode) {
    if (!project) return
    const pp = normalizePath(project.path)
    const fileName = node.name
    const confirmed = window.confirm(
      t("sources.deleteConfirm", { name: fileName })
    )
    if (!confirmed) return

    try {
      // Step 1: Find related wiki pages before deleting
      const relatedPages = await findRelatedWikiPages(pp, fileName)

      // Step 2: Delete the source file
      await deleteFile(node.path)

      // Step 3: Delete preprocessed cache (legacy — the new import flow
      // doesn't use a sidecar cache, but a leftover from a pre-migration
      // project may still be on disk).
      try {
        await deleteFile(`${pp}/raw/sources/.cache/${fileName}.md`)
      } catch {
        // cache file may not exist
      }

      // Step 4: For each page that findRelatedWikiPages surfaced,
      // consult decidePageFate to pick one of three actions:
      //
      //   keep   — page has OTHER sources too; just drop this one from
      //            its sources[] list and rewrite.
      //   delete — this was the page's sole source; remove the page
      //            and record { slug, title } so downstream cleanup
      //            can wipe every stale reference to it.
      //   skip   — the page's sources[] doesn't actually include the
      //            file being deleted. Must have been surfaced by the
      //            Rust findRelatedWikiPages loose-match path (fs.rs
      //            Strategy 3 — substring of title / description /
      //            elsewhere in the frontmatter). Leaving the page
      //            alone prevents silent data loss when a filename
      //            happens to appear in an unrelated page's metadata.
      const actuallyDeleted: string[] = []
      const deletedInfos: DeletedPageInfo[] = []
      for (const pagePath of relatedPages) {
        try {
          const content = await readFile(pagePath)
          const sourcesList = parseSources(content)
          const decision = decidePageFate(sourcesList, fileName)

          if (decision.action === "skip") {
            // Nothing to do — page isn't really derived from this source.
            continue
          }

          if (decision.action === "keep") {
            // Multi-source page — rewrite sources with the deleted one
            // filtered out. writeSources preserves every other
            // frontmatter field and position.
            const updated = writeSources(content, decision.updatedSources)
            await writeFile(pagePath, updated)
            continue
          }

          // action === "delete": the page's sole source was this file.
          // Capture slug + title before deletion so stale references
          // can be cleaned from index / overview / sibling pages.
          const slug = getFileName(pagePath).replace(/\.md$/, "")
          const title = extractFrontmatterTitle(content)
          deletedInfos.push({ slug, title })
          // cascadeDeleteWikiPage = deleteFile(...) + drop the page's
          // embedding chunks so future searches don't return phantom
          // hits pointing at a file that no longer exists.
          const { cascadeDeleteWikiPage } = await import("@/lib/wiki-page-delete")
          await cascadeDeleteWikiPage(pp, pagePath)
          actuallyDeleted.push(pagePath)
        } catch (err) {
          console.error(`Failed to process wiki page ${pagePath}:`, err)
        }
      }

      // Steps 5 & 6: clean stale references from every wiki file.
      //
      // index.md  → drop list-item lines whose primary `[[target]]` is
      //             a deleted page (title OR slug form matches).
      // overview.md + everything else → strip `[[deleted]]` occurrences
      //             in prose, replacing them with plain text (or with
      //             the pipe display when present).
      //
      // Using normalized-key matching rather than the old substring
      // `includes` check avoids two classes of real bugs: stale
      // title-form refs surviving (`[[KV Cache]]` vs slug `kv-cache`),
      // and innocent siblings getting wiped collaterally (deleting
      // `ai.md` must not take `[[OpenAI]]` / `[[AI Safety]]` down).
      const deletedKeys = buildDeletedKeys(deletedInfos)
      if (deletedKeys.size > 0) {
        try {
          const dbTree = await listDirectory(`${pp}/db`)
          const allMdFiles = flattenMdFiles(dbTree)
          for (const file of allMdFiles) {
            try {
              const content = await readFile(file.path)
              const isIndex = file.path === `${pp}/db/index.md` ||
                file.name === "index.md"
              // For index: first drop whole entry lines for deleted
              // pages, then still strip any secondary `[[...]]` refs
              // to deleted pages that may appear in surviving rows.
              const afterListing = isIndex
                ? cleanIndexListing(content, deletedKeys)
                : content
              const updated = stripDeletedWikilinks(afterListing, deletedKeys)
              if (updated !== content) {
                await writeFile(file.path, updated)
              }
            } catch {
              // skip individual file failures — best-effort cleanup
            }
          }
        } catch {
          // non-critical
        }
      }

      // Step 7: Append deletion record to log.md
      try {
        const logPath = `${pp}/db/log.md`
        const logContent = await readFile(logPath).catch(() => "# DB Log\n")
        const date = new Date().toISOString().slice(0, 10)
        const keptCount = relatedPages.length - actuallyDeleted.length
        const logEntry = `\n## [${date}] delete | ${fileName}\n\nDeleted source file and ${actuallyDeleted.length} db pages.${keptCount > 0 ? ` ${keptCount} shared pages kept (have other sources).` : ""}\n`
        await writeFile(logPath, logContent.trimEnd() + logEntry)
      } catch {
        // non-critical
      }

      // Step 8: Refresh everything
      await loadSources()
      const tree = await listDirectory(pp)
      setFileTree(tree)
      useWikiStore.getState().bumpDataVersion()

      // Clear selected file if it was the deleted one
      if (selectedFile === node.path || actuallyDeleted.includes(selectedFile ?? "")) {
        setSelectedFile(null)
      }
    } catch (err) {
      console.error("Failed to delete source:", err)
      window.alert(`Failed to delete: ${err}`)
    }
  }

  async function handleIngest(node: FileNode) {
    if (!project || ingestingPath) return
    setIngestingPath(node.path)
    try {
      setChatExpanded(true)
      setActiveView("wiki")
      await startIngest(normalizePath(project.path), node.path, llmConfig)
    } catch (err) {
      console.error("Failed to start ingest:", err)
    } finally {
      setIngestingPath(null)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold">{t("sources.title")}</h2>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={loadSources} title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button size="sm" onClick={handleImport} disabled={importing}>
            <Plus className="mr-1 h-4 w-4" />
            {importing ? t("sources.importing") : t("sources.import")}
          </Button>
          <Button size="sm" onClick={handleImportFolder} disabled={importing}>
            <Plus className="mr-1 h-4 w-4" />
            {t("sources.importFolder", "Folder")}
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        {sources.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground">
            <p>{t("sources.noSources")}</p>
            <p>{t("sources.importHint")}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleImport}>
                <Plus className="mr-1 h-4 w-4" />
                {t("sources.importFiles")}
              </Button>
              <Button variant="outline" size="sm" onClick={handleImportFolder}>
                <Plus className="mr-1 h-4 w-4" />
                Folder
              </Button>
            </div>
          </div>
        ) : (
          <div className="p-2">
            <SourceTree
              nodes={sources}
              onOpen={handleOpenSource}
              onIngest={handleIngest}
              onDelete={handleDelete}
              ingestingPath={ingestingPath}
              depth={0}
            />
          </div>
        )}
      </ScrollArea>

      {/* Related Knowledge Graphs Section */}
      {selectedFile && (
        <div className="border-t bg-muted/30 p-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Network className="h-3.5 w-3.5" />
            {t("sources.relatedGraphs", "Related Knowledge Graphs")}
          </h3>
          {loadingGraphs ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <RefreshCw className="h-3 w-3 animate-spin" />
              Searching...
            </div>
          ) : relatedGraphs.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {relatedGraphs.map((g) => (
                <Button
                  key={g}
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={() => handleJumpToGraph(g)}
                >
                  <Network className="h-3 w-3" />
                  {g}
                </Button>
              ))}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground italic">
              {t("sources.noRelatedGraphs", "No related graphs found for this document.")}
            </div>
          )}
        </div>
      )}

      <div className="border-t px-4 py-2 text-xs text-muted-foreground">
        {t("sources.sourceCount", { count: countFiles(sources) })}
      </div>
    </div>
  )
}

/**
 * Replace any extension on `fileName` with `.md`. Used by the import flow
 * after preprocessFile turns the original into markdown — see
 * second-fix-develop.md §2 D2.
 *   "spec.pdf" → "spec.md"
 *   "notes"    → "notes.md"
 *   "x.foo.tar.gz" → "x.foo.tar.md"  (only the last segment is replaced)
 */
function toMarkdownName(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".")
  if (lastDot <= 0) return `${fileName}.md`
  return `${fileName.slice(0, lastDot)}.md`
}

/** Recursively flatten a FileNode tree, dropping directories and dotfiles. */
function flattenAllFiles(nodes: FileNode[]): FileNode[] {
  const out: FileNode[] = []
  for (const n of nodes) {
    if (n.name.startsWith(".")) continue
    if (n.is_dir && n.children) {
      out.push(...flattenAllFiles(n.children))
    } else if (!n.is_dir) {
      out.push(n)
    }
  }
  return out
}

/** Strip a leading `<root>/` prefix from a path. Both sides must already be normalized. */
function stripRoot(p: string, root: string): string {
  if (p === root) return ""
  if (p.startsWith(`${root}/`)) return p.slice(root.length + 1)
  return p
}

/**
 * Generate a unique destination path. If file already exists, adds date/counter suffix.
 * "file.md" → "file.md" (first time)
 * "file.md" → "file-20260406.md" (conflict)
 * "file.md" → "file-20260406-2.md" (second conflict same day)
 */
async function getUniqueDestPath(dir: string, fileName: string): Promise<string> {
  const basePath = `${dir}/${fileName}`

  // Check if file exists by trying to read it
  try {
    await readFile(basePath)
  } catch {
    // File doesn't exist — use original name
    return basePath
  }

  // File exists — add date suffix
  const ext = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")) : ""
  const nameWithoutExt = ext ? fileName.slice(0, -ext.length) : fileName
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "")

  const withDate = `${dir}/${nameWithoutExt}-${date}${ext}`
  try {
    await readFile(withDate)
  } catch {
    return withDate
  }

  // Date suffix also exists — add counter
  for (let i = 2; i <= 99; i++) {
    const withCounter = `${dir}/${nameWithoutExt}-${date}-${i}${ext}`
    try {
      await readFile(withCounter)
    } catch {
      return withCounter
    }
  }

  // Shouldn't happen, but fallback
  return `${dir}/${nameWithoutExt}-${date}-${Date.now()}${ext}`
}

function filterTree(nodes: FileNode[]): FileNode[] {
  return nodes
    .filter((n) => !n.name.startsWith("."))
    .map((n) => {
      if (n.is_dir && n.children) {
        return { ...n, children: filterTree(n.children) }
      }
      return n
    })
    .filter((n) => !n.is_dir || (n.children && n.children.length > 0))
}

function countFiles(nodes: FileNode[]): number {
  let count = 0
  for (const node of nodes) {
    if (node.is_dir && node.children) {
      count += countFiles(node.children)
    } else if (!node.is_dir) {
      count++
    }
  }
  return count
}

function SourceTree({
  nodes,
  onOpen,
  onIngest,
  onDelete,
  ingestingPath,
  depth,
}: {
  nodes: FileNode[]
  onOpen: (node: FileNode) => void
  onIngest: (node: FileNode) => void
  onDelete: (node: FileNode) => void
  ingestingPath: string | null
  depth: number
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const toggle = (path: string) => {
    setCollapsed((prev) => ({ ...prev, [path]: !prev[path] }))
  }

  // Sort: folders first, then files, alphabetical within each group
  const sorted = [...nodes].sort((a, b) => {
    if (a.is_dir && !b.is_dir) return -1
    if (!a.is_dir && b.is_dir) return 1
    return a.name.localeCompare(b.name)
  })

  return (
    <>
      {sorted.map((node) => {
        if (node.is_dir && node.children) {
          const isCollapsed = collapsed[node.path] ?? false
          return (
            <div key={node.path}>
              <button
                onClick={() => toggle(node.path)}
                className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                style={{ paddingLeft: `${depth * 16 + 4}px` }}
              >
                {isCollapsed ? (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                )}
                <Folder className="h-4 w-4 shrink-0 text-amber-500" />
                <span className="truncate font-medium">{node.name}</span>
                <span className="ml-auto text-[10px] text-muted-foreground/60 shrink-0">
                  {countFiles(node.children)}
                </span>
              </button>
              {!isCollapsed && (
                <SourceTree
                  nodes={node.children}
                  onOpen={onOpen}
                  onIngest={onIngest}
                  onDelete={onDelete}
                  ingestingPath={ingestingPath}
                  depth={depth + 1}
                />
              )}
            </div>
          )
        }

        return (
          <div
            key={node.path}
            className="flex w-full items-center gap-1 rounded-md px-1 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            style={{ paddingLeft: `${depth * 16 + 4}px` }}
          >
            <button
              onClick={() => onOpen(node)}
              className="flex flex-1 items-center gap-2 truncate px-2 py-1 text-left"
            >
              <FileText className="h-4 w-4 shrink-0" />
              <span className="truncate">{node.name}</span>
            </button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              title="Ingest"
              disabled={ingestingPath === node.path}
              onClick={() => onIngest(node)}
            >
              <BookOpen className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
              title="Delete"
              onClick={() => onDelete(node)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )
      })}
    </>
  )
}

function flattenMdFiles(nodes: FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) {
      files.push(...flattenMdFiles(node.children))
    } else if (!node.is_dir && node.name.endsWith(".md")) {
      files.push(node)
    }
  }
  return files
}
