import type { Combination, TestAxis } from "./types"

/**
 * Greedy pairwise (all-pairs) combination generation.
 *
 * Produces a small set of combinations such that every pair of values
 * from two different enabled axes appears in at least one combination —
 * the standard greedy covering-array construction. Full enumeration is
 * never done (8 axes × 6 values would be ~1.6M rows); the result size
 * grows roughly with (largest axis)² and is additionally capped.
 *
 * Each loop iteration is guaranteed to cover at least one uncovered pair
 * (greedy first, with a seed-from-uncovered-pair fallback), so unless
 * `cap` truncates, the result always covers all pairs.
 *
 * @param priorityValues values considered high-risk (e.g. 네트워크=끊김);
 *   pairs involving them are covered first, so the risky combinations
 *   appear at the front of the returned list even when `cap` truncates.
 */
export function generatePairwise(
  axes: TestAxis[],
  cap: number = 200,
  priorityValues: { axisId: string; value: string }[] = [],
): Combination[] {
  const active = axes.filter((a) => a.enabled && a.values.length > 0)
  if (active.length === 0) return []
  if (active.length === 1) {
    return active[0].values.slice(0, cap).map((v) => ({ [active[0].id]: v }))
  }

  const isPriority = (axisId: string, value: string) =>
    priorityValues.some((p) => p.axisId === axisId && p.value === value)

  interface Pair { i: number; av: string; j: number; bv: string }
  const pairKey = (i: number, av: string, j: number, bv: string) =>
    `${i}::${av}||${j}::${bv}`

  // All uncovered pairs, keyed by (axis index, value) with i < j.
  const uncovered = new Map<string, Pair>()
  // Subset involving at least one priority value — targeted first.
  const priorityKeys = new Set<string>()
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      for (const av of active[i].values) {
        for (const bv of active[j].values) {
          const key = pairKey(i, av, j, bv)
          uncovered.set(key, { i, av, j, bv })
          if (isPriority(active[i].id, av) || isPriority(active[j].id, bv)) {
            priorityKeys.add(key)
          }
        }
      }
    }
  }

  // Count of uncovered pairs involving (axis, value) — the lookahead term.
  const involving = (i: number, v: string): number => {
    let n = 0
    for (const p of uncovered.values()) {
      if ((p.i === i && p.av === v) || (p.j === i && p.bv === v)) {
        n += priorityKeys.has(pairKey(p.i, p.av, p.j, p.bv)) ? 1000 : 1
      }
    }
    return n
  }

  const markCovered = (chosen: string[]): number => {
    let n = 0
    for (let i = 0; i < chosen.length; i++) {
      for (let j = i + 1; j < chosen.length; j++) {
        const key = pairKey(i, chosen[i], j, chosen[j])
        if (uncovered.delete(key)) n++
        priorityKeys.delete(key)
      }
    }
    return n
  }

  const toCombination = (chosen: string[]): Combination => {
    const combo: Combination = {}
    active.forEach((axis, i) => { combo[axis.id] = chosen[i] })
    return combo
  }

  const combos: Combination[] = []
  while (uncovered.size > 0 && combos.length < cap) {
    // Build one combination greedily, axis by axis. Direct coverage of
    // uncovered pairs against already-chosen values dominates; a small
    // lookahead term (uncovered pairs anywhere involving this value)
    // breaks ties toward values that still have work left.
    const chosen: string[] = []
    for (let i = 0; i < active.length; i++) {
      let bestValue = active[i].values[0]
      let bestScore = -1
      for (const v of active[i].values) {
        let direct = 0
        for (let j = 0; j < chosen.length; j++) {
          const key = pairKey(j, chosen[j], i, v)
          if (uncovered.has(key)) direct += priorityKeys.has(key) ? 1000 : 1
        }
        const score = direct * 1_000_000 + involving(i, v)
        if (score > bestScore) {
          bestScore = score
          bestValue = v
        }
      }
      chosen.push(bestValue)
    }

    if (markCovered(chosen) > 0) {
      combos.push(toCombination(chosen))
      continue
    }

    // Greedy produced a combo covering nothing new (its per-axis choices
    // were myopic). Seed directly from an uncovered pair — a priority one
    // if any remain — so every iteration makes progress.
    let seed: Pair | undefined
    for (const [key, p] of uncovered) {
      seed = p
      if (priorityKeys.has(key)) break
      if (priorityKeys.size === 0) break
    }
    if (!seed) break // unreachable: uncovered.size > 0
    const seeded: string[] = []
    for (let i = 0; i < active.length; i++) {
      if (i === seed.i) { seeded.push(seed.av); continue }
      if (i === seed.j) { seeded.push(seed.bv); continue }
      // Fill remaining axes by direct coverage against what's fixed so far.
      let bestValue = active[i].values[0]
      let bestScore = -1
      for (const v of active[i].values) {
        let direct = 0
        for (let j = 0; j < seeded.length; j++) {
          const key = pairKey(j, seeded[j], i, v)
          if (uncovered.has(key)) direct += priorityKeys.has(key) ? 1000 : 1
        }
        if (direct > bestScore) {
          bestScore = direct
          bestValue = v
        }
      }
      seeded.push(bestValue)
    }
    markCovered(seeded)
    combos.push(toCombination(seeded))
  }
  return combos
}
