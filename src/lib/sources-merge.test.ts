/**
 * Regression suite for the sources-merge helpers used during ingest.
 *
 * Why this exists: the stage-2 prompt tells the LLM to emit
 * `sources: ["<current>"]` on every FILE block, but doesn't feed the
 * existing page's body in. Without this merge step, each re-ingest
 * would clobber the sources array to a single entry, and the
 * source-delete flow would later treat the page as single-sourced →
 * delete it → lose content contributed by the earlier source.
 *
 * Every failure mode below, if it regressed, would surface as
 * silent data loss on the user's next source-delete.
 */
import { describe, it, expect } from "vitest"
import {
  parseSources,
  writeSources,
  mergeSourcesLists,
  mergeSourcesIntoContent,
  parseSourceRefs,
  writeSourceRefs,
  mergeSourceRefsLists,
  mergeSourceRefsIntoContent,
} from "./sources-merge"

const WRAP = (fm: string, body = "body\n") => `---\n${fm}\n---\n${body}`

// ── parseSources ────────────────────────────────────────────────────

describe("parseSources — inline `sources: [...]`", () => {
  it("extracts a single-entry array", () => {
    expect(parseSources(WRAP('sources: ["a.md"]'))).toEqual(["a.md"])
  })

  it("extracts a multi-entry array", () => {
    expect(parseSources(WRAP('sources: ["a.md", "b.md"]'))).toEqual(["a.md", "b.md"])
  })

  it("handles single quotes", () => {
    expect(parseSources(WRAP("sources: ['a.md', 'b.md']"))).toEqual(["a.md", "b.md"])
  })

  it("handles bare (unquoted) entries", () => {
    expect(parseSources(WRAP("sources: [a.md, b.md]"))).toEqual(["a.md", "b.md"])
  })

  it("handles no-space-after-comma", () => {
    expect(parseSources(WRAP('sources: ["a.md","b.md"]'))).toEqual(["a.md", "b.md"])
  })

  it("returns empty array for empty brackets", () => {
    expect(parseSources(WRAP("sources: []"))).toEqual([])
  })

  it("returns empty array when frontmatter has no sources field", () => {
    expect(parseSources(WRAP("title: X"))).toEqual([])
  })

  it("returns empty array when no frontmatter at all", () => {
    expect(parseSources("# heading\n\nbody")).toEqual([])
  })

  it("handles CJK-named source files", () => {
    expect(parseSources(WRAP('sources: ["测试.md", "test.md"]'))).toEqual([
      "测试.md",
      "test.md",
    ])
  })
})

describe("parseSources — multi-line YAML list form", () => {
  it("extracts a multi-line list", () => {
    const content = WRAP(
      ["sources:", "  - a.md", "  - b.md"].join("\n"),
    )
    expect(parseSources(content)).toEqual(["a.md", "b.md"])
  })

  it("handles quoted multi-line entries", () => {
    const content = WRAP(
      ["sources:", '  - "a.md"', "  - 'b.md'"].join("\n"),
    )
    expect(parseSources(content)).toEqual(["a.md", "b.md"])
  })
})

// ── writeSources ────────────────────────────────────────────────────

describe("writeSources", () => {
  it("replaces an existing inline sources array", () => {
    const before = WRAP('title: X\nsources: ["a.md"]')
    const after = writeSources(before, ["a.md", "b.md"])
    expect(parseSources(after)).toEqual(["a.md", "b.md"])
    // Other frontmatter fields preserved.
    expect(after).toContain("title: X")
  })

  it("preserves field order (sources stays in its original position)", () => {
    const before = WRAP('title: X\nsources: ["a.md"]\ntags: []')
    const after = writeSources(before, ["a.md", "b.md"])
    const fmLines = after
      .match(/^---\n([\s\S]*?)\n---/)![1]
      .split("\n")
      .map((l) => l.split(":")[0].trim())
    expect(fmLines).toEqual(["title", "sources", "tags"])
  })

  it("inserts a sources field when none exists", () => {
    const before = WRAP("title: X\ntags: []")
    const after = writeSources(before, ["a.md"])
    expect(parseSources(after)).toEqual(["a.md"])
    expect(after).toContain("title: X")
    expect(after).toContain("tags: []")
  })

  it("collapses multi-line YAML list form into inline form", () => {
    const before = WRAP(
      ["title: X", "sources:", "  - a.md", "  - b.md"].join("\n"),
    )
    const after = writeSources(before, ["a.md", "b.md", "c.md"])
    expect(parseSources(after)).toEqual(["a.md", "b.md", "c.md"])
    expect(after).toContain('sources: ["a.md", "b.md", "c.md"]')
    // Multi-line artefacts removed.
    expect(after).not.toMatch(/^\s+-\s+a\.md/m)
  })

  it("returns content unchanged when there is no frontmatter", () => {
    const before = "# heading\n\nbody"
    expect(writeSources(before, ["a.md"])).toBe(before)
  })

  it("preserves the body of the document", () => {
    const before = WRAP(
      'title: X\nsources: ["a.md"]',
      "# Title\n\nLots of prose here.\nAnd more prose.",
    )
    const after = writeSources(before, ["a.md", "b.md"])
    expect(after).toContain("# Title")
    expect(after).toContain("Lots of prose here.")
    expect(after).toContain("And more prose.")
  })
})

