/**
 * Named predicate axes — the single source of truth shared by retrieval
 * (Step 01/04, traversal `allowedPredicates`) and accumulation (Step 06, the
 * ingest extraction instruction). Keeping one list ensures the edges ingest
 * writes are exactly the edges retrieval follows (§3.1).
 */
export const PREDICATE_AXES = {
  dependency: ["DEPENDS_ON", "AFFECTS", "MODIFIES", "DERIVES_FROM"],
} as const

export type PredicateAxisName = keyof typeof PREDICATE_AXES

/** Expand axis names to their concrete predicate list (deduped, unknown names ignored). */
export function predicatesForAxes(axes: readonly string[]): string[] {
  const out = new Set<string>()
  for (const axis of axes) {
    const predicates = PREDICATE_AXES[axis as PredicateAxisName]
    if (predicates) for (const predicate of predicates) out.add(predicate)
  }
  return Array.from(out)
}
