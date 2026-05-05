import { describe, it, expect } from "vitest"
import {
  parseSourceRef,
  serializeSourceRef,
  sourceRefKey,
  type SourceRef,
} from "../source-ref"

describe("parseSourceRef", () => {
  it("accepts a bare string and treats it as the file with no range", () => {
    expect(parseSourceRef("foo.md")).toEqual({ file: "foo.md" })
  })

  it("trims surrounding whitespace from string input", () => {
    expect(parseSourceRef("  foo.md  ")).toEqual({ file: "foo.md" })
  })

  it("rejects empty / whitespace-only string", () => {
    expect(parseSourceRef("")).toBeNull()
    expect(parseSourceRef("   ")).toBeNull()
  })

  it("accepts an object with file + range", () => {
    expect(parseSourceRef({ file: "foo.md", range: "## section 3" })).toEqual({
      file: "foo.md",
      range: "## section 3",
    })
  })

  it("accepts an object with just file (range optional)", () => {
    expect(parseSourceRef({ file: "foo.md" })).toEqual({ file: "foo.md" })
  })

  it("drops empty-string range from object input", () => {
    // An empty `range:` value in the YAML shouldn't synthesize a phantom
    // range — it should round-trip back to a file-only ref.
    expect(parseSourceRef({ file: "foo.md", range: "" })).toEqual({
      file: "foo.md",
    })
    expect(parseSourceRef({ file: "foo.md", range: "   " })).toEqual({
      file: "foo.md",
    })
  })

  it("rejects objects without a usable file", () => {
    expect(parseSourceRef({})).toBeNull()
    expect(parseSourceRef({ file: "" })).toBeNull()
    expect(parseSourceRef({ range: "section 3" })).toBeNull()
  })

  it("rejects arrays and other non-object inputs", () => {
    expect(parseSourceRef(["foo.md"])).toBeNull()
    expect(parseSourceRef(null)).toBeNull()
    expect(parseSourceRef(undefined)).toBeNull()
    expect(parseSourceRef(42)).toBeNull()
  })

  it("preserves CJK characters in file and range", () => {
    expect(
      parseSourceRef({ file: "던전_설계.md", range: "## 3. 던전 A — 보상" }),
    ).toEqual({
      file: "던전_설계.md",
      range: "## 3. 던전 A — 보상",
    })
  })
})

describe("serializeSourceRef", () => {
  it("returns just the file when there is no range", () => {
    expect(serializeSourceRef({ file: "foo.md" })).toBe("foo.md")
  })

  it("joins file:range with a colon when range is set", () => {
    expect(
      serializeSourceRef({ file: "foo.md", range: "## section 3" }),
    ).toBe("foo.md:## section 3")
  })

  it("matches the format that auto-commit.ts emits in commit trailers", () => {
    // formatModificationMessage uses `${file}${range ? `:${range}` : ""}`.
    // Keeping serializeSourceRef in sync with that means a single source
    // of truth for "human-readable ref shape" across the codebase.
    const ref: SourceRef = { file: "raw.md", range: "section 3" }
    expect(serializeSourceRef(ref)).toBe("raw.md:section 3")
  })
})

describe("sourceRefKey", () => {
  it("treats same file + same range as identical (case-insensitive)", () => {
    expect(sourceRefKey({ file: "Foo.md", range: "Section 3" })).toBe(
      sourceRefKey({ file: "foo.md", range: "section 3" }),
    )
  })

  it("treats same file with no range as identical to itself", () => {
    expect(sourceRefKey({ file: "foo.md" })).toBe(
      sourceRefKey({ file: "foo.md" }),
    )
  })

  it("distinguishes same file with different ranges", () => {
    expect(sourceRefKey({ file: "foo.md", range: "section 1" })).not.toBe(
      sourceRefKey({ file: "foo.md", range: "section 2" }),
    )
  })

  it("distinguishes file-only from file+range (file-only is its own key)", () => {
    // Two refs to the same file but one without range should be kept as
    // separate entries — the no-range form means "the whole file" while
    // the ranged form points at a specific section.
    expect(sourceRefKey({ file: "foo.md" })).not.toBe(
      sourceRefKey({ file: "foo.md", range: "section 1" }),
    )
  })
})
