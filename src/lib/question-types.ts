/**
 * Stage 9 — `question_types/*.md` loader.
 *
 * Each markdown file under `question_types/` becomes one QuestionType.
 * The id is the filename stem (e.g. `policy_violation.md` → `policy_violation`).
 * Sections are pulled from H2 headings (`## Description`, `## Input`,
 * `## Output`, `## Zero residue`); free-form content outside those
 * headings is summarized into `description`.
 *
 * Malformed files (read errors, parse errors) are logged and skipped —
 * a single broken file should not break the rest of the search wiring.
 */
import yaml from "js-yaml"
import { listDirectory, readFile } from "@/commands/fs"
import type { FileNode } from "@/types/wiki"

export interface QuestionType {
  /** Filename stem — stable id used by the classifier and exclusion map. */
  id: string
  /** Display name. */
  name: string
  /** Description for the classifier and UI. */
  description: string
  /** Keys the LLM should fill in its structured response. Map of key -> description. */
  fields?: Record<string, string>
  /** Prompt template for execution. */
  promptTemplate?: string
  /** Legacy markdown shape description used by older tests and docs. */
  inputShape?: string
  /** Legacy markdown output description used by older tests and docs. */
  outputShape?: string
  /** Body of `Zero residue` section — surfaced to the user when residue == 0 (§2.10). */
  zeroResidueMeaning?: string
  /** Internal: source path category. Not displayed in UI. */
  _source: "app" | "project" | "user"
  /** Internal: absolute file path. Undefined for app defaults. */
  _filePath?: string
}

