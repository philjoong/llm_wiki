import type { ParsedPageV2 } from "./types"

export function findSectionAtOffset(page: ParsedPageV2, offset: number) {
  return page.sections.find((section) => offset >= section.startOffset && offset < section.endOffset) ?? null
}
