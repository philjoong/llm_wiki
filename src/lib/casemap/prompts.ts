import type { CandidateCombo, Combination, RiskLevel, TestAxis } from "./types"

/**
 * Prompt builders + response parsers for the case-mapping LLM steps.
 * Builders are pure (language directive is passed in by generate.ts);
 * parsers are lenient about code fences and surrounding prose, in the
 * same spirit as ingest.ts's JSON handling.
 */

export interface BuiltPrompt {
  system: string
  user: string
}

/** Same contract as ingest.ts's JSON_ONLY_INSTRUCTION — needed for CLI providers. */
export const JSON_ONLY_INSTRUCTION =
  "Output ONLY a JSON object — no prose, no code fences. First character must be `{`."

/**
 * Pull the first JSON object out of an LLM response, tolerating code
 * fences and stray prose before/after the object.
 */
export function extractJsonObject(raw: string): Record<string, unknown> {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) text = fence[1].trim()
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`No JSON object found in LLM response: ${raw.slice(0, 200)}`)
  }
  return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === "string").map((s) => s.trim()).filter(Boolean)
}

/** "상태=전투 중 / 입력=연타" — shared by prompts and the wizard UI. */
export function renderCombination(combination: Combination, axes: TestAxis[]): string {
  return axes
    .filter((a) => combination[a.id] !== undefined)
    .map((a) => `${a.name}=${combination[a.id]}`)
    .join(" / ")
}

function renderCandidateLines(candidates: CandidateCombo[], axes: TestAxis[]): string {
  return candidates.map((c) => `- id: ${c.id}\n  combination: ${renderCombination(c.combination, axes)}`).join("\n")
}

// ── Step 2: abstraction ──────────────────────────────────────────────────────

export function buildAbstractionPrompt(featureInput: string, languageDirective: string): BuiltPrompt {
  const system = [
    "You are a senior game QA analyst. Given a natural-language description of a game feature, abstract it into short characteristic tags that drive test design.",
    "",
    "Tags are short noun phrases describing testable properties, e.g.: 시전형 스킬, 단일 대상 타깃, 스플래시 대미지, 쿨타임 존재, 마나 소모, PvP 영향 있음.",
    "Return 4-12 tags. Do not invent properties the description doesn't imply.",
    "",
    'Respond with JSON: {"tags": ["tag1", "tag2", ...]}',
    "",
    languageDirective,
  ].join("\n")
  const user = `Feature description:\n${featureInput}\n\n${JSON_ONLY_INSTRUCTION}`
  return { system, user }
}

export function parseAbstractionResponse(raw: string): string[] {
  const obj = extractJsonObject(raw)
  const tags = asStringArray(obj.tags)
  if (tags.length === 0) throw new Error("LLM returned no tags")
  return [...new Set(tags)]
}

// ── Step 3: test axis recommendation ─────────────────────────────────────────

/** Default axes from docs/new-feature-dev.md §1.3, seeded into the prompt. */
const DEFAULT_AXES_SEED = [
  "상태: 로비, 전투 중, 이동 중, 사망, 로딩 중, 매칭 중, 결과 화면, 상점 이용 중",
  "입력: 단일 입력, 연타, 길게 누름, 동시 입력, 입력 취소, 입력 직후 화면 전환",
  "시간/타이밍: (경계값 포함, e.g. 쿨타임 직전/직후)",
  "리소스: (e.g. 충분, 부족, 정확히 경계값)",
  "네트워크: 정상, 지연, 끊김, 재접속, 서버 응답 실패, 중복 요청",
  "UI 충돌: (e.g. 없음, 팝업 표시 중, 상점 열림)",
  "앱 상태: 포그라운드, 앱 최소화, 앱 종료 후 재실행",
].join("\n")

