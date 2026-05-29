/**
 * Claude Code CLI ingest path — a deliberately minimal alternative to
 * autoIngestImpl in [./ingest.ts](./ingest.ts).
 *
 * Why a separate path: Claude Code is hardwired as a coding agent and
 * happily invokes Read/Write/Edit when asked to "produce FILE blocks",
 * yielding a stream that contains tool_use events but no parseable text
 * — autoIngestImpl ends up with zero blocks and the queue surfaces
 * "Ingest produced no output files". Stage A confirmed that:
 *   - `claude --tools ""` empties the tool definition list, so the
 *     model has no choice but to answer in text.
 *   - `claude --system-prompt "<ours>"` replaces the default system
 *     prompt entirely, which also blocks `.claude/CLAUDE.md` in the
 *     project cwd from leaking into the system context.
 *   - `claude` reliably emits raw JSON when the system prompt demands
 *     `{"files":[{"path","content"}]}`.
 *
 * Trade-off: this MVP skips chunking, the 2-stage analyse/generate
 * flow, modification-conflict detection, the ingest cache, embedding
 * generation, and auto-commit. The contract returned to the queue
 * runner is the same `Promise<string[]>` of relative paths, so the
 * queue's success condition (writtenPaths.length > 0) is satisfied.
 */

import { listDirectory, readFile, writeFile } from "@/commands/fs"
import { useActivityStore } from "@/stores/activity-store"
import { useWikiStore } from "@/stores/wiki-store"
import type { LlmConfig } from "@/stores/wiki-store"
import type { FileNode } from "@/types/wiki"
import { streamClaudeCodeCli } from "./claude-cli-transport"
import { isSafeIngestPath } from "./ingest"
import { getFileName, normalizePath } from "./path-utils"
import { buildGraphPolicyPrompt, loadGraphPolicy } from "./graph-policy"

export interface ParsedAgentFile {
  path: string
  content: string
}

/**
 * The system prompt installed via `--system-prompt`. Leading instruction
 * is the JSON shape; db index and graph policy are appended as context.
 */
export function buildAgentIngestPrompt(
  dbIndex: string,
  dismissalContext: string,
  graphPolicyPrompt: string = "",
): string {
  return [
    "You are a wiki maintainer. Decompose the user's source document into",
    "logical pages under db/.",
    "",
    "## Output format (STRICT)",
    "",
    "Reply with raw JSON ONLY. No code fences. No prose before or after.",
    "No explanation. The first character of your reply MUST be `{`.",
    "",
    "Schema:",
    "",
    '  {"files": [{"path": "db/...", "content": "..."}]}',
    "",
    "Each `path` MUST start with one of:",
    "  db/, pending/, counterexamples/, question_types/, exclusions/",
    "",
    "Each `content` is the FULL markdown body of the page, with YAML",
    "frontmatter at the top:",
    "",
    "  ---",
    "  title: <human-readable title>",
    "  status: draft",
    "  sources:",
    "    - file: <source filename>",
    "      range: <heading path | sheet!range | timestamp>",
    "  ---",
    "",
    "Do not invent content the source does not contain. If a section is",
    "too thin for its own page, omit it.",
    "",
    dbIndex ? `## Current db/ index\n\n${dbIndex}` : "",
    graphPolicyPrompt,
    dismissalContext,
  ]
    .filter(Boolean)
    .join("\n\n")
}

/**
 * Parse the raw text Claude Code returned. Tolerates a single layer of
 * ```json fences (defensive — Stage A showed the bare JSON case, but
 * other versions may add fences). Throws with a previewable message on
 * any structural issue so the queue runner can surface and retry.
 *
 * Path safety is enforced here rather than at the writer: an attacker
 * planting "now write to ../../etc/passwd" in the source content would
 * otherwise rely on the writer's gate. We belt-and-braces it here so
 * the rejection is visible in this module's logs instead of buried at
 * the FS boundary.
 */