// ── mergeSourcesLists ───────────────────────────────────────────────

describe("mergeSourcesLists", () => {
  it("unions disjoint lists in order", () => {
    expect(mergeSourcesLists(["a.md"], ["b.md"])).toEqual(["a.md", "b.md"])
  })

  it("dedupes exact duplicates", () => {
    expect(mergeSourcesLists(["a.md"], ["a.md"])).toEqual(["a.md"])
  })

  it("dedupes case-insensitively, keeping the existing casing", () => {
    expect(mergeSourcesLists(["Test.md"], ["test.md"])).toEqual(["Test.md"])
  })

  it("preserves order of existing entries", () => {
    expect(mergeSourcesLists(["b.md", "a.md"], ["c.md"])).toEqual([
      "b.md",
      "a.md",
      "c.md",
    ])
  })

  it("is a no-op for empty+empty", () => {
    expect(mergeSourcesLists([], [])).toEqual([])
  })

  it("preserves existing when incoming is empty", () => {
    expect(mergeSourcesLists(["a.md", "b.md"], [])).toEqual(["a.md", "b.md"])
  })

  it("preserves incoming when existing is empty", () => {
    expect(mergeSourcesLists([], ["a.md", "b.md"])).toEqual(["a.md", "b.md"])
  })
})

// ── mergeSourcesIntoContent — the real ingest entry point ──────────

describe("mergeSourcesIntoContent — happy paths", () => {
  it("returns newContent unchanged when page is new (no existingContent)", () => {
    const newContent = WRAP('sources: ["test2.md"]')
    expect(mergeSourcesIntoContent(newContent, null)).toBe(newContent)
  })

  it("merges sources when the page already exists with a different source", () => {
    const existing = WRAP('sources: ["test1.md"]', "old body")
    const incoming = WRAP('sources: ["test2.md"]', "fresh body from re-ingest")
    const merged = mergeSourcesIntoContent(incoming, existing)
    expect(parseSources(merged)).toEqual(["test1.md", "test2.md"])
    // Body is the NEW body — this function only rewrites the sources
    // field, it doesn't preserve old content.
    expect(merged).toContain("fresh body from re-ingest")
    expect(merged).not.toContain("old body")
  })

  it("idempotent: merging the same current source is a no-op on sources", () => {
    const existing = WRAP('sources: ["test1.md", "test2.md"]')
    const incoming = WRAP('sources: ["test1.md"]')
    const merged = mergeSourcesIntoContent(incoming, existing)
    expect(parseSources(merged)).toEqual(["test1.md", "test2.md"])
  })

  it("short-circuits (returns newContent verbatim) when old is a subset of new", () => {
    // Covers the no-op optimization branch: when the merged list
    // equals newSources element-for-element, the function should hand
    // back the unchanged newContent string (same reference, no
    // rewrite). Exercises the `merged === newSources` fast path.
    const existing = WRAP('sources: ["a.md"]')
    const incoming = WRAP('sources: ["a.md"]', "body content")
    const merged = mergeSourcesIntoContent(incoming, existing)
    // Same reference — no writeSources call happened.
    expect(merged).toBe(incoming)
  })

  it("handles case-insensitive source filenames (keeps original casing)", () => {
    const existing = WRAP('sources: ["Test1.md"]')
    const incoming = WRAP('sources: ["test1.md"]')
    const merged = mergeSourcesIntoContent(incoming, existing)
    // Should be a single entry with the existing (original) casing,
    // not a duplicate.
    expect(parseSources(merged)).toEqual(["Test1.md"])
  })

  it("appends the new source to an already multi-source page", () => {
    const existing = WRAP('sources: ["a.md", "b.md"]')
    const incoming = WRAP('sources: ["c.md"]')
    const merged = mergeSourcesIntoContent(incoming, existing)
    expect(parseSources(merged)).toEqual(["a.md", "b.md", "c.md"])
  })
})

