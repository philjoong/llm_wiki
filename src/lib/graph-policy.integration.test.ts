/**
 * Real-FS tests for graph-policy load/save.
 *
 * `graphRelationTypes` is the single source of truth for relation types.
 * The legacy global `relationTypes` field was removed entirely — files
 * that still carry it load fine (unknown keys are ignored) and it is
 * dropped on the next save.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { realFs, createTempProject, readFileRaw, writeFileRaw } from "@/test-helpers/fs-temp"

vi.mock("@/commands/fs", () => realFs)

import {
  loadGraphPolicy,
  saveGraphPolicy,
  buildGraphPolicyPrompt,
  DEFAULT_POLICY,
} from "./graph-policy"

let tmp: { path: string; cleanup: () => Promise<void> }

const policyFile = () => `${tmp.path}/.llm-wiki/graph-policy.json`

async function writePolicyRaw(policy: unknown): Promise<void> {
  await writeFileRaw(policyFile(), JSON.stringify(policy))
}

beforeEach(async () => {
  tmp = await createTempProject("graph-policy")
})

afterEach(async () => {
  await tmp.cleanup()
})

describe("loadGraphPolicy", () => {
  it("loads managedGraphs and graphRelationTypes", async () => {
    await writePolicyRaw({
      managedGraphs: ["combat_graph"],
      graphRelationTypes: { combat_graph: ["WEAK_AGAINST", "USES_SKILL"] },
    })
    const policy = await loadGraphPolicy(tmp.path)
    expect(policy.managedGraphs).toEqual(["combat_graph"])
    expect(policy.graphRelationTypes.combat_graph).toEqual(["WEAK_AGAINST", "USES_SKILL"])
  })

  it("ignores the removed legacy relationTypes field in old files", async () => {
    await writePolicyRaw({
      relationTypes: ["UPGRADES_TO", "WEAK_AGAINST"],
      managedGraphs: ["combat_graph"],
      graphRelationTypes: { combat_graph: ["USES_SKILL"] },
    })
    const policy = await loadGraphPolicy(tmp.path)
    expect(policy).toEqual({
      managedGraphs: ["combat_graph"],
      graphRelationTypes: { combat_graph: ["USES_SKILL"] },
    })
  })

  it("returns DEFAULT_POLICY when the file is absent", async () => {
    const policy = await loadGraphPolicy(tmp.path)
    expect(policy).toEqual(DEFAULT_POLICY)
  })
})

describe("saveGraphPolicy", () => {
  it("persists only managedGraphs and graphRelationTypes", async () => {
    const saved = await saveGraphPolicy(tmp.path, {
      managedGraphs: ["combat_graph"],
      graphRelationTypes: { combat_graph: ["WEAK_AGAINST"] },
    })
    expect(saved).toEqual({
      managedGraphs: ["combat_graph"],
      graphRelationTypes: { combat_graph: ["WEAK_AGAINST"] },
    })
    const onDisk = JSON.parse(await readFileRaw(policyFile()))
    expect(Object.keys(onDisk).sort()).toEqual(["graphRelationTypes", "managedGraphs"])
  })

  it("drops the legacy relationTypes key on load → save round-trip", async () => {
    await writePolicyRaw({
      relationTypes: ["UPGRADES_TO"],
      managedGraphs: ["combat_graph"],
      graphRelationTypes: { combat_graph: ["WEAK_AGAINST"] },
    })
    await saveGraphPolicy(tmp.path, await loadGraphPolicy(tmp.path))
    const onDisk = JSON.parse(await readFileRaw(policyFile()))
    expect(onDisk.relationTypes).toBeUndefined()
    expect(onDisk.graphRelationTypes.combat_graph).toEqual(["WEAK_AGAINST"])
  })
})

describe("buildGraphPolicyPrompt — no global seed", () => {
  it("returns an empty prompt when there are no managed graphs", () => {
    const prompt = buildGraphPolicyPrompt({
      managedGraphs: [],
      graphRelationTypes: {},
    })
    expect(prompt).toBe("")
  })

  it("lists per-graph types for managed graphs", () => {
    const prompt = buildGraphPolicyPrompt({
      managedGraphs: ["combat_graph"],
      graphRelationTypes: { combat_graph: ["WEAK_AGAINST", "USES_SKILL"] },
    })
    expect(prompt).toContain("combat_graph: WEAK_AGAINST, USES_SKILL")
    expect(prompt).not.toContain("Allowed relation types")
  })
})