// schema/question_types is a Tauri bundle resource — listDirectory() cannot
// access it in dev or production, so app defaults are hardcoded here.
const APP_DEFAULT_QUESTION_TYPES: Omit<QuestionType, "_source" | "_filePath">[] = [
  {
    id: "balance_simulation",
    name: "밸런스 시뮬레이션",
    description: "특정 빌드·세팅에서 클래스/스킬/아이템 조합이 어떻게 성능을 발휘하는지를 가상으로 검증한다.",
    fields: {
      simulation_result: "시뮬레이션 결과 한 줄 + 인용된 공식·수치 페이지",
      strengths_weaknesses: "기준 대비 강·약점 요약",
    },
    promptTemplate: "당신은 게임 밸런스 시뮬레이터입니다.\n다음 입력 데이터를 바탕으로 시뮬레이션을 수행하고 결과를 구조화된 형식으로 출력하세요.\n\n## Context\n{{context}}\n\n## User Question\n{{question}}\n\n## Output Format\nJSON 형식으로 답변하세요. 키는 다음과 같습니다:\n- simulation_result: {{fields.simulation_result}}\n- strengths_weaknesses: {{fields.strengths_weaknesses}}",
    zeroResidueMeaning: "잔존 0 = **시뮬레이션에 필요한 수치 정보 부족**. 공식·계수·기준치 중 일부가 wiki에 정의되어 있지 않다는 신호.",
  },
  {
    id: "change_impact",
    name: "변경 영향 분석",
    description: "특정 수치·공식·정책·콘텐츠 변경이 다른 시스템·콘텐츠에 어떤 영향을 주는지 추적한다.",
    fields: {
      affected_pages: "영향받는 페이지 목록 (related: 연결 + 출처 인용을 따라간 결과)",
      update_candidates: "동시 갱신이 필요한 페이지 후보",
    },
    promptTemplate: "당신은 시스템 영향 분석가입니다.\n다음 입력 데이터를 바탕으로 변경 영향을 분석하고 결과를 구조화된 형식으로 출력하세요.\n\n## Context\n{{context}}\n\n## User Question\n{{question}}\n\n## Output Format\nJSON 형식으로 답변하세요. 키는 다음과 같습니다:\n- affected_pages: {{fields.affected_pages}}\n- update_candidates: {{fields.update_candidates}}",
    zeroResidueMeaning: "잔존 0 = **영향 격리 완료**. 이 변경이 다른 페이지로 전이되지 않는다는 신호.",
  },
  {
    id: "combination_explosion_test",
    name: "조합 폭발 테스트",
    description: "사람이 수동으로 나열하기 어려운 조건 축의 곱집합에서 놓치기 쉬운 테스트 케이스를 만든다.",
    fields: {
      missing_combinations: "사람이 놓치기 쉬운 조합 후보",
      risk_reasoning: "각 조합이 위험한 이유와 검증해야 할 기대 결과",
      new_cases: "기존 테스트와 중복되지 않는 신규 케이스 목록",
    },
    promptTemplate: "당신은 테스트 엔지니어입니다.\n다음 입력 데이터를 바탕으로 조합 폭발 테스트 케이스를 생성하고 결과를 구조화된 형식으로 출력하세요.\n\n## Context\n{{context}}\n\n## User Question\n{{question}}\n\n## Output Format\nJSON 형식으로 답변하세요. 키는 다음과 같습니다:\n- missing_combinations: {{fields.missing_combinations}}\n- risk_reasoning: {{fields.risk_reasoning}}\n- new_cases: {{fields.new_cases}}",
    zeroResidueMeaning: "잔존 0 = **추가 조합 없음**. 정의된 조건 축의 조합이 이미 테스트되었거나 명시적으로 제외되어 새로 생성할 케이스가 없다는 신호.",
  },
  {
    id: "condition_based_test",
    name: "조건 기반 가상 테스트",
    description: "특정 조건/상호작용에서 시스템이 어떻게 동작해야 하는지 가상의 테스트 케이스로 검증한다.",
    fields: {
      cited_rules: "인용된 규칙/정책/시스템 페이지",
      test_result: "조건에 적용 가능한 결과 한 줄 또는 명세 공백",
    },
    promptTemplate: "당신은 가상 테스트 시뮬레이터입니다.\n다음 입력 데이터를 바탕으로 가상 테스트를 수행하고 결과를 구조화된 형식으로 출력하세요.\n\n## Context\n{{context}}\n\n## User Question\n{{question}}\n\n## Output Format\nJSON 형식으로 답변하세요. 키는 다음과 같습니다:\n- cited_rules: {{fields.cited_rules}}\n- test_result: {{fields.test_result}}",
    zeroResidueMeaning: "잔존 0 = **명세 공백**. 이 조건에 대한 규칙이 wiki 어디에도 정의되어 있지 않다는 신호.",
  },
  {
    id: "design_flaw_detection",
    name: "구현 전 기획 결함 탐지",
    description: "구현에 들어가기 전에 규칙의 모호함, 누락된 우선순위, 서로 충돌하는 의도, 플레이어가 오해할 수 있는 설계 결함을 찾는다.",
    fields: {
      conflicting_rules: "모호하거나 충돌하는 문장·규칙 인용",
      decision_questions: "구현 전에 결정해야 할 질문 목록",
      improvement_suggestions: "결함을 줄이기 위한 명세 보강 제안",
    },
    promptTemplate: "당신은 기획 설계 리뷰어입니다.\n다음 입력 데이터를 바탕으로 기획 결함을 탐지하고 결과를 구조화된 형식으로 출력하세요.\n\n## Context\n{{context}}\n\n## User Question\n{{question}}\n\n## Output Format\nJSON 형식으로 답변하세요. 키는 다음과 같습니다:\n- conflicting_rules: {{fields.conflicting_rules}}\n- decision_questions: {{fields.decision_questions}}\n- improvement_suggestions: {{fields.improvement_suggestions}}",
    zeroResidueMeaning: "잔존 0 = **기획 결함 신호 없음**. 현재 wiki 기준으로 구현을 막을 만한 모호함이나 충돌이 발견되지 않았다는 신호.",
  },
  {
    id: "game_action_suggestion",
    name: "게임 조작",
    description: "현재 게임 상황과 목표에 맞춰 다음 조작이나 선택지를 제안한다.",
    fields: {
      recommended_action: "추천하는 다음 조작",
      alternatives: "대안 선택지와 선택 기준",
      reasoning_risks: "관련 규칙·공략·시스템 근거 및 실패 위험",
    },
    promptTemplate: "당신은 게임 전략 가이드입니다.\n다음 입력 데이터를 바탕으로 최적의 조작을 제안하고 결과를 구조화된 형식으로 출력하세요.\n\n## Context\n{{context}}\n\n## User Question\n{{question}}\n\n## Output Format\nJSON 형식으로 답변하세요. 키는 다음과 같습니다:\n- recommended_action: {{fields.recommended_action}}\n- alternatives: {{fields.alternatives}}\n- reasoning_risks: {{fields.reasoning_risks}}",
    zeroResidueMeaning: "잔존 0 = **추천 조작 근거 부족**. 현재 상황이나 사용 가능한 행동에 대한 wiki 근거가 부족해 다음 조작을 안정적으로 제안할 수 없다는 신호.",
  },
  {
    id: "game_screen_understanding",
    name: "게임 화면 이해",
    description: "현재 게임 화면이나 상황 설명을 바탕으로 어떤 상태가 벌어지고 있는지 파악한다.",
    fields: {
      situation_summary: "현재 게임 상황 요약",
      cited_rules: "관련 규칙·시스템 페이지 인용",
      uncertainties: "확실한 판단과 추가 확인이 필요한 불확실성 구분",
    },
    promptTemplate: "당신은 게임 상황 분석가입니다.\n다음 입력 데이터를 바탕으로 상황을 해석하고 결과를 구조화된 형식으로 출력하세요.\n\n## Context\n{{context}}\n\n## User Question\n{{question}}\n\n## Output Format\nJSON 형식으로 답변하세요. 키는 다음과 같습니다:\n- situation_summary: {{fields.situation_summary}}\n- cited_rules: {{fields.cited_rules}}\n- uncertainties: {{fields.uncertainties}}",
    zeroResidueMeaning: "잔존 0 = **상황 판단 근거 부족**. 화면 요소나 관련 규칙이 wiki에 충분히 연결되지 않아 현재 상황을 안정적으로 해석할 수 없다는 신호.",
  },
  {
    id: "opinion_delivery",
    name: "의견 전달",
    description: "변경안이 의도에는 맞더라도 사용성, 학습 난이도, 오인 사용 가능성, 운영 부담 같은 정성적 리스크를 검토해 사람에게 전달할 의견을 만든다.",
    fields: {
      aligned_points: "의도와 맞는 부분",
      qualitative_opinions: "사용성·인지부하·오해 가능성에 대한 의견",
      tradeoffs_recommendation: "사람이 결정해야 할 트레이드오프와 권고 문장",
    },
    promptTemplate: "당신은 게임 기획 리뷰어입니다.\n다음 입력 데이터를 바탕으로 정성적 리뷰 의견을 작성하고 결과를 구조화된 형식으로 출력하세요.\n\n## Context\n{{context}}\n\n## User Question\n{{question}}\n\n## Output Format\nJSON 형식으로 답변하세요. 키는 다음과 같습니다:\n- aligned_points: {{fields.aligned_points}}\n- qualitative_opinions: {{fields.qualitative_opinions}}\n- tradeoffs_recommendation: {{fields.tradeoffs_recommendation}}",
    zeroResidueMeaning: "잔존 0 = **전달할 추가 의견 없음**. 현재 wiki 기준으로 의도와 충돌하거나 별도 코멘트가 필요한 정성적 리스크가 발견되지 않았다는 신호.",
  },
  {
    id: "policy_violation",
    name: "정책 위반 탐지",
    description: "사용자/운영 정책에 위반되는 동작·콘텐츠·상호작용을 식별한다.",
    fields: {
      violated_policy: "위반된 정책 항목 인용",
      recommendation: "위반 정도 및 후속 조치 권고",
    },
    promptTemplate: "당신은 정책 준수 감시자입니다.\n다음 입력 데이터를 바탕으로 정책 위반 여부를 식별하고 결과를 구조화된 형식으로 출력하세요.\n\n## Context\n{{context}}\n\n## User Question\n{{question}}\n\n## Output Format\nJSON 형식으로 답변하세요. 키는 다음과 같습니다:\n- violated_policy: {{fields.violated_policy}}\n- recommendation: {{fields.recommendation}}",
    zeroResidueMeaning: "잔존 0 = **위반 없음 (긍정적 신호)**. 명시된 정책 어디에도 어긋나지 않았다는 결론.",
  },
  {
    id: "regression_test",
    name: "회귀 테스트",
    description: "이전 패치/변경 이후 깨질 가능성이 있는 영역을 식별한다.",
    fields: {
      regression_candidates: "회귀 후보 페이지 (영향받을 가능성이 높은 시스템·콘텐츠·QA 케이스)",
      existing_cases: "적용 가능한 기존 회귀 케이스 인용",
    },
    promptTemplate: "당신은 QA 엔지니어입니다.\n다음 입력 데이터를 바탕으로 회귀 테스트 대상을 식별하고 결과를 구조화된 형식으로 출력하세요.\n\n## Context\n{{context}}\n\n## User Question\n{{question}}\n\n## Output Format\nJSON 형식으로 답변하세요. 키는 다음과 같습니다:\n- regression_candidates: {{fields.regression_candidates}}\n- existing_cases: {{fields.existing_cases}}",
    zeroResidueMeaning: "잔존 0 = **영향 없음**. 변경된 영역이 다른 시스템·콘텐츠와 격리되어 있으며 회귀 위험이 없다는 신호.",
  },
  {
    id: "risk_based_recommendation",
    name: "리스크 기반 추천",
    description: "기능·스킬·아이템·정책 변경이 여러 위험 축에서 충돌할 가능성을 평가하고, 우선적으로 확인할 검증·기획·운영 액션을 추천한다.",
    fields: {
      high_risk_axes: "위험도가 높은 축과 그 근거",
      priority_actions: "우선 확인해야 할 테스트·리뷰·완화 조치",
      low_risk_axes: "위험이 낮거나 근거가 부족한 축의 구분",
    },
    promptTemplate: "당신은 리스크 관리 전문가입니다.\n다음 입력 데이터를 바탕으로 리스크를 평가하고 결과를 구조화된 형식으로 출력하세요.\n\n## Context\n{{context}}\n\n## User Question\n{{question}}\n\n## Output Format\nJSON 형식으로 답변하세요. 키는 다음과 같습니다:\n- high_risk_axes: {{fields.high_risk_axes}}\n- priority_actions: {{fields.priority_actions}}\n- low_risk_axes: {{fields.low_risk_axes}}",
    zeroResidueMeaning: "잔존 0 = **주요 리스크 신호 없음**. 현재 wiki 기준으로 충돌 가능성이 높은 축이 발견되지 않았다는 신호이며, 새 검증 항목은 선택 사항이다.",
  },
  {
    id: "test_gap",
    name: "테스트 공백 탐지",
    description: "기능·시스템·콘텐츠 중 QA가 누락되었거나 회귀 케이스가 정의되지 않은 영역을 식별한다.",
    fields: {
      empty_qa_pages: "QA 자산이 비어 있는 페이지 목록",
      new_case_candidates: "신규로 정의해야 할 케이스 후보",
    },
    promptTemplate: "당신은 QA 품질 보증 전문가입니다.\n다음 입력 데이터를 바탕으로 테스트 공백을 탐지하고 결과를 구조화된 형식으로 출력하세요.\n\n## Context\n{{context}}\n\n## User Question\n{{question}}\n\n## Output Format\nJSON 형식으로 답변하세요. 키는 다음과 같습니다:\n- empty_qa_pages: {{fields.empty_qa_pages}}\n- new_case_candidates: {{fields.new_case_candidates}}",
    zeroResidueMeaning: "잔존 0 = **공백 없음**. 대상 영역의 모든 시스템·기능에 대응하는 QA 자산이 존재한다는 신호.",
  },
]

