/**
 * Data type loader.
 *
 * Loads from {projectPath}/data_types/ — project-shared, committed to git.
 */
import yaml from "js-yaml"
import { listDirectory, readFile } from "@/commands/fs"
import type { FileNode } from "@/types/wiki"

export interface DataType {
  /** Filename stem — stable id. */
  id: string
  /** Display name. */
  name: string
  /** Description for UI. */
  description: string
  /** Keys the LLM should extract from raw data. Map of key -> description. */
  fields: Record<string, string>
  /** Internal: absolute file path. */
  _filePath: string
}

export async function loadDataTypes(projectPath: string): Promise<DataType[]> {
  const projectTierPath = `${projectPath}/data_types`

  const projectNodes = await tryListDirectory(projectTierPath)

  const outMap = new Map<string, DataType>()

  for (const node of projectNodes) {
    const dt = await loadNode(projectTierPath, node)
    if (dt) outMap.set(dt.id, dt)
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
): Promise<DataType | null> {
  if (node.is_dir) return null
  if (node.name.startsWith(".")) return null
  if (!node.name.endsWith(".yaml") && !node.name.endsWith(".yml")) return null

  const id = node.name.replace(/\.(yaml|yml)$/, "")
  const filePath = `${dir}/${node.name}`
  try {
    const content = await readFile(filePath)
    const dt = parseYamlDataType(id, content)
    return dt ? { ...dt, _filePath: filePath } : null
  } catch (err) {
    console.warn(`[data-types] failed to load ${node.name}:`, err)
    return null
  }
}

function parseYamlDataType(id: string, content: string): Omit<DataType, "_filePath"> | null {
  try {
    const raw = yaml.load(content) as any
    if (!raw || typeof raw !== "object") return null
    return {
      id,
      name: raw.name || id,
      description: raw.description || "",
      fields: raw.fields || {},
    }
  } catch {
    return null
  }
}
