import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { realFs, createTempProject } from "@/test-helpers/fs-temp"

vi.mock("@/commands/fs", () => realFs)

import { loadPersonas, savePersonas, loadScenarios, saveScenarios, DEFAULT_PERSONAS } from "./storage"
import { createPersona } from "./types"
import type { PlayScenario } from "./types"

describe("persona storage round-trip", () => {
  let projectPath: string
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    const tmp = await createTempProject("persona")
    projectPath = tmp.path
    cleanup = tmp.cleanup
  })

  afterEach(async () => {
    await cleanup()
  })

  it("seeds default personas when personas.json doesn't exist", async () => {
    const personas = await loadPersonas(projectPath)
    expect(personas.map(({ id: _, ...rest }) => rest)).toEqual(DEFAULT_PERSONAS)
    expect(new Set(personas.map((p) => p.id)).size).toBe(personas.length)
  })

  it("save → load preserves personas (seeds are not re-added)", async () => {
    const personas = [createPersona("숙련 유저", "빠른 입력을 많이 하는 숙련 유저", ["연타"])]
    await savePersonas(projectPath, personas)
    expect(await loadPersonas(projectPath)).toEqual(personas)
  })

  it("scenarios default to [] and round-trip", async () => {
    expect(await loadScenarios(projectPath)).toEqual([])
    const scenarios: PlayScenario[] = [{
      id: "s1",
      personaId: "p1",
      title: "전투 연속 입력",
      steps: ["전투 진입", "이동 중 스킬 버튼 연타", "결과 화면 진입"],
      createdAt: 123,
    }]
    await saveScenarios(projectPath, scenarios)
    expect(await loadScenarios(projectPath)).toEqual(scenarios)
  })
})
