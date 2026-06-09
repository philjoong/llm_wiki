import { invoke } from "@tauri-apps/api/core"

export interface CommitResult {
  committed: boolean
  commitHash: string | null
}

export interface StatusEntry {
  /** Two-character porcelain status code (e.g. " M", "??", "A "). */
  xy: string
  path: string
}

export interface CommitInfo {
  hash: string
  author: string
  /** ISO 8601 author date. */
  date: string
  message: string
}

export interface FileChange {
  path: string
  /** A / M / D / R / C / T — git's --name-status code (single char). */
  status: string
  additions: number
  deletions: number
}

export interface CommitDetail {
  hash: string
  author: string
  /** ISO 8601 author date. */
  date: string
  /** Full commit message (subject + body). */
  message: string
  files: FileChange[]
}

export interface RevertResult {
  committed: boolean
  commitHash: string | null
  /** Non-empty when revert produced merge conflicts. */
  conflicts: string[]
}

export async function gitInit(projectPath: string): Promise<void> {
  return invoke<void>("git_init", { projectPath })
}

export async function gitCommit(
  projectPath: string,
  message: string,
  paths: string[],
): Promise<CommitResult> {
  return invoke<CommitResult>("git_commit", { projectPath, message, paths })
}

export async function gitStatus(projectPath: string): Promise<StatusEntry[]> {
  return invoke<StatusEntry[]>("git_status", { projectPath })
}

export async function gitLog(projectPath: string, limit: number): Promise<CommitInfo[]> {
  return invoke<CommitInfo[]>("git_log", { projectPath, limit })
}

export async function gitShow(projectPath: string, hash: string): Promise<CommitDetail> {
  return invoke<CommitDetail>("git_show", { projectPath, hash })
}

export async function gitDiff(
  projectPath: string,
  refA: string,
  refB: string,
  path?: string,
): Promise<string> {
  return invoke<string>("git_diff", { projectPath, refA, refB, path: path ?? null })
}

export async function gitCheckoutPath(
  projectPath: string,
  hash: string,
  paths: string[],
): Promise<void> {
  return invoke<void>("git_checkout_path", { projectPath, hash, paths })
}

export async function gitRevert(projectPath: string, hash: string): Promise<RevertResult> {
  return invoke<RevertResult>("git_revert", { projectPath, hash })
}

export async function gitLsRemote(url: string): Promise<string[]> {
  return invoke<string[]>("git_ls_remote", { url })
}

export async function gitCreateBranch(projectPath: string, branchName: string): Promise<void> {
  return invoke<void>("git_create_branch", { projectPath, branchName })
}

export async function gitRemoteAdd(projectPath: string, name: string, url: string): Promise<void> {
  return invoke<void>("git_remote_add", { projectPath, name, url })
}

export async function gitPush(project_path: string, remote: string, branch: string): Promise<void> {
  return invoke<void>("git_push", { projectPath: project_path, remote, branch })
}

export async function gitPull(project_path: string, remote: string, branch: string): Promise<void> {
  return invoke<void>("git_pull", { projectPath: project_path, remote, branch })
}

export async function gitSetupFromRemote(projectPath: string, remoteUrl: string, branch: string): Promise<void> {
  return invoke<void>("git_setup_from_remote", { projectPath, remoteUrl, branch })
}
