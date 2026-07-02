import { describe, it, expect } from "vitest"
import { applyRules, parseEffect, ruleExcludes } from "./rule-filter"
import type { CandidateCombo, Rule, TestAxis } from "./types"

// Fixtures: the five example rules from docs/new-feature-dev.md §1.5.
const DOC_RULES: Rule[] = [
  { id: "r1", ifAxis: "상태", ifValue: "사망", effect: "입력 = 스킬 사용 불가", enabled: true },
  { id: "r2", ifAxis: "상태", ifValue: "로딩 중", effect: "UI 충돌 = 상점 열림 불가", enabled: true },
  { id: "r3", ifAxis: "상태", ifValue: "로비", effect: "전투 스킬 사용 불가", enabled: true },
  { id: "r4", ifAxis: "리소스", ifValue: "마나 부족", effect: "스킬 성공 불가", enabled: true },
  { id: "r5", ifAxis: "인벤토리", ifValue: "가득 참", effect: "보상 아이템 지급 실패 또는 우편 이동", enabled: true },
]

const AXES: TestAxis[] = [
  { id: "ax-state", name: "상태", values: ["로비", "전투 중", "사망", "로딩 중"], enabled: true },
  { id: "ax-input", name: "입력", values: ["단일 입력", "연타", "스킬 사용"], enabled: true },
  { id: "ax-ui", name: "UI 충돌", values: ["없음", "상점 열림", "팝업 표시 중"], enabled: true },
  { id: "ax-res", name: "리소스", values: ["마나 충분", "마나 부족"], enabled: true },
]

describe("parseEffect", () => {
  it("parses '<axis> = <value> 불가' into a pair exclusion", () => {
    expect(parseEffect("UI 충돌 = 상점 열림 불가")).toEqual({
      thenAxis: "UI 충돌",
      thenValue: "상점 열림",
      raw: "UI 충돌 = 상점 열림 불가",
    })
  })

  it("treats effects without '=' as condition-only (free text)", () => {
    expect(parseEffect("전투 스킬 사용 불가").thenAxis).toBeUndefined()
    expect(parseEffect("보상 아이템 지급 실패 또는 우편 이동").thenAxis).toBeUndefined()
  })
})

describe("ruleExcludes", () => {
  it("pair exclusion needs BOTH the IF condition and the THEN pair", () => {
    const rule = DOC_RULES[1] // 로딩 중 → 상점 열림 불가
    expect(ruleExcludes(rule, { "ax-state": "로딩 중", "ax-ui": "상점 열림" }, AXES)).toBe(true)
    expect(ruleExcludes(rule, { "ax-state": "로딩 중", "ax-ui": "없음" }, AXES)).toBe(false)
    expect(ruleExcludes(rule, { "ax-state": "전투 중", "ax-ui": "상점 열림" }, AXES)).toBe(false)
  })

  it("condition exclusion fires on the IF condition alone", () => {
    const rule = DOC_RULES[2] // 로비 → 전투 스킬 사용 불가
    expect(ruleExcludes(rule, { "ax-state": "로비", "ax-input": "연타" }, AXES)).toBe(true)
    expect(ruleExcludes(rule, { "ax-state": "전투 중", "ax-input": "연타" }, AXES)).toBe(false)
  })

  it("ignores disabled rules", () => {
    const rule = { ...DOC_RULES[2], enabled: false }
    expect(ruleExcludes(rule, { "ax-state": "로비" }, AXES)).toBe(false)
  })

  it("ignores rules whose IF axis doesn't exist in this plan", () => {
    const rule = DOC_RULES[4] // 인벤토리 축 없음
    expect(ruleExcludes(rule, { "ax-state": "전투 중" }, AXES)).toBe(false)
  })

  it("pair exclusion referencing a missing THEN axis never fires", () => {
    const rule: Rule = { id: "rx", ifAxis: "상태", ifValue: "전투 중", effect: "날씨 = 비 불가", enabled: true }
    expect(ruleExcludes(rule, { "ax-state": "전투 중" }, AXES)).toBe(false)
  })
})

describe("applyRules", () => {
  function cand(id: string, combination: Record<string, string>): CandidateCombo {
    return { id, combination, impossible: false }
  }

  it("marks matches impossible with source 'rule' and a readable reason", () => {
    const out = applyRules(
      DOC_RULES,
      [cand("c1", { "ax-state": "사망", "ax-input": "스킬 사용" }), cand("c2", { "ax-state": "전투 중", "ax-input": "연타" })],
      AXES,
    )
    expect(out[0].impossible).toBe(true)
    expect(out[0].impossibleSource).toBe("rule")
    expect(out[0].impossibleReason).toContain("IF 상태 = 사망")
    expect(out[1].impossible).toBe(false)
  })

  it("does not touch user-overridden candidates", () => {
    const overridden: CandidateCombo = {
      id: "c1",
      combination: { "ax-state": "로비" },
      impossible: false,
      overridden: true,
    }
    const out = applyRules(DOC_RULES, [overridden], AXES)
    expect(out[0].impossible).toBe(false)
  })
})
