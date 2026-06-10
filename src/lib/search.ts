import { readFile, listDirectory } from "@/commands/fs"
import type { FileNode } from "@/types/wiki"
import { normalizePath, getFileName } from "@/lib/path-utils"
import { pageIdFromRelPath } from "@/lib/embedding"

export interface SearchResult {
  path: string
  title: string
  snippet: string
  titleMatch: boolean
  score: number
}

const MAX_RESULTS = 20
const SNIPPET_CONTEXT = 80

// ── Reciprocal Rank Fusion ─────────────────────────────────────────────────
// Token search and vector search produce two independently-ranked lists.
// Their absolute scores are incommensurable (token score: 1-400, vector
// cosine: 0-1), so summing them privileges whichever list happens to use
// the larger numbers. RRF sidesteps that by fusing on RANK only:
//
//     fused(p) = sum over lists L of  1 / (K + rank_L(p))
//
// A page that ranks #1 in BOTH lists wins handily. A page that's only in
// one list still surfaces if it ranks high there, but a page in BOTH a
// little lower can outrank it — exactly what we want for hybrid retrieval.
//
// K=60 is the canonical constant from Cormack et al. (SIGIR 2009), large
// enough that small rank differences near the top don't dominate but
// small enough that being deep in either list still falls off quickly.
const RRF_K = 60

// ── Scoring weights ────────────────────────────────────────────────────────
// Exact lexical matches dominate everything else. The rationale: when a
// user types "attention", the page literally named `attention.md` MUST
// rank first, regardless of how many other pages also mention the word.
//
//   filename == query (e.g. `attention.md` for query "attention")
//     → FILENAME_EXACT_BONUS — large enough that nothing short of an
//       equally-exact match can outrank it.
//
//   title or content contains the raw query as a substring
//     → PHRASE_IN_TITLE_BONUS / PHRASE_IN_CONTENT_PER_OCC — phrase
//       presence is worth far more than individual token presence, and
//       in content it rewards repetition (with a cap to avoid runaway).
//
//   per-token matches (existing behavior, but now smaller weight)
//     → TITLE_TOKEN_WEIGHT / CONTENT_TOKEN_WEIGHT. These used to
//       dominate via a flat +10 title bonus regardless of how many
//       tokens matched; now each matched token counts individually.
const FILENAME_EXACT_BONUS = 200
const PHRASE_IN_TITLE_BONUS = 50
const PHRASE_IN_CONTENT_PER_OCC = 20
const MAX_PHRASE_OCC_COUNTED = 10 // cap to avoid runaway on huge logs
const TITLE_TOKEN_WEIGHT = 5
const CONTENT_TOKEN_WEIGHT = 1

const STOP_WORDS = new Set([
  "的", "是", "了", "什么", "在", "有", "和", "与", "对", "从",
  "the", "is", "a", "an", "what", "how", "are", "was", "were",
  "do", "does", "did", "be", "been", "being", "have", "has", "had",
  "it", "its", "in", "on", "at", "to", "for", "of", "with", "by",
  "this", "that", "these", "those",
])

export function tokenizeQuery(query: string): string[] {
  // Split by whitespace and punctuation
  const rawTokens = query
    .toLowerCase()
    .split(/[\s,，。！？、；：""''（）()\-_/\\·~～…]+/)
    .filter((t) => t.length > 1)
    .filter((t) => !STOP_WORDS.has(t))

  const tokens: string[] = []

  for (const token of rawTokens) {
    // Check if token contains CJK characters
    const hasCJK = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(token)

    if (hasCJK && token.length > 2) {
      // For CJK text: split into individual characters AND overlapping bigrams
      // "默会知识" → ["默会", "会知", "知识", "默", "会", "知", "识"]
      const chars = [...token]
      // Add bigrams (most useful for Chinese)
      for (let i = 0; i < chars.length - 1; i++) {
        tokens.push(chars[i] + chars[i + 1])
      }
      // Also add individual chars (for single-char matches)
      for (const ch of chars) {
        if (!STOP_WORDS.has(ch)) {
          tokens.push(ch)
        }
      }
      // Keep the original token too (for exact phrase match)
      tokens.push(token)
    } else {
      tokens.push(token)
    }
  }

  // Deduplicate
  return [...new Set(tokens)]
}

