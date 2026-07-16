/**
 * Inline info-request plumbing (Step 11).
 *
 * A back-question form's result becomes a plain user message tagged with its
 * `info_key`, so the next turn's LLM sees its own question and the user's
 * answer in the conversation history (§6 설계 3 — history is the injection
 * channel; no separate mechanism). `file`/`link` answers instead reuse the
 * existing raw-injection queue so ingest picks them up for later retrieval.
 */

import { writeFile, fileExists } from "@/commands/fs"
import { enqueueIngest } from "@/lib/ingest-queue"
import { fetchUrlAsMarkdown } from "@/lib/url-import"

/**
 * Format a form submission as a user message. The `info_key` is named
 * explicitly so the model can match the answer to its own request (Step 11
 * §2). `unavailable` marks the closed-loop terminal answer (§4).
 */
export function formatInfoAnswer(
  infoKey: string,
  answer: string,
  unavailable = false,
): string {
  if (unavailable) return `[info_key: ${infoKey}] 이 정보는 없음/모름`
  return `[info_key: ${infoKey}] ${answer}`.trim()
}

const INFO_ANSWER_RE = /^\[info_key:\s*([^\]]+)\]\s*([\s\S]*)$/

/**
 * Recognize a user message produced by {@link formatInfoAnswer} and split it
 * into its info_key and answer body. Returns null for ordinary messages. Used
 * by the "위키에 저장" action (Step 12) to know a message carries a savable
 * answer and to strip the tag before persisting.
 */
export function parseInfoAnswer(content: string): { infoKey: string; answer: string } | null {
  const m = content.match(INFO_ANSWER_RE)
  if (!m) return null
  return { infoKey: m[1].trim(), answer: m[2].trim() }
}

/**
 * Pick a project-relative `raw/sources/<name>.md` path that isn't taken,
 * appending a date then a counter on collision. Mirrors icon-sidebar's
 * uniqueSourceRel so a link answer re-uses the same naming convention as a
 * manually injected URL.
 */
async function uniqueSourceRel(projectPath: string, baseName: string): Promise<string> {
  const base = `raw/sources/${baseName}.md`
  if (!(await fileExists(`${projectPath}/${base}`))) return base
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "")
  const dated = `raw/sources/${baseName}-${date}.md`
  if (!(await fileExists(`${projectPath}/${dated}`))) return dated
  for (let i = 2; i <= 99; i++) {
    const numbered = `raw/sources/${baseName}-${date}-${i}.md`
    if (!(await fileExists(`${projectPath}/${numbered}`))) return numbered
  }
  return dated
}

/**
 * Answer a `link` request by reusing the existing URL-injection path
 * (fetch → convert → write under raw/sources → enqueue ingest). No new
 * ingest route (Step 11 §1). Returns the enqueued task id so the caller can
 * watch for its completion to show the "반영 완료" badge.
 */
export async function injectLinkAnswer(
  projectPath: string,
  projectId: string,
  url: string,
): Promise<string> {
  const { markdown, baseName } = await fetchUrlAsMarkdown(url)
  const rel = await uniqueSourceRel(projectPath, baseName)
  await writeFile(`${projectPath}/${rel}`, markdown)
  return enqueueIngest(projectId, rel)
}

/**
 * Answer a `file` request by enqueuing already-picked files into the raw
 * ingest queue (Step 11 §1) — the file picker itself is driven by the caller
 * (icon-sidebar's open() dialog path). Returns the enqueued task ids.
 */
export async function injectFileAnswers(
  projectPath: string,
  projectId: string,
  absolutePaths: string[],
): Promise<string[]> {
  const ids: string[] = []
  for (const filePath of absolutePaths) {
    const rel = filePath.startsWith(projectPath)
      ? filePath.slice(projectPath.length).replace(/^[\\/]/, "")
      : filePath
    ids.push(await enqueueIngest(projectId, rel))
  }
  return ids
}
