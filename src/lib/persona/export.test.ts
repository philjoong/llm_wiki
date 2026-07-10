import { describe, it, expect } from "vitest"
import { buildScenarioMarkdown, buildScenarioDbFields, sanitizeFileName } from "./export"
import { createPersona } from "./types"
import type { PlayScenario } from "./types"

function makeScenario(overrides: Partial<PlayScenario> = {}): PlayScenario {
  return {
    id: crypto.randomUUID(),
    personaId: "p1",
    title: "튜토리얼 스킵 시도",
    steps: ["로그인", "튜토리얼 건너뛰기 클릭"],
    createdAt: Date.now(),
    ...overrides,
  }
}

describe("buildScenarioMarkdown", () => {
  it("renders persona name/description and numbered steps", () => {
    const persona = createPersona("신규 유저", "게임을 처음 접하는 유저")
    const scenario = makeScenario()
    const md = buildScenarioMarkdown(scenario, persona)
    expect(md).toContain("# 플레이 시나리오: 튜토리얼 스킵 시도")
    expect(md).toContain("신규 유저 — 게임을 처음 접하는 유저")
    expect(md).toContain("1. 로그인")
    expect(md).toContain("2. 튜토리얼 건너뛰기 클릭")
  })
})

describe("buildScenarioDbFields", () => {
  it("carries persona name/description and scenario title+steps as narrative fields", () => {
    const persona = createPersona("신규 유저", "게임을 처음 접하는 유저")
    const scenario = makeScenario()

    const fields = buildScenarioDbFields(scenario, persona)

    expect(fields["페르소나"]).toBe("신규 유저 — 게임을 처음 접하는 유저")
    expect(fields["시나리오"]).toContain("튜토리얼 스킵 시도")
    expect(fields["시나리오"]).toContain("1. 로그인")
    expect(fields["시나리오"]).toContain("2. 튜토리얼 건너뛰기 클릭")
    expect(Object.keys(fields)).toEqual(["페르소나", "시나리오"])
  })

  it("falls back to personaId when the persona is not found", () => {
    const scenario = makeScenario({ personaId: "missing-persona" })

    const fields = buildScenarioDbFields(scenario, undefined)

    expect(fields["페르소나"]).toBe("missing-persona")
  })
})

describe("sanitizeFileName", () => {
  it("strips path-hostile characters and falls back on empty input", () => {
    expect(sanitizeFileName('시나리오: "긴급/수정"')).toBe("시나리오- -긴급-수정-")
    expect(sanitizeFileName("   ")).toBe("scenario")
  })
})
