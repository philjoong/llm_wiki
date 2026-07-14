import { readFile, writeFile, listDirectory } from "@/commands/fs"
import { invoke } from "@tauri-apps/api/core"
import { streamChat, isCliProvider } from "@/lib/llm-client"
import { streamClaudeCodeCli } from "@/lib/claude-cli-transport"
import { streamGeminiCli } from "@/lib/gemini-cli-transport"
import { streamCodexCli } from "@/lib/codex-cli-transport"
import type { ChatMessage } from "@/lib/llm-providers"
import type { LlmConfig } from "@/stores/wiki-store"
import { useWikiStore } from "@/stores/wiki-store"
import { useActivityStore } from "@/stores/activity-store"
import { useReviewStore, type ReviewItem } from "@/stores/review-store"
import { getFileName, normalizePath } from "@/lib/path-utils"
import { checkIngestCache, saveIngestCache } from "@/lib/ingest-cache"
import { withProjectLock } from "@/lib/project-mutex"
import { buildLanguageDirective } from "@/lib/output-language"
import { detectLanguage } from "@/lib/detect-language"
import { parseSourceRefs, SourceRefValidationError } from "@/lib/sources-merge"
import { listKnowledgeGraphs, listKnowledgeRelationTypes, discardSectionAssertions, registerGraph } from "@/commands/knowledge"
import {
  loadRejectionLog,
  findRelatedRejections,
  formatDismissalContext,
} from "@/lib/counterexample-index"
import type { ModificationProposal } from "@/stores/review-store"
import type { FileNode } from "@/types/wiki"
import { loadDataTypes } from "@/lib/data-types"
import { createPageId, createSectionId } from "@/lib/knowledge/ids"
import { parseMarkdownV2, reconcileMarkdownV2, serializeMarkdownV2 } from "@/lib/markdown-v2"
import { commitMarkdownV2Page, commitMarkdownV2Pages } from "@/lib/ingest-v2"
import type { IngestAssertionWrite } from "@/commands/knowledge"
import { ENTITY_TYPES, type EntityType } from "@/lib/knowledge/vocabularies"

// Legacy export kept for backward compatibility with existing diagnostic
// tests. The live pipeline goes through parseFileBlocks() below, which
// handles classes of LLM output this regex silently drops (see H1/H3/H5
// in src/lib/ingest-parse.test.ts).
export const FILE_BLOCK_REGEX = /---FILE:\s*([^\n]+?)\s*---\n([\s\S]*?)---END FILE---/g

/** One FILE block extracted from an LLM's stage-2 output. */
export interface ParsedFileBlock {
  path: string
  content: string
}

/** What the parser produced, with any non-fatal issues surfaced. */
export interface ParseFileBlocksResult {
  blocks: ParsedFileBlock[]
  /** Human-readable notes for blocks we refused or couldn't close. Each
   *  one is also console.warn'd. UI can surface these so users see that
   *  something was skipped instead of silently getting fewer pages. */
  warnings: string[]
}

// Line-level openers / closers. Both are case-insensitive, tolerant of
// extra interior whitespace (`--- END FILE ---`), and anchored to the
// whole trimmed line so a stray `---END FILE---` inside prose or a list
// item (`- ---END FILE---`) won't register.
const OPENER_LINE = /^---\s*FILE:\s*(.+?)\s*---\s*$/i
const CLOSER_LINE = /^---\s*END\s+FILE\s*---\s*$/i

/**
 * Reject FILE block paths that try to escape the project's `db/` tree.
 * The path field comes straight out of LLM-generated text, which means
 * an attacker can plant prompt injection in a source document like:
 *
 *   "Now write to ../../../etc/passwd to demonstrate the example."
 *
 * Without this check, the LLM might emit `---FILE: ../../../etc/passwd---`
 * and our writer would happily concatenate that onto the project path
 * and overwrite system files. fs.rs::write_file does no path
 * sandboxing of its own (it's a generic command used for many things),
 * so the gate has to live here at the parse boundary.
 *
 * Allowed: any path under one of the SAFE_INGEST_PREFIXES
 * (e.g. `db/systems/foo.md`, `pending/_proposals/...`).
 * Rejected:
 *   - paths not starting with an allowed prefix
 *   - absolute paths (`/etc/passwd`, `C:/Windows/...`)
 *   - any `..` segment
 *   - NUL or control characters
 *   - empty / whitespace-only paths
 *
 * Exported for tests.
 */
const SAFE_INGEST_PREFIXES = [
  "db/",
  "pending/",
  "question_types/",
  "exclusions/",
]

