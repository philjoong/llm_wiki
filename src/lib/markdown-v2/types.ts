import type { PageType, SectionType, UiAnchor, UiAspect, UiLayer, UiScope } from "@/lib/knowledge/vocabularies"

export interface PageMetadata {
  schema: "llm-wiki/page/v2"
  page_id: string
  title: string
  page_type: PageType
  summary: string
  primary_entity?: string
  sections: Record<string, SectionMetadata>
  [key: string]: unknown
}

export interface SectionMetadata {
  section_type: SectionType
  summary?: string
  ui_scope?: UiScope
  ui_anchor?: UiAnchor
  ui_layer?: UiLayer
  ui_aspect?: UiAspect
  content_entity?: string
  host_entity?: string
}

export interface ParsedSectionV2 {
  sectionId: string
  headingText: string
  headingLevel: 2
  ordinal: number
  metadata: SectionMetadata
  body: string
  /** UTF-16 string offsets into `source`; never use directly as Rust byte offsets. */
  startOffset: number
  endOffset: number
}

export interface ParsedPageV2 {
  page: PageMetadata
  h1: string
  sections: ParsedSectionV2[]
  source: string
}

export class MarkdownV2ValidationError extends Error {
  readonly code = "VALIDATION_FAILED"
  constructor(message: string) { super(message); this.name = "MarkdownV2ValidationError" }
}
