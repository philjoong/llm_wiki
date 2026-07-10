import { writeFile, createDirectory } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { reIngestDocument } from "@/lib/ingest"
import type { LlmConfig } from "@/stores/wiki-store"
import { renderCombination } from "./prompts"
import type { TestPlan } from "./types"

const RISK_LABEL = { high: "High", medium: "Medium", low: "Low" } as const

/**
 * Render a finalized plan as a markdown test-plan document following the
 * case format of docs/new-feature-dev.md §1.7 (목적/사전 조건/절차/기대 결과).
 * Excluded cases are NOT exported — they stay in the plan JSON only.
 */
export function buildTestPlanMarkdown(plan: TestPlan): string {
  const included = plan.cases.filter((c) => c.status !== "excluded")
  const lines: string[] = [
    `# 테스트 플랜: ${plan.name}`,
    "",
    "## 기능 정보",
    "",
    plan.featureInput.trim(),
    "",
    `**특성:** ${plan.abstraction.join(", ")}`,
    "",
    `## 테스트케이스 (${included.length}건)`,
    "",
  ]
  included.forEach((tc, i) => {
    lines.push(`### TC-${String(i + 1).padStart(3, "0")} [${RISK_LABEL[tc.risk]}] ${tc.purpose}`)
    lines.push("")
    const combo = renderCombination(tc.combination, plan.axes)
    if (combo) {
      lines.push(`- **조합:** ${combo}`)
      lines.push("")
    }
    lines.push(`- 테스트 목적: ${tc.purpose}`)
    lines.push("- 사전 조건:")
    tc.preconditions.forEach((p, n) => lines.push(`  ${n + 1}. ${p}`))
    lines.push("- 테스트 절차:")
    tc.steps.forEach((s, n) => lines.push(`  ${n + 1}. ${s}`))
    lines.push("- 기대 결과:")
    tc.expected.forEach((e, n) => lines.push(`  ${n + 1}. ${e}`))
    lines.push("")
  })
  return lines.join("\n")
}

export function sanitizeFileName(name: string): string {
  const cleaned = name.trim().replace(/[\\/:*?"<>|#%]+/g, "-").replace(/\s+/g, " ")
  return cleaned || "test-plan"
}

/**
 * Render the finalized plan as narrative field content for the graph
 * pipeline (`db/casemap/<name>.md`, data type "casemap"). Unlike
 * buildTestPlanMarkdown(), this only carries the feature description,
 * abstraction tags, and confirmed test cases as prose — no axes, rules,
 * or risk-grading intermediates.
 */
export function buildTestPlanDbFields(plan: TestPlan): Record<string, string> {
  const included = plan.cases.filter((c) => c.status !== "excluded")
  const cases = included.map((tc, i) => {
    const combo = renderCombination(tc.combination, plan.axes)
    const lines = [
      `${i + 1}. [${RISK_LABEL[tc.risk]}] ${tc.purpose}`,
      combo ? `조합: ${combo}` : null,
      `사전 조건: ${tc.preconditions.join("; ")}`,
      `절차: ${tc.steps.join("; ")}`,
      `기대 결과: ${tc.expected.join("; ")}`,
    ].filter(Boolean)
    return lines.join("\n   ")
  })
  return {
    "기능 정보": plan.featureInput.trim(),
    "특성": plan.abstraction.join(", "),
    "테스트케이스": cases.join("\n\n"),
  }
}

/**
 * Write the markdown export to `qa/test-plans/<name>.md`, then render the
 * same plan as a narrative `db/casemap/<name>.md` doc and re-ingest it so
 * the graph pipeline picks up the finalized test cases. Returns the
 * `qa/test-plans` relative path (unchanged from before this doc-sync was
 * added).
 */
export async function exportTestPlan(
  projectPath: string,
  projectName: string,
  plan: TestPlan,
  llmConfig: LlmConfig,
): Promise<string> {
  const pp = normalizePath(projectPath)
  const rel = `qa/test-plans/${sanitizeFileName(plan.name)}.md`
  await createDirectory(`${pp}/qa/test-plans`)
  await writeFile(`${pp}/${rel}`, buildTestPlanMarkdown(plan))

  const dbFields = buildTestPlanDbFields(plan)
  const dbPagePath = `db/casemap/${sanitizeFileName(plan.name)}.md`
  await reIngestDocument(pp, projectName, dbPagePath, "", llmConfig, "casemap", dbFields)

  return rel
}
