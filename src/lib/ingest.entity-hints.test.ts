import { describe, it, expect } from "vitest"
import { buildGraphAssignmentPrompt } from "./ingest"

describe("buildGraphAssignmentPrompt entityHints", () => {
  it("omits the known-entity-names section when no hints are given", () => {
    const prompt = buildGraphAssignmentPrompt("## Graph Policy\n...")
    expect(prompt).not.toContain("Known entity names")
  })

  it("injects the known-entity-names section and reuse rule when hints are given", () => {
    const prompt = buildGraphAssignmentPrompt("## Graph Policy\n...", "고블린 전사, 오크 전사")
    expect(prompt).toContain("## Known entity names")
    expect(prompt).toContain("고블린 전사, 오크 전사")
    expect(prompt).toContain("use the exact string from this list")
  })
})
