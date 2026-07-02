import { readFile, writeFile, createDirectory } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { getGraphBackend } from "@/lib/graph-backend"

const DICT_PATH = ".llm-wiki/entity-dict.json"
const MAX_HINT_NAMES = 200

export interface EntityGraphNodeRef {
  graphName: string
  nodeId: string
  pagePath?: string
}

export interface EntityEntry {
  id: string
  canonicalName: string
  aliases: string[]
  primaryPagePath?: string
  pagePaths: string[]
  graphNodes: EntityGraphNodeRef[]
}

export type EntityDict = Record<string, EntityEntry>

export async function loadEntityDict(projectPath: string): Promise<EntityDict> {
  try {
    const raw = await readFile(`${normalizePath(projectPath)}/${DICT_PATH}`)
    return JSON.parse(raw) as EntityDict
  } catch {
    return {}
  }
}

export async function saveEntityDict(projectPath: string, dict: EntityDict): Promise<void> {
  const pp = normalizePath(projectPath)
  await createDirectory(`${pp}/.llm-wiki`)
  await writeFile(`${pp}/${DICT_PATH}`, JSON.stringify(dict, null, 2))
}

function normalizeForCompare(s: string): string {
  return s.trim().toLowerCase()
}

/** Standard Levenshtein edit distance. */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m

  const prev = new Array<number>(n + 1)
  const curr = new Array<number>(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j

  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j]
  }
  return prev[n]
}

/**
 * Similarity verdict between two names.
 * - "exact": same after trim+lowercase normalization
 * - "fuzzy": Levenshtein distance <= 2, or one is a substring of the other
 * - "none": unrelated
 */
export function isSimilar(a: string, b: string): "exact" | "fuzzy" | "none" {
  const na = normalizeForCompare(a)
  const nb = normalizeForCompare(b)
  if (!na || !nb) return "none"
  if (na === nb) return "exact"
  if (na.includes(nb) || nb.includes(na)) return "fuzzy"
  if (levenshteinDistance(na, nb) <= 2) return "fuzzy"
  return "none"
}

export interface EntityCandidate {
  entry: EntityEntry
  match: "exact" | "fuzzy"
  /** The specific name (canonicalName or one of the aliases) that matched. */
  matchedName: string
}

/** Find entities whose canonicalName or any alias is similar to `name`. Exact matches sort first. */
export function findCandidates(name: string, dict: EntityDict): EntityCandidate[] {
  const candidates: EntityCandidate[] = []
  for (const entry of Object.values(dict)) {
    const names = [entry.canonicalName, ...entry.aliases]
    let best: "exact" | "fuzzy" | "none" = "none"
    let matchedName = ""
    for (const n of names) {
      const verdict = isSimilar(name, n)
      if (verdict === "exact") { best = "exact"; matchedName = n; break }
      if (verdict === "fuzzy" && best === "none") { best = "fuzzy"; matchedName = n }
    }
    if (best !== "none") candidates.push({ entry, match: best, matchedName })
  }
  return candidates.sort((a, b) => (a.match === b.match ? 0 : a.match === "exact" ? -1 : 1))
}

/** Find the entity that owns a given graph node ref, if any. */
export function findEntityByGraphNode(graphName: string, nodeId: string, dict: EntityDict): EntityEntry | undefined {
  return Object.values(dict).find((entry) =>
    entry.graphNodes.some((ref) => ref.graphName === graphName && ref.nodeId === nodeId)
  )
}

/** Remove a graph node ref from whichever entity owns it. Deletes the entity if it has no refs or pagePaths left. */
export function unlinkGraphNode(graphName: string, nodeId: string, dict: EntityDict): EntityDict {
  const entry = findEntityByGraphNode(graphName, nodeId, dict)
  if (!entry) return dict
  const graphNodes = entry.graphNodes.filter((ref) => !(ref.graphName === graphName && ref.nodeId === nodeId))
  if (graphNodes.length === 0 && entry.pagePaths.length === 0) {
    const next = { ...dict }
    delete next[entry.id]
    return next
  }
  return { ...dict, [entry.id]: { ...entry, graphNodes } }
}

export function upsertEntity(
  entry: Partial<EntityEntry> & { canonicalName: string },
  dict: EntityDict,
): EntityDict {
  const existing = entry.id ? dict[entry.id] : undefined
  const id = existing?.id ?? entry.id ?? crypto.randomUUID()
  const merged: EntityEntry = {
    id,
    canonicalName: entry.canonicalName,
    aliases: entry.aliases ?? existing?.aliases ?? [],
    primaryPagePath: entry.primaryPagePath ?? existing?.primaryPagePath,
    pagePaths: entry.pagePaths ?? existing?.pagePaths ?? [],
    graphNodes: entry.graphNodes ?? existing?.graphNodes ?? [],
  }
  return { ...dict, [id]: merged }
}