export async function loadQuestionTypes(
  projectPath: string,
): Promise<QuestionType[]> {
  const projectSpecificPath = `${projectPath}/question_types`
  const userOverridePath = `${projectPath}/.llm-wiki/question-types`

  const projectNodes = await tryListDirectory(projectSpecificPath)
  const userNodes = await tryListDirectory(userOverridePath)

  const outMap = new Map<string, QuestionType>()

  for (const qt of APP_DEFAULT_QUESTION_TYPES) {
    outMap.set(qt.id, { ...qt, _source: "app" })
  }

  // Load project-specific (shared via git)
  for (const node of projectNodes) {
    const qt = await loadNode(projectSpecificPath, node, "project")
    if (qt) outMap.set(qt.id, qt)
  }

  // Load user overrides (private to .llm-wiki) — tombstone handling
  for (const node of userNodes) {
    const result = await loadNodeOrTombstone(userOverridePath, node)
    if (result === null) {
      // tombstone: remove from map
      const id = node.name.replace(/\.(yaml|yml|md)$/, "")
      outMap.delete(id)
    } else if (result) {
      outMap.set(result.id, result)
    }
  }

  return Array.from(outMap.values())
}

async function tryListDirectory(path: string): Promise<FileNode[]> {
  try {
    return await listDirectory(path)
  } catch {
    return []
  }
}

