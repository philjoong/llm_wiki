import { writeFile, createDirectory } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import type { Persona, PlayScenario } from "./types"

/** Render a scenario as markdown in the step-sequence format of docs/new-feature-dev.md. */
export function buildScenarioMarkdown(scenario: PlayScenario, persona: Persona | undefined): string {
  const lines: string[] = [
    `# 플레이 시나리오: ${scenario.title}`,
    "",
    `- **페르소나:** ${persona ? `${persona.name} — ${persona.description}` : scenario.personaId}`,
    `- **생성일:** ${new Date(scenario.createdAt).toLocaleString()}`,
    "",
    "## 스텝 시퀀스",
    "",
  ]
  scenario.steps.forEach((step, i) => {
    lines.push(`${i + 1}. ${step}`)
  })
  lines.push("")
  return lines.join("\n")
}

export function sanitizeFileName(name: string): string {
  const cleaned = name.trim().replace(/[\\/:*?"<>|#%]+/g, "-").replace(/\s+/g, " ")
  return cleaned || "scenario"
}

/** Write the scenario markdown to `qa/scenarios/<title>.md`; returns the relative path. */
export async function exportScenario(
  projectPath: string,
  scenario: PlayScenario,
  persona: Persona | undefined,
): Promise<string> {
  const pp = normalizePath(projectPath)
  const rel = `qa/scenarios/${sanitizeFileName(scenario.title)}.md`
  await createDirectory(`${pp}/qa/scenarios`)
  await writeFile(`${pp}/${rel}`, buildScenarioMarkdown(scenario, persona))
  return rel
}
