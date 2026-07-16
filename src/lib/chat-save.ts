/**
 * Save a chat answer into the wiki/graph (Step 12).
 *
 * A user's answer to a back-question is persisted so the next question can
 * retrieve it normally — answering IS database-building. Location is an LLM
 * suggestion the user approves or changes (no content-review step); assertions
 * extracted on save are tagged `origin: "user_chat"` for traceability.
 */

import { readFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { listKnowledgePages } from "@/commands/knowledge"
import { callModel, extractKnowledgeAssertionWrites, isSafeIngestPath } from "@/lib/ingest"
import { commitMarkdownV2Pages } from "@/lib/ingest-v2"
import { parseMarkdownV2, serializeMarkdownV2 } from "@/lib/markdown-v2"
import { createPageId, createSectionId } from "@/lib/knowledge/ids"
import { stripCodeFence } from "@/lib/json-answer"
import type { ParsedSectionV2 } from "@/lib/markdown-v2/types"
import type { LlmConfig } from "@/stores/wiki-store"

/** A proposed save target the user reviews before committing. */
export interface SaveLocation {
  /** Project-relative db/ path, e.g. "db/concepts/스킬-쿨타임.md". */
  pagePath: string
  /** Page display title (used only when creating a new page). */
  title: string
  /** Section heading for the saved answer. */
  heading: string
  /** True when pagePath does not yet exist → a new page is created. */
  isNew: boolean
}

/**
 * Ask the model where the answer should live, reusing decomposition's habit of
 * preferring an existing page when one fits (Step 12 §2). The existing db/
 * pages are listed in the prompt so it can reuse one instead of always making a
 * new page. Falls back to a fresh concepts/ page when the reply is unusable.
 */
export async function suggestSaveLocation(
  projectPath: string,
  question: string,
  answer: string,
  llmConfig: LlmConfig,
  signal?: AbortSignal,
): Promise<SaveLocation> {
  const pp = normalizePath(projectPath)
  const pages = await listKnowledgePages(pp).catch(() => [])
  const index = pages.map((p) => `- ${p.pagePath} — ${p.title}`).join("\n") || "(none)"
  const prompt = [
    "A user answered a wiki question. Decide where to store the answer so it is retrievable later.",
    "Prefer adding a section to an existing page when one clearly fits; otherwise propose a new page under db/concepts/.",
    'Return ONLY JSON: {"page_path":"db/category/name.md","title":"page display name","heading":"section heading","is_new":true}',
    "page_path must start with db/ and end with .md. When adding to an existing page, use its exact path from the index and set is_new=false.",
    "## Existing db/ pages",
    index,
    "## Question",
    question,
    "## Answer",
    answer,
  ].join("\n")

  const existingPaths = new Set(pages.map((p) => p.pagePath))
  try {
    const raw = await callModel(llmConfig, "You assign wiki storage locations.", prompt, signal, pp, 800, true)
    const parsed = JSON.parse(stripCodeFence(raw)) as Record<string, unknown>
    const pagePath = typeof parsed.page_path === "string" ? parsed.page_path.trim() : ""
    if (pagePath.startsWith("db/") && pagePath.endsWith(".md") && isSafeIngestPath(pagePath)) {
      const isNew = existingPaths.has(pagePath) ? false : parsed.is_new !== false
      return {
        pagePath,
        title: (typeof parsed.title === "string" && parsed.title.trim()) || deriveTitle(question),
        heading: (typeof parsed.heading === "string" && parsed.heading.trim()) || deriveTitle(question),
        isNew: !existingPaths.has(pagePath) && isNew,
      }
    }
  } catch (err) {
    console.warn("[chat-save] location suggestion failed, using fallback:", err)
  }
  return fallbackLocation(question, existingPaths)
}

function deriveTitle(question: string): string {
  return question.replace(/[[\]#]/g, "").trim().slice(0, 60) || "Saved Answer"
}

function fallbackLocation(question: string, existingPaths: Set<string>): SaveLocation {
  const slug = deriveTitle(question).replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-").slice(0, 60) || "saved-answer"
  let pagePath = `db/concepts/${slug}.md`
  for (let i = 2; existingPaths.has(pagePath); i++) pagePath = `db/concepts/${slug}-${i}.md`
  return { pagePath, title: deriveTitle(question), heading: deriveTitle(question), isNew: true }
}

/**
 * Commit the answer to the approved location via the existing v2 ingest
 * pipeline (Step 12 §4): build/append the section, extract assertions, and
 * commit with `origin: "user_chat"`. Appends to the existing page (preserving
 * its page_id) when the file is already present, else creates a new page.
 */
export async function saveChatAnswerToWiki(
  projectPath: string,
  location: SaveLocation,
  answer: string,
  llmConfig: LlmConfig,
  signal?: AbortSignal,
): Promise<void> {
  const pp = normalizePath(projectPath)
  const body = answer.trim()
  const newSection: ParsedSectionV2 = {
    sectionId: createSectionId(),
    headingText: location.heading || location.title,
    headingLevel: 2,
    ordinal: 0,
    metadata: { section_type: "overview" },
    // H2 is the v2 section boundary; demote any embedded H2 to H3 so the
    // appended prose can't fabricate a second section split.
    body: `\n${body.replace(/^##(?!#)(?=\s)/gm, "###")}\n`,
    startOffset: 0,
    endOffset: 0,
  }

  let content: string
  const existing = await readFile(`${pp}/${location.pagePath}`).catch(() => "")
  if (existing.trim()) {
    // Append a section to the existing page, keeping its page_id/sections.
    const page = parseMarkdownV2(existing)
    newSection.ordinal = page.sections.length
    const sections = [...page.sections, newSection]
    content = serializeMarkdownV2({
      ...page,
      page: { ...page.page, sections: Object.fromEntries(sections.map((s) => [s.sectionId, s.metadata])) },
      sections,
    })
  } else {
    // Fresh page — mirror buildFileBlocksFromSections' single-page shape.
    content = serializeMarkdownV2({
      page: {
        schema: "llm-wiki/page/v2",
        page_id: createPageId(),
        title: location.title,
        page_type: "reference",
        summary: location.title,
        sections: { [newSection.sectionId]: newSection.metadata },
      },
      h1: location.title,
      sections: [newSection],
      source: "",
    })
  }

  const documents = [{ relativePath: location.pagePath, content }]
  // Extract assertions from just the new section, then commit content +
  // assertions atomically with the user_chat origin.
  let assertions: Awaited<ReturnType<typeof extractKnowledgeAssertionWrites>> = []
  try {
    assertions = await extractKnowledgeAssertionWrites(pp, documents, llmConfig, signal, [newSection.sectionId])
  } catch (err) {
    // Assertion extraction is best-effort; the section still gets saved so the
    // answer is retrievable even if graph extraction fails.
    console.warn("[chat-save] assertion extraction failed, saving content only:", err)
  }
  await commitMarkdownV2Pages(pp, documents, assertions, "user_chat")
}
