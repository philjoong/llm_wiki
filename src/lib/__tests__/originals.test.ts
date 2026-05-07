/**
 * Tests for the originals helper. Three concerns:
 *
 *   1. `injectOriginalRef` correctly inserts/merges the `original:`
 *      frontmatter key (load-bearing for the wiki's "view original"
 *      affordance and any future multimodal pipeline).
 *   2. `ensureOriginalsGitignore` is idempotent and merges into existing
 *      .gitignore content (must not clobber user edits).
 *   3. `copyOriginal` uses a date/counter dedup so re-imports of the
 *      same filename don't silently overwrite earlier copies.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/commands/fs", () => ({
  copyFile: vi.fn(),
  fileExists: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}))

import { copyFile, fileExists, readFile, writeFile } from "@/commands/fs"
import { copyOriginal, ensureOriginalsGitignore, injectOriginalRef } from "../originals"

const mockCopyFile = vi.mocked(copyFile)
const mockFileExists = vi.mocked(fileExists)
const mockReadFile = vi.mocked(readFile)
const mockWriteFile = vi.mocked(writeFile)

beforeEach(() => {
  mockCopyFile.mockReset().mockResolvedValue(undefined)
  mockFileExists.mockReset().mockResolvedValue(false)
  mockReadFile.mockReset().mockResolvedValue("")
  mockWriteFile.mockReset().mockResolvedValue(undefined)
})

describe("injectOriginalRef", () => {
  it("prepends a fresh frontmatter block when the body has none", () => {
    const body = "# Heading\n\nbody text\n"
    const out = injectOriginalRef(body, "raw/originals/foo.docx")
    expect(out.startsWith("---\noriginal: raw/originals/foo.docx\n---\n\n")).toBe(true)
    expect(out.endsWith(body)).toBe(true)
  })

  it("merges into an existing frontmatter block instead of stacking a new one", () => {
    const body = "---\ntitle: Foo\nstatus: draft\n---\n# Heading\n"
    const out = injectOriginalRef(body, "raw/originals/foo.docx")
    // Only one frontmatter block (count of leading `---\n`).
    expect(out.match(/^---\n/gm)?.length).toBe(2)
    expect(out).toContain("title: Foo")
    expect(out).toContain("status: draft")
    expect(out).toContain("original: raw/originals/foo.docx")
    expect(out).toContain("# Heading")
  })

  it("replaces an existing original: value rather than duplicating it (re-import case)", () => {
    const body = "---\ntitle: Foo\noriginal: raw/originals/old.docx\n---\nbody\n"
    const out = injectOriginalRef(body, "raw/originals/new.docx")
    expect(out).toContain("original: raw/originals/new.docx")
    expect(out).not.toContain("original: raw/originals/old.docx")
    // Single key, not two:
    expect(out.match(/^original:/gm)?.length).toBe(1)
  })

  it("doesn't mistake `---\\n` mid-body for a frontmatter block", () => {
    // Body that happens to contain a horizontal rule but no leading
    // frontmatter must still get a fresh block prepended.
    const body = "intro\n\n---\nnot-frontmatter\n"
    const out = injectOriginalRef(body, "raw/originals/x.pdf")
    expect(out.startsWith("---\noriginal: raw/originals/x.pdf\n---\n\n")).toBe(true)
  })
})

describe("ensureOriginalsGitignore", () => {
  it("creates .gitignore from scratch with the originals + cache rules when absent", async () => {
    mockFileExists.mockResolvedValue(false)
    await ensureOriginalsGitignore("/tmp/proj")

    expect(mockWriteFile).toHaveBeenCalledTimes(1)
    const [path, body] = mockWriteFile.mock.calls[0]
    expect(path).toBe("/tmp/proj/.gitignore")
    expect(body).toContain("raw/originals/")
    expect(body).toContain("raw/sources/.cache/")
    // Header makes the section greppable so the next call's
    // idempotency check has something stable to look for.
    expect(body).toContain("# llm-wiki")
  })

  it("appends only missing rules to an existing .gitignore (preserves user content)", async () => {
    mockFileExists.mockResolvedValue(true)
    mockReadFile.mockResolvedValue("# user rules\nnode_modules/\n.env\n")

    await ensureOriginalsGitignore("/tmp/proj")

    const [, body] = mockWriteFile.mock.calls[0]
    const text = String(body)
    // User content survives.
    expect(text).toContain("node_modules/")
    expect(text).toContain(".env")
    // New rules added.
    expect(text).toContain("raw/originals/")
    expect(text).toContain("raw/sources/.cache/")
  })

  it("is a no-op when all rules are already present (idempotent)", async () => {
    mockFileExists.mockResolvedValue(true)
    mockReadFile.mockResolvedValue(
      [
        "# llm-wiki — keep binary originals and preprocess caches out of git",
        "raw/originals/",
        "raw/sources/.cache/",
        "raw/sources/**/.cache/",
        "",
      ].join("\n"),
    )

    await ensureOriginalsGitignore("/tmp/proj")

    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it("doesn't double-add when called twice in succession on an existing project", async () => {
    // First call: file missing, fresh write happens.
    mockFileExists.mockResolvedValueOnce(false)
    await ensureOriginalsGitignore("/tmp/proj")
    const firstWrite = String(mockWriteFile.mock.calls[0][1])

    // Second call: file now exists with what we just wrote.
    mockFileExists.mockResolvedValueOnce(true)
    mockReadFile.mockResolvedValueOnce(firstWrite)
    await ensureOriginalsGitignore("/tmp/proj")

    // Still only the first write — second call recognized everything
    // was already in place.
    expect(mockWriteFile).toHaveBeenCalledTimes(1)
  })
})

