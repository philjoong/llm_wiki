import type { Persona } from "./types"

/**
 * Prompt builder + parser for play-scenario generation. Pure functions;
 * the LLM call lives in generate.ts.
 */

export interface BuiltPrompt {
  system: string
  user: string
}

export const JSON_ONLY_INSTRUCTION =
  "Output ONLY a JSON object — no prose, no code fences. First character must be `{`."

export function buildScenarioPrompt(
  persona: Persona,
  featureInput: string,
  count: number,
  languageDirective: string,
): BuiltPrompt {
  const system = [
    "You are a senior game QA engineer designing persona-driven exploratory play scenarios.",
    "Given a player persona and a target feature/situation, produce play scenarios: realistic action sequences THIS persona would perform, biased toward the persona's traits and toward inputs likely to expose bugs (timing races, repeated inputs, interruptions, network trouble).",
    "",
    "Each scenario is a short title plus an ordered step sequence. Example step sequence:",
    "전투 진입 → 이동 중 스킬 버튼 연타 → 스킬 사용 직후 회피 입력 → 쿨타임 중 재입력 → 타깃 사망 직전 스킬 사용 → 네트워크 지연 발생 → 결과 화면 진입",
    "",
    `Respond with JSON: {"scenarios": [{"title": "...", "steps": ["...", "..."]}]}`,
    `Produce exactly ${count} scenarios, each with 5-10 steps.`,
    "",
    languageDirective,
  ].join("\n")
  const user = [
    `Persona: ${persona.name}`,
    `Description: ${persona.description}`,
    `Traits: ${persona.traits.join(", ")}`,
    "",
    `Target feature / situation:\n${featureInput}`,
    "",
    JSON_ONLY_INSTRUCTION,
  ].join("\n")
  return { system, user }
}

export interface GeneratedScenario {
  title: string
  steps: string[]
}

/** Lenient parse: tolerates code fences and prose around the JSON object. */
export function parseScenarioResponse(raw: string): GeneratedScenario[] {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) text = fence[1].trim()
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`No JSON object found in LLM response: ${raw.slice(0, 200)}`)
  }
  const obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
  if (!Array.isArray(obj.scenarios)) throw new Error("LLM response has no scenarios array")
  const out: GeneratedScenario[] = []
  for (const entry of obj.scenarios) {
    if (typeof entry !== "object" || entry === null) continue
    const e = entry as Record<string, unknown>
    const title = typeof e.title === "string" ? e.title.trim() : ""
    const steps = Array.isArray(e.steps)
      ? e.steps.filter((s): s is string => typeof s === "string").map((s) => s.trim()).filter(Boolean)
      : []
    if (!title || steps.length === 0) continue
    out.push({ title, steps })
  }
  if (out.length === 0) throw new Error("LLM returned no usable scenarios")
  return out
}
