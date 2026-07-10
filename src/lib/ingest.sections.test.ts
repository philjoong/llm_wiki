import { describe, it, expect } from "vitest"
import { splitIntoSections, reconcileSections, replaceSection } from "./ingest"

describe("splitIntoSections", () => {
  it("splits a body with multiple ## headings", () => {
    const body = [
      "# 던전 A 보상",
      "",
      "## stats",
      "",
      "- 레벨 10",
      "",
      "## drops",
      "",
      "- 골드 1000",
    ].join("\n")

    const sections = splitIntoSections(body)

    expect(sections).toEqual([
      { heading: null, body: "# 던전 A 보상\n" },
      { heading: "stats", body: "\n- 레벨 10\n" },
      { heading: "drops", body: "\n- 골드 1000" },
    ])
  })

  it("treats leading text with no ## heading as a single section", () => {
    const body = "# 던전 A 보상\n\nJust some intro text, no sections."

    const sections = splitIntoSections(body)

    expect(sections).toHaveLength(1)
    expect(sections[0]).toEqual({ heading: null, body })
  })

  it("keeps deeper headings (###) inside their parent ## section", () => {
    const body = [
      "## stats",
      "",
      "### 세부",
      "",
      "- 레벨 10",
    ].join("\n")

    const sections = splitIntoSections(body)

    expect(sections).toHaveLength(1)
    expect(sections[0].heading).toBe("stats")
    expect(sections[0].body).toContain("### 세부")
  })

  it("returns an empty array for an empty body", () => {
    expect(splitIntoSections("")).toEqual([])
  })

  it("returns an empty array for a whitespace-only body with no heading", () => {
    expect(splitIntoSections("\n\n  \n")).toEqual([])
  })

  it("handles a heading with no body before EOF", () => {
    const sections = splitIntoSections("## drops")
    expect(sections).toEqual([{ heading: "drops", body: "" }])
  })

  it("handles consecutive headings with empty bodies", () => {
    const sections = splitIntoSections("## a\n## b\n- content")
    expect(sections).toEqual([
      { heading: "a", body: "" },
      { heading: "b", body: "- content" },
    ])
  })
})

describe("reconcileSections", () => {
  it("appends a brand-new section with no conflict", () => {
    const existing = "# 던전 A 보상\n\n## stats\n\n- 레벨 10"
    const incoming = "# 던전 A 보상\n\n## drops\n\n- 골드 1000"

    const { merged, conflicts } = reconcileSections(existing, incoming)

    expect(conflicts).toEqual([])
    expect(merged).toContain("## stats")
    expect(merged).toContain("## drops")
    expect(merged).toContain("- 레벨 10")
    expect(merged).toContain("- 골드 1000")
  })

  it("reports no conflict when bodies are identical for a shared heading", () => {
    const existing = "## stats\n\n- 레벨 10"
    const incoming = "## stats\n\n- 레벨 10"

    const { merged, conflicts } = reconcileSections(existing, incoming)

    expect(conflicts).toEqual([])
    expect(merged).toBe(existing)
  })

  it("flags a conflict when a shared heading's body differs, keeping existing in merged", () => {
    const existing = "## stats\n\n- 레벨 10"
    const incoming = "## stats\n\n- 레벨 20"

    const { merged, conflicts } = reconcileSections(existing, incoming)

    expect(conflicts).toEqual([
      { heading: "stats", existingBody: "\n- 레벨 10", incomingBody: "\n- 레벨 20" },
    ])
    expect(merged).toContain("- 레벨 10")
    expect(merged).not.toContain("- 레벨 20")
  })

  it("handles a mixed case: one new section applied, one conflicting section held back", () => {
    const existing = "## stats\n\n- 레벨 10"
    const incoming = "## stats\n\n- 레벨 20\n\n## drops\n\n- 골드 1000"

    const { merged, conflicts } = reconcileSections(existing, incoming)

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].heading).toBe("stats")
    expect(merged).toContain("- 레벨 10")
    expect(merged).not.toContain("- 레벨 20")
    expect(merged).toContain("## drops")
    expect(merged).toContain("- 골드 1000")
  })

  it("flags a conflict on the leading (heading-less) section when its text differs", () => {
    const existing = "# Title A\n\nsome intro"
    const incoming = "# Title B\n\nsome intro"

    const { merged, conflicts } = reconcileSections(existing, incoming)

    expect(conflicts).toEqual([
      { heading: null, existingBody: "# Title A\n\nsome intro", incomingBody: "# Title B\n\nsome intro" },
    ])
    expect(merged).toContain("Title A")
  })

  it("fully identical bodies produce no conflicts and an unchanged merge", () => {
    const body = "# T\n\n## a\n\nfoo\n\n## b\n\nbar"
    const { merged, conflicts } = reconcileSections(body, body)
    expect(conflicts).toEqual([])
    expect(merged.replace(/\n+$/, "")).toBe(body.replace(/\n+$/, ""))
  })

  it("fully different bodies (single unnamed section) produce one conflict", () => {
    const existing = "entirely different content, no headings at all"
    const incoming = "totally other content, also no headings"
    const { merged, conflicts } = reconcileSections(existing, incoming)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].heading).toBeNull()
    expect(merged).toBe(existing)
  })
})

describe("replaceSection", () => {
  it("replaces one section's body, leaving the others untouched", () => {
    const body = "## stats\n\n- 레벨 10\n\n## drops\n\n- 골드 500"

    const result = replaceSection(body, "stats", "\n- 레벨 20")

    expect(result).toContain("- 레벨 20")
    expect(result).not.toContain("- 레벨 10")
    expect(result).toContain("## drops")
    expect(result).toContain("- 골드 500")
  })

  it("replaces the leading (null-heading) section", () => {
    const body = "# Title A\n\nintro\n\n## stats\n\n- 레벨 10"

    const result = replaceSection(body, null, "# Title B\n\nintro")

    expect(result).toContain("Title B")
    expect(result).not.toContain("Title A")
    expect(result).toContain("## stats")
  })

  it("appends the section at the end when the heading no longer exists", () => {
    const body = "## stats\n\n- 레벨 10"

    const result = replaceSection(body, "drops", "\n- 골드 1000")

    expect(result).toContain("## stats")
    expect(result).toContain("- 레벨 10")
    expect(result).toContain("## drops")
    expect(result).toContain("- 골드 1000")
  })
})
