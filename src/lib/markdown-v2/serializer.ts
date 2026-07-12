import yaml from "js-yaml"
import type { ParsedPageV2 } from "./types"
import { parseMarkdownV2 } from "./parser"

/** Serializes only structural syntax; section bodies are emitted byte-for-byte. */
export function serializeMarkdownV2(page: ParsedPageV2): string {
  const metadata = { ...page.page, sections: Object.fromEntries(page.sections.map((section) => [section.sectionId, section.metadata])) }
  const frontmatter = yaml.dump(metadata).trimEnd()
  const sections = page.sections.map((section) => `## ${section.headingText} {#${section.sectionId}}\n${section.body}`).join("")
  return `---\n${frontmatter}\n---\n\n# ${page.h1}\n\n${sections}`
}

export function roundTripMarkdownV2(source: string): string { return serializeMarkdownV2(parseMarkdownV2(source)) }
