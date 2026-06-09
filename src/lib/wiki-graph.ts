import { listDirectory } from "@/commands/fs"
import type { FileNode } from "@/types/wiki"
import { normalizePath } from "@/lib/path-utils"

export interface GraphNode {
  id: string
  label: string
  type: string
  path: string
  sources: string[] // Original source document filenames
  graph: string | null // managed graph name from frontmatter `graph:` field
  linkCount: number // inbound + outbound
  community: number // community id from Louvain detection
}

export interface GraphEdge {
  source: string
  target: string
  type?: string // relationship type (e.g. REQUIRES, NAVIGATES_TO)
  weight: number // relevance score between source and target
  sources: string[] // Original source document filenames
}

export interface CommunityInfo {
  id: number
  nodeCount: number
  cohesion: number // intra-community edge density
  topNodes: string[] // top nodes by linkCount (labels)
}

function flattenMdFiles(nodes: FileNode[]): FileNode[] {
  const files: FileNode[] = []
  for (const node of nodes) {
    if (node.is_dir && node.children) {
      files.push(...flattenMdFiles(node.children))
    } else if (!node.is_dir && node.name.endsWith(".md")) {
      files.push(node)
    }
  }
  return files
}

export async function listDbFiles(projectPath: string): Promise<FileNode[]> {
  const dbRoot = `${normalizePath(projectPath)}/db`
  let tree: FileNode[]
  try {
    tree = await listDirectory(dbRoot)
  } catch {
    return []
  }
  return flattenMdFiles(tree)
}
