import { describe, it, expect } from "vitest"
import { formatModificationMessage } from "../auto-commit"

describe("formatModificationMessage", () => {
  it("includes range when present", () => {
    const msg = formatModificationMessage("approve", "db/x.md", {
      file: "raw.md",
      range: "section 3",
    })
    expect(msg).toBe(
      "modification: approve db/x.md\n\nSource: raw.md:section 3\nResolved-by: approve",
    )
  })

  it("omits range suffix when absent", () => {
    const msg = formatModificationMessage("discard", "db/x.md", {
      file: "raw.md",
    })
    expect(msg).toBe(
      "modification: discard db/x.md\n\nSource: raw.md\nResolved-by: discard",
    )
  })
})
