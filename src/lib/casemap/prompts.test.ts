import { describe, it, expect } from "vitest"
import {
  extractJsonObject,
  renderCombination,
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
} from "./prompts"
import type { CandidateCombo, TestAxis } from "./types"

const LANG = "## OUTPUT LANGUAGE: Korean"

const AXES: TestAxis[] = [
  { id: "ax-state", name: "상태", values: ["전투 중", "로비"], enabled: true },
  { id: "ax-net", name: "네트워크", values: ["정상", "지연"], enabled: true },
]

const CANDS: CandidateCombo[] = [
  { id: "c1", combination: { "ax-state": "전투 중", "ax-net": "지연" }, impossible: false },
  { id: "c2", combination: { "ax-state": "로비", "ax-net": "정상" }, impossible: false },
]

describe("extractJsonObject", () => {
  it("parses a bare JSON object", () => {
    expect(extractJsonObject('{"a": 1}')).toEqual({ a: 1 })
  })

  it("strips ```json code fences", () => {
    expect(extractJsonObject('```json\n{"a": 1}\n```')).toEqual({ a: 1 })
  })

  it("tolerates prose around the object", () => {
    expect(extractJsonObject('Here you go:\n{"a": 1}\nHope that helps!')).toEqual({ a: 1 })
  })

  it("throws when there is no JSON object", () => {
    expect(() => extractJsonObject("no json here")).toThrow(/No JSON object/)
  })
})

describe("renderCombination", () => {
  it("renders axis names in axis order", () => {
    expect(renderCombination({ "ax-net": "지연", "ax-state": "전투 중" }, AXES)).toBe(
      "상태=전투 중 / 네트워크=지연",
    )
  })

  it("skips axes absent from the combination", () => {
    expect(renderCombination({ "ax-net": "지연" }, AXES)).toBe("네트워크=지연")
  })
})

describe("abstraction prompt", () => {
  it("embeds the feature text, language directive and JSON-only instruction", () => {
    const { system, user } = buildAbstractionPrompt("파이어볼은 마법 스킬이다.", LANG)
    expect(system).toContain(LANG)
    expect(user).toContain("파이어볼은 마법 스킬이다.")
    expect(user).toContain("Output ONLY a JSON object")
  })

  it("parses, trims and dedupes tags", () => {
    const raw = '{"tags": [" 시전형 스킬 ", "쿨타임 존재", "시전형 스킬", ""]}'
    expect(parseAbstractionResponse(raw)).toEqual(["시전형 스킬", "쿨타임 존재"])
  })

  it("throws on an empty tag list", () => {
    expect(() => parseAbstractionResponse('{"tags": []}')).toThrow(/no tags/)
  })
})

describe("axis prompt", () => {
  it("seeds the default axes and tags", () => {
    const { system, user } = buildAxisPrompt("설명", ["쿨타임 존재"], LANG)
    expect(system).toContain("네트워크: 정상, 지연, 끊김")
    expect(user).toContain("쿨타임 존재")
  })

  it("parses axes with generated ids and risky-value refs", () => {
    const raw = JSON.stringify({
      axes: [
        { name: "네트워크", values: ["정상", "지연", "끊김"], riskyValues: ["끊김", "존재하지 않는 값"] },
        { name: "", values: ["x"] },
        { name: "빈 축", values: [] },
      ],
    })
    const { axes, priorityValues } = parseAxisResponse(raw)
    expect(axes).toHaveLength(1)
    expect(axes[0].name).toBe("네트워크")
    expect(axes[0].enabled).toBe(true)
    expect(priorityValues).toEqual([{ axisId: axes[0].id, value: "끊김" }])
  })

  it("throws when no usable axis survives", () => {
    expect(() => parseAxisResponse('{"axes": [{"name": "", "values": []}]}')).toThrow(/no usable axes/)
  })
})

describe("impossible prompt", () => {
  it("lists each candidate with its rendered combination", () => {
    const { user } = buildImpossiblePrompt("설명", CANDS, AXES, LANG)
    expect(user).toContain("id: c1")
    expect(user).toContain("상태=전투 중 / 네트워크=지연")
  })

  it("parses verdicts and skips malformed entries", () => {
    const raw = JSON.stringify({
      verdicts: [
        { id: "c1", impossible: true, reason: "로비에서 전투 스킬 불가" },
        { id: "c2", impossible: "yes" },
        { impossible: false },
      ],
    })
    expect(parseImpossibleResponse(raw)).toEqual([
      { id: "c1", impossible: true, reason: "로비에서 전투 스킬 불가" },
    ])
  })
})

describe("risk prompt", () => {
  it("includes the High/Medium/Low rubric", () => {
    const { system } = buildRiskPrompt("설명", CANDS, AXES, LANG)
    expect(system).toContain("중복 지급/중복 차감")
    expect(system).toContain("시각적 어색함")
  })

  it("normalizes risk casing and drops unknown levels", () => {
    const raw = JSON.stringify({
      grades: [
        { id: "c1", risk: "High", reason: "중복 차감 가능" },
        { id: "c2", risk: "critical", reason: "?" },
      ],
    })
    expect(parseRiskResponse(raw)).toEqual([{ id: "c1", risk: "high", reason: "중복 차감 가능" }])
  })
})

describe("test case prompt", () => {
  it("parses case docs and keeps list fields as string arrays", () => {
    const raw = JSON.stringify({
      cases: [
        {
          id: "c1",
          purpose: "중복 발동 확인",
          preconditions: ["전투 중이다", "마나가 충분하다"],
          steps: ["버튼을 누른다", "연타한다"],
          expected: ["1회만 발동한다"],
        },
        { id: "c2" },
      ],
    })
    const docs = parseTestCaseResponse(raw)
    expect(docs).toHaveLength(1)
    expect(docs[0].steps).toHaveLength(2)
  })

  it("prompt carries feature text, tags and candidates", () => {
    const { user } = buildTestCasePrompt("파이어볼 설명", ["쿨타임 존재"], CANDS, AXES, LANG)
    expect(user).toContain("파이어볼 설명")
    expect(user).toContain("쿨타임 존재")
    expect(user).toContain("id: c2")
  })
})
