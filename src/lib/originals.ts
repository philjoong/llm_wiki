import { copyFile, fileExists, readFile, writeFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"

/**
 * Where binary originals are stashed inside a project. Lives under
 * `raw/` (siblings: `sources/`, `assets/`) and is gitignored — see
 * `ensureOriginalsGitignore` below.
 *
 * Why we keep originals at all: 1차 가공 (preprocess_file in fs.rs) is
 * lossy by design — it extracts text only. Embedded images, charts,
 * SmartArt, and OLE objects are dropped silently (DOCX: see the
 * `_ => {}` arm in `extract_docx_with_library`; PPTX/PDF likewise).
 * Keeping the binary lets a human re-open the source to consult those
 * non-text artifacts without re-importing.
 */
const ORIGINALS_DIR = "raw/originals"

/**
 * Lines added to the project's .gitignore when originals are first
 * copied in. Trailing slash matches a directory recursively per the
 * gitignore spec.
 *
 * - `raw/originals/` — binary copies. Game design docs alone can be
 *   hundreds of MB; tracking them in git would bloat clones and slow
 *   every commit.
 * - `raw/sources/.cache/` and `raw/sources/** /.cache/` — preprocess
 *   extraction caches written by `write_cache` in fs.rs. Re-derivable
 *   from the original on demand; no value in versioning them.
 */
const GITIGNORE_ENTRIES = [
  "raw/originals/",
  "raw/sources/.cache/",
  "raw/sources/**/.cache/",
] as const

const GITIGNORE_HEADER = "# llm-wiki — keep binary originals and preprocess caches out of git"

/**
 * Copy the original binary into `raw/originals/<relPath>` so a human
 * can later round-trip back to it for things 1차 가공 dropped (charts,
 * diagrams, embedded images, OLE objects).
 *
 * Returns the project-relative destination path that was written. The
 * caller stores this in the preprocessed markdown's frontmatter (via
 * `injectOriginalRef`) so the wiki can link back to it.
 *
 * If a file already exists at the natural destination, a date / counter
 * suffix is appended to the filename — same convention as
 * `getUniqueDestPath` in sources-view.tsx, so re-imports of the same
 * filename don't clobber prior copies.
 */
export async function copyOriginal(
  projectPath: string,
  sourcePath: string,
  relPath: string,
): Promise<string> {
  const pp = normalizePath(projectPath).replace(/\/+$/, "")
  const sp = normalizePath(sourcePath)
  const baseRel = `${ORIGINALS_DIR}/${relPath.replace(/^\/+/, "")}`
  const baseAbs = `${pp}/${baseRel}`

  // Defensive: if the source IS the destination (re-import from inside
  // the project's own raw/originals/ tree), skip the copy.
  if (sp === baseAbs) return baseRel

  const targetRel = await uniqueOriginalRel(pp, baseRel)
  await copyFile(sp, `${pp}/${targetRel}`)
  return targetRel
}

async function uniqueOriginalRel(projectPath: string, baseRel: string): Promise<string> {
  if (!(await fileExists(`${projectPath}/${baseRel}`))) return baseRel

  // Split into stem + extension, only counting the dot if it's after
  // the last `/` (so `dir.with.dots/file` doesn't get its directory
  // mangled).
  const lastSlash = baseRel.lastIndexOf("/")
  const lastDot = baseRel.lastIndexOf(".")
  const hasExt = lastDot > lastSlash
  const stem = hasExt ? baseRel.slice(0, lastDot) : baseRel
  const ext = hasExt ? baseRel.slice(lastDot) : ""

  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "")
  const datedRel = `${stem}-${date}${ext}`
  if (!(await fileExists(`${projectPath}/${datedRel}`))) return datedRel

  for (let i = 2; i <= 99; i++) {
    const numbered = `${stem}-${date}-${i}${ext}`
    if (!(await fileExists(`${projectPath}/${numbered}`))) return numbered
  }
  // 99 same-day re-imports of the identical filename isn't a realistic
  // case; give up and return the dated form (the copy will overwrite).
  return datedRel
}

/**
 * Idempotently ensure the project's .gitignore contains the originals
 * + cache rules. Creates the file when absent; appends only the lines
 * that aren't already present (preserves any user edits or existing
 * entries).
 *
 * Run from `initProject` for new projects and from import-time copy
 * for existing projects (so legacy projects pick up the rules on first
 * use without a separate migration step).
 */
export async function ensureOriginalsGitignore(projectPath: string): Promise<void> {
  const pp = normalizePath(projectPath).replace(/\/+$/, "")
  const gitignorePath = `${pp}/.gitignore`

  let existing = ""
  if (await fileExists(gitignorePath)) {
    try {
      existing = await readFile(gitignorePath)
    } catch {
      // Treat unreadable .gitignore as missing — the writeFile below
      // will overwrite with our seed.
    }
  }

  const existingLines = new Set(existing.split(/\r?\n/).map((l) => l.trim()))
  const missing = GITIGNORE_ENTRIES.filter((l) => !existingLines.has(l))
  if (missing.length === 0) return

  const parts: string[] = []
  if (existing.length === 0) {
    parts.push(`${GITIGNORE_HEADER}\n`)
  } else {
    parts.push(existing.endsWith("\n") ? existing : `${existing}\n`)
    if (!existing.includes(GITIGNORE_HEADER)) parts.push(`\n${GITIGNORE_HEADER}\n`)
  }
  parts.push(missing.join("\n") + "\n")

  await writeFile(gitignorePath, parts.join(""))
}

/**
 * Wrap preprocessed markdown with a YAML frontmatter block recording
 * the project-relative path to the original binary. If the body already
 * has a leading frontmatter block, merges the `original:` key into it
 * instead of stacking a second one (replaces an existing `original:`
 * value if present — re-imports get an updated reference).
 *
 * The frontmatter sits at the top of `raw/sources/<name>.md`, where
 * the 2차 가공 (autoIngest) step reads the source. The LLM mostly
 * ignores it; the value is for the UI's "View original" affordance and
 * for downstream tooling that wants to re-process the binary (e.g. a
 * future multimodal pipeline that fills in chart / diagram content).
 */
export function injectOriginalRef(markdown: string, originalRel: string): string {
  if (markdown.startsWith("---\n")) {
    const end = markdown.indexOf("\n---\n", 4)
    if (end > 0) {
      const fm = markdown.slice(4, end)
      const body = markdown.slice(end + 5)
      const lines = fm.split("\n")
      const idx = lines.findIndex((l) => /^original:\s*/.test(l))
      const replacement = `original: ${originalRel}`
      if (idx >= 0) lines[idx] = replacement
      else lines.push(replacement)
      return `---\n${lines.join("\n")}\n---\n${body}`
    }
  }
  return `---\noriginal: ${originalRel}\n---\n\n${markdown}`
}
