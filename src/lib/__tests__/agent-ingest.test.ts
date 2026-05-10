/**
 * Stage C — agent-ingest regression tests for claude-cli-ingest-plan.md.
 *
 * The five cases mirror the failure modes the queue runner has to
 * tolerate: a clean JSON path, a code-fenced JSON path, a bad-JSON
 * reject (so the queue retries), an unsafe-path filter, and an empty
 * `files: []` response (also a retry trigger via writtenPaths.length===0).
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  listDirectory: vi.fn(),
}))

vi.mock("../claude-cli-transport", () => ({
  streamClaudeCodeCli: vi.fn(),
}))

import { readFile, writeFile, listDirectory } from "@/commands/fs"
import { streamClaudeCodeCli } from "../claude-cli-transport"
import { autoIngestViaAgent } from "../agent-ingest"
import { useActivityStore } from "@/stores/activity-store"
import { useWikiStore } from "@/stores/wiki-store"
import type { LlmConfig } from "@/stores/wiki-store"
import type { FileNode } from "@/types/wiki"

const mockReadFile = vi.mocked(readFile)
const mockWriteFile = vi.mocked(writeFile)
const mockListDirectory = vi.mocked(listDirectory)
const mockStream = vi.mocked(streamClaudeCodeCli)

const PROJECT = "/proj"
const SOURCE = "/proj/raw/lorem.md"

const cliConfig: LlmConfig = {
  provider: "claude-code",
  apiKey: "",
  model: "claude-sonnet-4-5",
  ollamaUrl: "",
  customEndpoint: "",
  maxContextSize: 200000,
}

/**
 * Drive the mocked transport: emit `response` as a single token, then
 * resolve onDone. Mirrors how Claude Code returns the JSON in one shot
 * (Stage A confirmed the bare-JSON case).
 */
function mockStreamResponse(response: string) {
  mockStream.mockImplementation(async (_cfg, _msgs, callbacks) => {
    callbacks.onToken(response)
    callbacks.onDone()
  })
}

beforeEach(() => {
  mockReadFile.mockReset()
  mockWriteFile.mockReset().mockResolvedValue(undefined)
  mockListDirectory.mockReset()
  mockStream.mockReset()
  useActivityStore.setState({ items: [] })
  useWikiStore.setState({ fileTree: [] })

  // Default: source + empty schema/purpose/db; the project listDirectory
  // (tree refresh after writes) returns an empty tree. Individual tests
  // override these as needed.
  mockReadFile.mockImplementation(async (p: string) => {
    if (p === SOURCE) return "Lorem ipsum source body."
    return ""
  })
  mockListDirectory.mockImplementation(async (_p: string) => [] as FileNode[])
})

describe("autoIngestViaAgent", () => {
  it("writes every file from a clean JSON multi-file response", async () => {
    mockStreamResponse(
      JSON.stringify({
        files: [
          { path: "db/foo.md", content: "# Foo\n\nbody" },
          { path: "db/bar.md", content: "# Bar\n\nbody" },
        ],
      }),
    )

    const written = await autoIngestViaAgent(PROJECT, SOURCE, cliConfig)

    expect(written).toEqual(["db/foo.md", "db/bar.md"])
    expect(mockWriteFile).toHaveBeenCalledTimes(2)
    expect(mockWriteFile).toHaveBeenNthCalledWith(1, "/proj/db/foo.md", "# Foo\n\nbody")
    expect(mockWriteFile).toHaveBeenNthCalledWith(2, "/proj/db/bar.md", "# Bar\n\nbody")
    const last = useActivityStore.getState().items[0]
    expect(last.status).toBe("done")
    expect(last.filesWritten).toEqual(["db/foo.md", "db/bar.md"])
  })

  it("strips a ```json code fence before parsing", async () => {
    mockStreamResponse(
      "```json\n" +
        JSON.stringify({ files: [{ path: "db/fenced.md", content: "ok" }] }) +
        "\n```",
    )

    const written = await autoIngestViaAgent(PROJECT, SOURCE, cliConfig)

    expect(written).toEqual(["db/fenced.md"])
    expect(mockWriteFile).toHaveBeenCalledWith("/proj/db/fenced.md", "ok")
  })

  it("rejects with a clear error when the response is non-JSON prose", async () => {
    mockStreamResponse(
      'I cannot help with that request. Here is some explanation { "files": [',
    )

    await expect(autoIngestViaAgent(PROJECT, SOURCE, cliConfig)).rejects.toThrow(
      /Agent ingest JSON parse failed/,
    )
    expect(mockWriteFile).not.toHaveBeenCalled()
    const last = useActivityStore.getState().items[0]
    expect(last.status).toBe("error")
  })

  it("drops unsafe paths and writes only the safe entries", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    mockStreamResponse(
      JSON.stringify({
        files: [
          { path: "../../etc/passwd", content: "evil" },
          { path: "db/safe.md", content: "good" },
        ],
      }),
    )

    const written = await autoIngestViaAgent(PROJECT, SOURCE, cliConfig)

    expect(written).toEqual(["db/safe.md"])
    expect(mockWriteFile).toHaveBeenCalledTimes(1)
    expect(mockWriteFile).toHaveBeenCalledWith("/proj/db/safe.md", "good")
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Rejected unsafe path: ../../etc/passwd"),
    )
    warn.mockRestore()
  })

  it("returns an empty array when the model emits files: [] (queue will retry)", async () => {
    mockStreamResponse(JSON.stringify({ files: [] }))

    const written = await autoIngestViaAgent(PROJECT, SOURCE, cliConfig)

    expect(written).toEqual([])
    expect(mockWriteFile).not.toHaveBeenCalled()
    const last = useActivityStore.getState().items[0]
    expect(last.status).toBe("error")
    expect(last.detail).toMatch(/No files generated/)
  })
})
