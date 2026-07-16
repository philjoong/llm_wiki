/**
 * Render-time JSON answer parsing (Step 05, §3.4).
 *
 * When a question type is selected the model is asked to return a single JSON
 * object keyed by the type's `fields`. Messages are stored as the raw string;
 * the renderer parses on every render so cards survive a conversation reload.
 * Local models sometimes drift from strict JSON — parsing failures fall back to
 * the raw text at the call site.
 */

/**
 * Strip a leading/trailing markdown code fence (```json … ```), if present.
 * Extracted from the inline pattern used by ingest.ts so both share one rule.
 */
export function stripCodeFence(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim()
}

/**
 * Reserved answer key (Step 10, §6). When a type declares `required_info`, the
 * model returns any unmet items here so the UI can ask the user (Step 11). This
 * key is stripped from the field cards and rendered as inline forms instead.
 */
export const INFORMATION_REQUESTS_KEY = "information_requests"

/** Closed set of form kinds an information request may ask for (Step 10 §2). */
export const INFO_INPUT_TYPES = ["choice", "text", "file", "link"] as const
export type InfoInputType = (typeof INFO_INPUT_TYPES)[number]

/** One validated back-question the model raised for a missing required_info item. */
export interface InformationRequest {
  infoKey: string
  question: string
  reason: string
  inputType: InfoInputType
  /** Radio candidates, only meaningful when inputType === "choice". */
  options: string[]
}

/**
 * Parse a JSON answer into a flat key→value object. Returns null when the text
 * is not a JSON object (so the caller renders the raw markdown instead).
 * Arrays and scalars are intentionally rejected — the answer contract is an
 * object of named fields.
 */
export function parseJsonAnswer(raw: string): Record<string, unknown> | null {
  const stripped = stripCodeFence(raw)
  if (!stripped.startsWith("{") || !stripped.endsWith("}")) return null
  try {
    const parsed = JSON.parse(stripped)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    return null
  } catch {
    return null
  }
}

/**
 * Build the prompt block that declares the input contract (Step 10 §3-4).
 * Lists the type's `required_info` items, instructs the model to judge each
 * one against the provided context and ask for only the unmet ones via the
 * `information_requests` reserved key, and — when the user has already marked
 * some items unavailable (Step 11) — forbids re-asking those. Returns "" when
 * the type declares no required_info, so unflagged types are unaffected.
 */
export function buildRequiredInfoPrompt(
  requiredInfo: Record<string, string> | undefined,
  unavailableKeys: readonly string[] = [],
): string {
  if (!requiredInfo || Object.keys(requiredInfo).length === 0) return ""
  const lines: string[] = ["", "## Required Information", "Answering this question type may need these inputs:"]
  for (const [key, desc] of Object.entries(requiredInfo)) {
    lines.push(`- "${key}": ${desc}`)
  }
  lines.push(
    "",
    "Judge each item against the context above. Answer the parts you can from the context — do NOT guess missing facts.",
    `For each item the context does NOT cover and that you genuinely need, add an entry to a "${INFORMATION_REQUESTS_KEY}" array in your JSON answer:`,
    `"${INFORMATION_REQUESTS_KEY}": [{ "info_key": "<one of the keys above>", "question": "<what to ask the user>", "reason": "<why it's needed and not in the wiki>", "input_type": "${INFO_INPUT_TYPES.join('" | "')}", "options": ["<only for choice>"] }]`,
    'Ask only for what you truly need; answer everything you already know in the normal fields. Omit the array entirely when nothing is missing.',
  )
  if (unavailableKeys.length > 0) {
    lines.push(
      "",
      `The user has already said these items are unavailable — do NOT ask for them again; answer within what you have and state the limitation: ${unavailableKeys.join(", ")}.`,
    )
  }
  return lines.join("\n")
}

/**
 * Extract and validate the `information_requests` reserved key from a parsed
 * JSON answer (Step 10 §5). Each request must reference a `validKeys` member
 * and carry an `input_type` from the closed {@link INFO_INPUT_TYPES} set;
 * requests failing either check are dropped (the answer body still renders).
 * Returns [] when the key is absent, malformed, or the type declared no keys.
 */
export function parseInformationRequests(
  answer: Record<string, unknown> | null,
  validKeys: readonly string[],
): InformationRequest[] {
  if (!answer) return []
  const raw = answer[INFORMATION_REQUESTS_KEY]
  if (!Array.isArray(raw)) return []
  const allowed = new Set(validKeys)
  const out: InformationRequest[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const rec = item as Record<string, unknown>
    const infoKey = typeof rec.info_key === "string" ? rec.info_key : ""
    const inputType = rec.input_type
    if (!allowed.has(infoKey)) continue
    if (!INFO_INPUT_TYPES.includes(inputType as InfoInputType)) continue
    out.push({
      infoKey,
      question: typeof rec.question === "string" ? rec.question : "",
      reason: typeof rec.reason === "string" ? rec.reason : "",
      inputType: inputType as InfoInputType,
      options: Array.isArray(rec.options)
        ? rec.options.filter((o): o is string => typeof o === "string")
        : [],
    })
  }
  return out
}