async function loadNode(
  dir: string,
  node: FileNode,
  source: "project" | "user",
): Promise<QuestionType | null> {
  if (node.is_dir) return null
  if (node.name.startsWith(".")) return null

  const isYaml = node.name.endsWith(".yaml") || node.name.endsWith(".yml")
  const isMd = node.name.endsWith(".md")
  if (!isYaml && !isMd) return null

  const id = node.name.replace(/\.(yaml|yml|md)$/, "")
  const filePath = `${dir}/${node.name}`
  try {
    const content = await readFile(filePath)
    const qt = isYaml ? parseYamlQuestionType(id, content) : parseMdQuestionType(id, content)
    return { ...qt, _source: source, _filePath: filePath }
  } catch (err) {
    console.warn(`[question-types] failed to load ${node.name}:`, err)
    return null
  }
}

// Returns null for tombstone, QuestionType for valid entry, undefined on error/skip
async function loadNodeOrTombstone(
  dir: string,
  node: FileNode,
): Promise<QuestionType | null | undefined> {
  if (node.is_dir) return undefined
  if (node.name.startsWith(".")) return undefined

  const isYaml = node.name.endsWith(".yaml") || node.name.endsWith(".yml")
  const isMd = node.name.endsWith(".md")
  if (!isYaml && !isMd) return undefined

  const id = node.name.replace(/\.(yaml|yml|md)$/, "")
  const filePath = `${dir}/${node.name}`
  try {
    const content = await readFile(filePath)
    if (isYaml) {
      const raw = yaml.load(content) as any
      if (raw && raw._deleted === true) return null // tombstone
      const qt = parseYamlQuestionType(id, content)
      return { ...qt, _source: "user", _filePath: filePath }
    } else {
      const qt = parseMdQuestionType(id, content)
      return { ...qt, _source: "user", _filePath: filePath }
    }
  } catch (err) {
    console.warn(`[question-types] failed to load ${node.name}:`, err)
    return undefined
  }
}