export function buildAxisPrompt(featureInput: string, tags: string[], languageDirective: string): BuiltPrompt {
  const system = [
    "You are a senior game QA analyst designing a combinatorial test matrix. Given a feature description and its characteristic tags, recommend the test axes (dimensions) and 2-8 concrete values per axis.",
    "",
    "Use these standard axes as a starting point, keeping only the ones relevant to the feature and adapting values to it:",
    DEFAULT_AXES_SEED,
    "",
    "Also add feature-specific axes implied by the tags (e.g. a cooldown tag implies a 타이밍 axis with 쿨타임 중/쿨타임 직후 values).",
    'Mark values that are especially failure-prone ("riskyValues": values from that axis likely to expose High-risk bugs, e.g. 네트워크 끊김).',
    "",
    'Respond with JSON: {"axes": [{"name": "...", "values": ["...", "..."], "riskyValues": ["..."]}]}',
    "",
    languageDirective,
  ].join("\n")
  const user = [
    `Feature description:\n${featureInput}`,
    `Characteristic tags: ${tags.join(", ")}`,
    "",
    JSON_ONLY_INSTRUCTION,
  ].join("\n")
  return { system, user }
}

export interface AxisRecommendation {
  axes: TestAxis[]
  /** Values the LLM flagged as high-risk, as (axisId, value) refs into `axes`. */
  priorityValues: { axisId: string; value: string }[]
}

export function parseAxisResponse(raw: string): AxisRecommendation {
  const obj = extractJsonObject(raw)
  if (!Array.isArray(obj.axes)) throw new Error("LLM response has no axes array")
  const axes: TestAxis[] = []
  const priorityValues: { axisId: string; value: string }[] = []
  for (const entry of obj.axes) {
    if (typeof entry !== "object" || entry === null) continue
    const e = entry as Record<string, unknown>
    const name = typeof e.name === "string" ? e.name.trim() : ""
    const values = [...new Set(asStringArray(e.values))]
    if (!name || values.length === 0) continue
    const axis: TestAxis = { id: crypto.randomUUID(), name, values, enabled: true }
    axes.push(axis)
    for (const rv of asStringArray(e.riskyValues)) {
      if (values.includes(rv)) priorityValues.push({ axisId: axis.id, value: rv })
    }
  }
  if (axes.length === 0) throw new Error("LLM returned no usable axes")
  return { axes, priorityValues }
}

// ── Step 5: impossible-combination verdicts ──────────────────────────────────

export function buildImpossiblePrompt(
  featureInput: string,
  candidates: CandidateCombo[],
  axes: TestAxis[],
  languageDirective: string,
): BuiltPrompt {
  const system = [
    "You are a senior game QA analyst. For each candidate test combination below, judge whether it is IMPOSSIBLE to even set up in the game (contradictory by game rules — e.g. using a combat-only skill in the lobby), as opposed to merely unusual.",
    "Only mark a combination impossible when the preconditions cannot coexist. A combination that is possible but expected to FAIL gracefully is NOT impossible — it is a valuable test.",
    "",
    'Respond with JSON: {"verdicts": [{"id": "...", "impossible": true, "reason": "..."}]}',
    "Include one verdict per candidate id. Keep reasons to one sentence.",
    "",
    languageDirective,
  ].join("\n")
  const user = [
    `Feature description:\n${featureInput}`,
    "",
    "Candidates:",
    renderCandidateLines(candidates, axes),
    "",
    JSON_ONLY_INSTRUCTION,
  ].join("\n")
  return { system, user }
}

export interface ImpossibleVerdict {
  id: string
  impossible: boolean
  reason: string
}

export function parseImpossibleResponse(raw: string): ImpossibleVerdict[] {
  const obj = extractJsonObject(raw)
  if (!Array.isArray(obj.verdicts)) throw new Error("LLM response has no verdicts array")
  const out: ImpossibleVerdict[] = []
  for (const entry of obj.verdicts) {
    if (typeof entry !== "object" || entry === null) continue
    const e = entry as Record<string, unknown>
    if (typeof e.id !== "string" || typeof e.impossible !== "boolean") continue
    out.push({ id: e.id, impossible: e.impossible, reason: typeof e.reason === "string" ? e.reason : "" })
  }
  return out
}

// ── Step 6: risk grading ─────────────────────────────────────────────────────