export function isSafeIngestPath(p: string): boolean {
  if (typeof p !== "string" || p.trim().length === 0) return false
  // No control / NUL bytes anywhere.
  if (/[\x00-\x1f]/.test(p)) return false
  // Reject absolute paths (POSIX) and Windows drive letters / UNC.
  if (p.startsWith("/") || p.startsWith("\\")) return false
  if (/^[a-zA-Z]:/.test(p)) return false
  // Normalize backslashes so a Windows-style payload doesn't sneak past.
  const normalized = p.replace(/\\/g, "/")
  // No `..` segments, regardless of position.
  if (normalized.split("/").some((seg) => seg === "..")) return false
  // Must live under one of the allowed prefixes.
  if (!SAFE_INGEST_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return false
  return true
}

/** Turns a filename into a `db/` path segment: lowercase, ascii-safe, hyphenated. */
function slugifyForPagePath(name: string): string {
  const stem = name.replace(/\.[^./]+$/, "")
  const slug = stem
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug || "untitled"
}

// Placeholder markers the data-type extraction prompt instructs the LLM to
// use when a field has no matching content in the source. A field body
// entirely made of these (plus whitespace/list bullets) contributes no
// real information.
const EMPTY_FIELD_MARKERS = ["정보 없음", "정보없음", "n/a", "없음", "none", "no information", "not found", "not available"]

/**
 * True when a data-type extraction produced nothing usable: every `##`
 * field section is blank or only contains an empty-field placeholder.
 * Used to skip document/graph creation for chunks that matched no real
 * data instead of writing a page full of "정보 없음".
 */
function isEmptyDataTypeExtraction(markdown: string): boolean {
  const fieldBodies = markdown
    .split(/^##\s+.*$/m)
    .slice(1) // drop text before the first heading (if any)
  const sections = fieldBodies.length > 0 ? fieldBodies : [markdown]

  return sections.every((body) => {
    const cleaned = body
      .replace(/^[-*]\s*/gm, "") // strip list bullets
      .trim()
      .toLowerCase()
    if (cleaned.length === 0) return true
    return EMPTY_FIELD_MARKERS.some((marker) => cleaned === marker)
  })
}

// Fence delimiters per CommonMark (triple+ backticks or tildes). Leading
// indentation ≤ 3 spaces is still a fence; 4+ spaces is an indented code
// block and doesn't use fence markers.
const FENCE_LINE = /^\s{0,3}(```+|~~~+)/

/**
 * Parse an LLM stage-2 generation into FILE blocks.
 *
 * Known hazards the naive `---FILE:...---END FILE---` regex walks into
 * (all reproduced as fixtures in src/lib/ingest-parse.test.ts):
 *
 *   H1. Windows CRLF line endings — regex anchored on bare `\n` missed
 *       every block.
 *   H2. Stream truncation — the last block's closing `---END FILE---`
 *       never arrived; the entire block was silently dropped with no
 *       logging.
 *   H3. Marker whitespace / case variants — `--- END FILE ---`,
 *       `---end file---`, `--- FILE: path ---`, `---FILE: foo--- \n`
 *       (trailing space) all made the regex fail.
 *   H5. Literal `---END FILE---` inside a fenced code block (e.g. when
 *       the LLM is writing a concept page about our own ingest format)
 *       — lazy match stopped at the first occurrence, truncating the
 *       page and dumping all subsequent real content into no-man's-land.
 *   H6. Empty path — block matched but was silently dropped by a
 *       downstream `!path` check.
 *
 * This parser fixes every one except H2 (which is fundamentally a
 * stream-budget problem), and at least surfaces H2 as a warning so the
 * user isn't left wondering why a page is missing.
 */
export function parseFileBlocks(text: string): ParseFileBlocksResult {
  // H1 fix: normalize CRLF to LF before anything else. Cheap and
  // covers the case where a proxy / server / LLM inserts Windows line
  // endings into the stream.
  const normalized = text.replace(/\r\n/g, "\n")
  const lines = normalized.split("\n")

  const blocks: ParsedFileBlock[] = []
  const warnings: string[] = []

  let i = 0
  while (i < lines.length) {
    const openerMatch = OPENER_LINE.exec(lines[i])
    if (!openerMatch) {
      i++
      continue
    }
    const path = openerMatch[1].trim()
    i++ // consume opener

    const contentLines: string[] = []
    let fenceMarker: string | null = null // tracks whether we're inside ``` or ~~~
    let fenceLen = 0
    let closed = false

    while (i < lines.length) {
      const line = lines[i]

      // H5 fix: update fence state before checking closer. Only close
      // the fence when we see the same character repeated at least as
      // many times — CommonMark rule. This lets docs-about-our-format
      // quote `---END FILE---` inside code fences without truncating
      // the outer block.
      const fenceMatch = FENCE_LINE.exec(line)
      if (fenceMatch) {
        const run = fenceMatch[1]
        const char = run[0] // '`' or '~'
        const len = run.length
        if (fenceMarker === null) {
          fenceMarker = char
          fenceLen = len
        } else if (char === fenceMarker && len >= fenceLen) {
          fenceMarker = null
          fenceLen = 0
        }
        contentLines.push(line)
        i++
        continue
      }

      // A line matching the closer ONLY counts when we're outside any
      // code fence. Inside a fence, treat it as ordinary body text.
      if (fenceMarker === null && CLOSER_LINE.test(line)) {
        closed = true
        i++
        break
      }

      contentLines.push(line)
      i++
    }

    if (!closed) {
      // H2 fix (partial): we can't fabricate content the LLM never
      // sent, but we surface the drop instead of silently hiding it.
      const pathLabel = path || "(unnamed)"
      const msg = `FILE block "${pathLabel}" was not closed before end of stream — likely truncation (model hit max_tokens, timeout, or connection dropped). Block dropped.`
      console.warn(`[ingest] ${msg}`)
      warnings.push(msg)
      continue
    }

    if (!path) {
      // H6 fix: surface empty-path blocks.
      const msg = `FILE block with empty path skipped (LLM omitted the path after \`---FILE:\`).`
      console.warn(`[ingest] ${msg}`)
      warnings.push(msg)
      continue
    }

    if (!isSafeIngestPath(path)) {
      // Path-traversal guard. Drops blocks whose path tries to escape
      // the allowed prefixes — see isSafeIngestPath for the threat model.
      const msg = `FILE block with unsafe path "${path}" rejected (must be under db/, pending/, question_types/, or exclusions/; no .., no absolute paths).`
      console.warn(`[ingest] ${msg}`)
      warnings.push(msg)
      continue
    }

    blocks.push({ path, content: contentLines.join("\n") })
  }

  return { blocks, warnings }
}

// Decomposition SECTION markers. Mirror the FILE-block markers above:
// line-anchored, case-insensitive, tolerant of interior whitespace. The
// `source_range` rides on the opener line (it's a single-line locator —
// heading path / sheet+range / timestamp); the body between the markers
// is VERBATIM source text. Verbatim text is exactly why decomposition left
// JSON behind (Fix 25): markdown escapes like `\[`, `\]`, `\(`, `\)` are
// invalid JSON escape sequences and made JSON.parse throw, silently dropping
// the whole chunk. A delimiter format carries any bytes without escaping.
const SECTION_OPENER_LINE = /^---\s*SECTION:\s*(.*?)\s*---\s*$/i
const SECTION_CLOSER_LINE = /^---\s*END\s+SECTION\s*---\s*$/i

/**
 * Parse a decomposition response into sections.
 *
 * Deliberately NOT code-fence-aware (unlike parseFileBlocks): the body is
 * arbitrary verbatim source markdown that may contain unbalanced ``` fences,
 * and a fence tracker would then swallow the `---END SECTION---` closer and
 * drop the block. A literal `---END SECTION---` line appearing inside real
 * source text is vanishingly unlikely, so "close on the first closer line"
 * is the safer trade for verbatim content.
 *
 * Truncation-tolerant: an unclosed trailing block still yields its body —
 * a stream cut mid-section just produces a shorter (still usable) source_text
 * rather than dropping the section entirely.
 *
 * Exported for tests.
 */
export function parseDecomposedSections(text: string): DecomposedSection[] {
  const normalized = text.replace(/\r\n/g, "\n")
  const lines = normalized.split("\n")
  const sections: DecomposedSection[] = []

  let i = 0
  while (i < lines.length) {
    const opener = SECTION_OPENER_LINE.exec(lines[i])
    if (!opener) {
      i++
      continue
    }
    // opener[1] format: "source_range | page_path" or just "source_range"
    const openerText = opener[1].trim()
    const pipeIdx = openerText.lastIndexOf(" | db/")
    let sourceRange: string
    let pagePath: string | undefined
    if (pipeIdx >= 0) {
      sourceRange = openerText.slice(0, pipeIdx).trim()
      pagePath = openerText.slice(pipeIdx + 3).trim() // " | " → skip 3 chars
    } else {
      sourceRange = openerText
      pagePath = undefined
    }
    i++ // consume opener

    const bodyLines: string[] = []
    while (i < lines.length) {
      if (SECTION_CLOSER_LINE.test(lines[i])) {
        i++ // consume closer
        break
      }
      bodyLines.push(lines[i])
      i++
    }

    const sourceText = bodyLines.join("\n").trim()
    if (sourceText.length === 0) continue // too thin to be meaningful
    sections.push({ source_range: sourceRange, source_text: sourceText, page_path: pagePath })
  }

  return sections
}

/**
 * Build the language rule for ingest prompts.
 * Uses the user's configured output language, falling back to source content detection.
 */
export function languageRule(sourceContent: string = ""): string {
  return buildLanguageDirective(sourceContent)
}

/**
 * Maximum source-content size sent to the LLM in a single ingest round.
 * Larger sources are split into chunks so each round produces a tractable
 * number of FILE blocks within `max_tokens`. Without chunking, big sources
 * truncated mid-block ("FILE … not closed before end of stream") and the
 * parser dropped the entire trailing block — leading to autoIngest
 * returning zero files and the queue runner throwing "Ingest produced no
 * output files". 20000 chars ≈ 5–8k tokens depending on script, leaving
 * room for the system prompts (dbIndex + dismissals) and the
 * FILE-block output.
 */
const MAX_CHUNK_CHARS = 8000

/**
 * Recursively split content into chunks ≤ maxChars, preferring to break
 * on markdown structural boundaries (level-2/3 headers, then paragraphs,
 * then lines, then spaces). Falls back to a hard char split as a last
 * resort. Each separator is kept on the leading edge of the next chunk
 * so headers stay attached to their bodies.
 *
 * Returns a single-element array when content already fits.
 *
 * Exported for tests.
 */
export function chunkSourceContent(content: string, maxChars: number = MAX_CHUNK_CHARS): string[] {
  if (content.length <= maxChars) return [content]
  const separators = ["\n## ", "\n### ", "\n\n", "\n", " "]
  return splitRecursive(content, maxChars, separators, 0)
}

function splitRecursive(text: string, maxChars: number, separators: string[], sepIdx: number): string[] {
  if (text.length <= maxChars) return [text]
  if (sepIdx >= separators.length) {
    // Last resort: hard char split. Loses semantic boundaries but beats
    // throwing on a single unbroken 100k-char run with no whitespace.
    const out: string[] = []
    for (let i = 0; i < text.length; i += maxChars) {
      out.push(text.slice(i, i + maxChars))
    }
    return out
  }
  const parts = splitKeepLeading(text, separators[sepIdx])
  const out: string[] = []
  let cur = ""
  for (const part of parts) {
    if (part.length > maxChars) {
      // This single part is bigger than the budget — flush whatever we
      // were accumulating, then sub-split it with the next finer separator.
      if (cur.length > 0) {
        out.push(cur)
        cur = ""
      }
      out.push(...splitRecursive(part, maxChars, separators, sepIdx + 1))
    } else if ((cur + part).length > maxChars) {
      // Adding this part would overflow — start a new chunk.
      if (cur.length > 0) out.push(cur)
      cur = part
    } else {
      cur += part
    }
  }
  if (cur.length > 0) out.push(cur)
  return out
}

function splitKeepLeading(text: string, sep: string): string[] {
  const parts = text.split(sep)
  if (parts.length === 1) return parts
  // First piece has no leading separator (it's whatever preceded the
  // first occurrence). Subsequent pieces re-attach the separator so
  // headers like "## Foo" survive the split and remain valid markdown.
  const result: string[] = []
  if (parts[0].length > 0) result.push(parts[0])
  for (let i = 1; i < parts.length; i++) {
    if (parts[i].length > 0) result.push(sep + parts[i])
  }
  return result
}

/**
 * Auto-ingest: reads source → LLM analyzes → LLM writes wiki pages, all in one go.
 * Used when importing new files.
 *
 * Concurrency: this function holds a per-project lock for its full
 * duration. Two simultaneous calls for the same project (e.g. queue
 * + Save-to-Wiki) take turns. The lock is necessary because the
 * analysis stage reads `wiki/index.md` and the generation stage
 * overwrites it; without serialization, each call would emit an
 * "updated" index based on the same pre-state and overwrite each
 * other's additions.
 *
 * Large sources: split into chunks of `MAX_CHUNK_CHARS` and processed
 * one chunk at a time so each LLM round emits a tractable number of
 * FILE blocks within max_tokens. dbIndex is refreshed between chunks
 * so later chunks see what earlier ones wrote (path-collision avoidance
 * + Stage-4 modification flow on real conflicts).
 */
// Set by autoIngestImpl right before it returns zero files for a data-type
// ingest whose chunks legitimately matched none of the data type's fields.
// ingest-queue.ts reads it via consumeEmptyDataTypeFlag() immediately after
// autoIngest resolves to tell that outcome apart from a real failure — see
// autoIngest's doc comment for why this can't just be an extra return value.
let emptyDataTypeMatchFlag = false

/**
 * One-shot read of emptyDataTypeMatchFlag: returns its value and resets it
 * to false. Exported for ingest-queue.ts; each ingest task consumes the
 * flag left by its own autoIngest call before the next task can set it —
 * the queue processes one task at a time, so there's no cross-task races.
 */
export function consumeEmptyDataTypeFlag(): boolean {
  const value = emptyDataTypeMatchFlag
  emptyDataTypeMatchFlag = false
  return value
}

export async function autoIngest(
  projectPath: string,
  sourcePath: string,
  llmConfig: LlmConfig,
  signal?: AbortSignal,
  folderContext?: string,
  dataTypeId?: string,
): Promise<string[]> {
  // Single pipeline for all providers. The only provider-specific
  // divergence — how the model is asked to emit JSON — is isolated in
  // callModel(): HTTP providers use response_format, local-CLI coding
  // agents disable tools and rely on a "JSON only" prompt instruction.
  return withProjectLock(normalizePath(projectPath), () =>
    autoIngestImpl(projectPath, sourcePath, llmConfig, signal, folderContext, dataTypeId),
  )
}

/**
 * Single model-call entry point for the ingest pipeline. Returns the
 * model's raw text and throws on transport error so the per-chunk
 * isolation in autoIngestImpl can catch it and skip just that chunk.
 *
 * Provider divergence lives here and nowhere else:
 *  - HTTP providers enforce JSON via `response_format: json_object`.
 *  - Local-CLI coding agents (claude-code/gemini-cli/codex-cli) can't set
 *    response_format and will invoke Read/Write/Edit tools if left to
 *    their own devices, so we spawn them with tools disabled and lean on
 *    the prompt's explicit "JSON only" instruction instead.
 */
async function callModel(
  llmConfig: LlmConfig,
  systemPrompt: string,
  userContent: string,
  signal: AbortSignal | undefined,
  projectPath: string,
  maxTokens?: number,
  // Decomposition emits a delimiter-based SECTION format (not JSON) so
  // verbatim source_text never has to round-trip through a JSON string.
  // When false, we must NOT force `response_format: json_object` on HTTP
  // providers — that would make the model wrap the SECTION blocks in JSON.
  // CLI providers ignore response_format either way.
  jsonMode: boolean = true,
): Promise<string> {
  if (isCliProvider(llmConfig.provider)) {
    let buffer = ""
    await new Promise<void>((resolve, reject) => {
      const cb = {
        onToken: (token: string) => { buffer += token },
        onDone: () => resolve(),
        onError: (err: Error) => reject(err),
      }
      // CLI transports have no system role; prepend it to the user turn.
      const combined: ChatMessage[] = [{ role: "user", content: `${systemPrompt}\n\n${userContent}` }]
      let transport: Promise<void>
      if (llmConfig.provider === "gemini-cli") {
        transport = streamGeminiCli(llmConfig, combined, cb, signal)
      } else if (llmConfig.provider === "codex-cli") {
        transport = streamCodexCli(llmConfig, combined, cb, signal)
      } else {
        // claude-code: keep the system prompt separate so we can also pass
        // disableTools + cwd as spawn options.
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

  let buffer = ""
  const errors: Error[] = []
  await streamChat(
    llmConfig,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    {
      onToken: (token) => { buffer += token },
      onDone: () => {},
      onError: (err) => { errors.push(err) },
    },
    signal,
    { temperature: 0.1, ...(jsonMode ? { response_format: { type: "json_object" as const } } : {}), ...(maxTokens ? { max_tokens: maxTokens } : {}) },
  )
  if (errors.length > 0) throw errors[0]
  return buffer
}

/** Instruction appended to every stage's user turn so CLI coding agents
 * emit a bare JSON object instead of prose or tool calls. Harmless for
 * HTTP providers, which already get response_format. */
/** Decomposition counterpart to JSON_ONLY_INSTRUCTION. Decomposition emits a
 * delimiter-based SECTION format instead of JSON so verbatim source_text
 * (which routinely contains JSON-hostile markdown escapes like `\[` and
 * `\(`) never has to be escaped or round-tripped through a JSON string. */
const SECTION_ONLY_INSTRUCTION =
  "Output ONLY `---SECTION: ...---` / `---END SECTION---` blocks — no JSON, no prose, no outer code fence. The first characters of your response must be `---SECTION:`."

export async function autoIngestImpl(
  projectPath: string,
  sourcePath: string,
  llmConfig: LlmConfig,
  signal?: AbortSignal,
  folderContext?: string,
  dataTypeId?: string,
): Promise<string[]> {
  const pp = normalizePath(projectPath)
  const sp = normalizePath(sourcePath)
  const activity = useActivityStore.getState()
  const fileName = getFileName(sp)
  const activityId = activity.addItem({
    type: "ingest",
    title: fileName,
    status: "running",
    detail: "Reading source...",
    filesWritten: [],
  })

  const sourceContent = await tryReadFile(sp)

  // ── Cache check: skip re-ingest if source content hasn't changed ──
  const cachedFiles = await checkIngestCache(pp, fileName, sourceContent)
  if (cachedFiles !== null) {
    activity.updateItem(activityId, {
      status: "done",
      detail: `Skipped (unchanged) — ${cachedFiles.length} files from previous ingest`,
      filesWritten: cachedFiles,
    })
    return cachedFiles
  }

  // Ingest receives the markdown/raw source artifact that lives under
  // `raw/sources/<name>.md`. No separate processed_1 step runs here.

  // Build a compact db/ index string to inject into both prompts. We
  // skip empty / .gitkeep entries; the LLM only needs to see what real
  // pages already live there.
  const dbIndex = await buildDbIndex(pp)

  // Dismissal context — load prior dismissals (rejection log) so the
  // analysis prompt can re-apply the user's earlier decisions instead of
  // re-proposing the same modification card every time the source is
  // re-ingested. `pending/` is intentionally not loaded — those entries
  // are awaiting human triage and shouldn't bias the model.
  const rejectionLog = await loadRejectionLog(pp)
  const relevantRejections = findRelatedRejections(rejectionLog, fileName)
  const dismissalContext = formatDismissalContext(relevantRejections)

  // Split oversized sources into chunks. Small files run as a single
  // chunk (length 1) — semantically identical to the pre-chunking flow.
  const chunks = chunkSourceContent(sourceContent)

  const allWrittenPaths: string[] = []
  const allHardFailures: string[] = []
  const allWarnings: string[] = []
  const allProposals: ModificationProposal[] = []
  const allReviewItems: Omit<ReviewItem, "id" | "resolved" | "createdAt">[] = []
  // Chunk-level failures are isolated: a chunk that fails decomposition or
  // graph assignment is recorded here and skipped so the remaining chunks
  // still ingest. The whole document no longer aborts on the first bad chunk.
  const failedChunks: Array<{ chunk: number; stage: string; error: string }> = []
  // Chunks where the data-type extraction legitimately found nothing (all
  // fields empty/placeholder). Tracked separately from failedChunks — this
  // isn't an error, just "this chunk doesn't match this data type".
  const emptyDataTypeChunks: number[] = []
  // dbIndex is refreshed between chunks so later chunks see what earlier
  // chunks wrote — this lets the LLM align paths with what already exists
  // and routes real overwrite conflicts through the modification-proposal
  // flow instead of clobbering pages chunk-1 just generated.
  let currentDbIndex = dbIndex

  for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
    const chunk = chunks[chunkIdx]
    const chunkLabel = chunks.length > 1 ? `Chunk ${chunkIdx + 1}/${chunks.length} · ` : ""
    const writtenBeforeChunk = allWrittenPaths.length

    // ── Decomposition — extract concepts + relations ────────
    // When a data type is selected, decomposition is replaced by a
    // structured extraction pass: the LLM fills each field defined in the
    // data type YAML and produces a single md file. The result is fed to
    // graph assignment as a single section, identical to the standard path.
    activity.updateItem(activityId, { detail: `${chunkLabel}${dataTypeId ? "Extracting structured fields..." : "Decomposing document..."}` })

    let decompositionRaw = ""
    if (dataTypeId) {
      // ── Decomposition replacement: structured extraction via data type ────
      let dataType: import("@/lib/data-types").DataType | undefined
      try {
        const allDataTypes = await loadDataTypes(pp)
        dataType = allDataTypes.find((dt) => dt.id === dataTypeId)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`[ingest] failed to load data types for "${dataTypeId}": ${msg}`)
        throw new Error(`Data type "${dataTypeId}" could not be loaded: ${msg}`)
      }

      if (dataType) {
        const fieldsBlock = Object.entries(dataType.fields)
          .map(([k, v]) => `- **${k}**: ${v}`)
          .join("\n")
        const systemPrompt = `You are extracting structured information from a document according to a predefined schema.\n\nExtract the following fields from the document. If a field cannot be found, write "정보 없음" (or "N/A" if the document language is English).\n\nSchema: **${dataType.name}**\n${dataType.description ? `Description: ${dataType.description}\n` : ""}Fields to extract:\n${fieldsBlock}\n\nOutput a single markdown document with each field as a ## heading followed by the extracted content. Do NOT wrap your response in a code fence.`
        try {
          decompositionRaw = await callModel(
            llmConfig,
            systemPrompt,
            `Extract structured fields from this document.\n\n**File:** ${fileName}${folderContext ? `\n**Folder context:** ${folderContext}` : ""}${chunks.length > 1 ? `\n**Section:** ${chunkIdx + 1} of ${chunks.length}` : ""}\n\n---\n\n${chunk}`,
            signal,
            pp,
            16000,
            false,
          )
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          activity.updateItem(activityId, { detail: `${chunkLabel}Decomposition (data type extraction) failed: ${msg} — skipping chunk` })
          failedChunks.push({ chunk: chunkIdx + 1, stage: "decomposition (data type extraction)", error: msg })
          continue
        }

        if (isEmptyDataTypeExtraction(decompositionRaw)) {
          activity.updateItem(activityId, { detail: `${chunkLabel}No "${dataType.name}" data found — skipping chunk` })
          emptyDataTypeChunks.push(chunkIdx + 1)
          continue
        }

        // Wrap the extracted md as a single SECTION with a page_path fixed
        // to this data type + source file. Without a page_path, decomposition
        // would fail this chunk instead of writing a file — this branch fixes
        // the path up front so exactly one document is produced per
        // (data type, source file), instead of relying on the LLM to assign one.
        const dataTypePagePath = `db/${dataTypeId}/${slugifyForPagePath(fileName)}.md`
        decompositionRaw = `---SECTION: ${fileName} | ${dataTypePagePath}---\n${decompositionRaw}\n---END SECTION---`
      } else {
        const msg = `Data type "${dataTypeId}" not found. Ingest stopped instead of falling back to standard decomposition.`
        console.warn(`[ingest] ${msg}`)
        activity.updateItem(activityId, { status: "error", detail: msg })
        throw new Error(msg)
      }
    }

    if (!decompositionRaw) {
      try {
        decompositionRaw = await callModel(
          llmConfig,
          buildDecompositionPrompt(currentDbIndex, chunk, dismissalContext),
          `Decompose this source document into SECTION blocks with their verbatim text.\n\n**File:** ${fileName}${folderContext ? `\n**Folder context:** ${folderContext}` : ""}${chunks.length > 1 ? `\n**Section:** ${chunkIdx + 1} of ${chunks.length}` : ""}\n\n${SECTION_ONLY_INSTRUCTION}\n\n---\n\n${chunk}`,
          signal,
          pp,
          16000,
          false, // Decomposition uses the SECTION delimiter format, not JSON.
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        activity.updateItem(activityId, { detail: `${chunkLabel}Decomposition failed: ${msg} — skipping chunk` })
        failedChunks.push({ chunk: chunkIdx + 1, stage: "decomposition (model call)", error: msg })
        continue
      }
    }

    invoke("app_debug", { message: `[ingest:decomposition] ${chunkLabel}file=${fileName} chars=${decompositionRaw.length}` }).catch(() => {})

    const decomposedSections = parseDecomposedSections(decompositionRaw)

    if (decomposedSections.length === 0) {
      const errMsg = `Decomposition produced no sections. LLM raw output (${decompositionRaw.length} chars): ${decompositionRaw.slice(0, 2000)}`
      invoke("app_debug", { message: `[ingest:decomposition:ERROR] ${chunkLabel}${errMsg}` }).catch(() => {})
      activity.updateItem(activityId, { detail: `${chunkLabel}Decomposition failed: no sections produced — skipping chunk` })
      failedChunks.push({ chunk: chunkIdx + 1, stage: "decomposition (no sections)", error: `no parseable sections from ${decompositionRaw.length} chars of output` })
      continue
    }

    // Decomposition must assign a page_path to every section — graph
    // assignment (and the file write it depends on) has no other way to
    // know where a section belongs. A section missing a safe page_path
    // means the model didn't follow the SECTION format; fail this chunk
    // instead of guessing a path for it.
    const sectionsMissingPath = decomposedSections.filter((s) => !s.page_path || !isSafeIngestPath(s.page_path))
    if (sectionsMissingPath.length > 0) {
      const errMsg = `Decomposition produced ${sectionsMissingPath.length}/${decomposedSections.length} section(s) without a valid page_path.`
      invoke("app_debug", { message: `[ingest:decomposition:ERROR] ${chunkLabel}${errMsg}` }).catch(() => {})
      activity.updateItem(activityId, { detail: `${chunkLabel}Decomposition failed: missing page_path — skipping chunk` })
      failedChunks.push({ chunk: chunkIdx + 1, stage: "decomposition (missing page_path)", error: errMsg })
      continue
    }

    activity.updateItem(activityId, { detail: `${chunkLabel}Writing db/ pages...` })
    const fileBlocks = buildFileBlocksFromSections(decomposedSections, fileName)
    invoke("app_debug", { message: `[ingest:filewrite] ${chunkLabel}file=${fileName} sections=${decomposedSections.length} chars=${fileBlocks.length}` }).catch(() => {})

    const { writtenPaths: writtenThisChunk, warnings: writeWarnings, hardFailures: writeHardFailures, proposals: writeProposals } = await writeFileBlocks(pp, fileBlocks, fileName, llmConfig, signal)
    const writeDebug = `[ingest:write] ${chunkLabel}file=${fileName} written=${writtenThisChunk.length} hardFailures=${writeHardFailures.length}`
    console.log(writeDebug)
    invoke("app_debug", { message: writeDebug }).catch(() => {})

    allWrittenPaths.push(...writtenThisChunk)
    allHardFailures.push(...writeHardFailures)
    allWarnings.push(...writeWarnings)

    allProposals.push(...writeProposals)

    // Refresh dbIndex for the next chunk so it sees what this chunk
    // just wrote. Skip on the final chunk — no consumer.
    if (chunks.length > 1 && chunkIdx < chunks.length - 1 && allWrittenPaths.length > writtenBeforeChunk) {
      try {
        currentDbIndex = await buildDbIndex(pp)
      } catch {
        // Non-fatal: the next chunk just sees a stale index, same as before chunking.
      }
    }
  }

  // Surface parser / writer warnings to the activity panel so users
  // don't have to open devtools to find out a block was dropped.
  if (allWarnings.length > 0) {
    const summary = allWarnings.length === 1
      ? allWarnings[0]
      : `${allWarnings.length} ingest warnings: ${allWarnings.slice(0, 2).join(" · ")}${allWarnings.length > 2 ? ` … (+${allWarnings.length - 2} more in console)` : ""}`
    activity.updateItem(activityId, { detail: summary })
  }

  if (allWrittenPaths.length > 0) {
    try {
      const tree = await listDirectory(pp)
      useWikiStore.getState().setFileTree(tree)
      useWikiStore.getState().bumpDataVersion()
    } catch {
      // ignore
    }
  }

  // ── Failed chunks → review item ──────────────────────────────
  // Surface skipped chunks so a partial ingest is visible and the user
  // can re-run. One card per document covering every skipped chunk.
  if (failedChunks.length > 0) {
    allReviewItems.push({
      type: "suggestion",
      stage: "primary",
      title: `Ingest skipped ${failedChunks.length}/${chunks.length} chunk(s): ${fileName}`,
      description: failedChunks
        .map((f) => `- **Chunk ${f.chunk}/${chunks.length}** (${f.stage}): ${f.error}`)
        .join("\n"),
      sourcePath: sp,
      affectedPages: [],
      options: [{ label: "Dismiss", action: "Dismiss" }],
    })
  }

  // ── Empty data-type extraction → review item ─────────────────
  // Not a failure: the source just had nothing matching the selected
  // data type's fields. Surfaced so a zero-file result is explained
  // instead of looking like a silent/failed ingest.
  if (dataTypeId && emptyDataTypeChunks.length > 0 && allWrittenPaths.length === 0) {
    allReviewItems.push({
      type: "suggestion",
      stage: "primary",
      title: `No matching data for "${dataTypeId}": ${fileName}`,
      description: `${emptyDataTypeChunks.length}/${chunks.length} chunk(s) had no content matching this data type's fields — every field came back empty or "정보 없음"/"N/A". No document or graph was created.`,
      sourcePath: sp,
      affectedPages: [],
      options: [{ label: "Dismiss", action: "Dismiss" }],
    })
  }

  // ── Step 4: Append modification cards ────────────────────────
  // Modification proposal — append a modification card for every proposal
  // the writer parked. These items always run in their own card (the store
  // skips dedupe for `modification`) so two parallel conflicts can't
  // collapse into one and lose a parked draft.
  for (const proposal of allProposals) {
    const sectionLabel = proposal.sectionId ? `section \`${proposal.sectionId}\`` : null
    allReviewItems.push({
      type: "modification",
      stage: "primary",
      title: `Modification proposal: ${proposal.targetPath}`,
      description: sectionLabel
        ? `Re-ingest of "${fileName}" produced different content for ` +
          `${sectionLabel} of ${proposal.targetPath}. Approve to overwrite ` +
          `that section, Merge to hand-edit, or Reject to send the proposal ` +
          `to discard / pending.`
        : `Re-ingest of "${fileName}" produced different content for ` +
          `${proposal.targetPath}. Approve to overwrite, Merge to hand-edit, ` +
          `or Reject to send the proposal to discard / pending.`,
      sourcePath: sp,
      affectedPages: [proposal.targetPath],
      options: [],
      proposal,
    })
  }
  if (allReviewItems.length > 0) {
    useReviewStore.getState().addItems(allReviewItems)
  }

  // ── Step 5: Save to cache ───────────────────────────────────
  // Skip cache when ANY block hit a hard FS failure: we'd otherwise
  // freeze the partial-write result into the cache and a future
  // re-ingest of the same source would silently replay only the
  // pages that succeeded the first time, never giving the user a
  // chance to recover the failed ones. Soft drops (language
  // mismatch, path-traversal rejection, empty-path) are NOT failures
  // — they represent deterministic decisions and caching them is
  // safe.
  //
  // Skipped chunks (failedChunks) also block caching: a partial ingest
  // must stay re-runnable so the skipped chunks get another attempt
  // instead of being frozen out by a content-hash cache hit.
  //
  // A data-type ingest where every chunk legitimately matched nothing is
  // cached too (with an empty file list) — otherwise the same unchanged
  // source would re-run the extraction LLM call on every ingest and, since
  // autoIngest's zero-file result reads as a transport failure to the
  // queue, get retried and marked failed for no reason.
  const allChunksEmptyDataType = Boolean(dataTypeId) && emptyDataTypeChunks.length === chunks.length
  if ((allWrittenPaths.length > 0 || allChunksEmptyDataType) && allHardFailures.length === 0 && failedChunks.length === 0) {
    await saveIngestCache(pp, fileName, sourceContent, allWrittenPaths)
  } else if (allHardFailures.length > 0) {
    console.warn(
      `[ingest] Skipping cache save for "${fileName}" — ${allHardFailures.length} block(s) failed to write: ${allHardFailures.join(", ")}`,
    )
  } else if (failedChunks.length > 0) {
    console.warn(
      `[ingest] Skipping cache save for "${fileName}" — ${failedChunks.length}/${chunks.length} chunk(s) skipped; re-run to retry them.`,
    )
  }

  // ── Step 6: Generate embeddings (if enabled) ───────────────
  const embCfg = useWikiStore.getState().embeddingConfig
  if (embCfg.enabled && embCfg.model && allWrittenPaths.length > 0) {
    try {
      const { embedPage, pageIdFromRelPath } = await import("@/lib/embedding")
      for (const wpath of allWrittenPaths) {
        // Only db/ pages are indexed. Pending proposal drafts and any
        // other non-db paths are skipped — they aren't retrieval targets.
        if (!wpath.startsWith("db/")) continue
        const stem = wpath.split("/").pop()?.replace(/\.md$/, "") ?? ""
        const isStructural =
          wpath === "db/index.md" ||
          wpath === "db/log.md" ||
          wpath === "db/overview.md"
        if (!stem || isStructural) continue
        const pageId = pageIdFromRelPath(wpath)
        try {
          const content = await readFile(`${pp}/${wpath}`)
          const titleMatch = content.match(/^---\n[\s\S]*?^title:\s*["']?(.+?)["']?\s*$/m)
          const title = titleMatch ? titleMatch[1].trim() : pageId
          await embedPage(pp, pageId, title, content, embCfg)
        } catch {
          // non-critical
        }
      }
    } catch {
      // embedding module not available
    }
  }

  const skippedSuffix = failedChunks.length > 0
    ? ` (${failedChunks.length}/${chunks.length} chunk(s) skipped)`
    : ""
  const isCleanEmptyDataTypeResult =
    allWrittenPaths.length === 0 && allChunksEmptyDataType && allHardFailures.length === 0 && failedChunks.length === 0
  const detail = allWrittenPaths.length > 0
    ? `${allWrittenPaths.length} files written${allReviewItems.length > 0 ? `, ${allReviewItems.length} review item(s)` : ""}${skippedSuffix}`
    : isCleanEmptyDataTypeResult
      ? `No "${dataTypeId}" data found in source — nothing to ingest`
      : `No files generated${skippedSuffix}`

  activity.updateItem(activityId, {
    status: allWrittenPaths.length > 0 || isCleanEmptyDataTypeResult ? "done" : "error",
    detail,
    filesWritten: allWrittenPaths,
  })

  // Tell ingest-queue.ts this zero-file result is a legitimate "no match"
  // outcome, not a failure, so it doesn't retry/fail the task. Must be set
  // right before returning — consumeEmptyDataTypeFlag() is a one-shot read.
  if (isCleanEmptyDataTypeResult) {
    emptyDataTypeMatchFlag = true
  }

  return allWrittenPaths
}

/**
 * Build a compact tree-style listing of pages already under `db/`. Used
 * as context in both the analysis and generation prompts so the LLM can
 * see what already exists and align proposed paths with existing ones.
 *
 * Returns an empty string when db/ is missing or only contains .gitkeep —
 * the prompts handle the empty case explicitly.
 */
async function buildDbIndex(projectPath: string): Promise<string> {
  let nodes: FileNode[]
  try {
    nodes = await listDirectory(`${projectPath}/db`)
  } catch {
    return ""
  }
  const lines: string[] = []
  walk(nodes, "db", lines)
  return lines.join("\n")
}

function walk(nodes: FileNode[], prefix: string, out: string[]): void {
  for (const node of nodes) {
    if (node.name.startsWith(".")) continue
    const path = `${prefix}/${node.name}`
    if (node.is_dir) {
      walk(node.children ?? [], path, out)
    } else if (node.name.endsWith(".md")) {
      out.push(path)
    }
  }
}

/**
 * Per-file language guard. Strips frontmatter + code/math blocks, runs
 * detectLanguage on the remainder, and returns whether the content is in
 * a language family compatible with the target. This catches cases where
 * the LLM follows the format spec but writes a single page in a wrong
 * language (observed ~once in 5 real-LLM runs on mid-size models).
 */
function contentMatchesTargetLanguage(content: string, target: string): boolean {
  // Strip frontmatter
  const fmEnd = content.indexOf("\n---\n", 3)
  let body = fmEnd > 0 ? content.slice(fmEnd + 5) : content
  // Strip code + math
  body = body
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\$\$[\s\S]*?\$\$/g, "")
    .replace(/\$[^$\n]*\$/g, "")
  const sample = body.slice(0, 1500)
  if (sample.trim().length < 20) return true // too short to judge

  const detected = detectLanguage(sample)

  // Compatible families: CJK targets accept CJK variants; Latin targets
  // accept any Latin family (English may mis-detect as Italian/French for
  // short idiomatic samples — that's fine). Cross-family is the real bug.
  const cjk = new Set(["Chinese", "Traditional Chinese", "Japanese", "Korean"])
  const targetIsCjk = cjk.has(target)
  const detectedIsCjk = cjk.has(detected)
  if (targetIsCjk) return detectedIsCjk
  return !detectedIsCjk && !["Arabic", "Hindi", "Thai", "Hebrew"].includes(detected)
}

async function writeFileBlocks(
  projectPath: string,
  text: string,
  sourceFile: string,
  llmConfig: LlmConfig,
  signal?: AbortSignal,
): Promise<{
  writtenPaths: string[]
  warnings: string[]
  hardFailures: string[]
  proposals: ModificationProposal[]
}> {
  const { blocks, warnings: parseWarnings } = parseFileBlocks(text)
  const warnings = [...parseWarnings]
  const writtenPaths: string[] = []
  // "Hard failures" = blocks we INTENDED to write but the FS rejected
  // (disk full, permission, OS-level errors). Distinct from soft drops
  // (language mismatch, parse warnings, path-traversal rejections):
  // those represent intentional content-level decisions, while hard
  // failures are unexpected losses. The autoIngest cache layer keys
  // off this list — any hard failure means the cache entry must NOT
  // be written, so the next re-ingest goes through the full pipeline
  // instead of replaying the partial result forever.
  const hardFailures: string[] = []

  // Modification proposal — db/ pages whose target already exists with
  // materially different content are parked under `pending/_proposals/...`
  // instead of overwriting. The caller turns each proposal into a
  // `modification` review card.
  const proposals: ModificationProposal[] = []
  // A chunk can produce several pages.  Hold their fully validated v2
  // replacements until all FILE blocks have been prepared, then hand them
  // to the one DB+filesystem ingest transaction below.
  const pendingV2Writes: Array<{ relativePath: string; content: string }> = []
  const runStamp = Date.now()
  let proposalIdx = 0

  const targetLang = useWikiStore.getState().outputLanguage

  for (const { path: relativePath, content } of blocks) {
    // Language guard: reject individual FILE blocks whose body contradicts
    // the user-set target language. Skip:
    // - log.md (structural, short)
    // - /sources/ and /entities/ pages: these legitimately cite cross-
    //   language proper nouns (a German philosophy source summary naturally
    //   quotes Russian philosophers) which confuses naive script-based
    //   detection. Keep the check for /concepts/ pages, which should be
    //   authoritative content in the target language.
    const isLog = relativePath.endsWith("/log.md")
    const isEntityOrSource =
      relativePath.includes("/entities/") ||
      relativePath.includes("/sources/")
    if (
      targetLang &&
      targetLang !== "auto" &&
      !isLog &&
      !isEntityOrSource &&
      !contentMatchesTargetLanguage(content, targetLang)
    ) {
      const msg = `Dropped "${relativePath}" — body language doesn't match target ${targetLang}.`
      console.warn(`[ingest] ${msg}`)
      warnings.push(msg)
      continue
    }

    const fullPath = `${projectPath}/${relativePath}`
    try {
      if (relativePath.endsWith("/log.md")) {
        const existing = await tryReadFile(fullPath)
        const appended = existing ? `${existing}\n\n${content.trim()}` : content.trim()
        await writeFile(fullPath, appended)
      } else if (
        relativePath.endsWith("/index.md") ||
        relativePath.endsWith("/overview.md")
      ) {
        // Listing pages (index / overview) are always overwritten
        // wholesale — their sources field is incidental and merging
        // wouldn't make semantic sense (they aren't source-derived
        // content pages).
        await writeFile(fullPath, content)
      } else {
        // Content pages: MERGE the sources field with what's already on
        // disk before overwriting, so pages that multiple source
        // documents contribute to retain the full sources history.
        // Without this, every re-ingest clobbers sources to a single
        // entry and the source-delete flow would later treat the page
        // as single-sourced and delete it outright — silent data loss.
        const isDbPage = relativePath.startsWith("db/")
        const { mergeSourceRefsIntoContent } = await import("./sources-merge")
        const existing = await tryReadFile(fullPath)

        // Markdown v2 has no compatibility parser: every db/ document is
        // validated before it is stored and conflicts are keyed solely by ID.
        if (isDbPage) {
          let incomingPage
          try { incomingPage = parseMarkdownV2(content) }
          catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            warnings.push(`Dropped "${relativePath}" — VALIDATION_FAILED: ${message}`)
            continue
          }
          if (existing) {
            let existingPage
            try { existingPage = parseMarkdownV2(existing) }
            catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              warnings.push(`Refused overwrite of "${relativePath}" — VALIDATION_FAILED: existing document is not v2 (${message})`)
              continue
            }
            const { sections, conflicts } = reconcileMarkdownV2(existingPage, incomingPage)

          if (conflicts.length > 0) {
            const slug = relativePath
              .replace(/^db\//, "")
              .replace(/\.md$/, "")
              .replace(/\//g, "_")
            const incomingRefs = parseSourceRefs(content)
            const sourceRefs = incomingRefs.length > 0
              ? incomingRefs
              : [{ file: sourceFile }]

            for (const conflict of conflicts) {
              proposalIdx++
              const draftRel = `pending/_proposals/${runStamp}-${proposalIdx}-${slug}.md`
              const draftAbs = `${projectPath}/${draftRel}`
              await writeFile(draftAbs, conflict.incoming.body)

              proposals.push({
                targetPath: relativePath,
                pageId: conflict.pageId,
                sectionId: conflict.sectionId,
                existingExcerpt: conflict.existing.body,
                incomingExcerpt: conflict.incoming.body,
                incomingDraftPath: draftRel,
                sourceRefs,
              })
              writtenPaths.push(draftRel)
            }
          }

          // Sections that didn't conflict (new headings, or matching
          // bodies) are applied right away — same-transaction as the
          // proposal park above, so a mixed incoming block never loses
          // its non-conflicting parts while the conflicting section
          // awaits review.
          // page_path is only a location. Once a target exists its stable
          // page identity is retained; otherwise the DB unique page_path
          // constraint would let an LLM-generated replacement create a
          // second identity for the same document.
          const mergedContent = serializeMarkdownV2({
            ...incomingPage,
            page: { ...incomingPage.page, page_id: existingPage.page.page_id },
            sections,
          })
          pendingV2Writes.push({ relativePath, content: mergedContent })
          continue
          }
        }

        const toWrite = mergeSourceRefsIntoContent(content, existing)
        if (isDbPage) pendingV2Writes.push({ relativePath, content: toWrite })
        else await writeFile(fullPath, toWrite)
      }
      if (!relativePath.startsWith("db/")) writtenPaths.push(relativePath)
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      const msg = err instanceof SourceRefValidationError
        ? `Refused overwrite of "${relativePath}" — VALIDATION_FAILED: non-v2 source metadata (${detail}). Restore or migrate this document from a backup.`
        : `Failed to write "${relativePath}": ${detail}`
      console.error(`[ingest] ${msg}`)
      warnings.push(msg)
      hardFailures.push(relativePath)
    }
  }

  if (pendingV2Writes.length > 0) {
    try {
      const assertions = await extractKnowledgeAssertionWrites(projectPath, pendingV2Writes, llmConfig, signal)
      await commitMarkdownV2Pages(projectPath, pendingV2Writes, assertions)
      writtenPaths.push(...pendingV2Writes.map(({ relativePath }) => relativePath))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const paths = pendingV2Writes.map(({ relativePath }) => relativePath)
      const msg = `Failed to atomically commit v2 pages: ${message}`
      console.error(`[ingest] ${msg}`)
      warnings.push(msg)
      hardFailures.push(...paths)
    }
  }

  return { writtenPaths, warnings, hardFailures, proposals }
}

/**
 * Normalize an LLM-produced entity name so the same real-world entity resolves
 * to one string across independent chunk calls. Strips a single trailing
 * parenthetical qualifier ("검(무기)" → "검"), collapses internal whitespace,
 * and trims. Mirrors the intent of the Rust-side alias normalization (trim +
 * NFKC + lowercase) but preserves the display casing the canonical_name keeps.
 * Exported for tests.
 */
export function normalizeEntityName(name: string): string {
  return name.normalize("NFKC").replace(/\s*[（(][^（()）]*[)）]\s*$/, "").replace(/\s+/g, " ").trim()
}

/** Decomposition output: a single meaningful section from the source document. */
export interface DecomposedSection {
  source_range: string
  source_text: string
  page_path?: string
}

export async function extractKnowledgeAssertionWrites(
  projectPath:string,
  documents:Array<{relativePath:string;content:string}>,
  llmConfig:LlmConfig,
  signal?:AbortSignal,
  sectionIds?:string[],
):Promise<IngestAssertionWrite[]> {
  const graphs=await listKnowledgeGraphs(projectPath)
  const catalogs=await Promise.all(graphs.map(async(graph)=>({graph,relations:await listKnowledgeRelationTypes(projectPath,graph.graphId)})))
  const allTargets=documents.flatMap((document)=>{const parsed=parseMarkdownV2(document.content);return parsed.sections.map((section)=>({key:`${parsed.page.page_id}:${section.sectionId}`,pageId:parsed.page.page_id,sectionId:section.sectionId,text:section.body}))})
  const targets=sectionIds?allTargets.filter((target)=>sectionIds.includes(target.sectionId)):allTargets
  if(targets.length===0)return []
  const purposePrefixes=Array.from(new Set(graphs.map((g)=>g.graphName.split("_")[0]).filter(Boolean)))
  const prompt=[
    "Extract factual graph assertions from the supplied Markdown v2 sections.",
    "Assign each assertion to the graph whose domain best matches the relationship.",
    "Prefer an existing graph from the catalog: set graphId to its id and leave newGraph unset.",
    "If no catalog graph fits, propose a new graph: set newGraph=true, omit graphId, and set graphName.",
    "graphName must be lower snake_case shaped as {purpose}_{subjectType}_{action}_{objectType} — e.g. combat_character_attacks_enemy, quest_npc_gives_item.",
    purposePrefixes.length?`Reuse an existing purpose prefix when one fits: ${purposePrefixes.join(", ")}.`:"",
    "Predicates must be uppercase snake case. Reuse an existing predicate when it fits; a new predicate requires a precise relationDescription.",
    `Entity types must be one of: ${ENTITY_TYPES.join(", ")}. Do not emit scalar values as entities.`,
    "Entity names must be the canonical short name of the entity: strip parenthetical qualifiers, appositives, honorifics, and trailing particles; do not append descriptive modifiers. The SAME real-world entity must get the SAME exact string every time so it deduplicates across sections.",
    "Return only JSON: {\"assertions\":[{\"targetKey\":\"page:section\",\"graphId\":\"...\",\"newGraph\":false,\"graphName\":\"...\",\"subjectName\":\"...\",\"subjectType\":\"concept\",\"predicate\":\"...\",\"relationDescription\":\"...\",\"objectName\":\"...\",\"objectType\":\"concept\",\"quote\":\"exact supporting text\"}]}",
    "Graph catalog:",JSON.stringify(catalogs.map(({graph,relations})=>({graphId:graph.graphId,name:graph.graphName,purpose:graph.purpose,relations:relations.map((r)=>({name:r.name,subjectTypes:r.subjectTypes,objectTypes:r.objectTypes}))}))),
    "Sections:",JSON.stringify(targets.map(({key,text})=>({targetKey:key,text}))),
  ].filter(Boolean).join("\n")
  const raw=await callModel(llmConfig,"You produce validated knowledge graph write plans.",prompt,signal,projectPath,12000,true)
  let parsed:unknown
  try{parsed=JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i,"").replace(/```\s*$/, ""))}catch{throw new Error("VALIDATION_FAILED: graph assignment was not valid JSON")}
  const values=(parsed as {assertions?:unknown[]}).assertions
  if(!Array.isArray(values))throw new Error("VALIDATION_FAILED: graph assignment has no assertions array")
  const byKey=new Map(targets.map((target)=>[target.key,target]))
  const graphIds=new Set(graphs.map((graph)=>graph.graphId))
  const GRAPH_NAME=/^[a-z0-9]+(_[a-z0-9]+)+$/
  // Register any newly proposed graph once, then resolve its name to a graphId.
  // Kept out of the atomic commit deliberately: an orphaned empty graph from a
  // later commit failure is harmless and removable from the graphs tab.
  const newGraphIds=new Map<string,string>()
  const drafts=values.map((rawValue)=>{
    const value=rawValue as Record<string,unknown>
    const target=byKey.get(String(value.targetKey??""))
    const subjectType=String(value.subjectType??"") as EntityType
    const objectType=String(value.objectType??"") as EntityType
    const quote=String(value.quote??"")
    const isNew=value.newGraph===true
    const graphName=String(value.graphName??"").trim()
    const graphId=String(value.graphId??"")
    const validGraph=isNew?GRAPH_NAME.test(graphName):graphIds.has(graphId)
    if(!target||!validGraph||!ENTITY_TYPES.includes(subjectType)||!ENTITY_TYPES.includes(objectType)||!target.text.includes(quote))throw new Error("VALIDATION_FAILED: graph assignment references an invalid graph, section, type, or quote")
    return{isNew,graphName,graphId,subjectName:normalizeEntityName(String(value.subjectName??"")),subjectType,predicate:String(value.predicate??"").trim(),relationDescription:String(value.relationDescription??"").trim(),objectName:normalizeEntityName(String(value.objectName??"")),objectType,pageId:target.pageId,sectionId:target.sectionId,quote}
  })
  const resolveGraphId=async(draft:typeof drafts[number]):Promise<string>=>{
    if(!draft.isNew)return draft.graphId
    const existing=graphs.find((g)=>g.graphName===draft.graphName)
    if(existing)return existing.graphId
    const cached=newGraphIds.get(draft.graphName)
    if(cached)return cached
    const created=await registerGraph(projectPath,{graphId:`graph-${crypto.randomUUID()}`,graphName:draft.graphName,purpose:draft.relationDescription})
    newGraphIds.set(draft.graphName,created.graphId)
    return created.graphId
  }
  const writes:IngestAssertionWrite[]=[]
  for(const draft of drafts){const graphId=await resolveGraphId(draft);writes.push({graphId,subjectName:draft.subjectName,subjectType:draft.subjectType,predicate:draft.predicate,relationDescription:draft.relationDescription,objectName:draft.objectName,objectType:draft.objectType,pageId:draft.pageId,sectionId:draft.sectionId,quote:draft.quote})}
  return writes
}

export function buildDecompositionPrompt(dbIndex: string, sourceContent = "", dismissalContext = ""): string {
  return [
    "You are a document decomposer. Split the source into meaningful sections and assign each section a current db/ page path.",
    "Do not infer stable IDs; IDs are generated and reconciled by the Markdown v2 pipeline.",
    languageRule(sourceContent),
    "Output only blocks shaped as:",
    "---SECTION: heading range | db/category/page.md---",
    "<verbatim source text>",
    "---END SECTION---",
    dbIndex ? `## Current db/ index\n${dbIndex}` : "## Current db/ index\n(empty)",
    dismissalContext,
  ].filter(Boolean).join("\n\n")
}

/** Compatibility name for callers that only need the v2 decomposition prompt. */
export function buildAnalysisPrompt(dbIndex: string, sourceContent = "", dismissalContext = ""): string {
  return buildDecompositionPrompt(dbIndex, sourceContent, dismissalContext)
}

/**
 * Replace a saved v2 document while preserving its page and section IDs.
 *
 * When `sectionId` is given (the modification-approve path), also discards
 * the prior graph assertions whose evidence pointed at that section and
 * re-extracts assertions from its new text — otherwise an approved edit
 * would leave stale assertions in the graph pointing at text that no longer
 * exists, and never pick up new relations the edit introduced.
 */
export async function reIngestDocument(
  projectPath: string,
  projectName: string,
  pagePath: string,
  content: string,
  llmConfig: LlmConfig,
  dataTypeId?: string,
  prefilledFields?: Record<string, string>,
  sectionId?: string,
): Promise<void> {
  const pp = normalizePath(projectPath)
  // Re-ingest is now a v2 document replacement, not a bridge back to the
  // legacy graph backend. The content must already carry stable IDs; this
  // deliberately rejects v1 rather than inventing identity from headings.
  void projectName
  void dataTypeId
  void prefilledFields
  if (sectionId) {
    try {
      const assertions = await extractKnowledgeAssertionWrites(pp, [{ relativePath: pagePath, content }], llmConfig, undefined, [sectionId])
      await discardSectionAssertions(pp, sectionId)
      await commitMarkdownV2Pages(pp, [{ relativePath: pagePath, content }], assertions)
      return
    } catch (err) {
      console.warn(`[ingest] reIngestDocument graph reassignment failed for ${pagePath}, falling back to content-only commit: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  try {
    await commitMarkdownV2Page(pp, pagePath, content)
  } catch (err) {
    console.warn(`[ingest] reIngestDocument failed for ${pagePath}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Build FILE block text from decomposed sections, without an LLM call.
 * page_path is decided by decomposition, before graph assignment runs.
 *
 * Sections without a page_path are skipped. Sections sharing the same
 * page_path are merged into one FILE block (first section wins for
 * frontmatter; subsequent source_text is appended).
 */
export function buildFileBlocksFromSections(
  sections: DecomposedSection[],
  fileName: string,
): string {
  const groups = new Map<string, DecomposedSection[]>()
  for (const section of sections) {
    const pp = section.page_path
    if (!pp || !isSafeIngestPath(pp)) continue
    const existing = groups.get(pp)
    if (existing) {
      existing.push(section)
    } else {
      groups.set(pp, [section])
    }
  }

  const blocks: string[] = []
  for (const [pagePath, group] of groups) {
    const first = group[0]
    const title = first.source_range || pagePath
    const sections = group.map((section, ordinal) => ({
      sectionId: createSectionId(),
      headingText: `Section ${ordinal + 1}`,
      headingLevel: 2 as const,
      ordinal,
      metadata: { section_type: "overview" as const },
      // H2 is reserved for v2 section boundaries. Preserve source hierarchy
      // below the generated section by demoting embedded H2 headings to H3.
      body: (section.source_text || "").replace(/^##(?!#)(?=\s)/gm, "###"),
      startOffset: 0,
      endOffset: 0,
    }))
    const content = serializeMarkdownV2({
      page: {
        schema: "llm-wiki/page/v2",
        page_id: createPageId(),
        title,
        page_type: "guide",
        summary: `Generated from ${fileName}`,
        sections: Object.fromEntries(sections.map((section) => [section.sectionId, section.metadata])),
      },
      h1: title,
      sections,
      source: "",
    })

    blocks.push(`---FILE: ${pagePath}---\n${content}\n---END FILE---`)
  }

  return blocks.join("\n\n")
}

async function tryReadFile(path: string): Promise<string> {
  try {
    return await readFile(path)
  } catch {
    return ""
  }
}
