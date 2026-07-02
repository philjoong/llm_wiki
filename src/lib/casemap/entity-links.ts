import { addAlias, findCandidates, type EntityCandidate, type EntityDict } from "@/lib/entity-dict"
import type { AbstractionTag } from "./types"

/**
 * Tag ↔ entity-dict linking for wizard step 2 (docs/casemap-entity-link-plan.md).
 * Pure functions over the existing entity-dict matching — exact matches link
 * automatically, fuzzy matches only surface candidates for user confirmation.
 */

/** Auto-link unlinked tags whose text exactly matches an entity name. */
export function linkExactTags(tags: AbstractionTag[], dict: EntityDict): AbstractionTag[] {
  return tags.map((t) => {
    if (t.entityId) return t
    const exact = findCandidates(t.tag, dict).find((c) => c.match === "exact")
    return exact ? { ...t, entityId: exact.entry.id } : t
  })
}

/** Fuzzy candidates for an unlinked tag (exact matches are handled by linkExactTags). */
export function fuzzyCandidates(tag: AbstractionTag, dict: EntityDict): EntityCandidate[] {
  if (tag.entityId) return []
  return findCandidates(tag.tag, dict).filter((c) => c.match === "fuzzy")
}

/**
 * User approved a fuzzy suggestion: link the tag to the entity and record the
 * tag text as an alias so future prompts/ingests recognize it (Phase C).
 */
export function approveTagLink(
  tags: AbstractionTag[],
  tagText: string,
  entityId: string,
  dict: EntityDict,
): { tags: AbstractionTag[]; dict: EntityDict } {
  return {
    tags: tags.map((t) => (t.tag === tagText ? { ...t, entityId } : t)),
    dict: addAlias(entityId, tagText, dict),
  }
}
