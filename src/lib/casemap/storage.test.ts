import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { realFs, createTempProject } from "@/test-helpers/fs-temp"

vi.mock("@/commands/fs", () => realFs)

import { loadTestPlans, saveTestPlan, deleteTestPlan, loadRules, saveRules, DEFAULT_RULES } from "./storage"
import { createEmptyPlan } from "./types"

describe("casemap storage round-trip", () => {
  let projectPath: string
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    const tmp = await createTempProject("casemap")
    projectPath = tmp.path
    cleanup = tmp.cleanup
  })

  afterEach(async () => {
    await cleanup()
  })

  it("returns [] when the casemap dir doesn't exist", async () => {
    expect(await loadTestPlans(projectPath)).toEqual([])
  })

  it("save → load preserves plan contents", async () => {
    const plan = createEmptyPlan("파이어볼")
    plan.featureInput = "파이어볼은 적 1명을 대상으로 시전하는 마법 스킬이다."
    plan.abstraction = [{ tag: "시전형 스킬", entityId: "ent-1" }, { tag: "쿨타임 존재" }]
    plan.axes = [{ id: "a1", name: "상태", values: ["로비", "전투 중"], enabled: true }]
    plan.candidates = [{ id: "c1", combination: { a1: "전투 중" }, impossible: false }]
    plan.cases = [{
      id: "t1",
      combination: { a1: "전투 중" },
      purpose: "확인",
      preconditions: ["전투 중"],
      steps: ["버튼을 누른다"],
      expected: ["1회만 발동"],
      risk: "high",
      status: "generated",
    }]
    plan.step = 7
    await saveTestPlan(projectPath, plan)

    const loaded = await loadTestPlans(projectPath)
    expect(loaded).toHaveLength(1)
    const { updatedAt: _saved, ...savedRest } = loaded[0]
    const { updatedAt: _orig, ...origRest } = plan
    expect(savedRest).toEqual(origRest)
  })

  it("deleteTestPlan removes exactly that plan", async () => {
    const p1 = createEmptyPlan("plan-1")
    const p2 = createEmptyPlan("plan-2")
    await saveTestPlan(projectPath, p1)
    await saveTestPlan(projectPath, p2)
    await deleteTestPlan(projectPath, p1.id)
    const loaded = await loadTestPlans(projectPath)
    expect(loaded.map((p) => p.id)).toEqual([p2.id])
  })

  it("loadRules seeds the default rules when no rules.json exists", async () => {
    const rules = await loadRules(projectPath)
    expect(rules.map(({ id: _, ...rest }) => rest)).toEqual(DEFAULT_RULES)
    expect(new Set(rules.map((r) => r.id)).size).toBe(rules.length)
  })

  it("saveRules → loadRules round-trips and rules.json is not listed as a plan", async () => {
    const rules = [{ id: "r1", ifAxis: "상태", ifValue: "사망", effect: "스킬 사용 불가", enabled: false }]
    await saveRules(projectPath, rules)
    expect(await loadRules(projectPath)).toEqual(rules)
    expect(await loadTestPlans(projectPath)).toEqual([])
  })
})
