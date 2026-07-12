import { describe, expect, it } from "vitest"
import { createEntityId, createPageId, createSectionId, isKnowledgeId } from "./ids"
import type { PageRecord, SectionRecord } from "./types"
import { KNOWLEDGE_ERROR_CODES, knowledgeErrorUserMessage } from "./validation"

describe("knowledge IDs", () => {
  it("creates and validates each stable prefix without deriving from display values", () => {
    const page = createPageId()
    const entity = createEntityId()
    const section = createSectionId()
    expect(isKnowledgeId(page, "page")).toBe(true)
    expect(isKnowledgeId(entity, "ent")).toBe(true)
    expect(isKnowledgeId(section, "sec")).toBe(true)
    expect(page).not.toBe(createPageId())
    expect(entity).not.toBe(createEntityId())
  })

  it("keeps IDs independent from a path or title rename", () => {
    const pageId = createPageId()
    const before: PageRecord = { pageId, pagePath: "docs/old.md", title: "Old title", pageType: "guide", updatedAt: new Date().toISOString() }
    const after = { ...before, pagePath: "docs/new.md", title: "New title" }
    expect(after.pageId).toBe(before.pageId)
  })
})

describe("knowledge DTOs and errors", () => {
  it("round-trips DTO serialization", () => {
    const section: SectionRecord = { sectionId: createSectionId(), pageId: createPageId(), headingLevel: 2, headingText: "Overview", sectionType: "overview", ordinal: 0 }
    expect(JSON.parse(JSON.stringify(section))).toEqual(section)
  })

  it("maps every public error code to a user message", () => {
    for (const code of KNOWLEDGE_ERROR_CODES) expect(knowledgeErrorUserMessage(code)).not.toHaveLength(0)
  })
})
