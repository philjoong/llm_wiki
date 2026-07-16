import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/commands/git", () => ({
  gitLog: vi.fn(),
  gitShow: vi.fn(),
  gitShowFile: vi.fn(),
  gitDiff: vi.fn(),
  gitCheckoutPath: vi.fn(),
  gitCommit: vi.fn(),
  gitRevert: vi.fn(),
}))
vi.mock("@/commands/fs", () => ({ readFile: vi.fn() }))
vi.mock("@/commands/knowledge", () => ({ getKnowledgePage: vi.fn() }))
import { gitLog, gitShowFile, type CommitInfo } from "@/commands/git"
import { readFile } from "@/commands/fs"
import { getKnowledgePage } from "@/commands/knowledge"
import {
  buildPreviousVersionsBlock,
  collectPreviousVersions,
  findDefaultComparisonVersion,
} from "./git-history"

const pageId = "page-01ARZ3NDEKTSV4RRFFQ69G5FAV"
const sectionId = "sec-01ARZ3NDEKTSV4RRFFQ69G5FAW"
const sectionId2 = "sec-01ARZ3NDEKTSV4RRFFQ69G5FAX"

function commit(hash: string, date: string): CommitInfo {
  return { hash, author: "t", date, message: "sync: update knowledge database" }
}

function v2Markdown(body: string, sections: string[] = [sectionId]): string {
  const fm = sections.map((id) => `  ${id}:\n    section_type: overview`).join("\n")
  const h2s = sections.map((id, i) => `## S${i} {#${id}}\n${body}`).join("\n")
  return `---\nschema: llm-wiki/page/v2\npage_id: ${pageId}\ntitle: Test\npage_type: guide\nsummary: s\nsections:\n${fm}\n---\n# Test\n${h2s}\n`
}

beforeEach(() => {
  vi.mocked(gitLog).mockReset()
  vi.mocked(gitShowFile).mockReset()
  vi.mocked(readFile).mockReset()
  vi.mocked(getKnowledgePage).mockReset()
})

describe("findDefaultComparisonVersion (Step 08 default point)", () => {
  it("skips the newest file-touching commit whose content matches the working tree and picks the older differing one", async () => {
    // Scenario behind the zero_residue misfire: the repo's last commit only
    // touched OTHER pages, so this file's newest touching commit (c2) equals
    // the working tree — the real previous state is c1.
    vi.mocked(gitLog).mockResolvedValue([commit("c2", "2026-07-10T00:00:00+09:00"), commit("c1", "2026-07-01T00:00:00+09:00")])
    vi.mocked(gitShowFile).mockImplementation(async (_p, hash) =>
      hash === "c2" ? { exists: true, content: "same-as-working" } : { exists: true, content: "older" })
    const version = await findDefaultComparisonVersion("/project", "db/a.md", "same-as-working")
    expect(version).toMatchObject({ commitHash: "c1", exists: true, content: "older" })
  })

  it("picks the newest commit when the working tree is already ahead of it", async () => {
    vi.mocked(gitLog).mockResolvedValue([commit("c2", "2026-07-10T00:00:00+09:00"), commit("c1", "2026-07-01T00:00:00+09:00")])
    vi.mocked(gitShowFile).mockResolvedValue({ exists: true, content: "committed" })
    const version = await findDefaultComparisonVersion("/project", "db/a.md", "edited-after-sync")
    expect(version?.commitHash).toBe("c2")
  })

  it("returns null when no commit touches the file (Sync never ran)", async () => {
    vi.mocked(gitLog).mockResolvedValue([])
    expect(await findDefaultComparisonVersion("/project", "db/a.md", "anything")).toBeNull()
    expect(gitShowFile).not.toHaveBeenCalled()
  })

  it("falls back to the oldest version when every recorded version equals the working tree", async () => {
    vi.mocked(gitLog).mockResolvedValue([commit("c2", "2026-07-10T00:00:00+09:00"), commit("c1", "2026-07-01T00:00:00+09:00")])
    vi.mocked(gitShowFile).mockResolvedValue({ exists: true, content: "unchanged" })
    const version = await findDefaultComparisonVersion("/project", "db/a.md", "unchanged")
    expect(version?.commitHash).toBe("c1")
  })

  it("treats a commit where the file is absent as differing", async () => {
    vi.mocked(gitLog).mockResolvedValue([commit("c1", "2026-07-01T00:00:00+09:00")])
    vi.mocked(gitShowFile).mockResolvedValue({ exists: false, content: null })
    const version = await findDefaultComparisonVersion("/project", "db/a.md", "current")
    expect(version).toMatchObject({ commitHash: "c1", exists: false })
  })
})

