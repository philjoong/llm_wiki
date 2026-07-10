import { streamChat, isCliProvider } from "@/lib/llm-client"
import { streamClaudeCodeCli } from "@/lib/claude-cli-transport"
import { streamGeminiCli } from "@/lib/gemini-cli-transport"
import { streamCodexCli } from "@/lib/codex-cli-transport"
import type { ChatMessage } from "@/lib/llm-providers"
import type { LlmConfig } from "@/stores/wiki-store"
import { buildLanguageDirective } from "@/lib/output-language"
import { getGraphContext, formatGraphContextBlocks } from "@/lib/graph-qna"
import { generatePairwise } from "./pairwise"
import {
  buildAbstractionPrompt,
  buildAxisPrompt,
  buildImpossiblePrompt,
  buildRiskPrompt,
  buildTestCasePrompt,
  parseAbstractionResponse,
  parseAxisResponse,
  parseImpossibleResponse,
  parseRiskResponse,
  parseTestCaseResponse,
  type AxisRecommendation,
} from "./prompts"
import type { CandidateCombo, TestAxis, TestCase } from "./types"

/** Cap on generated combinations (docs/new-feature-dev-plan.md §5). */
export const COMBINATION_CAP = 200
/** Batch size for per-combination LLM calls (filter/risk). */
const BATCH_SIZE = 20
/** Test-case documents are longer — smaller batches. */
const CASE_BATCH_SIZE = 8

/**
 * Single model-call helper, mirroring ingest.ts's callModel: HTTP
 * providers get response_format json_object; local-CLI coding agents run
 * with tools disabled and rely on the prompt's JSON-only instruction.
 * (Deliberately duplicated per lib rather than extracted — see plan §1.)
 */