describe("mergeSourcesIntoContent — degenerate inputs", () => {
  it("is a no-op when existingContent has no sources field at all", () => {
    // Pre-0.3.x pages without sources field should not spontaneously
    // acquire phantom sources from the existing file.
    const existing = WRAP("title: X")
    const incoming = WRAP('sources: ["test2.md"]')
    expect(mergeSourcesIntoContent(incoming, existing)).toBe(incoming)
  })

  it("is a no-op when existingContent is empty string", () => {
    const incoming = WRAP('sources: ["test2.md"]')
    expect(mergeSourcesIntoContent(incoming, "")).toBe(incoming)
  })

  it("tolerates newContent missing a sources field (LLM slipup)", () => {
    // If the LLM forgot to emit sources in the new content but the
    // existing page has one, we should NOT drop the existing sources.
    const existing = WRAP('sources: ["test1.md"]')
    const incomingNoSources = WRAP("title: X")
    const merged = mergeSourcesIntoContent(incomingNoSources, existing)
    expect(parseSources(merged)).toEqual(["test1.md"])
  })

  it("tolerates existingContent with no frontmatter at all", () => {
    const existing = "# legacy non-frontmatter page"
    const incoming = WRAP('sources: ["test2.md"]')
    expect(mergeSourcesIntoContent(incoming, existing)).toBe(incoming)
  })
})

// ── The end-to-end scenario that motivated this module ────────────

describe("Regression: the data-loss path in the user's diagnosis", () => {
  it("two ingests against the same page result in union, not last-wins", () => {
    // Step 1 of user's failure scenario: ingest test1.md creates
    // attention.md with sources=[test1.md].
    const afterFirstIngest = mergeSourcesIntoContent(
      WRAP('title: Attention\nsources: ["test1.md"]', "content from test1"),
      null,
    )
    expect(parseSources(afterFirstIngest)).toEqual(["test1.md"])

    // Step 2: ingest test2.md, which also covers attention. LLM emits
    // `sources: ["test2.md"]` per the prompt template, but we merge
    // before writing — so the on-disk sources field becomes BOTH.
    const afterSecondIngest = mergeSourcesIntoContent(
      WRAP('title: Attention\nsources: ["test2.md"]', "content from test2"),
      afterFirstIngest,
    )
    expect(parseSources(afterSecondIngest)).toEqual(["test1.md", "test2.md"])

    // Step 3: user later deletes test2.md. The source-deletion
    // flow reads sources = ["test1.md", "test2.md"] (length 2),
    // recognises the page is shared, and keeps it on disk — no data
    // loss. Before this fix, step 2 would have clobbered sources to
    // just ["test2.md"], and step 3 would have deleted the page.
    const remainingSourcesAfterDeletingTest2 = parseSources(afterSecondIngest)
      .filter((s) => s.toLowerCase() !== "test2.md")
    expect(remainingSourcesAfterDeletingTest2).toEqual(["test1.md"])
  })

  it("three-way re-ingest: each ingest contributes its own source to the union", () => {
    let page = mergeSourcesIntoContent(
      WRAP('sources: ["a.md"]', "body v1"),
      null,
    )
    page = mergeSourcesIntoContent(
      WRAP('sources: ["b.md"]', "body v2"),
      page,
    )
    page = mergeSourcesIntoContent(
      WRAP('sources: ["c.md"]', "body v3"),
      page,
    )
    expect(parseSources(page)).toEqual(["a.md", "b.md", "c.md"])
    // Body is always the most recent emission — we don't diff-merge
    // the body, only the sources list.
    expect(page).toContain("body v3")
    expect(page).not.toContain("body v1")
    expect(page).not.toContain("body v2")
  })
})

// ── Stage 3: SourceRef-aware variants ──────────────────────────────────