function tokenMatchScore(text: string, tokens: readonly string[]): number {
  const lower = text.toLowerCase()
  let score = 0
  for (const token of tokens) {
    if (lower.includes(token)) score += 1
  }
  return score
}

function countOccurrences(haystackLower: string, needleLower: string): number {
  if (!needleLower || needleLower.length === 0) return 0
  let count = 0
  let pos = 0
  while (true) {
    const idx = haystackLower.indexOf(needleLower, pos)
    if (idx === -1) break
    count++
    pos = idx + needleLower.length
  }
  return count
}

function flattenMdFiles(nodes: FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) {
      files.push(...flattenMdFiles(node.children))
    } else if (!node.is_dir && node.name.endsWith(".md")) {
      files.push(node)
    }
  }
  return files
}

function extractTitle(content: string, fileName: string): string {
  // Try YAML frontmatter title
  const frontmatterMatch = content.match(/^---\n[\s\S]*?^title:\s*["']?(.+?)["']?\s*$/m)
  if (frontmatterMatch) return frontmatterMatch[1].trim()

  // Try first heading
  const headingMatch = content.match(/^#\s+(.+)$/m)
  if (headingMatch) return headingMatch[1].trim()

  // Fall back to filename
  return fileName.replace(/\.md$/, "").replace(/-/g, " ")
}

function buildSnippet(content: string, query: string): string {
  const lower = content.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const idx = lower.indexOf(lowerQuery)
  if (idx === -1) return content.slice(0, SNIPPET_CONTEXT * 2).replace(/\n/g, " ")

  const start = Math.max(0, idx - SNIPPET_CONTEXT)
  const end = Math.min(content.length, idx + query.length + SNIPPET_CONTEXT)
  let snippet = content.slice(start, end).replace(/\n/g, " ")
  if (start > 0) snippet = "..." + snippet
  if (end < content.length) snippet = snippet + "..."
  return snippet
}

export async function searchWiki(
  projectPath: string,
  query: string,
): Promise<SearchResult[]> {
  if (!query.trim()) return []
  const pp = normalizePath(projectPath)

  const tokens = tokenizeQuery(query)
  // Fallback: if all tokens were filtered out, use the trimmed query as a single token
  const effectiveTokens = tokens.length > 0 ? tokens : [query.trim().toLowerCase()]
  const results: SearchResult[] = []

  // Search db pages
  try {
    const dbTree = await listDirectory(`${pp}/db`)
    const dbFiles = flattenMdFiles(dbTree)
    await searchFiles(dbFiles, effectiveTokens, query, results)
  } catch {
    // no db directory
  }

  // Also search raw sources (extracted text)
  try {
    const rawTree = await listDirectory(`${pp}/raw/sources`)
    const rawFiles = flattenAllFiles(rawTree)
    await searchFiles(rawFiles, effectiveTokens, query, results)
  } catch {
    // no raw sources
  }

  await fuseTokenAndVector(results, pp, query, null)

  return results.slice(0, MAX_RESULTS)
}

/**
 * Fuse token-search results with embedding-search results via RRF.
 *
 * Mutates `results` in place: replaces each entry's score with the RRF
 * fused value, materializes vector-only pages, and sorts by score
 * descending (ties broken alphabetically for determinism).
 *
 * `restrictedPaths`:
 *   - null   → no restriction; vector-only pages are looked up across
 *              the entire db/ tree. Used by `searchWiki`.
 *   - Set<string> of normalized absolute paths → only vector results
 *              whose page_id resolves into the set are considered, and
 *              vector-only pages outside the set are not materialized.
 *              Used by `searchPaths` so exclusions remain authoritative
 *              over the candidate space (a vector hit on an excluded
 *              page must not slip back in via embedding similarity).
 */
async function fuseTokenAndVector(
  results: SearchResult[],
  pp: string,
  query: string,
  restrictedPaths: ReadonlySet<string> | null,
): Promise<void> {
  // Snapshot token ranks BEFORE vector materialization so newly-added
  // vector-only pages don't shift token ranks under us.
  const tokenSorted = [...results].sort((a, b) => b.score - a.score)
  const tokenRank = new Map<string, number>()
  tokenSorted.forEach((r, i) => {
    tokenRank.set(normalizePath(r.path), i + 1) // 1-indexed
  })

  let vectorRank = new Map<string, number>()
  let vectorCount = 0
  try {
    const { useWikiStore } = await import("@/stores/wiki-store")
    const embCfg = useWikiStore.getState().embeddingConfig
    console.log(`[Vector Search] Config: enabled=${embCfg.enabled}, model="${embCfg.model}"`)
    if (embCfg.enabled && (embCfg.source === "builtin" || embCfg.model)) {
      const t0 = performance.now()
      const { searchByEmbedding } = await import("@/lib/embedding")
      const vectorResults = await searchByEmbedding(pp, query, embCfg, 10)
      const vectorMs = Math.round(performance.now() - t0)
      vectorCount = vectorResults.length

      console.log(
        `[Vector Search] query="${query}" | ${vectorResults.length} results in ${vectorMs}ms | model=${embCfg.model}` +
        (vectorResults.length > 0
          ? ` | top: ${vectorResults.slice(0, 5).map((r) => `${r.id}(${r.score.toFixed(3)})`).join(", ")}`
          : "")
      )

      // Build the page_id → path lookup. When restrictedPaths is set, we
      // build it from that set only, so vector hits on out-of-scope pages
      // (excluded by IDEA.md exclusions, etc.) cannot resolve at all.
      const idToPath = new Map<string, string>()
      if (restrictedPaths) {
        for (const p of restrictedPaths) {
          idToPath.set(pageIdFromRelPath(p), p)
        }
      } else {
        try {
          const dbTree = await listDirectory(`${pp}/db`)
          const dbFiles = flattenMdFiles(dbTree)
          for (const f of dbFiles) {
            idToPath.set(pageIdFromRelPath(f.path), f.path)
          }
        } catch {
          // db tree unavailable — vector-only materialization best-effort
        }
      }

      // Filter and rank the vector results that resolve into the
      // allowed set. searchByEmbedding returns results pre-sorted by
      // descending similarity; preserve order while skipping unresolved.
      let rank = 0
      for (const vr of vectorResults) {
        if (!idToPath.has(vr.id)) continue
        rank++
        vectorRank.set(vr.id, rank)
      }

      // Materialize any vector-result page that token search didn't
      // already include — without this, `results` has no entry for
      // them and they can't surface even with a top vector rank.
      const knownIds = new Set(results.map((r) => pageIdFromRelPath(r.path)))
      let added = 0
      for (const vr of vectorResults) {
        if (knownIds.has(vr.id)) continue
        const tryPath = idToPath.get(vr.id)
        if (!tryPath) continue
        try {
          const content = await readFile(tryPath)
          const title = extractTitle(content, getFileName(tryPath))
          results.push({
            path: tryPath,
            title,
            snippet: buildSnippet(content, query),
            titleMatch: false,
            score: 0, // overwritten by RRF below
          })
          knownIds.add(vr.id)
          added++
        } catch {
          // unreadable — skip
        }
      }
      if (added > 0) {
        console.log(`[Vector Search] Added ${added} vector-only pages to candidate set`)
      }
    }
  } catch (err) {
    console.log(`[Vector Search] Skipped: ${err instanceof Error ? err.message : "not available"}`)
    vectorRank = new Map()
  }

  // RRF fusion: replace each result's score with
  //   1/(K + token_rank) + 1/(K + vector_rank)
  // Pages absent from either list contribute 0 from that side; pages
  // absent from BOTH never make it here.
  for (const r of results) {
    const tRank = tokenRank.get(normalizePath(r.path))
    const vRank = vectorRank.get(pageIdFromRelPath(r.path))
    let rrf = 0
    if (tRank !== undefined) rrf += 1 / (RRF_K + tRank)
    if (vRank !== undefined) rrf += 1 / (RRF_K + vRank)
    r.score = rrf
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.path.localeCompare(b.path)
  })

  const tokenHits = tokenRank.size
  console.log(
    `[Search] query="${query}" | RRF fused: ${tokenHits} token + ${vectorCount} vector → ${results.length} unique`,
  )
}

/**
 * Search a fixed list of file paths.
 *
 * Entry point for the exclusion-aware pipeline: caller has already
 * pruned the candidate space (db/ tree minus excluded patterns) and
 * passes the absolute paths it wants scored. Token + vector hybrid:
 * vector hits are restricted to the kept set so an excluded page can't
 * slip back in via embedding similarity (IDEA.md §2.5 — "줄어든 후보
 * 공간이 검색의 시작 상태").
 */
export async function searchPaths(
  projectPath: string,
  query: string,
  absolutePaths: readonly string[],
): Promise<SearchResult[]> {
  if (!query.trim()) return []
  if (absolutePaths.length === 0) return []

  const pp = normalizePath(projectPath)

  const tokens = tokenizeQuery(query)
  const effectiveTokens = tokens.length > 0 ? tokens : [query.trim().toLowerCase()]

  const normalizedPaths = absolutePaths.map((p) => normalizePath(p))
  const restrictedSet = new Set<string>(normalizedPaths)

  const files: FileNode[] = normalizedPaths.map((p) => ({
    name: getFileName(p),
    path: p,
    is_dir: false,
  }))

  const results: SearchResult[] = []
  await searchFiles(files, effectiveTokens, query, results)

  await fuseTokenAndVector(results, pp, query, restrictedSet)

  return results.slice(0, MAX_RESULTS)
}

async function searchFiles(
  files: FileNode[],
  tokens: readonly string[],
  query: string,
  results: SearchResult[],
): Promise<void> {
  const queryPhrase = query.trim().toLowerCase()

  for (const file of files) {
    let content = ""
    try {
      content = await readFile(file.path)
    } catch {
      continue
    }

    const title = extractTitle(content, file.name)
    const titleText = `${title} ${file.name}`
    const titleLower = titleText.toLowerCase()
    const contentLower = content.toLowerCase()
    const fileStem = file.name.replace(/\.md$/, "").toLowerCase()

    // Exact-match signals (strongest)
    const filenameExact = fileStem === queryPhrase
    const titleHasPhrase =
      queryPhrase.length > 0 && titleLower.includes(queryPhrase)
    const contentPhraseOcc = Math.min(
      countOccurrences(contentLower, queryPhrase),
      MAX_PHRASE_OCC_COUNTED,
    )

    // Token-level signals (fallback / density)
    const titleTokenScore = tokenMatchScore(titleText, tokens)
    const contentTokenScore = tokenMatchScore(content, tokens)

    // Must have at least one signal to be included
    if (
      !filenameExact &&
      !titleHasPhrase &&
      contentPhraseOcc === 0 &&
      titleTokenScore === 0 &&
      contentTokenScore === 0
    ) {
      continue
    }

    const score =
      (filenameExact ? FILENAME_EXACT_BONUS : 0) +
      (titleHasPhrase ? PHRASE_IN_TITLE_BONUS : 0) +
      contentPhraseOcc * PHRASE_IN_CONTENT_PER_OCC +
      titleTokenScore * TITLE_TOKEN_WEIGHT +
      contentTokenScore * CONTENT_TOKEN_WEIGHT

    const isTitleMatch = titleTokenScore > 0 || titleHasPhrase

    // Prefer snipping around the full phrase when it exists; otherwise
    // pick the first matching token; otherwise the raw query.
    const snippetAnchor =
      contentPhraseOcc > 0
        ? queryPhrase
        : tokens.find((t) => contentLower.includes(t)) ?? query

    results.push({
      path: file.path,
      title,
      snippet: buildSnippet(content, snippetAnchor),
      titleMatch: isTitleMatch,
      score,
    })
  }
}

function flattenAllFiles(nodes: FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) {
      files.push(...flattenAllFiles(node.children))
    } else if (!node.is_dir) {
      files.push(node)
    }
  }
  return files
}