describe("copyOriginal", () => {
  it("copies to raw/originals/<relPath> and returns the project-relative path", async () => {
    mockFileExists.mockResolvedValue(false)
    const result = await copyOriginal("/tmp/proj", "/srv/data/foo.docx", "foo.docx")

    expect(result).toBe("raw/originals/foo.docx")
    expect(mockCopyFile).toHaveBeenCalledWith(
      "/srv/data/foo.docx",
      "/tmp/proj/raw/originals/foo.docx",
    )
  })

  it("preserves nested folder structure for folder-import callers", async () => {
    mockFileExists.mockResolvedValue(false)
    const result = await copyOriginal(
      "/tmp/proj",
      "/srv/data/specs/dungeons/A.docx",
      "specs/dungeons/A.docx",
    )

    expect(result).toBe("raw/originals/specs/dungeons/A.docx")
    expect(mockCopyFile).toHaveBeenCalledWith(
      "/srv/data/specs/dungeons/A.docx",
      "/tmp/proj/raw/originals/specs/dungeons/A.docx",
    )
  })

  it("appends a date suffix when the destination already exists", async () => {
    // First check (base path) → exists. Second check (date-suffixed) → free.
    mockFileExists
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
    const result = await copyOriginal("/tmp/proj", "/srv/foo.docx", "foo.docx")

    expect(result).toMatch(/^raw\/originals\/foo-\d{8}\.docx$/)
    expect(mockCopyFile).toHaveBeenCalledTimes(1)
  })

  it("appends a counter when the dated suffix is also taken", async () => {
    // base exists, dated exists, dated-2 free
    mockFileExists
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
    const result = await copyOriginal("/tmp/proj", "/srv/foo.docx", "foo.docx")

    expect(result).toMatch(/^raw\/originals\/foo-\d{8}-2\.docx$/)
  })

  it("doesn't mangle directory names containing dots when there's no extension", async () => {
    mockFileExists.mockResolvedValue(false)
    const result = await copyOriginal(
      "/tmp/proj",
      "/srv/v1.2/release-notes",
      "v1.2/release-notes",
    )

    expect(result).toBe("raw/originals/v1.2/release-notes")
  })

  it("skips the copy when source IS the destination (defensive against re-import loops)", async () => {
    // Source path matches the destination we'd derive — avoid a copy
    // that would either no-op or fail depending on platform semantics.
    const result = await copyOriginal(
      "/tmp/proj",
      "/tmp/proj/raw/originals/foo.docx",
      "foo.docx",
    )

    expect(result).toBe("raw/originals/foo.docx")
    expect(mockCopyFile).not.toHaveBeenCalled()
  })
})