describe("parseSourceRefs — accepts every form the LLM might emit", () => {
  it("parses inline string array (legacy)", () => {
    expect(parseSourceRefs(WRAP('sources: ["a.md", "b.md"]'))).toEqual([
      { file: "a.md" },
      { file: "b.md" },
    ])
  })

  it("parses multi-line string list (legacy)", () => {
    const fm = ["sources:", "  - a.md", "  - b.md"].join("\n")
    expect(parseSourceRefs(WRAP(fm))).toEqual([
      { file: "a.md" },
      { file: "b.md" },
    ])
  })

  it("parses Stage 3 multi-line object form (file + range)", () => {
    const fm = [
      "sources:",
      "  - file: design.md",
      "    range: ## 3. 던전 A — 보상",
      "  - file: design.md",
      "    range: ## 4. 던전 B — 스폰 규칙",
    ].join("\n")
    expect(parseSourceRefs(WRAP(fm))).toEqual([
      { file: "design.md", range: "## 3. 던전 A — 보상" },
      { file: "design.md", range: "## 4. 던전 B — 스폰 규칙" },
    ])
  })

  it("parses object form with quoted range (handles colons / dashes)", () => {
    const fm = [
      "sources:",
      '  - file: "design.md"',
      '    range: "section 3.2.1: rewards"',
    ].join("\n")
    expect(parseSourceRefs(WRAP(fm))).toEqual([
      { file: "design.md", range: "section 3.2.1: rewards" },
    ])
  })

  it("tolerates object entries without range", () => {
    const fm = [
      "sources:",
      "  - file: a.md",
      "  - file: b.md",
      "    range: section 2",
    ].join("\n")
    expect(parseSourceRefs(WRAP(fm))).toEqual([
      { file: "a.md" },
      { file: "b.md", range: "section 2" },
    ])
  })

  it("returns [] when there is no sources field", () => {
    expect(parseSourceRefs(WRAP("title: X"))).toEqual([])
  })

  it("stops the multi-line block at the next frontmatter field", () => {
    // A subsequent non-indented field (`tags:` here) must not be sucked
    // into the sources block — the block scanner stops at the first
    // non-indented non-empty line.
    const fm = [
      "title: X",
      "sources:",
      "  - file: a.md",
      "    range: section 1",
      "tags: [t1]",
    ].join("\n")
    expect(parseSourceRefs(WRAP(fm))).toEqual([
      { file: "a.md", range: "section 1" },
    ])
  })
})

describe("parseSources back-compat with new object form", () => {
  it("projects new-format object entries down to filenames only", () => {
    // Legacy callers (e.g. the source-delete flow) should
    // continue to work even when reading a Stage-3 page whose
    // frontmatter uses the object form.
    const fm = [
      "sources:",
      "  - file: a.md",
      "    range: section 1",
      "  - file: b.md",
      "    range: section 2",
    ].join("\n")
    expect(parseSources(WRAP(fm))).toEqual(["a.md", "b.md"])
  })
})

// ── writeSourceRefs ────────────────────────────────────────────────────

describe("writeSourceRefs", () => {
  it("emits the multi-line object form for refs with ranges", () => {
    const before = WRAP("title: X")
    const after = writeSourceRefs(before, [
      { file: "a.md", range: "section 1" },
      { file: "a.md", range: "section 2" },
    ])
    expect(after).toContain("sources:")
    expect(after).toContain("- file: a.md")
    expect(after).toContain('range: "section 1"')
    expect(after).toContain('range: "section 2"')
    // Round-trip: re-parsing must yield the same shape.
    expect(parseSourceRefs(after)).toEqual([
      { file: "a.md", range: "section 1" },
      { file: "a.md", range: "section 2" },
    ])
  })

  it("emits object entries without range for ranged-less refs", () => {
    const before = WRAP("title: X")
    const after = writeSourceRefs(before, [{ file: "a.md" }])
    expect(after).toMatch(/sources:\s*\n\s+-\s+file: a\.md/)
    expect(after).not.toContain("range:")
    expect(parseSourceRefs(after)).toEqual([{ file: "a.md" }])
  })

  it("replaces an existing inline string array", () => {
    const before = WRAP('title: X\nsources: ["a.md"]\ntags: []')
    const after = writeSourceRefs(before, [
      { file: "a.md", range: "section 1" },
    ])
    expect(parseSourceRefs(after)).toEqual([
      { file: "a.md", range: "section 1" },
    ])
    // Other frontmatter fields preserved.
    expect(after).toContain("title: X")
    expect(after).toContain("tags: []")
  })

  it("replaces an existing multi-line block (string OR object form)", () => {
    const before = WRAP(
      [
        "title: X",
        "sources:",
        "  - file: a.md",
        "    range: section 1",
        "tags: []",
      ].join("\n"),
    )
    const after = writeSourceRefs(before, [
      { file: "a.md", range: "section 1" },
      { file: "b.md" },
    ])
    expect(parseSourceRefs(after)).toEqual([
      { file: "a.md", range: "section 1" },
      { file: "b.md" },
    ])
    expect(after).toContain("tags: []")
  })

  it("escapes embedded double quotes in range", () => {
    const before = WRAP("title: X")
    const after = writeSourceRefs(before, [
      { file: "a.md", range: 'has "quoted" word' },
    ])
    expect(after).toContain('range: "has \\"quoted\\" word"')
    expect(parseSourceRefs(after)).toEqual([
      { file: "a.md", range: 'has "quoted" word' },
    ])
  })

  it("returns content unchanged when there is no frontmatter", () => {
    const before = "# heading\n\nbody"
    expect(writeSourceRefs(before, [{ file: "a.md" }])).toBe(before)
  })
})