function parseYamlQuestionType(id: string, content: string): QuestionType {
  const raw = yaml.load(content) as any
  return {
    id,
    name: raw.name || id,
    description: raw.description || "",
    fields: raw.fields || {},
    promptTemplate: raw.prompt_template || raw.promptTemplate || "",
    zeroResidueMeaning: raw.zero_residue_meaning || raw.zeroResidueMeaning,
  }
}

function parseMdQuestionType(id: string, content: string): QuestionType {
  const { fm, body } = parseFrontmatter(content)
  let name = ""
  if (typeof fm.title === "string" && fm.title.trim()) {
    name = fm.title.trim()
  } else {
    const h1 = body.match(/^#\s+(.+)$/m)
    if (h1) name = h1[1].trim()
  }
  if (!name) name = id

  const inputShape = extractSection(body, ["Input", "입력"])
  const outputShape = extractSection(body, ["Output", "출력"])
  const zeroResidueMeaning = extractSection(body, [
    "Zero residue",
    "Zero-residue",
    "잔존 0",
  ])
  const description = extractDescription(body)

  // Legacy MD doesn't have fields/promptTemplate in the same way.
  // We'll map Input/Output to description/fields for now.
  return {
    id,
    name,
    description: description || inputShape || "",
    fields: {
      answer: outputShape || "General answer",
    },
    promptTemplate: "", // MD doesn't have a template
    inputShape,
    outputShape,
    zeroResidueMeaning,
  }
}

/**
 * First non-heading paragraph of `body`. Keeps the writer free to put a
 * leading H1 ("# 정책 위반 탐지") followed by the description text without
 * needing an explicit `## Description` heading.
 */
function extractDescription(body: string): string {
  const lines = body.split("\n")
  const para: string[] = []
  for (const line of lines) {
    if (/^\s*#{1,6}\s/.test(line)) {
      if (para.length > 0) break
      continue
    }
    if (line.trim() === "") {
      if (para.length > 0) break
      continue
    }
    para.push(line.trim())
  }
  return para.join(" ").trim()
}

function extractSection(body: string, titles: readonly string[]): string | undefined {
  for (const title of titles) {
    const re = new RegExp(`^##\\s+${escapeRegex(title)}\\s*$`, "im")
    const m = body.match(re)
    if (!m) continue
    const start = (m.index ?? 0) + m[0].length
    const rest = body.slice(start)
    const next = rest.search(/\n##\s/)
    const block = next >= 0 ? rest.slice(0, next) : rest
    const trimmed = block.trim()
    if (trimmed.length > 0) return trimmed
  }
  return undefined
}

function escapeRegex(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\*]/g, "\\$&")
}

