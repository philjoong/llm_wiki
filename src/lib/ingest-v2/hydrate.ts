import type { IngestPageDocument } from "@/commands/knowledge"
import type { ParsedPageV2 } from "@/lib/markdown-v2"
import type { PageRecord, SectionRecord } from "@/lib/knowledge"

const entityId = (value: string | undefined, field: string) => {
  if (value !== undefined && !/^ent-[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(value)) {
    throw new Error(`VALIDATION_FAILED: ${field} must be a resolved entity ID`)
  }
  return value
}

/** Converts only parser-validated v2 markdown to the DB command shape. */
export function hydratePageDocument(relativePath: string, content: string, parsed: ParsedPageV2): IngestPageDocument {
  const page: PageRecord = {
    pageId: parsed.page.page_id,
    pagePath: relativePath,
    title: parsed.page.title,
    pageType: parsed.page.page_type,
    summary: parsed.page.summary,
    primaryEntityId: entityId(parsed.page.primary_entity, "primary_entity"),
    updatedAt: new Date().toISOString(),
  }
  const sections: SectionRecord[] = parsed.sections.map((section) => ({
    sectionId: section.sectionId,
    pageId: page.pageId,
    headingLevel: section.headingLevel,
    headingText: section.headingText,
    sectionType: section.metadata.section_type,
    uiScope: section.metadata.ui_scope,
    uiAnchor: section.metadata.ui_anchor,
    uiLayer: section.metadata.ui_layer,
    uiAspect: section.metadata.ui_aspect,
    contentEntityId: entityId(section.metadata.content_entity, `${section.sectionId}.content_entity`),
    hostEntityId: entityId(section.metadata.host_entity, `${section.sectionId}.host_entity`),
    ordinal: section.ordinal,
    summary: section.metadata.summary,
  }))
  return { relativePath, content, page, sections }
}
