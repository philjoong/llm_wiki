import { describe, it, expect } from "vitest"
import fc from "fast-check"
import { generatePairwise } from "./pairwise"
import type { TestAxis } from "./types"

function axis(id: string, values: string[], enabled = true): TestAxis {
  return { id, name: id, values, enabled }
}

/** Every value pair across two distinct enabled axes appears in ≥1 combination. */
function allPairsCovered(axes: TestAxis[], combos: Record<string, string>[]): boolean {
  const active = axes.filter((a) => a.enabled && a.values.length > 0)
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      for (const av of active[i].values) {
        for (const bv of active[j].values) {
          const covered = combos.some(
            (c) => c[active[i].id] === av && c[active[j].id] === bv,
          )
          if (!covered) return false
        }
      }
    }
  }
  return true
}

describe("generatePairwise", () => {
  it("returns [] for no axes", () => {
    expect(generatePairwise([])).toEqual([])
  })

  it("single axis → one combination per value", () => {
    const combos = generatePairwise([axis("a", ["x", "y", "z"])])
    expect(combos).toEqual([{ a: "x" }, { a: "y" }, { a: "z" }])
  })

  it("covers all value pairs for the doc's axis shape (7 axes)", () => {
    const axes = [
      axis("state", ["로비", "전투 중", "이동 중", "사망", "로딩 중"]),
      axis("input", ["단일 입력", "연타", "길게 누름", "동시 입력"]),
      axis("timing", ["쿨타임 중", "쿨타임 아님"]),
      axis("resource", ["마나 충분", "마나 부족"]),
      axis("network", ["정상", "지연", "끊김", "재접속"]),
      axis("ui", ["없음", "팝업 표시 중"]),
      axis("app", ["포그라운드", "앱 최소화"]),
    ]
    const combos = generatePairwise(axes)
    expect(allPairsCovered(axes, combos)).toBe(true)
    // Pairwise must be far below full enumeration (5*4*2*2*4*2*2 = 1280).
    expect(combos.length).toBeLessThan(60)
  })

  it("skips disabled and empty axes", () => {
    const axes = [
      axis("a", ["1", "2"]),
      axis("b", ["x", "y"], false),
      axis("c", []),
      axis("d", ["p", "q"]),
    ]
    const combos = generatePairwise(axes)
    expect(allPairsCovered(axes, combos)).toBe(true)
    for (const c of combos) {
      expect(Object.keys(c).sort()).toEqual(["a", "d"])
    }
  })

  it("respects the cap", () => {
    const axes = [axis("a", ["1", "2", "3", "4", "5"]), axis("b", ["1", "2", "3", "4", "5"])]
    const combos = generatePairwise(axes, 3)
    expect(combos.length).toBe(3)
  })

  it("puts combinations containing priority values first", () => {
    const axes = [
      axis("state", ["로비", "전투 중"]),
      axis("network", ["정상", "지연", "끊김"]),
    ]
    const combos = generatePairwise(axes, 200, [{ axisId: "network", value: "끊김" }])
    expect(combos[0].network).toBe("끊김")
    expect(allPairsCovered(axes, combos)).toBe(true)
  })

  it("property: greedy output always covers all pairs (fast-check)", () => {
    const axisArb = fc
      .array(fc.string({ minLength: 1, maxLength: 3 }), { minLength: 1, maxLength: 5 })
      .map((values) => [...new Set(values)])
    fc.assert(
      fc.property(
        fc.array(axisArb, { minLength: 1, maxLength: 4 }),
        (valueSets) => {
          const axes = valueSets.map((values, i) => axis(`ax${i}`, values))
          const combos = generatePairwise(axes, 10_000)
          return allPairsCovered(axes, combos)
        },
      ),
      { numRuns: 50 },
    )
  })
})
