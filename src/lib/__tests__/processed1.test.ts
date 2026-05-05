import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/commands/fs", () => ({
  writeFile: vi.fn(),
}))

import { writeFile } from "@/commands/fs"
import { runProcessed1 } from "../processed1"

const mockWriteFile = vi.mocked(writeFile)

beforeEach(() => {
  mockWriteFile.mockReset().mockResolvedValue(undefined)
})

describe("runProcessed1", () => {
  it("writes the raw content verbatim to processed_1/<basename>.md", async () => {
    const result = await runProcessed1(
      "/tmp/proj",
      "/some/folder/instance_server_design.md",
      "# 인스턴스 서버 설계\n\n## 1. 서버 구조\n",
    )

    expect(mockWriteFile).toHaveBeenCalledTimes(1)
    expect(mockWriteFile).toHaveBeenCalledWith(
      "/tmp/proj/processed_1/instance_server_design.md",
      "# 인스턴스 서버 설계\n\n## 1. 서버 구조\n",
    )
    expect(result).toEqual({
      rawFileName: "instance_server_design.md",
      writtenPath: "processed_1/instance_server_design.md",
    })
  })

  it("normalizes non-md extensions (.pdf / .docx) to .md", async () => {
    const result = await runProcessed1(
      "/tmp/proj",
      "/uploads/spec.docx",
      "extracted text body",
    )
    expect(mockWriteFile).toHaveBeenCalledWith(
      "/tmp/proj/processed_1/spec.md",
      "extracted text body",
    )
    expect(result.writtenPath).toBe("processed_1/spec.md")
  })

  it("appends .md when the source has no extension", async () => {
    const result = await runProcessed1("/tmp/proj", "/raw/notes", "body")
    expect(mockWriteFile).toHaveBeenCalledWith(
      "/tmp/proj/processed_1/notes.md",
      "body",
    )
    expect(result.writtenPath).toBe("processed_1/notes.md")
  })

  it("returns the original raw filename (unchanged extension) for ref linking", async () => {
    // Even when the on-disk processed_1 path uses .md, the rawFileName
    // returned to the caller MUST keep the source's original extension
    // — that's what the SourceRef in frontmatter points at.
    const result = await runProcessed1(
      "/tmp/proj",
      "/raw/balance.xlsx",
      "extracted",
    )
    expect(result.rawFileName).toBe("balance.xlsx")
  })

  it("does no transformation on the body — passthrough only", async () => {
    // Stage 3 explicitly leaves 1차 가공 unimplemented. Whatever the
    // caller passes in is what gets written. No frontmatter wrapping,
    // no header rewriting, no language detection.
    const raw = "<<arbitrary content with control chars>>\n\n```code```"
    await runProcessed1("/tmp/proj", "/raw/x.md", raw)
    expect(mockWriteFile).toHaveBeenCalledWith(
      "/tmp/proj/processed_1/x.md",
      raw,
    )
  })
})
