import { loadFalkordbUrl } from "@/lib/project-store"
import { createFalkorDbBackend } from "./falkordb-backend"
import { createSqliteGraphBackend } from "./sqlite-backend"
import type { GraphBackend } from "./types"

export async function getGraphBackend(projectPath: string): Promise<GraphBackend> {
  const url = await loadFalkordbUrl()
  if (url?.trim()) return createFalkorDbBackend()
  return createSqliteGraphBackend(projectPath)
}

export type {
  GraphBackend,
  GraphEdgeRecord,
  GraphNodeRecord,
  GraphQuery,
  GraphSnapshot,
} from "./types"
