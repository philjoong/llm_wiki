import { streamChat, isCliProvider } from "@/lib/llm-client"
import { streamClaudeCodeCli } from "@/lib/claude-cli-transport"
import { streamGeminiCli } from "@/lib/gemini-cli-transport"
import { streamCodexCli } from "@/lib/codex-cli-transport"
import type { ChatMessage } from "@/lib/llm-providers"
import type { LlmConfig } from "@/stores/wiki-store"
import { buildLanguageDirective } from "@/lib/output-language"
import { getGraphContext, formatGraphContextBlocks } from "@/lib/graph-qna"
import { buildScenarioPrompt, parseScenarioResponse } from "./prompts"
import type { Persona, PlayScenario } from "./types"

/**
 * Same callModel shape as src/lib/casemap/generate.ts (and ingest.ts):
 * HTTP providers get response_format json_object; CLI coding agents run
 * with tools disabled and rely on the JSON-only prompt instruction.
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
    { temperature: 0.4, response_format: { type: "json_object" as const } },
  )
  if (errors.length > 0) throw errors[0]
  return buffer
}

/**
 * Generate `count` play scenarios for a persona against a feature/situation.
 * Looks up existing persona_* graph context for the target description
 * first (other personas' finalized scenarios) so generation doesn't ignore
 * scenarios already covered for the same feature/situation.
 */
export async function generateScenarios(
  persona: Persona,
  featureInput: string,
  count: number,
  llmConfig: LlmConfig,
  projectPath: string,
  projectName: string,
  signal?: AbortSignal,
): Promise<PlayScenario[]> {
  const graphBlocks = await getGraphContext(featureInput, projectPath, projectName, llmConfig, "persona_")
  const graphContext = formatGraphContextBlocks(graphBlocks)
  const { system, user } = buildScenarioPrompt(
    persona,
    featureInput,
    count,
    buildLanguageDirective(featureInput),
  )
  const userWithContext = graphContext ? `${user}\n\n${graphContext}` : user
  const raw = await callModel(llmConfig, system, userWithContext, signal, projectPath)
  return parseScenarioResponse(raw).map((s) => ({
    id: crypto.randomUUID(),
    personaId: persona.id,
    title: s.title,
    steps: s.steps,
    createdAt: Date.now(),
  }))
}