/** Risk rubric from docs/new-feature-dev.md §1.6. */
const RISK_RUBRIC = [
  "high: 결제/재화/아이템 손실, 진행 불가, 데이터 저장 문제, PvP/랭킹 영향, 재접속 관련, 중복 지급/중복 차감, 서버 요청 실패, 롤백/복구 어려움",
  "medium: UI 표시 오류, 특정 상황에서만 발생, 우회 가능, 반복 사용 기능, 사용성 저하, 보상 표시 지연",
  "low: 단순 문구, 경미한 연출, 드문 조합, 유저 영향 낮음, 시각적 어색함",
].join("\n")

export function buildRiskPrompt(
  featureInput: string,
  candidates: CandidateCombo[],
  axes: TestAxis[],
  languageDirective: string,
): BuiltPrompt {
  const system = [
    "You are a senior game QA analyst. Grade the risk of each candidate test combination: how severe would the likely defect be if this combination misbehaves?",
    "",
    "Rubric:",
    RISK_RUBRIC,
    "",
    'Respond with JSON: {"grades": [{"id": "...", "risk": "high" | "medium" | "low", "reason": "..."}]}',
    "Include one grade per candidate id. Keep reasons to one sentence.",
    "",
    languageDirective,
  ].join("\n")
  const user = [
    `Feature description:\n${featureInput}`,
    "",
    "Candidates:",
    renderCandidateLines(candidates, axes),
    "",
    JSON_ONLY_INSTRUCTION,
  ].join("\n")
  return { system, user }
}

export interface RiskGrade {
  id: string
  risk: RiskLevel
  reason: string
}

export function parseRiskResponse(raw: string): RiskGrade[] {
  const obj = extractJsonObject(raw)
  if (!Array.isArray(obj.grades)) throw new Error("LLM response has no grades array")
  const out: RiskGrade[] = []
  for (const entry of obj.grades) {
    if (typeof entry !== "object" || entry === null) continue
    const e = entry as Record<string, unknown>
    if (typeof e.id !== "string" || typeof e.risk !== "string") continue
    const risk = e.risk.trim().toLowerCase()
    if (risk !== "high" && risk !== "medium" && risk !== "low") continue
    out.push({ id: e.id, risk, reason: typeof e.reason === "string" ? e.reason : "" })
  }
  return out
}

// ── Step 7: test case documents ──────────────────────────────────────────────

export function buildTestCasePrompt(
  featureInput: string,
  tags: string[],
  candidates: CandidateCombo[],
  axes: TestAxis[],
  languageDirective: string,
): BuiltPrompt {
  const system = [
    "You are a senior game QA engineer writing an executable test case for each combination below.",
    "For each candidate produce:",
    "- purpose: one sentence — what defect class this combination is probing.",
    "- preconditions: numbered setup conditions (game state, resources, environment).",
    "- steps: concrete numbered actions a tester performs.",
    "- expected: verifiable numbered outcomes (counts, UI state, server behavior).",
    "",
    'Respond with JSON: {"cases": [{"id": "...", "purpose": "...", "preconditions": ["..."], "steps": ["..."], "expected": ["..."]}]}',
    "Include one case per candidate id.",
    "",
    languageDirective,
  ].join("\n")
  const user = [
    `Feature description:\n${featureInput}`,
    `Characteristic tags: ${tags.join(", ")}`,
    "",
    "Candidates:",
    renderCandidateLines(candidates, axes),
    "",
    JSON_ONLY_INSTRUCTION,
  ].join("\n")
  return { system, user }
}

export interface GeneratedCaseDoc {
  id: string
  purpose: string
  preconditions: string[]
  steps: string[]
  expected: string[]
}

export function parseTestCaseResponse(raw: string): GeneratedCaseDoc[] {
  const obj = extractJsonObject(raw)
  if (!Array.isArray(obj.cases)) throw new Error("LLM response has no cases array")
  const out: GeneratedCaseDoc[] = []
  for (const entry of obj.cases) {
    if (typeof entry !== "object" || entry === null) continue
    const e = entry as Record<string, unknown>
    if (typeof e.id !== "string" || typeof e.purpose !== "string") continue
    out.push({
      id: e.id,
      purpose: e.purpose.trim(),
      preconditions: asStringArray(e.preconditions),
      steps: asStringArray(e.steps),
      expected: asStringArray(e.expected),
    })
  }
  return out
}
