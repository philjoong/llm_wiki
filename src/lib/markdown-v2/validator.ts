import { isKnowledgeId } from "@/lib/knowledge/ids"
import { PAGE_TYPES, SECTION_TYPES, UI_ANCHORS, UI_ASPECTS, UI_LAYERS, UI_SCOPES, isVocabularyValue } from "@/lib/knowledge/vocabularies"
import type { PageMetadata, SectionMetadata } from "./types"
import { MarkdownV2ValidationError } from "./types"

const PAGE_FIELDS = new Set(["schema", "page_id", "title", "page_type", "summary", "primary_entity", "sections"])
const SECTION_FIELDS = new Set(["section_type", "summary", "ui_scope", "ui_anchor", "ui_layer", "ui_aspect", "content_entity", "host_entity"])

const string = (value: unknown, name: string): string => {
  if (typeof value !== "string" || !value.trim()) throw new MarkdownV2ValidationError(`'${name}' must be a non-empty string`)
  return value
}

export function validatePageMetadata(raw: Record<string, unknown>): PageMetadata {
  for (const key of Object.keys(raw)) if (!PAGE_FIELDS.has(key)) throw new MarkdownV2ValidationError(`Unknown page metadata field '${key}'`)
  if (raw.schema !== "llm-wiki/page/v2") throw new MarkdownV2ValidationError("schema must be 'llm-wiki/page/v2'")
  const page_id = string(raw.page_id, "page_id")
  if (!isKnowledgeId(page_id, "page")) throw new MarkdownV2ValidationError("page_id must be a page-ULID")
  const title = string(raw.title, "title")
  const summary = string(raw.summary, "summary")
  const page_type = string(raw.page_type, "page_type")
  if (!isVocabularyValue(PAGE_TYPES, page_type)) throw new MarkdownV2ValidationError(`Invalid page_type '${page_type}'`)
  if (raw.primary_entity !== undefined) string(raw.primary_entity, "primary_entity")
  if (!raw.sections || typeof raw.sections !== "object" || Array.isArray(raw.sections)) throw new MarkdownV2ValidationError("sections must be a mapping keyed by section ID")
  const sections: Record<string, SectionMetadata> = {}
  for (const [sectionId, value] of Object.entries(raw.sections as Record<string, unknown>)) {
    if (!isKnowledgeId(sectionId, "sec")) throw new MarkdownV2ValidationError(`Invalid section ID '${sectionId}'`)
    sections[sectionId] = validateSectionMetadata(value, sectionId)
  }
  return { schema: "llm-wiki/page/v2", page_id, title, page_type, summary, ...(raw.primary_entity ? { primary_entity: raw.primary_entity as string } : {}), sections }
}

export function validateSectionMetadata(value: unknown, sectionId = "section"): SectionMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MarkdownV2ValidationError(`Metadata for '${sectionId}' must be a mapping`)
  const raw = value as Record<string, unknown>
  for (const key of Object.keys(raw)) if (!SECTION_FIELDS.has(key)) throw new MarkdownV2ValidationError(`Unknown section metadata field '${key}'`)
  const section_type = string(raw.section_type, `${sectionId}.section_type`)
  if (!isVocabularyValue(SECTION_TYPES, section_type)) throw new MarkdownV2ValidationError(`Invalid section_type '${section_type}'`)
  const result: SectionMetadata = { section_type }
  for (const field of ["summary", "content_entity", "host_entity"] as const) if (raw[field] !== undefined) result[field] = string(raw[field], `${sectionId}.${field}`)
  if (section_type === "ui" && raw.ui_scope === undefined) throw new MarkdownV2ValidationError(`'${sectionId}.ui_scope' is required for ui sections`)
  const ui = [["ui_scope", UI_SCOPES], ["ui_anchor", UI_ANCHORS], ["ui_layer", UI_LAYERS], ["ui_aspect", UI_ASPECTS]] as const
  for (const [field, vocabulary] of ui) {
    if (raw[field] === undefined) continue
    const item = string(raw[field], `${sectionId}.${field}`)
    if (!isVocabularyValue(vocabulary, item)) throw new MarkdownV2ValidationError(`Invalid ${field} '${item}'`)
    if (field === "ui_scope") result.ui_scope = item as typeof result.ui_scope
    if (field === "ui_anchor") result.ui_anchor = item as typeof result.ui_anchor
    if (field === "ui_layer") result.ui_layer = item as typeof result.ui_layer
    if (field === "ui_aspect") result.ui_aspect = item as typeof result.ui_aspect
  }
  return result
}
