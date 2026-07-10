import { writeFile, createDirectory } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { reIngestDocument } from "@/lib/ingest"
import type { LlmConfig } from "@/stores/wiki-store"
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

/**
 * Render the scenario as narrative field content for the graph pipeline
 * (`db/persona/<title>.md`, data type "persona"). Only the persona
 * description and the step sequence are carried as prose — no persona
 * traits array or scenario metadata.
 */
export function buildScenarioDbFields(scenario: PlayScenario, persona: Persona | undefined): Record<string, string> {
  return {
    "페르소나": persona ? `${persona.name} — ${persona.description}` : scenario.personaId,
    "시나리오": [`${scenario.title}`, ...scenario.steps.map((s, i) => `${i + 1}. ${s}`)].join("\n"),
  }
}

/**
 * Write the scenario markdown to `qa/scenarios/<title>.md`, then render
 * the same scenario as a narrative `db/persona/<title>.md` doc and
 * re-ingest it so the graph pipeline picks up the scenario. Returns the
 * `qa/scenarios` relative path (unchanged from before this doc-sync was
 * added).
 */
export async function exportScenario(
  projectPath: string,
  projectName: string,
  scenario: PlayScenario,
  persona: Persona | undefined,
  llmConfig: LlmConfig,
): Promise<string> {
  const pp = normalizePath(projectPath)
  const rel = `qa/scenarios/${sanitizeFileName(scenario.title)}.md`
  await createDirectory(`${pp}/qa/scenarios`)
  await writeFile(`${pp}/${rel}`, buildScenarioMarkdown(scenario, persona))

  const dbFields = buildScenarioDbFields(scenario, persona)
  const dbPagePath = `db/persona/${sanitizeFileName(scenario.title)}.md`
  await reIngestDocument(pp, projectName, dbPagePath, "", llmConfig, "persona", dbFields)

  return rel
}
