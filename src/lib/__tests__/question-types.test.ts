import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/commands/fs", () => ({
  listDirectory: vi.fn(),
  readFile: vi.fn(),
}))

import { listDirectory, readFile } from "@/commands/fs"
import { loadQuestionTypes, parseFrontmatter } from "../question-types"
import type { FileNode } from "@/types/wiki"

const mockListDirectory = vi.mocked(listDirectory)
const mockReadFile = vi.mocked(readFile)

beforeEach(() => {
  mockListDirectory.mockReset()
  mockReadFile.mockReset()
})

function makeFile(name: string): FileNode {
  return { name, path: `/proj/question_types/${name}`, is_dir: false }
}

describe("loadQuestionTypes", () => {
  it("returns [] when the question_types directory is missing", async () => {
    mockListDirectory.mockRejectedValueOnce(new Error("ENOENT"))
    expect(await loadQuestionTypes("/proj")).toEqual([])
  })

  it("parses the IDEA §2.4 example file end-to-end", async () => {
    mockListDirectory.mockResolvedValueOnce([makeFile("policy_violation.md")])
    mockReadFile.mockResolvedValueOnce(
      [
        "---",
        "title: 정책 위반 탐지",
        "---",
        "## Description",
        "사용자/운영 정책에 위반되는 동작을 식별한다.",
        "## Zero residue",
        "잔존 0 = 위반 없음 (긍정적 신호).",
      ].join("\n"),
    )
    const out = await loadQuestionTypes("/proj")
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({
      id: "policy_violation",
      name: "정책 위반 탐지",
      description: "사용자/운영 정책에 위반되는 동작을 식별한다.",
      zeroResidueMeaning: "잔존 0 = 위반 없음 (긍정적 신호).",
    })
  })

  it("falls back to first H1 then to filename stem when no frontmatter title", async () => {
    mockListDirectory.mockResolvedValueOnce([
      makeFile("h1_only.md"),
      makeFile("bare.md"),
    ])
    mockReadFile.mockResolvedValueOnce("# 회귀 테스트\n\n변경 후에도 기존 동작이 유지되어야 함.")
    mockReadFile.mockResolvedValueOnce("그냥 본문만 있는 파일.")
    const out = await loadQuestionTypes("/proj")
    expect(out.find((q) => q.id === "h1_only")?.name).toBe("회귀 테스트")
    expect(out.find((q) => q.id === "bare")?.name).toBe("bare")
  })

  it("captures Input / Output / Zero residue section bodies", async () => {
    mockListDirectory.mockResolvedValueOnce([makeFile("condition.md")])
    mockReadFile.mockResolvedValueOnce(
      [
        "---",
        "title: 조건 기반 가상 테스트",
        "---",
        "조건이 충족됐을 때의 시스템 반응을 추적한다.",
        "",
        "## Input",
        "조건 + 액터의 행동.",
        "",
        "## Output",
        "예상되는 시스템 반응 1줄.",
        "",
        "## Zero residue",
        "잔존 0 = 정의된 조건이 어떤 코너에도 걸리지 않음.",
        "",
        "## Unknown section",
        "이 영역은 무시되어야 한다.",
      ].join("\n"),
    )
    const [qt] = await loadQuestionTypes("/proj")
    expect(qt.inputShape).toBe("조건 + 액터의 행동.")
    expect(qt.outputShape).toBe("예상되는 시스템 반응 1줄.")
    expect(qt.zeroResidueMeaning).toBe("잔존 0 = 정의된 조건이 어떤 코너에도 걸리지 않음.")
    expect(qt.description).toBe("조건이 충족됐을 때의 시스템 반응을 추적한다.")
  })

  it("skips dotfiles, non-markdown, and directories; logs and skips read failures", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    mockListDirectory.mockResolvedValueOnce([
      { name: ".gitkeep", path: "/proj/question_types/.gitkeep", is_dir: false },
      { name: "_drafts", path: "/proj/question_types/_drafts", is_dir: true },
      { name: "notes.txt", path: "/proj/question_types/notes.txt", is_dir: false },
      makeFile("ok.md"),
      makeFile("broken.md"),
    ] as FileNode[])
    mockReadFile.mockResolvedValueOnce("# OK\n\n본문.")
    mockReadFile.mockRejectedValueOnce(new Error("EACCES"))

    const out = await loadQuestionTypes("/proj")
    expect(out.map((q) => q.id)).toEqual(["ok"])
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("broken.md"),
      expect.any(Error),
    )
    warn.mockRestore()
  })

  it("returns multiple types in the order listDirectory yields them", async () => {
    mockListDirectory.mockResolvedValueOnce([
      makeFile("a.md"),
      makeFile("b.md"),
      makeFile("c.md"),
    ])
    mockReadFile
      .mockResolvedValueOnce("# A\n\n본문A.")
      .mockResolvedValueOnce("# B\n\n본문B.")
      .mockResolvedValueOnce("# C\n\n본문C.")
    const out = await loadQuestionTypes("/proj")
    expect(out.map((q) => q.id)).toEqual(["a", "b", "c"])
  })

  it("handles a body whose first paragraph follows blank lines and headings", async () => {
    mockListDirectory.mockResolvedValueOnce([makeFile("policy.md")])
    mockReadFile.mockResolvedValueOnce(
      "\n\n## Description\n\n실제 설명 문단입니다.\n\n## Other\n다른 영역.",
    )
    const [qt] = await loadQuestionTypes("/proj")
    expect(qt.description).toBe("실제 설명 문단입니다.")
  })
})

describe("parseFrontmatter", () => {
  it("returns empty fm + raw body when no frontmatter is present", () => {
    const { fm, body } = parseFrontmatter("# Hello\nbody")
    expect(fm).toEqual({})
    expect(body).toBe("# Hello\nbody")
  })

  it("parses scalar / boolean / inline-array values", () => {
    const { fm } = parseFrontmatter(
      ["---", 'title: "정책 위반"', "archived: true", "applies_to: [a, b, c]", "---", "body"].join("\n"),
    )
    expect(fm.title).toBe("정책 위반")
    expect(fm.archived).toBe(true)
    expect(fm.applies_to).toEqual(["a", "b", "c"])
  })
})