/** Add a page path to an entity's related-documents list. Sets primaryPagePath if unset. */
export function addEntityPagePath(entityId: string, pagePath: string, dict: EntityDict): EntityDict {
  const entry = dict[entityId]
  if (!entry) return dict
  const pagePaths = entry.pagePaths.includes(pagePath) ? entry.pagePaths : [...entry.pagePaths, pagePath]
  const primaryPagePath = entry.primaryPagePath ?? pagePath
  return { ...dict, [entityId]: { ...entry, pagePaths, primaryPagePath } }
}

/** Link a graph node ref to an entity. Allows multiple nodeIds per graphName. */
export function linkGraphNode(entityId: string, ref: EntityGraphNodeRef, dict: EntityDict): EntityDict {
  const entry = dict[entityId]
  if (!entry) return dict
  const already = entry.graphNodes.some((r) => r.graphName === ref.graphName && r.nodeId === ref.nodeId)
  if (already) return dict
  return { ...dict, [entityId]: { ...entry, graphNodes: [...entry.graphNodes, ref] } }
}

/** Rename an entity's canonicalName, moving the previous name into aliases. */
export function renameEntity(entityId: string, newName: string, dict: EntityDict): EntityDict {
  const entry = dict[entityId]
  if (!entry) return dict
  const trimmed = newName.trim()
  if (!trimmed || trimmed === entry.canonicalName) return dict
  const aliases = entry.aliases.includes(entry.canonicalName)
    ? entry.aliases
    : [...entry.aliases, entry.canonicalName]
  return { ...dict, [entityId]: { ...entry, canonicalName: trimmed, aliases } }
}

export function addAlias(entityId: string, alias: string, dict: EntityDict): EntityDict {
  const entry = dict[entityId]
  if (!entry) return dict
  const trimmed = alias.trim()
  if (!trimmed || trimmed === entry.canonicalName || entry.aliases.includes(trimmed)) return dict
  return { ...dict, [entityId]: { ...entry, aliases: [...entry.aliases, trimmed] } }
}

export function removeAlias(entityId: string, alias: string, dict: EntityDict): EntityDict {
  const entry = dict[entityId]
  if (!entry) return dict
  return { ...dict, [entityId]: { ...entry, aliases: entry.aliases.filter((a) => a !== alias) } }
}

/**
 * Merge source into target: aliases and graphNodes combine, SQLite nodes owned
 * by source are renamed to target's canonicalName, and source is deleted.
 */
export async function mergeEntities(
  sourceId: string,
  targetId: string,
  dict: EntityDict,
  projectPath: string,
  projectName: string,
): Promise<EntityDict> {
  const source = dict[sourceId]
  const target = dict[targetId]
  if (!source || !target || sourceId === targetId) return dict

  const backend = await getGraphBackend(projectPath)
  for (const ref of source.graphNodes) {
    try {
      await backend.updateNodeName(projectName, ref.graphName, ref.nodeId, target.canonicalName)
    } catch (err) {
      console.warn(`[entity-dict] merge rename failed for ${ref.graphName}#${ref.nodeId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const mergedAliasSet = new Set([...target.aliases, source.canonicalName, ...source.aliases])
  mergedAliasSet.delete(target.canonicalName)
  const mergedGraphNodes = [...target.graphNodes, ...source.graphNodes]
  const mergedPagePaths = Array.from(new Set([...target.pagePaths, ...source.pagePaths]))
  const primaryPagePath = target.primaryPagePath ?? source.primaryPagePath

  const next = { ...dict }
  delete next[sourceId]
  next[targetId] = {
    ...target,
    aliases: Array.from(mergedAliasSet),
    graphNodes: mergedGraphNodes,
    pagePaths: mergedPagePaths,
    primaryPagePath,
  }
  return next
}

/**
 * Split an entity: move the given graph node refs off of `entityId` into a
 * newly created entity. Does not touch SQLite — the underlying nodes are
 * unchanged, only the dictionary-level grouping changes.
 */
export function splitEntity(
  entityId: string,
  newCanonicalName: string,
  splitNodeRefs: EntityGraphNodeRef[],
  dict: EntityDict,
): EntityDict {
  const entry = dict[entityId]
  if (!entry) return dict

  const isSplitRef = (ref: EntityGraphNodeRef) =>
    splitNodeRefs.some((s) => s.graphName === ref.graphName && s.nodeId === ref.nodeId)

  const remaining = entry.graphNodes.filter((ref) => !isSplitRef(ref))
  const moved = entry.graphNodes.filter(isSplitRef)

  const newEntry: EntityEntry = {
    id: crypto.randomUUID(),
    canonicalName: newCanonicalName.trim(),
    aliases: [],
    pagePaths: [],
    graphNodes: moved,
  }

  return {
    ...dict,
    [entityId]: { ...entry, graphNodes: remaining },
    [newEntry.id]: newEntry,
  }
}

/** Flatten canonicalName + aliases across the dictionary for prompt injection, capped for token budget. */
export function buildEntityHintsForPrompt(dict: EntityDict): string {
  const names = Object.values(dict).flatMap((e) => [e.canonicalName, ...e.aliases])
  return names.slice(0, MAX_HINT_NAMES).join(", ")
}