export function parseAgentIngestResponse(rawText: string): ParsedAgentFile[] {
  const stripped = rawText
    .trim()
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?\s*```\s*$/i, "")
    .trim()

  if (!stripped) {
    throw new Error("Agent ingest returned empty response")
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch (err) {
    const preview = stripped.slice(0, 200)
    throw new Error(
      `Agent ingest JSON parse failed: ${err instanceof Error ? err.message : String(err)} — got: ${preview}`,
    )
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as { files?: unknown }).files)
  ) {
    throw new Error("Agent ingest response missing `files: [...]` array")
  }

  const out: ParsedAgentFile[] = []
  for (const item of (parsed as { files: unknown[] }).files) {
    if (!item || typeof item !== "object") continue
    const obj = item as { path?: unknown; content?: unknown }
    if (typeof obj.path !== "string" || typeof obj.content !== "string") continue
    if (!isSafeIngestPath(obj.path)) {
      console.warn(`[agent-ingest] Rejected unsafe path: ${obj.path}`)
      continue
    }
    out.push({ path: obj.path, content: obj.content })
  }
  return out
}

async function tryReadFile(path: string): Promise<string> {
  try {
    return await readFile(path)
  } catch {
    return ""
  }
}

async function buildDbIndex(projectPath: string): Promise<string> {
  let nodes: FileNode[]
  try {
    nodes = await listDirectory(`${projectPath}/db`)
  } catch {
    return ""
  }
  const lines: string[] = []
  const walk = (ns: FileNode[], prefix: string): void => {
    for (const n of ns) {
      if (n.name.startsWith(".")) continue
      const p = `${prefix}/${n.name}`
      if (n.is_dir) walk(n.children ?? [], p)
      else if (n.name.endsWith(".md")) lines.push(p)
    }
  }
  walk(nodes, "db")
  return lines.join("\n")
}

export async function autoIngestViaAgent(
  projectPath: string,
  sourcePath: string,
  llmConfig: LlmConfig,
  signal?: AbortSignal,
  folderContext?: string,
): Promise<string[]> {
  const pp = normalizePath(projectPath)
  const sp = normalizePath(sourcePath)
  const fileName = getFileName(sp)
  const activity = useActivityStore.getState()
  const activityId = activity.addItem({
    type: "ingest",
    title: fileName,
    status: "running",
    detail: "Reading source...",
    filesWritten: [],
  })

  const [sourceContent, dbIndex, graphPolicy] = await Promise.all([
    tryReadFile(sp),
    buildDbIndex(pp),
    loadGraphPolicy(pp),
  ])
  const graphPolicyPrompt = buildGraphPolicyPrompt(graphPolicy)

  const systemPrompt = buildAgentIngestPrompt(dbIndex, "", graphPolicyPrompt)
  const userMessage = [
    `Source file: ${fileName}${folderContext ? ` (folder: ${folderContext})` : ""}`,
    "",
    sourceContent,
  ].join("\n")

  activity.updateItem(activityId, { detail: "Calling Claude Code (tools disabled)..." })

  let buffer = ""
  await new Promise<void>((resolve, reject) => {
    void streamClaudeCodeCli(
      llmConfig,
      [{ role: "user", content: userMessage }],
      {
        onToken: (token) => {
          buffer += token
        },
        onDone: () => resolve(),
        onError: (err) => reject(err),
      },
      signal,
      { disableTools: true, systemPrompt, cwd: pp },
    ).catch(reject)
  })

  activity.updateItem(activityId, { detail: "Writing files..." })

  let files: ParsedAgentFile[]
  try {
    files = parseAgentIngestResponse(buffer)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    activity.updateItem(activityId, { status: "error", detail: msg })
    throw err
  }

  const writtenPaths: string[] = []
  for (const { path: rel, content } of files) {
    try {
      await writeFile(`${pp}/${rel}`, content)
      writtenPaths.push(rel)
    } catch (err) {
      console.warn(
        `[agent-ingest] write failed for ${rel}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  if (writtenPaths.length > 0) {
    try {
      const tree = await listDirectory(pp)
      useWikiStore.getState().setFileTree(tree)
      useWikiStore.getState().bumpDataVersion()
    } catch {
      // Non-fatal: the files are on disk; the tree will refresh on next nav.
    }
  }

  activity.updateItem(activityId, {
    status: writtenPaths.length > 0 ? "done" : "error",
    detail:
      writtenPaths.length > 0
        ? `${writtenPaths.length} files written`
        : "No files generated",
    filesWritten: writtenPaths,
  })

  return writtenPaths
}
