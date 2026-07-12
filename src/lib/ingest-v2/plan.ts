import type { IngestAssertionWrite, IngestPageDocument } from "@/commands/knowledge"

/** Immutable, fully hydrated input to the core ingest commit. */
export interface IngestPlan {
  operationId: string
  pages: IngestPageDocument[]
  assertions: IngestAssertionWrite[]
  /** These are deliberately post-commit work, never part of core rollback. */
  embeddingJobs: Array<{ pageId: string; pagePath: string }>
}
