import { createDirectory, fileExists, readFile, writeFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"

export interface GraphPolicy {
  relationTypes: string[]
  managedGraphs: string[]
}

const DEFAULT_POLICY: GraphPolicy = {
  relationTypes: [],
  managedGraphs: [],
}

function policyPath(projectPath: string): string {
  return `${normalizePath(projectPath)}/.llm-wiki/graph-policy.json`
}

function sanitize(items: string[], max: number): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of items) {
    const value = String(raw ?? "").trim()
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
    if (out.length >= max) break
  }
  return out
}

export async function loadGraphPolicy(projectPath: string): Promise<GraphPolicy> {
  const path = policyPath(projectPath)
  try {
    if (!(await fileExists(path))) return DEFAULT_POLICY
    const raw = await readFile(path)
    const parsed = JSON.parse(raw) as Partial<GraphPolicy>
    return {
      relationTypes: sanitize(Array.isArray(parsed.relationTypes) ? parsed.relationTypes : [], 4),
      managedGraphs: sanitize(Array.isArray(parsed.managedGraphs) ? parsed.managedGraphs : [], 200),
    }
  } catch {
    return DEFAULT_POLICY
  }
}

export async function saveGraphPolicy(projectPath: string, policy: GraphPolicy): Promise<GraphPolicy> {
  const pp = normalizePath(projectPath)
  await createDirectory(`${pp}/.llm-wiki`)
  const normalized: GraphPolicy = {
    relationTypes: sanitize(policy.relationTypes, 4),
    managedGraphs: sanitize(policy.managedGraphs, 200),
  }
  await writeFile(policyPath(pp), JSON.stringify(normalized, null, 2))
  return normalized
}

export function buildGraphPolicyPrompt(policy: GraphPolicy): string {
  const parts: string[] = []

  if (policy.relationTypes.length > 0) {
    parts.push(
      "## Graph Relation Policy (project-defined)",
      "When proposing/generated knowledge links or relationships, use ONLY the relation types below.",
      "If a relationship does not fit one of them, do not invent a new relation type; rewrite or omit it.",
      `Allowed relation types (${policy.relationTypes.length}/4): ${policy.relationTypes.join(", ")}`,
    )
  }

  if (policy.managedGraphs.length > 0) {
    parts.push(
      "",
      "## Managed Graphs (project-defined)",
      "For each generated db/ page, add a `graph:` field in the frontmatter to assign it to one of the graphs below.",
      "Choose the graph whose domain best matches the page content. If no graph fits, omit the field.",
      `Available graphs: ${policy.managedGraphs.join(", ")}`,
    )
  }

  return parts.join("\n")
}

