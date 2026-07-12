import { recoverIngestTransactions } from "@/commands/knowledge"

/** Call when opening a project, before any new ingest can observe its files. */
export const recoverPendingIngests = (projectPath: string) => recoverIngestTransactions(projectPath)
