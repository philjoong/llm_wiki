import { writeFile, createDirectory } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
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
    `**특성:** ${plan.abstraction.map((t) => t.tag).join(", ")}`,
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

/** Write the markdown export to `qa/test-plans/<name>.md`; returns the relative path. */
export async function exportTestPlan(projectPath: string, plan: TestPlan): Promise<string> {
  const pp = normalizePath(projectPath)
  const rel = `qa/test-plans/${sanitizeFileName(plan.name)}.md`
  await createDirectory(`${pp}/qa/test-plans`)
  await writeFile(`${pp}/${rel}`, buildTestPlanMarkdown(plan))
  return rel
}
