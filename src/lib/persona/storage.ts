import { readFile, writeFile, createDirectory } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import type { Persona, PlayScenario } from "./types"

const PERSONAS_PATH = ".llm-wiki/personas.json"
const SCENARIOS_PATH = ".llm-wiki/scenarios.json"

/** Seed personas offered on first load (docs/new-feature-dev-plan.md §3.1). */
export const DEFAULT_PERSONAS: Omit<Persona, "id">[] = [
  {
    name: "숙련 유저",
    description: "빠른 입력을 많이 하는 숙련 유저",
    traits: ["연타", "동시 입력", "쿨타임 직후 재입력", "최적 동선 숙지"],
  },
  {
    name: "신규 유저",
    description: "튜토리얼을 갓 마친 신규 유저",
    traits: ["느린 입력", "UI 탐색 시행착오", "설명 팝업 의존"],
  },
  {
    name: "불안정 네트워크 유저",
    description: "이동 중 모바일 네트워크로 플레이하는 유저",
    traits: ["네트워크 지연", "재접속 빈번", "앱 최소화 후 복귀"],
  },
]

export async function loadPersonas(projectPath: string): Promise<Persona[]> {
  try {
    const raw = await readFile(`${normalizePath(projectPath)}/${PERSONAS_PATH}`)
    return JSON.parse(raw) as Persona[]
  } catch {
    return DEFAULT_PERSONAS.map((p) => ({ ...p, id: crypto.randomUUID() }))
  }
}

export async function savePersonas(projectPath: string, personas: Persona[]): Promise<void> {
  const pp = normalizePath(projectPath)
  await createDirectory(`${pp}/.llm-wiki`)
  await writeFile(`${pp}/${PERSONAS_PATH}`, JSON.stringify(personas, null, 2))
}

export async function loadScenarios(projectPath: string): Promise<PlayScenario[]> {
  try {
    const raw = await readFile(`${normalizePath(projectPath)}/${SCENARIOS_PATH}`)
    return JSON.parse(raw) as PlayScenario[]
  } catch {
    return []
  }
}

export async function saveScenarios(projectPath: string, scenarios: PlayScenario[]): Promise<void> {
  const pp = normalizePath(projectPath)
  await createDirectory(`${pp}/.llm-wiki`)
  await writeFile(`${pp}/${SCENARIOS_PATH}`, JSON.stringify(scenarios, null, 2))
}
