import { describe, expect, it } from "vitest"
import { createPageId, createSectionId, type KnowledgeId } from "@/lib/knowledge/ids"
import { parseMarkdownV2, reconcileMarkdownV2, serializeMarkdownV2 } from "."
import { buildFileBlocksFromSections } from "@/lib/ingest"

function document(pageId: KnowledgeId = createPageId(), sectionId: KnowledgeId = createSectionId(), heading = "개요", body = "한글 😀\n### 세부\n보존됨") {
  return `---\nschema: llm-wiki/page/v2\npage_id: ${pageId}\ntitle: 테스트\npage_type: guide\nsummary: 요약\nsections:\n  ${sectionId}:\n    section_type: overview\n---\n# 테스트\n\n## ${heading} {#${sectionId}}\n${body}\n`
}

describe("Markdown v2", () => {
  it("round-trips stable IDs, body, and UTF-16 offsets", () => {
    const source = document()
    const parsed = parseMarkdownV2(source)
    const section = parsed.sections[0]
    expect(source.slice(section.startOffset, section.endOffset)).toContain("한글 😀")
    const reparsed = parseMarkdownV2(serializeMarkdownV2(parsed))
    expect(reparsed.page.page_id).toBe(parsed.page.page_id)
    expect(reparsed.sections[0].sectionId).toBe(section.sectionId)
    expect(reparsed.sections[0].body).toBe(section.body)
  })

  it("keeps a renamed heading but conflicts on body changes", () => {
    const existing = parseMarkdownV2(document())
    const incoming = parseMarkdownV2(document(existing.page.page_id as KnowledgeId, existing.sections[0].sectionId as KnowledgeId, "이름 변경", "다른 본문"))
    const result = reconcileMarkdownV2(existing, incoming)
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0].sectionId).toBe(existing.sections[0].sectionId)
  })

  it("rejects v1 H2 headings and duplicate YAML keys", () => {
    expect(() => parseMarkdownV2("---\nschema: llm-wiki/page/v2\n---\n# old\n## old")).toThrow("page_id")
    const source = document().replace("title: 테스트", "title: 테스트\ntitle: 중복")
    expect(() => parseMarkdownV2(source)).toThrow("Duplicate YAML key")
  })

  it("emits v2 file blocks from decomposed sections", () => {
    const block = buildFileBlocksFromSections([{ source_range: "범위", source_text: "## 원문 제목\n본문", page_path: "db/guides/example.md" }], "source.md")
    const content = block.match(/---FILE: .*?---\n([\s\S]*?)\n---END FILE---/)?.[1]
    expect(content).toBeTruthy()
    expect(parseMarkdownV2(content!)).toMatchObject({ h1: "범위" })
  })
})
