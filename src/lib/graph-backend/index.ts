import { createSqliteGraphBackend } from "./sqlite-backend"
import type { GraphBackend } from "./types"

export async function getGraphBackend(projectPath: string): Promise<GraphBackend> {
  return createSqliteGraphBackend(projectPath)
}

export type {
  GraphBackend,
  GraphEdgeRecord,
  GraphNodeRecord,
  GraphQuery,
  GraphSnapshot,
} from "./types"
