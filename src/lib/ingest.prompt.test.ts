import { describe, it, expect, beforeEach } from "vitest"
import { buildAnalysisPrompt, buildGenerationPrompt } from "./ingest"
import { useWikiStore } from "@/stores/wiki-store"

beforeEach(() => {
  useWikiStore.getState().setOutputLanguage("auto")
})

// Stage 3 signatures:
//   buildAnalysisPrompt(dbIndex, sourceContent)
//   buildGenerationPrompt(dbIndex, sourceFileName, sourceContent)

describe("buildAnalysisPrompt language directive", () => {
  it("injects the user's explicit language setting", () => {
    useWikiStore.getState().setOutputLanguage("Chinese")
    const prompt = buildAnalysisPrompt("db-index", "english source content")
    expect(prompt).toContain("MANDATORY OUTPUT LANGUAGE: Chinese")
  })

  it("uses user setting even when source is in a different language", () => {
    useWikiStore.getState().setOutputLanguage("Japanese")
    const prompt = buildAnalysisPrompt("", "这段内容是中文")
    expect(prompt).toContain("MANDATORY OUTPUT LANGUAGE: Japanese")
    expect(prompt).not.toContain("OUTPUT LANGUAGE: Chinese")
  })

  it("auto mode falls back to detecting source content language", () => {
    useWikiStore.getState().setOutputLanguage("auto")
    const prompt = buildAnalysisPrompt("", "これは日本語の文章です")
    expect(prompt).toContain("MANDATORY OUTPUT LANGUAGE: Japanese")
  })

  it("auto mode with empty source defaults to English", () => {
    useWikiStore.getState().setOutputLanguage("auto")
    const prompt = buildAnalysisPrompt("", "")
    expect(prompt).toContain("MANDATORY OUTPUT LANGUAGE: English")
  })

  it("frames the task as decomposition into db/ paths", () => {
    const prompt = buildAnalysisPrompt("", "")
    expect(prompt).toContain("decomposer")
    expect(prompt).toContain("db/")
    expect(prompt).toContain("path")
    expect(prompt).toContain("range")
    expect(prompt).not.toContain("## Key Entities")
    expect(prompt).not.toContain("## Key Concepts")
    expect(prompt).not.toContain("schema.md")
  })
})

describe("buildGenerationPrompt language directive", () => {
  it("injects the user's explicit language setting", () => {
    useWikiStore.getState().setOutputLanguage("Chinese")
    const prompt = buildGenerationPrompt("db-index", "source.pdf")
    expect(prompt).toContain("MANDATORY OUTPUT LANGUAGE: Chinese")
  })

  it("honors Vietnamese setting", () => {
    useWikiStore.getState().setOutputLanguage("Vietnamese")
    const prompt = buildGenerationPrompt("", "file.pdf")
    expect(prompt).toContain("MANDATORY OUTPUT LANGUAGE: Vietnamese")
  })

  it("auto mode detects from source content", () => {
    useWikiStore.getState().setOutputLanguage("auto")
    const prompt = buildGenerationPrompt("", "file.pdf", "这是中文源文档内容")
    expect(prompt).toContain("MANDATORY OUTPUT LANGUAGE: Chinese")
  })

  it("includes the source filename in output instructions", () => {
    const prompt = buildGenerationPrompt("", "my-paper.pdf")
    expect(prompt).toContain("my-paper.pdf")
  })

  it("respects user setting regardless of source content language", () => {
    useWikiStore.getState().setOutputLanguage("English")
    const prompt = buildGenerationPrompt("", "x.pdf", "私は日本語の文章を書きます")
    expect(prompt).toContain("MANDATORY OUTPUT LANGUAGE: English")
    expect(prompt).not.toContain("OUTPUT LANGUAGE: Japanese")
  })

  it("directs FILE blocks under db/ and forbids index/overview/log", () => {
    const prompt = buildGenerationPrompt("", "src.md")
    expect(prompt).toContain("---FILE: db/")
    expect(prompt).toContain("Do NOT generate index, overview, or log pages")
    expect(prompt).not.toContain("schema")
  })

  it("describes the multi-line object form for sources frontmatter", () => {
    const prompt = buildGenerationPrompt("", "src.md")
    expect(prompt).toMatch(/-\s+file:\s*src\.md/)
    expect(prompt).toContain("range:")
    expect(prompt).toContain('NOT `sources: ["file.md"]`')
  })
})

describe("analysis + generation prompt consistency", () => {
  it("both stages declare the same language for a given setting", () => {
    useWikiStore.getState().setOutputLanguage("Korean")
    const analysis = buildAnalysisPrompt("", "")
    const generation = buildGenerationPrompt("", "f.pdf")
    expect(analysis).toContain("MANDATORY OUTPUT LANGUAGE: Korean")
    expect(generation).toContain("MANDATORY OUTPUT LANGUAGE: Korean")
  })

  it("both stages in auto mode agree on detected language from source", () => {
    useWikiStore.getState().setOutputLanguage("auto")
    const korean = "이것은 한국어 문장입니다"
    const analysis = buildAnalysisPrompt("", korean)
    const generation = buildGenerationPrompt("", "f.pdf", korean)
    expect(analysis).toContain("MANDATORY OUTPUT LANGUAGE: Korean")
    expect(generation).toContain("MANDATORY OUTPUT LANGUAGE: Korean")
  })
})
