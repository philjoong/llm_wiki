import type { CandidateCombo, Combination, Rule, TestAxis } from "./types"

/**
 * IF-THEN rule parsing and application (pure functions).
 *
 * A rule's IF side is structured (axis name + value); its THEN side
 * (`effect`) is free text. Two effect shapes are recognized:
 *
 *  1. "<axis> = <value> 불가"  → pair exclusion: a combination is
 *     impossible when it has BOTH ifAxis=ifValue and that axis=value.
 *     e.g. "UI 충돌 = 상점 열림 불가"
 *  2. anything else            → condition exclusion: the IF condition
 *     alone makes the combination impossible for the feature under test.
 *     e.g. "스킬 사용 불가" (IF 상태 = 사망 → any combination in 사망 state
 *     cannot exercise the skill at all)
 */

export interface ParsedEffect {
  thenAxis?: string
  thenValue?: string
  raw: string
}

const PAIR_EFFECT = /^(.+?)\s*=\s*(.+?)\s*(?:불가|불가능)\s*$/

export function parseEffect(effect: string): ParsedEffect {
  const m = effect.trim().match(PAIR_EFFECT)
  if (m) return { thenAxis: m[1].trim(), thenValue: m[2].trim(), raw: effect }
  return { raw: effect }
}

function axisIdByName(axes: TestAxis[], name: string): string | undefined {
  const n = name.trim()
  return axes.find((a) => a.name.trim() === n)?.id
}

/** True when `rule` marks `combination` impossible. Disabled rules never match. */
export function ruleExcludes(rule: Rule, combination: Combination, axes: TestAxis[]): boolean {
  if (!rule.enabled) return false
  const ifAxisId = axisIdByName(axes, rule.ifAxis)
  if (!ifAxisId || combination[ifAxisId]?.trim() !== rule.ifValue.trim()) return false

  const effect = parseEffect(rule.effect)
  if (!effect.thenAxis) return true // condition exclusion
  const thenAxisId = axisIdByName(axes, effect.thenAxis)
  if (!thenAxisId) return false // pair exclusion referencing an axis this plan doesn't have
  return combination[thenAxisId]?.trim() === effect.thenValue
}

/**
 * Apply all rules to the candidate list, marking matches impossible with
 * source "rule". Candidates already marked impossible (or user-overridden)
 * are left untouched.
 */
export function applyRules(rules: Rule[], candidates: CandidateCombo[], axes: TestAxis[]): CandidateCombo[] {
  return candidates.map((c) => {
    if (c.impossible || c.overridden) return c
    const hit = rules.find((r) => ruleExcludes(r, c.combination, axes))
    if (!hit) return c
    return {
      ...c,
      impossible: true,
      impossibleSource: "rule" as const,
      impossibleReason: `IF ${hit.ifAxis} = ${hit.ifValue} THEN ${hit.effect}`,
    }
  })
}
