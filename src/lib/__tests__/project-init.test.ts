import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/commands/fs", () => ({
  copyFile: vi.fn(),
  createDirectory: vi.fn(),
  writeFile: vi.fn(),
}))

vi.mock("@/commands/git", () => ({
  gitInit: vi.fn(),
}))

import { copyFile, createDirectory, writeFile } from "@/commands/fs"
import { gitInit } from "@/commands/git"
import {
  initProject,
  SYSTEM_PREFIX_DIRS,
  EXCLUSION_SCHEMA_SEED,
  PROMOTION_RULES_SEED,
} from "../project-init"

const mockCopyFile = vi.mocked(copyFile)
const mockCreateDirectory = vi.mocked(createDirectory)
const mockWriteFile = vi.mocked(writeFile)
const mockGitInit = vi.mocked(gitInit)

beforeEach(() => {
  mockCopyFile.mockReset().mockResolvedValue(undefined)
  mockCreateDirectory.mockReset().mockResolvedValue(undefined)
  mockWriteFile.mockReset().mockResolvedValue(undefined)
  mockGitInit.mockReset().mockResolvedValue(undefined)
})

describe("initProject", () => {
  it("creates every system-prefix directory with a .gitkeep marker", async () => {
    await initProject({
      projectPath: "/tmp/proj",
      schemaSourcePath: "/sources/schema.md",
      purposeMarkdown: "purpose body",
    })

    for (const dir of SYSTEM_PREFIX_DIRS) {
      expect(mockCreateDirectory).toHaveBeenCalledWith(`/tmp/proj/${dir}`)
      expect(mockWriteFile).toHaveBeenCalledWith(`/tmp/proj/${dir}/.gitkeep`, "")
    }
    // Stage 1's four ingest prefixes + Stage 8's search-side additions
    // (question_types + the three exclusions/<level>/ subtrees). The
    // exclusions/ parent itself is created implicitly by create_dir_all
    // and gets two seed markdown files instead of a .gitkeep.
    expect(SYSTEM_PREFIX_DIRS).toEqual([
      "db",
      "processed_1",
      "pending",
      "counterexamples",
      "question_types",
      "exclusions/by_question_type",
      "exclusions/axioms",
      "exclusions/instances",
    ])
  })

  it("writes the two exclusion seed markdown files into exclusions/", async () => {
    await initProject({
      projectPath: "/tmp/proj",
      schemaSourcePath: "/sources/schema.md",
      purposeMarkdown: "x",
    })

    expect(mockWriteFile).toHaveBeenCalledWith(
      "/tmp/proj/exclusions/exclusion_schema.md",
      EXCLUSION_SCHEMA_SEED,
    )
    expect(mockWriteFile).toHaveBeenCalledWith(
      "/tmp/proj/exclusions/promotion_rules.md",
      PROMOTION_RULES_SEED,
    )
  })

  it("seeds promotion_rules.md with an explicit 자동 승격 금지 clause", () => {
    // IDEA §2.6 forbids automatic promotion. The seed file must surface
    // that constraint so a user editing thresholds can't quietly enable
    // auto-promotion by lowering a number.
    expect(PROMOTION_RULES_SEED).toMatch(/자동 승격 금지/)
    expect(PROMOTION_RULES_SEED).toMatch(/사람의 명시적 승인/)
  })

  it("seeds exclusion_schema.md with the coordinate / application / conflict rules", () => {
    // Three load-bearing concepts from the plan: single-axis coordinate
    // system, single-shot application at search start, and the axiom >
    // pattern + archived-skip conflict rules.
    expect(EXCLUSION_SCHEMA_SEED).toMatch(/좌표계/)
    expect(EXCLUSION_SCHEMA_SEED).toMatch(/적용 시점/)
    expect(EXCLUSION_SCHEMA_SEED).toMatch(/axiom > pattern/)
    expect(EXCLUSION_SCHEMA_SEED).toMatch(/archived/)
  })

  it("orders writes so seed markdown lands before gitInit captures the tree", async () => {
    // The initial commit must include the seeds — otherwise users start
    // out with an untracked exclusions/ workspace and Stage 12's
    // commit-per-search story breaks on the first run.
    await initProject({
      projectPath: "/tmp/proj",
      schemaSourcePath: "/sources/schema.md",
      purposeMarkdown: "x",
    })

    const seedWriteOrders = mockWriteFile.mock.calls
      .map((call, i) => ({ path: call[0], order: mockWriteFile.mock.invocationCallOrder[i] }))
      .filter(
        (c) =>
          c.path === "/tmp/proj/exclusions/exclusion_schema.md" ||
          c.path === "/tmp/proj/exclusions/promotion_rules.md",
      )
    expect(seedWriteOrders).toHaveLength(2)
    const gitInitOrder = mockGitInit.mock.invocationCallOrder[0]
    for (const { order } of seedWriteOrders) {
      expect(gitInitOrder).toBeGreaterThan(order)
    }
  })

  it("copies the selected schema source into <projectPath>/schema.md", async () => {
    await initProject({
      projectPath: "/tmp/proj",
      schemaSourcePath: "/elsewhere/my-schema.md",
      purposeMarkdown: "",
    })

    expect(mockCopyFile).toHaveBeenCalledWith("/elsewhere/my-schema.md", "/tmp/proj/schema.md")
    expect(mockCopyFile).toHaveBeenCalledTimes(1)
  })

  it("writes the purpose markdown verbatim into <projectPath>/purpose.md", async () => {
    const purpose = "# 프로젝트 목적\n\n인스턴스 서버 자료 정리"
    await initProject({
      projectPath: "/tmp/proj",
      schemaSourcePath: "/sources/schema.md",
      purposeMarkdown: purpose,
    })

    expect(mockWriteFile).toHaveBeenCalledWith("/tmp/proj/purpose.md", purpose)
  })

  it("allows empty purpose (writes 0-byte purpose.md)", async () => {
    await initProject({
      projectPath: "/tmp/proj",
      schemaSourcePath: "/sources/schema.md",
      purposeMarkdown: "",
    })

    expect(mockWriteFile).toHaveBeenCalledWith("/tmp/proj/purpose.md", "")
  })

  it("strips trailing slashes from projectPath so paths don't double up", async () => {
    await initProject({
      projectPath: "/tmp/proj///",
      schemaSourcePath: "/sources/schema.md",
      purposeMarkdown: "x",
    })

    expect(mockCreateDirectory).toHaveBeenCalledWith("/tmp/proj/db")
    expect(mockCopyFile).toHaveBeenCalledWith("/sources/schema.md", "/tmp/proj/schema.md")
    expect(mockWriteFile).toHaveBeenCalledWith("/tmp/proj/purpose.md", "x")
    expect(mockGitInit).toHaveBeenCalledWith("/tmp/proj")
  })

  it("calls gitInit with the normalized project path after files are on disk", async () => {
    await initProject({
      projectPath: "/tmp/proj",
      schemaSourcePath: "/sources/schema.md",
      purposeMarkdown: "x",
    })

    expect(mockGitInit).toHaveBeenCalledTimes(1)
    expect(mockGitInit).toHaveBeenCalledWith("/tmp/proj")

    // gitInit must run AFTER the bootstrap writes — otherwise the
    // initial commit captures an empty tree.
    const gitInitOrder = mockGitInit.mock.invocationCallOrder[0]
    const lastWriteOrder = Math.max(...mockWriteFile.mock.invocationCallOrder)
    const copyOrder = mockCopyFile.mock.invocationCallOrder[0]
    expect(gitInitOrder).toBeGreaterThan(lastWriteOrder)
    expect(gitInitOrder).toBeGreaterThan(copyOrder)
  })
})
