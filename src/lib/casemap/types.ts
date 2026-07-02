/**
 * Data model for the case-mapping (경우의 수 맵핑) feature.
 * See docs/new-feature-dev-plan.md §2.
 */

/** Step-2 characteristic tag, optionally linked to an entity-dict entry. */
export interface AbstractionTag {
  tag: string
  entityId?: string
}

/** One test axis (e.g. 상태, 입력, 네트워크) with its candidate values. */
export interface TestAxis {
  id: string
  name: string
  values: string[]
  enabled: boolean
}

/**
 * Impossible-combination rule, reusable across plans.
 * Axis references are by NAME (not id) so a rule like
 * "IF 상태 = 사망 THEN 입력 = 스킬 사용 불가" survives across plans
 * whose axes were generated independently.
 */
export interface Rule {
  id: string
  ifAxis: string
  ifValue: string
  /** Free-text THEN clause, e.g. "입력 = 연타 불가" or "전투 스킬 사용 불가". */
  effect: string
  enabled: boolean
}

/** axisId → chosen value. */
export type Combination = Record<string, string>

export type RiskLevel = "high" | "medium" | "low"

/**
 * Intermediate combination state for wizard steps 4–6 (generation →
 * impossible filtering → risk grading), before test cases are written.
 */
export interface CandidateCombo {
  id: string
  combination: Combination
  impossible: boolean
  impossibleReason?: string
  impossibleSource?: "rule" | "llm"
  /** User flipped the impossible verdict in the UI. */
  overridden?: boolean
  risk?: RiskLevel
  riskReason?: string
}

export type TestCaseStatus = "generated" | "excluded" | "added" | "confirmed"

export interface TestCase {
  id: string
  combination: Combination
  purpose: string
  preconditions: string[]
  steps: string[]
  expected: string[]
  risk: RiskLevel
  riskReason?: string
  status: TestCaseStatus
}

/**
 * Wizard progress: index of the last COMPLETED step (0 = nothing done,
 * 1 = feature input saved, … 7 = test cases generated). Saved after each
 * step so the wizard can resume after an app restart.
 */
export interface TestPlan {
  id: string
  name: string
  featureInput: string
  abstraction: AbstractionTag[]
  axes: TestAxis[]
  /** High-risk (axisId, value) refs flagged by the axis-recommendation LLM step. */
  priorityValues: { axisId: string; value: string }[]
  candidates: CandidateCombo[]
  cases: TestCase[]
  finalized: boolean
  step: number
  createdAt: number
  updatedAt: number
}

export function createEmptyPlan(name: string): TestPlan {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    name,
    featureInput: "",
    abstraction: [],
    axes: [],
    priorityValues: [],
    candidates: [],
    cases: [],
    finalized: false,
    step: 0,
    createdAt: now,
    updatedAt: now,
  }
}
