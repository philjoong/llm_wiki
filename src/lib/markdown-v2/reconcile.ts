import type { ParsedPageV2, ParsedSectionV2 } from "./types"
import { MarkdownV2ValidationError } from "./types"

export interface SectionConflictV2 { pageId: string; sectionId: string; existing: ParsedSectionV2; incoming: ParsedSectionV2 }
export const normalizeSectionBody = (body: string) => body.replace(/\r\n/g, "\n").split("\n").map((line) => line.replace(/[ \t]+$/g, "")).join("\n").replace(/\n+$/g, "")

export function reconcileMarkdownV2(existing: ParsedPageV2, incoming: ParsedPageV2): { sections: ParsedSectionV2[]; conflicts: SectionConflictV2[] } {
  if (existing.page.page_id !== incoming.page.page_id) throw new MarkdownV2ValidationError(`page identity conflict: '${existing.page.page_id}' != '${incoming.page.page_id}'`)
  const incomingById = new Map(incoming.sections.map((section) => [section.sectionId, section]))
  const conflicts: SectionConflictV2[] = []
  const sections: ParsedSectionV2[] = []
  for (const current of existing.sections) {
    const next = incomingById.get(current.sectionId)
    if (!next) { sections.push(current); continue }
    incomingById.delete(current.sectionId)
    if (normalizeSectionBody(current.body) === normalizeSectionBody(next.body)) sections.push(next)
    else { conflicts.push({ pageId: existing.page.page_id, sectionId: current.sectionId, existing: current, incoming: next }); sections.push(current) }
  }
  sections.push(...incoming.sections.filter((section) => incomingById.has(section.sectionId)))
  return { sections, conflicts }
}

/** Replaces exactly one stable section, preserving every other section and page identity. */
export function spliceSectionById(existing: ParsedPageV2, sectionId: string, incoming: ParsedSectionV2): ParsedPageV2 {
  if (!existing.sections.some((section) => section.sectionId === sectionId)) throw new MarkdownV2ValidationError(`Section '${sectionId}' no longer exists`)
  return { ...existing, sections: existing.sections.map((section) => section.sectionId === sectionId ? { ...incoming, ordinal: section.ordinal } : section) }
}
