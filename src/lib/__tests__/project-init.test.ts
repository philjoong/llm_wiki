import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/commands/fs", () => ({
  createDirectory: vi.fn(),
  writeFile: vi.fn(),
  fileExists: vi.fn(),
  readFile: vi.fn(),
}))

vi.mock("@/commands/git", () => ({
  gitInit: vi.fn(),
}))

import { createDirectory, fileExists, readFile, writeFile } from "@/commands/fs"
import { gitInit } from "@/commands/git"
import {
  initProject,
  SYSTEM_PREFIX_DIRS,
  EXCLUSION_SCHEMA_SEED,
  PROMOTION_RULES_SEED,
} from "../project-init"

const mockCreateDirectory = vi.mocked(createDirectory)
const mockWriteFile = vi.mocked(writeFile)
const mockFileExists = vi.mocked(fileExists)
const mockReadFile = vi.mocked(readFile)
const mockGitInit = vi.mocked(gitInit)

beforeEach(() => {
  mockCreateDirectory.mockReset().mockResolvedValue(undefined)
  mockWriteFile.mockReset().mockResolvedValue(undefined)
  mockFileExists.mockReset().mockResolvedValue(false)
  mockReadFile.mockReset().mockResolvedValue("")
  mockGitInit.mockReset().mockResolvedValue(undefined)
})

describe("initProject", () => {
  it("creates every system-prefix directory with a .gitkeep marker", async () => {
    await initProject({ projectPath: "/tmp/proj" })

    for (const dir of SYSTEM_PREFIX_DIRS) {
      expect(mockCreateDirectory).toHaveBeenCalledWith(`/tmp/proj/${dir}`)
      expect(mockWriteFile).toHaveBeenCalledWith(`/tmp/proj/${dir}/.gitkeep`, "")
    }
    expect(SYSTEM_PREFIX_DIRS).toEqual([
      "db",
      "pending",
      "counterexamples",
      "question_types",
      "exclusions/by_question_type",
      "exclusions/axioms",
      "exclusions/instances",
    ])
  })

  it("writes the two exclusion seed markdown files into exclusions/", async () => {
    await initProject({ projectPath: "/tmp/proj" })

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
    expect(PROMOTION_RULES_SEED).toMatch(/자동 승격 금지/)
    expect(PROMOTION_RULES_SEED).toMatch(/사람의 명시적 승인/)
  })

  it("seeds .gitignore so binary originals + preprocess caches stay untracked", async () => {
    await initProject({ projectPath: "/tmp/proj" })

    const gitignoreCall = mockWriteFile.mock.calls.find(
      ([path]) => path === "/tmp/proj/.gitignore",
    )
    expect(gitignoreCall).toBeDefined()
    const body = String(gitignoreCall![1])
    expect(body).toContain("raw/originals/")
    expect(body).toContain("raw/sources/.cache/")
  })

  it("writes .gitignore before gitInit so the first commit doesn't capture binaries", async () => {
    await initProject({ projectPath: "/tmp/proj" })

    const gitignoreCall = mockWriteFile.mock.calls
      .map((call, i) => ({ path: call[0], order: mockWriteFile.mock.invocationCallOrder[i] }))
      .find((c) => c.path === "/tmp/proj/.gitignore")
    expect(gitignoreCall).toBeDefined()
    const gitInitOrder = mockGitInit.mock.invocationCallOrder[0]
    expect(gitInitOrder).toBeGreaterThan(gitignoreCall!.order)
  })

  it("seeds exclusion_schema.md with the coordinate / application / conflict rules", () => {
    expect(EXCLUSION_SCHEMA_SEED).toMatch(/좌표계/)
    expect(EXCLUSION_SCHEMA_SEED).toMatch(/적용 시점/)
    expect(EXCLUSION_SCHEMA_SEED).toMatch(/axiom > pattern/)
    expect(EXCLUSION_SCHEMA_SEED).toMatch(/archived/)
  })

  it("orders writes so seed markdown lands before gitInit captures the tree", async () => {
    await initProject({ projectPath: "/tmp/proj" })

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

  it("strips trailing slashes from projectPath so paths don't double up", async () => {
    await initProject({ projectPath: "/tmp/proj///" })

    expect(mockCreateDirectory).toHaveBeenCalledWith("/tmp/proj/db")
    expect(mockGitInit).toHaveBeenCalledWith("/tmp/proj")
  })

  it("calls gitInit with the normalized project path after files are on disk", async () => {
    await initProject({ projectPath: "/tmp/proj" })

    expect(mockGitInit).toHaveBeenCalledTimes(1)
    expect(mockGitInit).toHaveBeenCalledWith("/tmp/proj")

    const gitInitOrder = mockGitInit.mock.invocationCallOrder[0]
    const lastWriteOrder = Math.max(...mockWriteFile.mock.invocationCallOrder)
    expect(gitInitOrder).toBeGreaterThan(lastWriteOrder)
  })
})