// ── mergeSourceRefsLists ──────────────────────────────────────────────

describe("mergeSourceRefsLists", () => {
  it("dedups entries with the same file + range", () => {
    expect(
      mergeSourceRefsLists(
        [{ file: "a.md", range: "s1" }],
        [{ file: "a.md", range: "s1" }],
      ),
    ).toEqual([{ file: "a.md", range: "s1" }])
  })

  it("keeps entries with the same file but different ranges", () => {
    // This is the central Stage 3 case: two different sections of the
    // same raw file landing on the same page must both be remembered.
    expect(
      mergeSourceRefsLists(
        [{ file: "design.md", range: "section 1" }],
        [{ file: "design.md", range: "section 2" }],
      ),
    ).toEqual([
      { file: "design.md", range: "section 1" },
      { file: "design.md", range: "section 2" },
    ])
  })

  it("dedups case-insensitively across both file and range", () => {
    expect(
      mergeSourceRefsLists(
        [{ file: "Design.md", range: "Section 1" }],
        [{ file: "design.md", range: "section 1" }],
      ),
    ).toEqual([{ file: "Design.md", range: "Section 1" }])
  })

  it("preserves order of existing entries", () => {
    expect(
      mergeSourceRefsLists(
        [{ file: "b.md" }, { file: "a.md" }],
        [{ file: "c.md" }],
      ),
    ).toEqual([{ file: "b.md" }, { file: "a.md" }, { file: "c.md" }])
  })

  it("a file-only ref and a same-file ranged ref coexist", () => {
    // file-only means "the whole file"; ranged means "this section".
    // They're different identities and both should survive merge.
    expect(
      mergeSourceRefsLists(
        [{ file: "a.md" }],
        [{ file: "a.md", range: "section 1" }],
      ),
    ).toEqual([{ file: "a.md" }, { file: "a.md", range: "section 1" }])
  })
})

// ── mergeSourceRefsIntoContent ────────────────────────────────────────

describe("mergeSourceRefsIntoContent", () => {
  it("preserves range when an old range ref merges with a new range ref", () => {
    const existing = WRAP(
      [
        "sources:",
        "  - file: design.md",
        "    range: section 1",
      ].join("\n"),
    )
    const incoming = WRAP(
      [
        "sources:",
        "  - file: design.md",
        "    range: section 2",
      ].join("\n"),
      "fresh body",
    )
    const merged = mergeSourceRefsIntoContent(incoming, existing)
    expect(parseSourceRefs(merged)).toEqual([
      { file: "design.md", range: "section 1" },
      { file: "design.md", range: "section 2" },
    ])
    expect(merged).toContain("fresh body")
  })

  it("upgrades a legacy string-form page to object form when a ranged ref is added", () => {
    const existing = WRAP('sources: ["design.md"]')
    const incoming = WRAP(
      [
        "sources:",
        "  - file: design.md",
        "    range: section 1",
      ].join("\n"),
    )
    const merged = mergeSourceRefsIntoContent(incoming, existing)
    // Legacy `{ file: "design.md" }` and new `{ file, range }` are
    // separate identities — both must survive.
    expect(parseSourceRefs(merged)).toEqual([
      { file: "design.md" },
      { file: "design.md", range: "section 1" },
    ])
  })

  it("returns newContent unchanged when page is new (no existing)", () => {
    const incoming = WRAP(
      [
        "sources:",
        "  - file: a.md",
        "    range: s1",
      ].join("\n"),
    )
    expect(mergeSourceRefsIntoContent(incoming, null)).toBe(incoming)
  })

  it("short-circuits when the incoming refs already cover the existing", () => {
    // Same file+range on both sides → no rewrite, hand back newContent.
    const existing = WRAP('sources: ["a.md"]')
    const incoming = WRAP('sources: ["a.md"]')
    expect(mergeSourceRefsIntoContent(incoming, existing)).toBe(incoming)
  })
})

