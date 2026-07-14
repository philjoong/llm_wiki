import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/commands/fs", () => ({
  createDirectory: vi.fn(),
  writeFile: vi.fn(),
  fileExists: vi.fn(),
  readFile: vi.fn(),
  seedQuestionTypes: vi.fn(),
  seedDataTypes: vi.fn(),
}))

vi.mock("@/commands/git", () => ({
  gitInit: vi.fn(),
}))

vi.mock("@/commands/knowledge", () => ({
  bootstrapKnowledgeDb: vi.fn().mockResolvedValue({ schemaVersion: 1, foreignKeysEnabled: true, bootstrapped: true }),
  recoverIngestTransactions: vi.fn().mockResolvedValue(undefined),
}))

import { createDirectory, fileExists, readFile, seedDataTypes, seedQuestionTypes, writeFile } from "@/commands/fs"
import { gitInit } from "@/commands/git"
import {
  initProject,
  SYSTEM_PREFIX_DIRS,
} from "../project-init"

const mockCreateDirectory = vi.mocked(createDirectory)
const mockWriteFile = vi.mocked(writeFile)
const mockFileExists = vi.mocked(fileExists)
const mockReadFile = vi.mocked(readFile)
const mockSeedQuestionTypes = vi.mocked(seedQuestionTypes)
const mockSeedDataTypes = vi.mocked(seedDataTypes)
const mockGitInit = vi.mocked(gitInit)

beforeEach(() => {
  mockCreateDirectory.mockReset().mockResolvedValue(undefined)
  mockWriteFile.mockReset().mockResolvedValue(undefined)
  mockFileExists.mockReset().mockResolvedValue(false)
  mockReadFile.mockReset().mockResolvedValue("")
  mockSeedQuestionTypes.mockReset().mockResolvedValue(undefined)
  mockSeedDataTypes.mockReset().mockResolvedValue(undefined)
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
      "question_types",
      "data_types",
    ])
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
