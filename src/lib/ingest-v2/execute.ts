import { commitIngestPlan, type IngestOrigin } from "@/commands/knowledge"
import { parseMarkdownV2 } from "@/lib/markdown-v2"
import { hydratePageDocument } from "./hydrate"
import type { IngestPlan } from "./plan"
import { validateIngestPlan } from "./validate"

export async function executeIngestPlan(projectPath: string, plan: IngestPlan, origin: IngestOrigin = "ingest"): Promise<void> {
  validateIngestPlan(plan)
  // A final parser pass makes execution incapable of accepting a mutated or
  // hand-built document that did not go through the v2 parser.
  for (const document of plan.pages) {
    const parsed = parseMarkdownV2(document.content)
    const hydrated = hydratePageDocument(document.relativePath, document.content, parsed)
    const { updatedAt: _updatedAt, ...actualPage } = document.page
    const { updatedAt: _expectedUpdatedAt, ...expectedPage } = hydrated.page
    if (
      JSON.stringify(actualPage) !== JSON.stringify(expectedPage) ||
      JSON.stringify(document.sections) !== JSON.stringify(hydrated.sections)
    ) {
      throw new Error("VALIDATION_FAILED: plan rows do not match parser-validated Markdown v2")
    }
  }
  await commitIngestPlan(projectPath, plan.operationId, plan.pages, plan.assertions, origin)
}

/** Build and commit several page replacements as one crash-recoverable unit.
 * `origin` (Step 12) tags the extracted assertions — "user_chat" for the chat
 * save path, "ingest" (default) for every existing caller. */
export async function commitMarkdownV2Pages(
  projectPath: string,
  documents: Array<{ relativePath: string; content: string }>,
  assertions: IngestPlan["assertions"] = [],
  origin: IngestOrigin = "ingest",
): Promise<IngestPlan> {
  if (documents.length === 0) throw new Error("VALIDATION_FAILED: ingest plan has no pages")
  const pages = documents.map(({ relativePath, content }) =>
    hydratePageDocument(relativePath, content, parseMarkdownV2(content)),
  )
  const operationId = crypto.randomUUID().replace(/[^A-Za-z0-9-]/g, "")
  const plan: IngestPlan = {
    operationId,
    pages,
    assertions,
    embeddingJobs: pages.map((page) => ({ pageId: page.page.pageId, pagePath: page.relativePath })),
  }
  await executeIngestPlan(projectPath, plan, origin)
  return plan
}

export async function commitMarkdownV2Page(projectPath: string, relativePath: string, content: string): Promise<IngestPlan> {
  return commitMarkdownV2Pages(projectPath, [{ relativePath, content }])
}
