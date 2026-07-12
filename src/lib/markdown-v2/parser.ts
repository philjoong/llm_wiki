import { splitV2Frontmatter, parseV2Frontmatter } from "./frontmatter"
import type { ParsedPageV2 } from "./types"
import { MarkdownV2ValidationError } from "./types"
import { validatePageMetadata } from "./validator"

const H2 = /^##[ \t]+(.+?)[ \t]+\{#(sec-[0-7][0-9A-HJKMNP-TV-Z]{25})\}[ \t]*$/gm

export function parseMarkdownV2(source: string): ParsedPageV2 {
  const { raw, body } = splitV2Frontmatter(source)
  const page = validatePageMetadata(parseV2Frontmatter(raw))
  const h1Matches = [...body.matchAll(/^#(?!#)[ \t]+(.+?)[ \t]*$/gm)]
  if (h1Matches.length !== 1) throw new MarkdownV2ValidationError(`Markdown v2 requires exactly one H1 (found ${h1Matches.length})`)
  const matches = [...body.matchAll(H2)]
  const malformedH2 = [...body.matchAll(/^##(?!#).*$/gm)].filter((line) => !/^##[ \t]+.+?[ \t]+\{#sec-[0-7][0-9A-HJKMNP-TV-Z]{25}\}[ \t]*$/.test(line[0]))
  if (malformedH2.length) throw new MarkdownV2ValidationError(`Every H2 must be '## title {#sec-ULID}': ${malformedH2[0][0]}`)
  const seen = new Set<string>()
  const bodyOffset = source.length - body.length
  const sections = matches.map((match, ordinal) => {
    const sectionId = match[2]
    if (seen.has(sectionId)) throw new MarkdownV2ValidationError(`Duplicate section ID '${sectionId}' in page`)
    seen.add(sectionId)
    if (!page.sections[sectionId]) throw new MarkdownV2ValidationError(`H2 '${sectionId}' has no frontmatter metadata`)
    const startOffset = bodyOffset + match.index!
    const endLocal = ordinal + 1 < matches.length ? matches[ordinal + 1].index! : body.length
    const headingEnd = match.index! + match[0].length + (body[match.index! + match[0].length] === "\r" ? 2 : body[match.index! + match[0].length] === "\n" ? 1 : 0)
    return { sectionId, headingText: match[1].trim(), headingLevel: 2 as const, ordinal, metadata: page.sections[sectionId], body: body.slice(headingEnd, endLocal), startOffset, endOffset: bodyOffset + endLocal }
  })
  for (const sectionId of Object.keys(page.sections)) if (!seen.has(sectionId)) throw new MarkdownV2ValidationError(`Frontmatter section '${sectionId}' has no H2`)
  return { page, h1: h1Matches[0][1].trim(), sections, source }
}