describe("collectPreviousVersions (Step 08 injection data)", () => {
  const entry = { key: "k1", pageId, sectionId, title: "Test", headingText: "S0" }

  beforeEach(() => {
    vi.mocked(getKnowledgePage).mockResolvedValue({ pageId, pagePath: "db/a.md", title: "Test", pageType: "guide", updatedAt: "now" })
    vi.mocked(readFile).mockResolvedValue(v2Markdown("current body"))
  })

  it("extracts the matching section body from the past version by its stable section id", async () => {
    vi.mocked(gitLog).mockResolvedValue([commit("c1", "2026-07-01T00:00:00+09:00")])
    vi.mocked(gitShowFile).mockResolvedValue({ exists: true, content: v2Markdown("old body") })
    const items = await collectPreviousVersions("/project", [entry], null)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ key: "k1", state: "present", commitDate: "2026-07-01T00:00:00+09:00" })
    expect(items[0].body).toContain("old body")
  })

  it("marks the file absent at the comparison point as 'file-absent' (당시 존재하지 않음)", async () => {
    vi.mocked(gitLog).mockResolvedValue([commit("c1", "2026-07-01T00:00:00+09:00")])
    vi.mocked(gitShowFile).mockResolvedValue({ exists: false, content: null })
    const items = await collectPreviousVersions("/project", [entry], null)
    expect(items).toEqual([expect.objectContaining({ key: "k1", state: "file-absent", body: null })])
  })

  it("marks a section missing from an existing past file as 'section-absent'", async () => {
    vi.mocked(gitLog).mockResolvedValue([commit("c1", "2026-07-01T00:00:00+09:00")])
    vi.mocked(gitShowFile).mockResolvedValue({ exists: true, content: v2Markdown("old body", [sectionId2]) })
    const items = await collectPreviousVersions("/project", [entry], null)
    expect(items).toEqual([expect.objectContaining({ key: "k1", state: "section-absent", body: null })])
  })

  it("contributes nothing when the file has no history (Sync never ran)", async () => {
    vi.mocked(gitLog).mockResolvedValue([])
    expect(await collectPreviousVersions("/project", [entry], null)).toEqual([])
  })

  it("reads the past content at the user-selected commit instead of the default point (Step 09)", async () => {
    vi.mocked(gitShowFile).mockResolvedValue({ exists: true, content: v2Markdown("old body") })
    const selected = { hash: "picked", date: "2026-06-15T00:00:00+09:00" }
    const items = await collectPreviousVersions("/project", [entry], selected)
    expect(gitShowFile).toHaveBeenCalledWith("/project", "picked", "db/a.md")
    expect(gitLog).not.toHaveBeenCalled() // no default-point walk when a point is pinned
    expect(items[0].commitDate).toBe("2026-06-15T00:00:00+09:00")
  })
})

describe("buildPreviousVersionsBlock (Step 08 prompt block)", () => {
  it("returns an empty string when there is nothing to inject", () => {
    expect(buildPreviousVersionsBlock([])).toBe("")
  })

  it("labels each entry with its citation key and commit date, and spells out absences", () => {
    const block = buildPreviousVersionsBlock([
      { key: "k1", title: "Test", headingText: "S0", commitDate: "2026-07-01T00:00:00+09:00", state: "present", body: "old body" },
      { key: "k2", commitDate: "2026-07-01T00:00:00+09:00", state: "file-absent", body: null },
      { key: "k3", commitDate: "2026-07-01T00:00:00+09:00", state: "section-absent", body: null },
    ])
    expect(block).toContain("## Previous Versions")
    expect(block).toContain("[CIT:k1]")
    expect(block).toContain("as-of=2026-07-01T00:00:00+09:00")
    expect(block).toContain("old body")
    expect(block).toContain("[CIT:k2]")
    expect(block).toContain("did not exist at that point")
    expect(block).toContain("[CIT:k3]")
    expect(block).toContain("this section did not exist")
  })
})
