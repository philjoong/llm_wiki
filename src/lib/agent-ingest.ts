/**
 * Claude Code CLI ingest path — Stage 1/2 pipeline using CLI transport.
 *
 * Why a separate path: Claude Code is hardwired as a coding agent and
 * happily invokes Read/Write/Edit when asked to "produce FILE blocks",
 * yielding a stream that contains tool_use events but no parseable text.
 * We call the CLI with `disableTools: true` so it answers in plain text,
 * then run the same Stage 1 → Stage 2 → buildFileBlocksFromAssignments
 * pipeline as autoIngestImpl in ingest.ts.
 *
 * Key difference from ingest.ts: `response_format: { type: "json_object" }`
 * is not supported by the CLI, so JSON output is enforced via prompt only.
 */

import { listDirectory, readFile, writeFile } from "@/commands/fs"
import { invoke } from "@tauri-apps/api/core"
import { useActivityStore } from "@/stores/activity-store"
import { useWikiStore } from "@/stores/wiki-store"
import type { LlmConfig } from "@/stores/wiki-store"
import { useReviewStore } from "@/stores/review-store"
import type { FileNode } from "@/types/wiki"
import { streamClaudeCodeCli } from "./claude-cli-transport"
import { streamGeminiCli } from "./gemini-cli-transport"
import { streamCodexCli } from "./codex-cli-transport"
import {
  chunkSourceContent,
  buildDecompositionPrompt,
  buildGraphAssignmentPrompt,
  buildStage2Scaffold,
  buildFileBlocksFromAssignments,
  applyStage2GraphPolicyUpdates,
  hydrateStage2Assignments,
  validateStage2,
} from "./ingest"
import type { Stage1Section, Stage2Assignment } from "./ingest"
import { getFileName, normalizePath } from "./path-utils"
import { buildGraphPolicyPrompt, loadGraphPolicy, saveGraphPolicy } from "./graph-policy"
import { syncGraphToFalkorDb } from "./graph-sync"
import {
  loadCounterexamples,
  loadRejectionLog,
  findRelatedRejections,
  formatDismissalContext,
} from "@/lib/counterexample-index"

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

/**
 * CLI transport wrapper: same contract as streamChat but uses the CLI subprocess.
 * `response_format` is not passed — enforced via prompt instead.
 */
