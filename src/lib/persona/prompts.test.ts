import { describe, it, expect } from "vitest"
import { buildScenarioPrompt, parseScenarioResponse } from "./prompts"
import { buildScenarioMarkdown } from "./export"
import type { Persona, PlayScenario } from "./types"

const PERSONA: Persona = {
  id: "p1",
  name: "숙련 유저",
  description: "빠른 입력을 많이 하는 숙련 유저",
  traits: ["연타", "동시 입력"],
}

describe("buildScenarioPrompt", () => {
  it("embeds persona, feature text, count and language directive", () => {
    const { system, user } = buildScenarioPrompt(PERSONA, "파이어볼 스킬", 3, "LANG-DIRECTIVE")
    expect(system).toContain("LANG-DIRECTIVE")
    expect(system).toContain("exactly 3 scenarios")
    expect(user).toContain("숙련 유저")
    expect(user).toContain("연타, 동시 입력")
    expect(user).toContain("파이어볼 스킬")
    expect(user).toContain("Output ONLY a JSON object")
  })
})

describe("parseScenarioResponse", () => {
  it("parses scenarios and drops malformed entries", () => {
    const raw = JSON.stringify({
      scenarios: [
        { title: "전투 연속 입력", steps: ["전투 진입", "스킬 버튼 연타", " "] },
        { title: "", steps: ["x"] },
        { title: "스텝 없음", steps: [] },
      ],
    })
    const out = parseScenarioResponse(raw)
    expect(out).toEqual([{ title: "전투 연속 입력", steps: ["전투 진입", "스킬 버튼 연타"] }])
  })

  it("tolerates code fences", () => {
    const raw = '```json\n{"scenarios": [{"title": "t", "steps": ["a"]}]}\n```'
    expect(parseScenarioResponse(raw)).toHaveLength(1)
  })

  it("throws when nothing usable comes back", () => {
    expect(() => parseScenarioResponse('{"scenarios": []}')).toThrow(/no usable scenarios/)
    expect(() => parseScenarioResponse("prose only")).toThrow(/No JSON object/)
  })
})

describe("buildScenarioMarkdown", () => {
  it("renders title, persona and numbered step sequence", () => {
    const scenario: PlayScenario = {
      id: "s1",
      personaId: "p1",
      title: "전투 연속 입력",
      steps: ["전투 진입", "이동 중 스킬 버튼 연타"],
      createdAt: 0,
    }
    const md = buildScenarioMarkdown(scenario, PERSONA)
    expect(md).toContain("# 플레이 시나리오: 전투 연속 입력")
    expect(md).toContain("숙련 유저 — 빠른 입력을 많이 하는 숙련 유저")
    expect(md).toContain("1. 전투 진입")
    expect(md).toContain("2. 이동 중 스킬 버튼 연타")
  })
})
