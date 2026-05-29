import { invoke } from "@tauri-apps/api/core"

export interface VCCommit {
  hash: string
  author: string
  date: string
  message: string
}

export async function vcDbInit(projectPath: string): Promise<void> {
  return invoke<void>("vc_db_init", { projectPath })
}

export async function vcDbSaveSnapshot(
  projectPath: string,
  commitHash: string,
  snapshot: string,
): Promise<void> {
  return invoke<void>("vc_db_save_snapshot", { projectPath, commitHash, snapshot })
}

export async function vcDbGetSnapshot(
  projectPath: string,
  commitHash: string,
): Promise<string | null> {
  return invoke<string | null>("vc_db_get_snapshot", { projectPath, commitHash })
}

export async function vcDbRecordCommit(
  projectPath: string,
  commit: VCCommit,
): Promise<void> {
  return invoke<void>("vc_db_record_commit", { projectPath, commit })
}

export async function vcDbSetMeta(
  projectPath: string,
  key: string,
  value: string,
): Promise<void> {
  return invoke<void>("vc_db_set_meta", { projectPath, key, value })
}

export async function vcDbGetMeta(
  projectPath: string,
  key: string,
): Promise<string | null> {
  return invoke<string | null>("vc_db_get_meta", { projectPath, key })
}
