/** Stable identifiers are generated once and never derived from names or paths. */
export const ID_PREFIXES = ["page", "sec", "ent", "graph", "node", "assert", "evidence", "tag"] as const

export type KnowledgeIdPrefix = (typeof ID_PREFIXES)[number]
export type KnowledgeId = `${KnowledgeIdPrefix}-${string}`

// ULIDs use Crockford Base32. The first character is limited by the 48-bit
// timestamp and therefore cannot be 8-Z.
const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/
const RANDOM_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

function encodeTimestamp(timestamp: number): string {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > 0xffff_ffff_ffff) {
    throw new Error("timestamp must fit in an unsigned 48-bit integer")
  }

  let value = timestamp
  let result = ""
  for (let index = 0; index < 10; index += 1) {
    result = RANDOM_ALPHABET[value % 32] + result
    value = Math.floor(value / 32)
  }
  return result
}

function randomUlidSuffix(): string {
  const values = new Uint8Array(16)
  crypto.getRandomValues(values)
  return Array.from(values, (value) => RANDOM_ALPHABET[value & 31]).join("")
}

export function createKnowledgeId(prefix: KnowledgeIdPrefix, now = Date.now()): KnowledgeId {
  return `${prefix}-${encodeTimestamp(now)}${randomUlidSuffix()}`
}

export function isKnowledgeId(value: string, prefix?: KnowledgeIdPrefix): value is KnowledgeId {
  const separator = value.indexOf("-")
  if (separator <= 0) return false

  const actualPrefix = value.slice(0, separator)
  const ulid = value.slice(separator + 1)
  return (prefix === undefined ? ID_PREFIXES.includes(actualPrefix as KnowledgeIdPrefix) : actualPrefix === prefix)
    && ULID_PATTERN.test(ulid)
}

export function assertKnowledgeId(value: string, prefix?: KnowledgeIdPrefix): asserts value is KnowledgeId {
  if (!isKnowledgeId(value, prefix)) {
    const expected = prefix ? `${prefix}-<ULID>` : "<knowledge-prefix>-<ULID>"
    throw new Error(`Invalid knowledge ID '${value}'; expected ${expected}`)
  }
}

export const createPageId = () => createKnowledgeId("page")
export const createSectionId = () => createKnowledgeId("sec")
export const createEntityId = () => createKnowledgeId("ent")
export const createGraphId = () => createKnowledgeId("graph")
export const createNodeId = () => createKnowledgeId("node")
export const createAssertionId = () => createKnowledgeId("assert")
export const createEvidenceId = () => createKnowledgeId("evidence")
export const createTagId = () => createKnowledgeId("tag")
