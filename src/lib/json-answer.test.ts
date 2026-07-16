import { describe, expect, it } from "vitest"
import {
  parseJsonAnswer,
  parseInformationRequests,
  buildRequiredInfoPrompt,
  stripCodeFence,
  INFORMATION_REQUESTS_KEY,
} from "./json-answer"

describe("stripCodeFence", () => {
  it("strips a ```json fence", () => {
    expect(stripCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}')
  })
  it("strips a bare ``` fence", () => {
    expect(stripCodeFence('```\n{"a":1}\n```')).toBe('{"a":1}')
  })
  it("leaves unfenced content untouched", () => {
    expect(stripCodeFence('  {"a":1}  ')).toBe('{"a":1}')
  })
})

describe("parseJsonAnswer", () => {
  it("parses a plain JSON object", () => {
    expect(parseJsonAnswer('{"affected_pages":"- A [[CIT:3]]"}')).toEqual({ affected_pages: "- A [[CIT:3]]" })
  })
  it("parses a fenced JSON object (local-model drift)", () => {
    expect(parseJsonAnswer('```json\n{"x":"y"}\n```')).toEqual({ x: "y" })
  })
  it("returns null for prose (fallback to raw markdown)", () => {
    expect(parseJsonAnswer("This is a normal markdown answer.")).toBeNull()
  })
  it("returns null for incomplete/streaming JSON", () => {
    expect(parseJsonAnswer('{"x":"partial')).toBeNull()
  })
  it("rejects arrays and scalars — the contract is an object of fields", () => {
    expect(parseJsonAnswer('["a","b"]')).toBeNull()
    expect(parseJsonAnswer('"just a string"')).toBeNull()
  })
})

describe("parseInformationRequests (Step 10 §5)", () => {
  const KEYS = ["change_target", "change_detail"]

  it("accepts a valid request referencing a required_info key", () => {
    const answer = parseJsonAnswer(
      JSON.stringify({
        affected_pages: "- A",
        [INFORMATION_REQUESTS_KEY]: [
          { info_key: "change_detail", question: "상한이 어디?", reason: "위키에 없음", input_type: "text", options: [] },
        ],
      }),
    )
    expect(parseInformationRequests(answer, KEYS)).toEqual([
      { infoKey: "change_detail", question: "상한이 어디?", reason: "위키에 없음", inputType: "text", options: [] },
    ])
  })

  it("keeps choice options only as strings", () => {
    const answer = parseJsonAnswer(
      JSON.stringify({
        [INFORMATION_REQUESTS_KEY]: [
          { info_key: "change_target", question: "q", reason: "r", input_type: "choice", options: ["A", 5, "B"] },
        ],
      }),
    )
    expect(parseInformationRequests(answer, KEYS)[0].options).toEqual(["A", "B"])
  })

  it("drops requests with an out-of-set input_type or an unknown info_key", () => {
    const answer = parseJsonAnswer(
      JSON.stringify({
        [INFORMATION_REQUESTS_KEY]: [
          { info_key: "change_detail", question: "q", reason: "r", input_type: "dropdown", options: [] },
          { info_key: "not_a_key", question: "q", reason: "r", input_type: "text", options: [] },
          { info_key: "change_target", question: "ok", reason: "r", input_type: "link", options: [] },
        ],
      }),
    )
    const out = parseInformationRequests(answer, KEYS)
    expect(out).toHaveLength(1)
    expect(out[0].infoKey).toBe("change_target")
    expect(out[0].inputType).toBe("link")
  })

  it("returns [] when the reserved key is absent or malformed", () => {
    expect(parseInformationRequests(parseJsonAnswer('{"a":"b"}'), KEYS)).toEqual([])
    expect(parseInformationRequests(parseJsonAnswer(`{"${INFORMATION_REQUESTS_KEY}":"nope"}`), KEYS)).toEqual([])
    expect(parseInformationRequests(null, KEYS)).toEqual([])
  })
})

describe("buildRequiredInfoPrompt (Step 10 §3-4)", () => {
  it("lists items, the schema, and unavailable keys to skip", () => {
    const prompt = buildRequiredInfoPrompt(
      { change_target: "무엇을 변경", change_detail: "어떻게 변경" },
      ["change_target"],
    )
    expect(prompt).toContain("change_target")
    expect(prompt).toContain(INFORMATION_REQUESTS_KEY)
    expect(prompt).toContain('"choice" | "text" | "file" | "link"')
    expect(prompt).toContain("do NOT ask for them again")
    expect(prompt).toContain("change_target.")
  })

  it("returns empty string when the type declares no required_info", () => {
    expect(buildRequiredInfoPrompt(undefined)).toBe("")
    expect(buildRequiredInfoPrompt({})).toBe("")
  })

  it("omits the unavailable-keys clause when none are marked", () => {
    const prompt = buildRequiredInfoPrompt({ k: "d" })
    expect(prompt).not.toContain("do NOT ask for them again")
  })
})
