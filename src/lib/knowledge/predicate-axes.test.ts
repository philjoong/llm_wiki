import { describe, expect, it } from "vitest"
import { PREDICATE_AXES, predicatesForAxes } from "./predicate-axes"

describe("predicate axes", () => {
  it("expands the dependency axis to its concrete predicates", () => {
    expect(predicatesForAxes(["dependency"])).toEqual([...PREDICATE_AXES.dependency])
  })

  it("dedupes and ignores unknown axis names", () => {
    expect(predicatesForAxes(["dependency", "dependency", "nope"])).toEqual([...PREDICATE_AXES.dependency])
  })

  it("returns an empty list for no axes", () => {
    expect(predicatesForAxes([])).toEqual([])
  })
})
