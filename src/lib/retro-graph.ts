import { readFile, writeFile } from "@/commands/fs"
import { streamChat } from "@/lib/llm-client"
import { buildGraphPolicyPrompt, loadGraphPolicy, saveGraphPolicy } from "@/lib/graph-policy"
import { syncGraphToFalkorDb } from "@/lib/graph-sync"
import { listDbFiles } from "@/lib/wiki-graph"
import { normalizePath } from "@/lib/path-utils"
import type { LlmConfig } from "@/stores/wiki-store"
import type { GraphPolicy } from "@/lib/graph-policy"
import type { FileNode } from "@/types/wiki"
import { validateStage2, buildGraphAssignmentPrompt } from "@/lib/ingest"
import type { Stage1Section, Stage2Assignment } from "@/lib/ingest"

function fileNameToId(fileName: string): string {
  return fileName.replace(/\.md$/i, "")
}

function extractFrontmatterGraph(content: string): string | null {
  const m = content.match(/^---\n[\s\S]*?^graph:\s*["']?(.+?)["']?\s*$/m)
  return m?.[1]?.trim() || null
}

function extractTitle(content: string, fileName: string): string {
  const fm = content.match(/^---\n[\s\S]*?^title:\s*["']?(.+?)["']?\s*$/m)
  if (fm) return fm[1].trim()
  const h1 = content.match(/^#\s+(.+)$/m)
  if (h1) return h1[1].trim()
  return fileNameToId(fileName).replace(/_/g, " ")
}

function insertGraphFrontmatter(content: string, graphName: string): string {
  const fmMatch = content.match(/^(---\n)([\s\S]*?)(\n---)/)
  if (!fmMatch) return content
  const [, open, body, close] = fmMatch
  if (/^graph:\s*/m.test(body)) {
    return content.replace(fmMatch[0], `${open}${body.replace(/^graph:\s*.*/m, `graph: ${graphName}`)}${close}`)
  }
  return content.replace(fmMatch[0], `${open}${body}\ngraph: ${graphName}${close}`)
}

function appendRelatedSection(content: string, wikilinks: string[]): string {
  if (wikilinks.length === 0) return content

  const existing = new Set<string>()
  const existingRegex = /\[\[([^\]|]+)\|[^\]]+\]\]/g
  let m: RegExpExecArray | null
  while ((m = existingRegex.exec(content)) !== null) {
    existing.add(m[1].trim().toLowerCase())
  }

  const fresh = wikilinks.filter((link) => {
    const targetMatch = link.match(/\[\[([^\]|]+)\|/)
    if (!targetMatch) return false
    return !existing.has(targetMatch[1].trim().toLowerCase())
  })
  if (fresh.length === 0) return content

  const section = `\n\n## Related\n\n${fresh.join("\n")}`
  return content.trimEnd() + section
}


async function retroGraphFile(
  file: FileNode,
  projectName: string,
  policy: GraphPolicy,
  llmConfig: LlmConfig,
  signal?: AbortSignal,
): Promise<{ result: "patched" | "skipped"; updatedPolicy: GraphPolicy }> {
  let content: string
  try {
    content = await readFile(file.path)
  } catch {
    return { result: "skipped", updatedPolicy: policy }
  }

  const needsGraph = !extractFrontmatterGraph(content)
  const hasTypedLinks = /\[\[[^\]|]+\|[^\]]+\]\]/.test(content)
  if (!needsGraph && hasTypedLinks) return { result: "skipped", updatedPolicy: policy }

  // Stage 1 is skipped for retro-graph: the page content is already the source.
  // Wrap it directly as a Stage1Section so Stage 2 can read source_text and decide
  // graph assignment + relation types from the original content.
  const section: Stage1Section = {
    source_range: file.path,
    source_text: content.slice(0, 1200),
  }

  // ── Stage 2: 그래프 배정 (JSON + loop) ──────────────────────────────
  const MAX_RETRIES = 3
  let assignments: Stage2Assignment[] = []
  let currentPolicy = policy
  let sectionsToAssign: Stage1Section[] = [section]
  let retryCount = 0

  while (retryCount <= MAX_RETRIES) {
    const policyPrompt = buildGraphPolicyPrompt(currentPolicy)
    let stage2Raw = ""
    await streamChat(
      llmConfig,
      [
        { role: "system", content: buildGraphAssignmentPrompt(policyPrompt) },
        {
          role: "user",
          content: retryCount === 0
            ? `Assign this section to a graph:\n\n${JSON.stringify(sectionsToAssign, null, 2)}`
            : `Re-assign. Previous attempt failed validation:\n\n${JSON.stringify(sectionsToAssign, null, 2)}`,
        },
      ],
      {
        onToken: (token) => { stage2Raw += token },
        onDone: () => {},
        onError: () => {},
      },
      signal,
      { temperature: 0.1, max_tokens: 1024, response_format: { type: "json_object" } },
    )

    let parsed: Stage2Assignment[] = []
    try {
      const obj = JSON.parse(stage2Raw)
      parsed = Array.isArray(obj) ? obj : (obj.assignments ?? [])
    } catch {
      // parse failure — retry
    }

    // Register new graphs immediately
    for (const item of parsed) {
      if (item.new_graph && item.graph && !currentPolicy.managedGraphs.includes(item.graph)) {
        const newTypes = Array.isArray(item.graph_relation_types) ? item.graph_relation_types.slice(0, 4) : []
        currentPolicy = {
          ...currentPolicy,
          managedGraphs: [...currentPolicy.managedGraphs, item.graph],
          graphRelationTypes: { ...currentPolicy.graphRelationTypes, [item.graph]: newTypes },
        }
      }
    }

    assignments = parsed
    const failures = validateStage2(assignments, currentPolicy)
    if (failures.length === 0 || retryCount >= MAX_RETRIES) break

    retryCount++
  }

  if (assignments.length === 0) return { result: "skipped", updatedPolicy: currentPolicy }

  // Save policy if new graphs were added
  if (currentPolicy !== policy) {
    try {
      await saveGraphPolicy(normalizePath(file.path.split("/db/")[0] ?? ""), currentPolicy)
    } catch {
      // non-fatal
    }
  }

  // ── Stage 3: 파일 패치 (frontmatter + wikilinks) ──────────────────
  const primary = assignments[0]
  const graphName = primary?.graph && primary.graph !== "skip" ? primary.graph : null

  const wikilinks: string[] = []
  for (const item of assignments) {
    for (const rel of item.relations ?? []) {
      if (rel.target && rel.type) {
        wikilinks.push(`[[${rel.target}|${rel.type}]]`)
      }
    }
  }

  let patched = content
  if (needsGraph && graphName) {
    patched = insertGraphFrontmatter(patched, graphName)
  }
  patched = appendRelatedSection(patched, wikilinks)

  if (patched === content) return { result: "skipped", updatedPolicy: currentPolicy }

  await writeFile(file.path, patched)
  return { result: "patched", updatedPolicy: currentPolicy }
}

export async function runRetroGraph(
  projectPath: string,
  projectName: string,
  llmConfig: LlmConfig,
  onProgress?: (current: number, total: number, fileName: string) => void,
  signal?: AbortSignal,
): Promise<{ patched: number; skipped: number }> {
  const pp = normalizePath(projectPath)
  let policy = await loadGraphPolicy(pp)

  const files = await listDbFiles(pp)
  let patched = 0
  let skipped = 0

  for (let i = 0; i < files.length; i++) {
    if (signal?.aborted) break
    const file = files[i]
    onProgress?.(i + 1, files.length, file.name)

    const { result, updatedPolicy } = await retroGraphFile(file, projectName, policy, llmConfig, signal)

    // Propagate any newly registered graphs to subsequent iterations
    policy = updatedPolicy

    if (result === "patched") {
      patched++
      // 다음 파일 처리 전에 FalkorDB sync — 이 파일의 노드/엣지가 다음 파일의 컨텍스트에 반영됨
      await syncGraphToFalkorDb(pp, projectName, undefined, new Set([file.path]))
    } else {
      skipped++
    }
  }

  return { patched, skipped }
}
