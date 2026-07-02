import { readFile, writeFile, createDirectory, deleteFile, listDirectory } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import type { Rule, TestPlan } from "./types"

const CASEMAP_DIR = ".llm-wiki/casemap"
const RULES_FILE = "rules.json"

function casemapDir(projectPath: string): string {
  return `${normalizePath(projectPath)}/${CASEMAP_DIR}`
}

export async function loadTestPlans(projectPath: string): Promise<TestPlan[]> {
  let nodes
  try {
    nodes = await listDirectory(casemapDir(projectPath))
  } catch {
    return []
  }
  const plans: TestPlan[] = []
  for (const node of nodes) {
    if (node.is_dir || !node.name.endsWith(".json") || node.name === RULES_FILE) continue
    try {
      const raw = await readFile(`${casemapDir(projectPath)}/${node.name}`)
      plans.push(JSON.parse(raw) as TestPlan)
    } catch (err) {
      console.warn(`[casemap] skipping unreadable plan file ${node.name}:`, err)
    }
  }
  return plans.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function saveTestPlan(projectPath: string, plan: TestPlan): Promise<void> {
  await createDirectory(casemapDir(projectPath))
  const updated = { ...plan, updatedAt: Date.now() }
  await writeFile(`${casemapDir(projectPath)}/${plan.id}.json`, JSON.stringify(updated, null, 2))
}

export async function deleteTestPlan(projectPath: string, planId: string): Promise<void> {
  await deleteFile(`${casemapDir(projectPath)}/${planId}.json`)
}

/** Example rules from docs/new-feature-dev.md §1.5, seeded on first load. */
export const DEFAULT_RULES: Omit<Rule, "id">[] = [
  { ifAxis: "상태", ifValue: "사망", effect: "스킬 사용 불가", enabled: true },
  { ifAxis: "상태", ifValue: "로딩 중", effect: "UI 충돌 = 상점 열림 불가", enabled: true },
  { ifAxis: "상태", ifValue: "로비", effect: "전투 스킬 사용 불가", enabled: true },
]

export async function loadRules(projectPath: string): Promise<Rule[]> {
  try {
    const raw = await readFile(`${casemapDir(projectPath)}/${RULES_FILE}`)
    return JSON.parse(raw) as Rule[]
  } catch {
    return DEFAULT_RULES.map((r) => ({ ...r, id: crypto.randomUUID() }))
  }
}

export async function saveRules(projectPath: string, rules: Rule[]): Promise<void> {
  await createDirectory(casemapDir(projectPath))
  await writeFile(`${casemapDir(projectPath)}/${RULES_FILE}`, JSON.stringify(rules, null, 2))
}
