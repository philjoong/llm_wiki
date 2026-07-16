/**
 * Unit tests for cascadeDeleteWikiPage — the one helper that every
 * wiki-page delete flow goes through. By centralizing the cascade
 * here we get test coverage for page-id derivation + ordering once,
 * instead of having to test it at every React-component call site.
 *
 * Step 13: the embedding key is the v2 ULID read from the file's
 * frontmatter, not the filename stem.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockDeleteFile = vi.fn<(path: string) => Promise<void>>()
const mockReadFile = vi.fn<(path: string) => Promise<string>>()
const mockRemovePageEmbedding = vi.fn<(projectPath: string, pageId: string) => Promise<void>>()

vi.mock("@/commands/fs", () => ({
  deleteFile: (path: string) => mockDeleteFile(path),
  readFile: (path: string) => mockReadFile(path),
  // The other fs functions aren't called by this helper, but the
  // mock factory has to declare them so dynamic imports elsewhere
  // in transitive deps don't break.
  writeFile: vi.fn(),
  listDirectory: vi.fn(),
}))

vi.mock("@/lib/embedding", () => ({
  removePageEmbedding: (projectPath: string, pageId: string) =>
    mockRemovePageEmbedding(projectPath, pageId),
}))

import { cascadeDeleteWikiPage } from "./wiki-page-delete"

const PAGE_ID = "page-01ARZ3NDEKTSV4RRFFQ69G5FAV"
const SECTION_ID = "sec-01ARZ3NDEKTSV4RRFFQ69G5FAW"
const v2Doc = (pageId: string) =>
  `---\nschema: llm-wiki/page/v2\npage_id: ${pageId}\ntitle: RoPE\npage_type: guide\nsummary: s\nsections:\n  ${SECTION_ID}:\n    section_type: overview\n---\n# RoPE\n## Facts {#${SECTION_ID}}\nbody\n`

beforeEach(() => {
  mockDeleteFile.mockReset()
  mockReadFile.mockReset()
  mockRemovePageEmbedding.mockReset()
  // Default: file reads as a valid v2 page; both writes succeed silently.
  mockDeleteFile.mockResolvedValue(undefined)
  mockReadFile.mockResolvedValue(v2Doc(PAGE_ID))
  mockRemovePageEmbedding.mockResolvedValue(undefined)
})

describe("cascadeDeleteWikiPage", () => {
  it("deletes the file, then drops the embedding chunks keyed by the v2 ULID", async () => {
    await cascadeDeleteWikiPage("/proj", "/proj/db/concepts/rope.md")

    expect(mockDeleteFile).toHaveBeenCalledTimes(1)
    expect(mockDeleteFile).toHaveBeenCalledWith("/proj/db/concepts/rope.md")

    expect(mockRemovePageEmbedding).toHaveBeenCalledTimes(1)
    expect(mockRemovePageEmbedding).toHaveBeenCalledWith("/proj", PAGE_ID)
  })

  it("reads the ULID BEFORE the disk delete (file is the source of the key)", async () => {
    // The read must precede the delete — otherwise the file is gone and
    // its ULID is unrecoverable, orphaning the chunks.
    const order: string[] = []
    mockReadFile.mockImplementation(async () => {
      order.push("readFile")
      return v2Doc(PAGE_ID)
    })
    mockDeleteFile.mockImplementation(async () => {
      order.push("deleteFile")
    })
    mockRemovePageEmbedding.mockImplementation(async () => {
      order.push("removePageEmbedding")
    })

    await cascadeDeleteWikiPage("/proj", "/proj/db/concepts/foo.md")
    expect(order).toEqual(["readFile", "deleteFile", "removePageEmbedding"])
  })

  it("does NOT call removePageEmbedding when deleteFile throws", async () => {
    // If the file isn't actually gone, dropping its chunks is wrong:
    // the page still exists (e.g. permission-denied) and would lose
    // its searchability while staying on disk.
    mockDeleteFile.mockRejectedValueOnce(new Error("EACCES"))

    await expect(cascadeDeleteWikiPage("/proj", "/proj/db/foo.md")).rejects.toThrow("EACCES")

    expect(mockRemovePageEmbedding).not.toHaveBeenCalled()
  })

  it("propagates removePageEmbedding errors to the caller (not silently swallowed)", async () => {
    // Caller decides fault-tolerance policy. Some callers
    // (ingest-queue cleanup, source-delete batches) want to
    // continue past LanceDB hiccups; others (single-page delete
    // from lint view) might want to surface the error.
    mockRemovePageEmbedding.mockRejectedValueOnce(new Error("lancedb table missing"))

    await expect(cascadeDeleteWikiPage("/proj", "/proj/db/foo.md")).rejects.toThrow(
      "lancedb table missing",
    )
    // File delete still happened — leaving the cascade half-done
    // is the lesser evil compared to never deleting the file.
    expect(mockDeleteFile).toHaveBeenCalled()
  })

  it("skips removePageEmbedding when the file is not valid v2 Markdown (defensive)", async () => {
    // A non-v2 file yields no ULID. Nothing is indexed under a ULID for
    // it, so the delete proceeds but the embedding drop is skipped —
    // never with an empty key, which some LanceDB filters treat as
    // match-all.
    mockReadFile.mockResolvedValueOnce("not a v2 page")
    await cascadeDeleteWikiPage("/proj", "/proj/db/legacy.md")
    expect(mockDeleteFile).toHaveBeenCalled()
    expect(mockRemovePageEmbedding).not.toHaveBeenCalled()
  })

  it("skips removePageEmbedding when the file cannot be read (already gone)", async () => {
    mockReadFile.mockRejectedValueOnce(new Error("ENOENT"))
    await cascadeDeleteWikiPage("/proj", "/proj/db/missing.md")
    expect(mockDeleteFile).toHaveBeenCalled()
    expect(mockRemovePageEmbedding).not.toHaveBeenCalled()
  })
})