/**
 * Minimal YAML frontmatter parser shared with `exclusions.ts`. Recognizes
 * scalar strings, booleans, and inline `[a, b, c]` arrays. Multi-line
 * YAML blocks are not supported here — `sources:` block parsing lives in
 * sources-merge.ts and uses its own walker.
 */
export function parseFrontmatter(content: string): {
  fm: Record<string, unknown>
  body: string
} {
  const m = content.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!m) return { fm: {}, body: content }
  const body = content.slice(m[0].length)
  const fm: Record<string, unknown> = {}
  for (const line of m[1].split("\n")) {
    const km = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
    if (!km) continue
    const key = km[1]
    const raw = km[2].trim()
    if (raw === "") {
      fm[key] = ""
      continue
    }
    if (raw.startsWith("[") && raw.endsWith("]")) {
      const inner = raw.slice(1, -1).trim()
      fm[key] =
        inner === ""
          ? []
          : inner.split(",").map((s) => stripQuotes(s.trim())).filter((s) => s.length > 0)
      continue
    }
    if (raw === "true") {
      fm[key] = true
      continue
    }
    if (raw === "false") {
      fm[key] = false
      continue
    }
    fm[key] = stripQuotes(raw)
  }
  return { fm, body }
}

function stripQuotes(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\")
  }
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1)
  }
  return s
}
