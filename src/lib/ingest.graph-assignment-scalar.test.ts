import { describe, it, expect } from "vitest"
import { validateGraphAssignments, buildGraphAssignmentPrompt, type GraphAssignmentTriple } from "./ingest"
import type { GraphPolicy } from "@/lib/graph-policy"

const policy: GraphPolicy = {
  managedGraphs: ["combat_graph"],
  graphRelationTypes: { combat_graph: ["HAS_COOLDOWN"] },
}

function triple(overrides: Partial<GraphAssignmentTriple>): GraphAssignmentTriple {
  return {
    subject: "스킬A",
    predicate: "HAS_COOLDOWN",
    object: "쿨타임",
    graph: "combat_graph",
    page_path: "db/skills/skill-a.md",
    new_graph: false,
    ...overrides,
  }
}

describe("validateGraphAssignments scalar value rejection", () => {
  it("rejects a bare number+unit object", () => {
    const failures = validateGraphAssignments([triple({ object: "30초" })], policy)
    expect(failures).toHaveLength(1)
    expect(failures[0].reason).toContain("scalar value")
  })

  it("rejects a bare percentage subject", () => {
    const failures = validateGraphAssignments([triple({ subject: "50%" })], policy)
    expect(failures).toHaveLength(1)
    expect(failures[0].reason).toContain("scalar value")
  })

  it("passes a proper noun that contains a number", () => {
    const failures = validateGraphAssignments([triple({ object: "레벨 10 던전" })], policy)
    expect(failures).toHaveLength(0)
  })

  it("passes a normal concept object", () => {
    const failures = validateGraphAssignments([triple({})], policy)
    expect(failures).toHaveLength(0)
  })
})

describe("buildGraphAssignmentPrompt scalar value rule", () => {
  it("includes the scalar-value rejection rule", () => {
    const prompt = buildGraphAssignmentPrompt("## Graph Policy\n...")
    expect(prompt).toContain("never a bare scalar value")
    expect(prompt).toContain("HAS_COOLDOWN")
  })

  it("includes the relation type casing rule", () => {
    const prompt = buildGraphAssignmentPrompt("## Graph Policy\n...")
    expect(prompt).toContain("uppercase snake_case ASCII")
  })
})
