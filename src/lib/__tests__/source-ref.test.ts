import { describe, expect, it } from "vitest"
import { serializeSourceRef, sourceRefKey, type SourceRef } from "../source-ref"

describe("SourceRef", () => {
  it("serializes structured provenance for display", () => {
    expect(serializeSourceRef({ file: "raw.md", range: "## Intro" })).toBe("raw.md:## Intro")
  })

  it("uses file and range as a stable case-insensitive identity", () => {
    const a: SourceRef = { file: "Raw.md", range: "## Intro" }
    const b: SourceRef = { file: "raw.md", range: "## intro" }
    expect(sourceRefKey(a)).toBe(sourceRefKey(b))
    expect(sourceRefKey(a)).not.toBe(sourceRefKey({ file: "raw.md", range: "## Other" }))
  })
})
