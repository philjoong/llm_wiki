import { describe, it, expect } from "vitest"
import { buildTestPlanMarkdown, buildTestPlanDbFields, sanitizeFileName } from "./export"
import { createEmptyPlan } from "./types"
import type { TestCase } from "./types"

function makeCase(overrides: Partial<TestCase>): TestCase {
  return {
    id: crypto.randomUUID(),
    combination: {},
    purpose: "",
    preconditions: [],
    steps: [],
    expected: [],
    risk: "medium",
    status: "generated",
    ...overrides,
  }
}

describe("buildTestPlanMarkdown", () => {
  it("renders the doc's case format (목적/사전 조건/절차/기대 결과) with numbering", () => {
    const plan = createEmptyPlan("파이어볼")
    plan.featureInput = "파이어볼은 적 1명을 대상으로 시전하는 마법 스킬이다."
    plan.abstraction = ["시전형 스킬", "쿨타임 존재"]
    plan.axes = [
      { id: "a1", name: "상태", values: ["전투 중"], enabled: true },
      { id: "a2", name: "네트워크", values: ["지연"], enabled: true },
    ]
    plan.cases = [
      makeCase({
        combination: { a1: "전투 중", a2: "지연" },
        purpose: "네트워크 지연 상황에서 중복 차감이 없는지 확인",
        preconditions: ["캐릭터가 전투 중이다", "마나가 충분하다"],
        steps: ["파이어볼 버튼을 누른다", "응답 지연 중 연타한다"],
        expected: ["마나는 1회만 차감된다"],
        risk: "high",
      }),
    ]
    const md = buildTestPlanMarkdown(plan)
    expect(md).toContain("# 테스트 플랜: 파이어볼")
    expect(md).toContain("**특성:** 시전형 스킬, 쿨타임 존재")
    expect(md).toContain("[High]")
    expect(md).toContain("**조합:** 상태=전투 중 / 네트워크=지연")
    expect(md).toContain("- 테스트 목적: 네트워크 지연 상황에서 중복 차감이 없는지 확인")
    expect(md).toContain("- 사전 조건:\n  1. 캐릭터가 전투 중이다\n  2. 마나가 충분하다")
    expect(md).toContain("- 테스트 절차:\n  1. 파이어볼 버튼을 누른다\n  2. 응답 지연 중 연타한다")
    expect(md).toContain("- 기대 결과:\n  1. 마나는 1회만 차감된다")
  })

  it("omits excluded cases from the export (they stay in the plan JSON)", () => {
    const plan = createEmptyPlan("plan")
    plan.cases = [
      makeCase({ purpose: "포함되는 케이스", risk: "high" }),
      makeCase({ purpose: "제외된 케이스", status: "excluded" }),
    ]
    const md = buildTestPlanMarkdown(plan)
    expect(md).toContain("포함되는 케이스")
    expect(md).not.toContain("제외된 케이스")
    expect(md).toContain("테스트케이스 (1건)")
    // the excluded case is still present on the plan object itself
    expect(plan.cases.some((c) => c.status === "excluded")).toBe(true)
  })
})

describe("buildTestPlanDbFields", () => {
  it("carries feature input and abstraction tags verbatim as narrative fields", () => {
    const plan = createEmptyPlan("파이어볼")
    plan.featureInput = "  파이어볼 스킬 설명  "
    plan.abstraction = ["시전형 스킬", "쿨타임 존재"]
    plan.cases = [makeCase({ purpose: "기본 동작 확인" })]

    const fields = buildTestPlanDbFields(plan)

    expect(fields["기능 정보"]).toBe("파이어볼 스킬 설명")
    expect(fields["특성"]).toBe("시전형 스킬, 쿨타임 존재")
    expect(Object.keys(fields)).toEqual(["기능 정보", "특성", "테스트케이스"])
  })

  it("excludes cases with status 'excluded' from the 테스트케이스 field", () => {
    const plan = createEmptyPlan("파이어볼")
    plan.cases = [
      makeCase({ purpose: "포함 케이스" }),
      makeCase({ purpose: "제외 케이스", status: "excluded" }),
    ]

    const fields = buildTestPlanDbFields(plan)

    expect(fields["테스트케이스"]).toContain("포함 케이스")
    expect(fields["테스트케이스"]).not.toContain("제외 케이스")
  })

  it("includes the axis/value combination and risk label per case", () => {
    const plan = createEmptyPlan("파이어볼")
    plan.axes = [{ id: "a1", name: "상태", values: ["사망"], enabled: true }]
    plan.cases = [makeCase({ combination: { a1: "사망" }, risk: "high" })]

    const fields = buildTestPlanDbFields(plan)

    expect(fields["테스트케이스"]).toContain("상태=사망")
    expect(fields["테스트케이스"]).toContain("[High]")
  })
})

describe("sanitizeFileName", () => {
  it("strips path-hostile characters and falls back on empty input", () => {
    expect(sanitizeFileName('파이어볼: "긴급/수정"')).toBe("파이어볼- -긴급-수정-")
    expect(sanitizeFileName("   ")).toBe("test-plan")
  })
})