async function callModel(
  llmConfig: LlmConfig,
  systemPrompt: string,
  userContent: string,
  signal: AbortSignal | undefined,
  projectPath: string,
): Promise<string> {
  if (isCliProvider(llmConfig.provider)) {
    let buffer = ""
    await new Promise<void>((resolve, reject) => {
      const cb = {
        onToken: (token: string) => { buffer += token },
        onDone: () => resolve(),
        onError: (err: Error) => reject(err),
      }
      const combined: ChatMessage[] = [{ role: "user", content: `${systemPrompt}\n\n${userContent}` }]
      let transport: Promise<void>
      if (llmConfig.provider === "gemini-cli") {
        transport = streamGeminiCli(llmConfig, combined, cb, signal)
      } else if (llmConfig.provider === "codex-cli") {
        transport = streamCodexCli(llmConfig, combined, cb, signal)
      } else {
        transport = streamClaudeCodeCli(
          llmConfig,
          [{ role: "user", content: userContent }],
          cb,
          signal,
          { disableTools: true, systemPrompt, cwd: projectPath },
        )
      }
      transport.catch(reject)
    })
    return buffer
  }

  let buffer = ""
  const errors: Error[] = []
  await streamChat(
    llmConfig,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    {
      onToken: (token) => { buffer += token },
      onDone: () => {},
      onError: (err) => { errors.push(err) },
    },
    signal,
    { temperature: 0.1, response_format: { type: "json_object" as const } },
  )
  if (errors.length > 0) throw errors[0]
  return buffer
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export interface StepContext {
  llmConfig: LlmConfig
  projectPath: string
  projectName: string
  signal?: AbortSignal
  /** Batched steps report progress after each batch (done, total = batch counts). */
  onProgress?: (done: number, total: number) => void
}

/**
 * Step 2: feature abstraction → characteristic tags. Looks up existing
 * casemap_* graph context for the feature description first (other
 * features' finalized test plans) so the abstraction step doesn't ignore
 * prior coverage of the same or related features.
 */
export async function runAbstraction(featureInput: string, ctx: StepContext): Promise<string[]> {
  const graphBlocks = await getGraphContext(featureInput, ctx.projectPath, ctx.projectName, ctx.llmConfig, "casemap_")
  const graphContext = formatGraphContextBlocks(graphBlocks)
  const { system, user } = buildAbstractionPrompt(featureInput, buildLanguageDirective(featureInput))
  const userWithContext = graphContext ? `${user}\n\n${graphContext}` : user
  const raw = await callModel(ctx.llmConfig, system, userWithContext, ctx.signal, ctx.projectPath)
  return parseAbstractionResponse(raw)
}

/** Step 3: recommend test axes + values (with high-risk value flags). */
export async function runAxisRecommendation(
  featureInput: string,
  tags: string[],
  ctx: StepContext,
): Promise<AxisRecommendation> {
  const { system, user } = buildAxisPrompt(featureInput, tags, buildLanguageDirective(featureInput))
  const raw = await callModel(ctx.llmConfig, system, user, ctx.signal, ctx.projectPath)
  return parseAxisResponse(raw)
}

/** Step 4: pairwise combination generation (pure, no LLM). */
export function generateCandidates(
  axes: TestAxis[],
  priorityValues: { axisId: string; value: string }[],
): CandidateCombo[] {
  return generatePairwise(axes, COMBINATION_CAP, priorityValues).map((combination) => ({
    id: crypto.randomUUID(),
    combination,
    impossible: false,
  }))
}

/**
 * Step 5 (LLM part): batch-judge the combinations that survived the rule
 * filter. Returns a new candidates array with LLM verdicts merged in;
 * rule-marked and user-overridden entries are left untouched.
 */
export async function runImpossibleFilter(
  featureInput: string,
  candidates: CandidateCombo[],
  axes: TestAxis[],
  ctx: StepContext,
): Promise<CandidateCombo[]> {
  const pending = candidates.filter((c) => !c.impossible && !c.overridden)
  const byId = new Map(candidates.map((c) => [c.id, c]))
  const batches = chunk(pending, BATCH_SIZE)
  const directive = buildLanguageDirective(featureInput)
  let done = 0
  for (const batch of batches) {
    const { system, user } = buildImpossiblePrompt(featureInput, batch, axes, directive)
    const raw = await callModel(ctx.llmConfig, system, user, ctx.signal, ctx.projectPath)
    for (const verdict of parseImpossibleResponse(raw)) {
      const cand = byId.get(verdict.id)
      if (!cand || cand.impossible || cand.overridden) continue
      if (verdict.impossible) {
        byId.set(cand.id, {
          ...cand,
          impossible: true,
          impossibleSource: "llm",
          impossibleReason: verdict.reason,
        })
      }
    }
    done++
    ctx.onProgress?.(done, batches.length)
  }
  return candidates.map((c) => byId.get(c.id) ?? c)
}

/** Step 6: batch risk grading of the possible combinations. */
export async function runRiskGrading(
  featureInput: string,
  candidates: CandidateCombo[],
  axes: TestAxis[],
  ctx: StepContext,
): Promise<CandidateCombo[]> {
  const pending = candidates.filter((c) => !c.impossible)
  const byId = new Map(candidates.map((c) => [c.id, c]))
  const batches = chunk(pending, BATCH_SIZE)
  const directive = buildLanguageDirective(featureInput)
  let done = 0
  for (const batch of batches) {
    const { system, user } = buildRiskPrompt(featureInput, batch, axes, directive)
    const raw = await callModel(ctx.llmConfig, system, user, ctx.signal, ctx.projectPath)
    for (const grade of parseRiskResponse(raw)) {
      const cand = byId.get(grade.id)
      if (!cand || cand.impossible) continue
      byId.set(cand.id, { ...cand, risk: grade.risk, riskReason: grade.reason })
    }
    done++
    ctx.onProgress?.(done, batches.length)
  }
  return candidates.map((c) => byId.get(c.id) ?? c)
}

const RISK_ORDER = { high: 0, medium: 1, low: 2 } as const

/**
 * Step 7: generate test case documents for the possible combinations,
 * highest risk first. Combinations the LLM skips are dropped — the
 * wizard can simply re-run this step.
 */
export async function runCaseGeneration(
  featureInput: string,
  tags: string[],
  candidates: CandidateCombo[],
  axes: TestAxis[],
  ctx: StepContext,
): Promise<TestCase[]> {
  const pending = [...candidates.filter((c) => !c.impossible)].sort(
    (a, b) => RISK_ORDER[a.risk ?? "medium"] - RISK_ORDER[b.risk ?? "medium"],
  )
  const byId = new Map(pending.map((c) => [c.id, c]))
  const batches = chunk(pending, CASE_BATCH_SIZE)
  const directive = buildLanguageDirective(featureInput)
  const cases: TestCase[] = []
  let done = 0
  for (const batch of batches) {
    const { system, user } = buildTestCasePrompt(featureInput, tags, batch, axes, directive)
    const raw = await callModel(ctx.llmConfig, system, user, ctx.signal, ctx.projectPath)
    for (const doc of parseTestCaseResponse(raw)) {
      const cand = byId.get(doc.id)
      if (!cand) continue
      cases.push({
        id: cand.id,
        combination: cand.combination,
        purpose: doc.purpose,
        preconditions: doc.preconditions,
        steps: doc.steps,
        expected: doc.expected,
        risk: cand.risk ?? "medium",
        riskReason: cand.riskReason,
        status: "generated",
      })
    }
    done++
    ctx.onProgress?.(done, batches.length)
  }
  return cases
}