async function callCli(
  llmConfig: LlmConfig,
  systemPrompt: string,
  userContent: string,
  signal?: AbortSignal,
  projectPath?: string,
): Promise<string> {
  let buffer = ""
  await new Promise<void>((resolve, reject) => {
    const cb = {
      onToken: (token: string) => { buffer += token },
      onDone: () => resolve(),
      onError: (err: Error) => reject(err),
    }
    let transport: Promise<void>
    if (llmConfig.provider === "gemini-cli") {
      const combined = `${systemPrompt}\n\n${userContent}`
      transport = streamGeminiCli(llmConfig, [{ role: "user", content: combined }], cb, signal)
    } else if (llmConfig.provider === "codex-cli") {
      const combined = `${systemPrompt}\n\n${userContent}`
      transport = streamCodexCli(llmConfig, [{ role: "user", content: combined }], cb, signal)
    } else {
      transport = streamClaudeCodeCli(
        llmConfig,
        [{ role: "user", content: userContent }],
        cb,
        signal,
        { disableTools: true, systemPrompt, cwd: projectPath },
      )
    }
    transport.catch(reject)
  })
  return buffer
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

  const sourceContent = await tryReadFile(sp)

  const [dbIndex, counterexamples, rejectionLog] = await Promise.all([
    buildDbIndex(pp),
    loadCounterexamples(pp),
    loadRejectionLog(pp),
  ])
  const relevantRejections = findRelatedRejections(rejectionLog, fileName)
  const dismissalContext = formatDismissalContext(counterexamples, relevantRejections)

  const chunks = chunkSourceContent(sourceContent)
  const allWrittenPaths: string[] = []
  const allSkippedConcepts: Array<{ chunk: number; concept: string; reason: string }> = []

  let graphPolicy = await loadGraphPolicy(pp)

  for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
    const chunk = chunks[chunkIdx]
    const chunkLabel = chunks.length > 1 ? `Chunk ${chunkIdx + 1}/${chunks.length} · ` : ""

    // ── Stage 1: 섹션 분해 ────────────────────────────────────────────
    activity.updateItem(activityId, { detail: `${chunkLabel}Stage 1/3: Decomposing document...` })

    const stage1SystemPrompt = buildDecompositionPrompt(dbIndex, chunk, dismissalContext)
    const stage1UserContent = `Decompose this source document into sections with their text.\n\n**File:** ${fileName}${folderContext ? `\n**Folder context:** ${folderContext}` : ""}${chunks.length > 1 ? `\n**Section:** ${chunkIdx + 1} of ${chunks.length}` : ""}\n\nOutput ONLY a JSON object — no prose, no code fences. First character must be \`{\`.\n\n---\n\n${chunk}`

    let stage1Raw = ""
    try {
      stage1Raw = await callCli(llmConfig, stage1SystemPrompt, stage1UserContent, signal, pp)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      activity.updateItem(activityId, { status: "error", detail: `${chunkLabel}Stage 1 failed: ${msg}` })
      throw new Error(`Ingest Stage 1 failed for "${fileName}": ${msg}`)
    }

    invoke("app_debug", { message: `[ingest:stage1] ${chunkLabel}file=${fileName} chars=${stage1Raw.length}` }).catch(() => {})

    let stage1Sections: Stage1Section[] = []
    try {
      const parsed = JSON.parse(stage1Raw.trim().replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?\s*```\s*$/i, "").trim())
      stage1Sections = Array.isArray(parsed) ? parsed : (parsed.sections ?? [])
    } catch {
      invoke("app_debug", { message: `[ingest:stage1] JSON parse failed — raw:\n${stage1Raw}` }).catch(() => {})
    }

    if (stage1Sections.length === 0) {
      const errMsg = `Stage 1 produced no sections. LLM raw output (${stage1Raw.length} chars): ${stage1Raw.slice(0, 2000)}`
      invoke("app_debug", { message: `[ingest:stage1:ERROR] ${chunkLabel}${errMsg}` }).catch(() => {})
      activity.updateItem(activityId, { status: "error", detail: `${chunkLabel}Stage 1 failed: no sections produced` })
      throw new Error(`Ingest Stage 1 failed for "${fileName}": ${errMsg}`)
    }

    // ── Stage 2: 그래프 배정 ─────────────────────────────────────────
    activity.updateItem(activityId, { detail: `${chunkLabel}Stage 2/3: Assigning to graphs...` })

    const stage2SystemPrompt = buildGraphAssignmentPrompt(buildGraphPolicyPrompt(graphPolicy))
    const stage2Scaffold = buildStage2Scaffold(stage1Sections)
    const stage2UserContent = `Read the sections, then fill in the empty fields of each seed assignment below. Do not add or rename any keys inside assignment objects. Use \`source_id\` to refer to source sections; do not copy \`source_text\` into assignments. You may add additional assignment objects using the same schema when one source_text needs multiple graph assignments.\n\nOutput ONLY a JSON object — no prose, no code fences. First character must be \`{\`.\n\n${stage2Scaffold}`

    let stage2Raw = ""
    try {
      stage2Raw = await callCli(llmConfig, stage2SystemPrompt, stage2UserContent, signal, pp)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      activity.updateItem(activityId, { status: "error", detail: `${chunkLabel}Stage 2 CLI call failed: ${msg}` })
      throw new Error(`Ingest Stage 2 CLI call failed for "${fileName}": ${msg}`)
    }

    let parsed: Stage2Assignment[] = []
    try {
      const cleaned = stage2Raw.trim().replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?\s*```\s*$/i, "").trim()
      const obj = JSON.parse(cleaned)
      parsed = hydrateStage2Assignments(
        Array.isArray(obj) ? obj : (obj.assignments ?? []),
        stage1Sections,
      )
    } catch {
      // parse failure — treat as empty
    }

    if (parsed.length === 0) {
      const errMsg = `Stage 2 produced no assignments from ${stage1Sections.length} section(s). LLM raw output (${stage2Raw.length} chars): ${stage2Raw.slice(0, 2000)}`
      invoke("app_debug", { message: `[ingest:stage2:ERROR] ${chunkLabel}${errMsg}` }).catch(() => {})
      activity.updateItem(activityId, { status: "error", detail: `${chunkLabel}Stage 2 failed: no graph assignments produced` })
      throw new Error(`Ingest Stage 2 failed for "${fileName}": ${errMsg}`)
    }

    // 신규 graph와 기존 graph relation type 확장을 즉시 등록
    const policyUpdate = applyStage2GraphPolicyUpdates(parsed, graphPolicy)
    graphPolicy = policyUpdate.policy
    if (policyUpdate.changed) {
      try {
        await saveGraphPolicy(pp, graphPolicy)
      } catch {
        // non-fatal
      }
    }

    // 검증 — 실패한 것은 필터링하고 review item으로 기록
    const failures = validateStage2(parsed, graphPolicy)
    const failedIndexes = new Set(failures.map((f) => f.assignmentIndex))
    const assignments: Stage2Assignment[] = parsed.filter((_, index) => !failedIndexes.has(index))

    if (failures.length > 0) {
      const failureDetail = failures.map((f) => `${f.page_path || f.concept} [${f.graph || "no graph"}]: ${f.reason}`).join("; ")
      invoke("app_debug", { message: `[ingest:stage2:PARTIAL] ${chunkLabel}file=${fileName} skipped=${failures.length} failures=[${failureDetail}] raw_sample=${stage2Raw.slice(0, 500)}` }).catch(() => {})
      allSkippedConcepts.push(...failures.map((f) => ({
        chunk: chunkIdx + 1,
        concept: f.page_path || f.concept,
        reason: `${f.graph ? `${f.graph}: ` : ""}${f.reason}`,
      })))
    }

    const totalRelations = assignments.reduce((sum, a) => sum + (a.relations?.length ?? 0), 0)
    const assignmentsWithRelations = assignments.filter(a => (a.relations?.length ?? 0) > 0).length
    invoke("app_debug", { message: `[ingest:stage2] ${chunkLabel}file=${fileName} assignments=${assignments.length} skipped=${failures.length} withRelations=${assignmentsWithRelations} totalRelations=${totalRelations} sample=${JSON.stringify(assignments.slice(0, 2))}` }).catch(() => {})

    // ── Stage 3: FILE 블록 생성 (코드, LLM 없음) ─────────────────────
    activity.updateItem(activityId, { detail: `${chunkLabel}Stage 3/3: Writing db/ pages...` })

    const generation = buildFileBlocksFromAssignments(assignments, fileName)
    invoke("app_debug", { message: `[ingest:stage3] ${chunkLabel}file=${fileName} blocks=${assignments.length} chars=${generation.length}` }).catch(() => {})

    // ── 파일 쓰기 ─────────────────────────────────────────────────────
    activity.updateItem(activityId, { detail: `${chunkLabel}Writing files...` })

    const { writtenPaths } = await writeFileBlocks(pp, generation)
    invoke("app_debug", { message: `[ingest:write] ${chunkLabel}file=${fileName} written=${writtenPaths.length} [${writtenPaths.join(", ")}]` }).catch(() => {})
    allWrittenPaths.push(...writtenPaths)

    if (writtenPaths.length > 0) {
      const projectName = useWikiStore.getState().project?.name || "default"
      activity.updateItem(activityId, { detail: `${chunkLabel}Syncing knowledge graph...` })
      try {
        const graphSummary = await syncGraphToFalkorDb(pp, projectName, (msg) => {
          activity.updateItem(activityId, { detail: `${chunkLabel}${msg}` })
        })
        invoke("app_debug", { message: `[ingest:graph] ${chunkLabel}${graphSummary}` }).catch(() => {})
      } catch (err) {
        const graphErrMsg = `Knowledge graph sync failed: ${err instanceof Error ? err.message : String(err)}`
        console.warn(`[agent-ingest] ${graphErrMsg}`)
        invoke("app_debug", { message: `[ingest:graph:ERROR] ${chunkLabel}${graphErrMsg}` }).catch(() => {})
        activity.updateItem(activityId, { detail: `${chunkLabel}${graphErrMsg}`, status: "error" })
        return allWrittenPaths
      }
    }
  }

  if (allWrittenPaths.length > 0) {
    try {
      const tree = await listDirectory(pp)
      useWikiStore.getState().setFileTree(tree)
      useWikiStore.getState().bumpDataVersion()
    } catch {
      // non-fatal
    }
  }

  // ── Skipped concepts → review items ──────────────────────────────
  if (allSkippedConcepts.length > 0) {
    const byChunk = new Map<number, typeof allSkippedConcepts>()
    for (const item of allSkippedConcepts) {
      const list = byChunk.get(item.chunk) ?? []
      list.push(item)
      byChunk.set(item.chunk, list)
    }
    for (const [chunk, items] of byChunk) {
      const chunkSuffix = chunks.length > 1 ? ` (chunk ${chunk}/${chunks.length})` : ""
      useReviewStore.getState().addItems([{
        type: "suggestion",
        stage: "primary",
        title: `Stage 2 skipped ${items.length} concept(s): ${fileName}${chunkSuffix}`,
        description: items.map((f) => `- **${f.concept}**: ${f.reason}`).join("\n"),
        sourcePath: sp,
        affectedPages: [],
        options: [{ label: "Dismiss", action: "Dismiss" }],
      }])
    }
  }

  activity.updateItem(activityId, {
    status: allWrittenPaths.length > 0 ? "done" : "error",
    detail: allWrittenPaths.length > 0
      ? `${allWrittenPaths.length} files written`
      : "No files generated",
    filesWritten: allWrittenPaths,
  })

  return allWrittenPaths
}

async function writeFileBlocks(
  projectPath: string,
  text: string,
): Promise<{ writtenPaths: string[] }> {
  const { parseFileBlocks } = await import("./ingest")
  const { blocks } = parseFileBlocks(text)
  const writtenPaths: string[] = []

  for (const { path: rel, content } of blocks) {
    try {
      await writeFile(`${projectPath}/${rel}`, content)
      writtenPaths.push(rel)
    } catch (err) {
      console.warn(`[agent-ingest] write failed for ${rel}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { writtenPaths }
}
