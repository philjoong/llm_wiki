/**
 * Stage 10 — LLM-backed question type classifier.
 *
 * Given a user question and the project's question_types, ask the LLM to
 * pick exactly one typeId or admit it can't. The classifier is the entry
 * point into the search pipeline (Stage 11) — its result decides which
 * exclusion patterns and axioms get applied.
 *
 * Defensive against LLM misbehavior: if the model returns an unknown
 * typeId, malformed JSON, or errors out, we return `null` so the caller
 * can fall back to "no exclusions, search the whole tree".
 */
import type { LlmConfig } from "@/stores/wiki-store"
import { streamChat } from "./llm-client"
import { extractJsonObject } from "./sweep-reviews"
import type { QuestionType } from "./question-types"

export interface ClassificationResult {
  typeId: string
  confidence: number
  reasoning: string
}

export async function classifyQuestion(
  question: string,
  types: QuestionType[],
  llmConfig: LlmConfig,
): Promise<ClassificationResult | null> {
  if (types.length === 0) return null
  if (!question.trim()) return null

  const prompt = buildPrompt(question, types)

  let raw = ""
  let hadError = false

  try {
    await streamChat(
      llmConfig,
      [{ role: "user", content: prompt }],
      {
        onToken: (token) => {
          raw += token
        },
        onDone: () => {},
        onError: (err) => {
          hadError = true
          console.warn("[classify-question] LLM error:", err.message)
        },
      },
    )
  } catch (err) {
    console.warn("[classify-question] LLM call failed:", err)
    return null
  }

  if (hadError || !raw.trim()) return null

  const cleaned = extractJsonObject(raw)
  if (!cleaned) {
    console.warn(
      "[classify-question] No JSON object in response:",
      raw.slice(0, 300),
    )
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch (err) {
    console.warn("[classify-question] JSON parse failed:", err)
    return null
  }

  if (!parsed || typeof parsed !== "object") return null
  const obj = parsed as Record<string, unknown>

  // The model is allowed to admit defeat by returning typeId: null.
  if (obj.typeId === null) return null

  const typeId = obj.typeId
  if (typeof typeId !== "string" || typeId.trim() === "") return null

  // Hallucination guard: drop anything not in the project's question_types.
  if (!types.some((t) => t.id === typeId)) {
    console.warn(
      `[classify-question] LLM returned unknown typeId "${typeId}"; rejecting.`,
    )
    return null
  }

  const confidence =
    typeof obj.confidence === "number" && Number.isFinite(obj.confidence)
      ? clamp01(obj.confidence)
      : 0
  const reasoning =
    typeof obj.reasoning === "string" ? obj.reasoning.trim() : ""

  return { typeId, confidence, reasoning }
}

function clamp01(n: number): number {
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

function buildPrompt(question: string, types: QuestionType[]): string {
  const cards = types
    .map((t) => {
      const lines = [`- id: ${t.id}`, `  name: ${t.name}`]
      if (t.description) lines.push(`  description: ${t.description}`)
      const fieldKeys = Object.keys(t.fields ?? {})
      if (fieldKeys.length > 0) {
        lines.push(`  fields: [${fieldKeys.join(", ")}]`)
      }
      return lines.join("\n")
    })
    .join("\n")

  return [
    "You are a question type classifier for a personal wiki.",
    "Pick the single question_type that best matches the user's question, or admit you can't.",
    "",
    "## Available question types",
    cards,
    "",
    "## User question",
    question,
    "",
    "## Output",
    'Respond with ONLY a JSON object in this exact shape: {"typeId": "<id-from-list>", "confidence": <0-1>, "reasoning": "<one short sentence>"}',
    'If no type clearly matches, respond with: {"typeId": null, "confidence": 0, "reasoning": "<why none fit>"}',
    "Do not wrap in markdown fences. Do not add commentary outside the JSON.",
    "Use only ids from the list above — never invent a new id.",
  ].join("\n")
}
