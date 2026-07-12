import { describe, expect, it } from "vitest"
import {
  mergeSourceRefsIntoContent,
  mergeSourceRefsLists,
  parseSourceRefs,
  SourceRefValidationError,
  writeSourceRefs,
} from "./sources-merge"

const page = (sources: string) => `---\ntitle: Test\n${sources}\n---\n\n# Test\n`

describe("v2 SourceRef frontmatter", () => {
  it("reads and writes only structured source references", () => {
    const content = page('sources:\n  - file: "raw.md"\n    range: "## Intro"')
    expect(parseSourceRefs(content)).toEqual([{ file: "raw.md", range: "## Intro" }])
    expect(writeSourceRefs(content, [{ file: "other.md" }])).toContain('  - file: "other.md"')
  })

  it("rejects legacy inline string arrays instead of converting them", () => {
    expect(() => parseSourceRefs(page('sources: ["raw.md"]'))).toThrow(SourceRefValidationError)
  })

  it("rejects legacy string list entries instead of converting them", () => {
    expect(() => parseSourceRefs(page("sources:\n  - raw.md"))).toThrow(SourceRefValidationError)
  })

  it("preserves range identity while merging", () => {
    const merged = mergeSourceRefsLists(
      [{ file: "raw.md", range: "## One" }],
      [{ file: "raw.md", range: "## One" }, { file: "raw.md", range: "## Two" }],
    )
    expect(merged).toEqual([{ file: "raw.md", range: "## One" }, { file: "raw.md", range: "## Two" }])
  })

  it("refuses to overwrite an existing legacy source document", () => {
    const incoming = page('sources:\n  - file: "new.md"')
    const legacy = page('sources: ["old.md"]')
    expect(() => mergeSourceRefsIntoContent(incoming, legacy)).toThrow(SourceRefValidationError)
  })
})
