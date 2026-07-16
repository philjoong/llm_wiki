/**
 * Cascade delete for wiki pages.
 *
 * Whenever a wiki page is removed from disk we ALSO need to drop its
 * vector chunks from LanceDB; otherwise the chunks become "phantom"
 * search hits — `searchByEmbedding` returns the orphaned `page_id`
 * but retrieval then can't find a matching v2 page and silently
 * discards the result, wasting topK slots.
 *
 * This helper consolidates that two-step cleanup so every wiki-page
 * delete path (source-delete cascade, orphan-page delete in lint-view,
 * cancelled-ingest cleanup in ingest-queue) uses the SAME page-id
 * derivation and order of operations.
 *
 * Step 13: the embedding index is keyed by the v2 ULID `page_id`, so
 * the cascade reads that ULID from the file's frontmatter BEFORE the
 * disk delete (a non-destructive read). A file that isn't valid v2 (or
 * is already gone) yields no ULID, so the embedding drop is skipped —
 * there is nothing indexed under a ULID for it.
 *
 * Errors are propagated, NOT swallowed — callers wrap in try/catch
 * to apply their own fault-tolerance policy (e.g. continue with the
 * next file in a batch, or surface to the user via toast).
 */
import { deleteFile, readFile } from "@/commands/fs"
import { parseMarkdownV2 } from "@/lib/markdown-v2"
import { removePageEmbedding } from "@/lib/embedding"

/**
 * Delete a wiki page from disk and drop its embedding chunks.
 *
 * `projectPath` is the project root (used to scope the embedding
 * cascade to the right LanceDB instance).
 *
 * `pagePath` may be absolute or relative. The disk delete uses the path
 * verbatim — pass an absolute path if your caller has one (most do).
 */
export async function cascadeDeleteWikiPage(
  projectPath: string,
  pagePath: string,
): Promise<void> {
  // Read the v2 ULID before deleting; embedding is keyed by it (Step 13).
  // A read/parse failure just means no embedding key to drop.
  let pageId = ""
  try {
    pageId = parseMarkdownV2(await readFile(pagePath)).page.page_id
  } catch {
    pageId = ""
  }
  await deleteFile(pagePath)
  if (pageId.length > 0) {
    await removePageEmbedding(projectPath, pageId)
  }
}
