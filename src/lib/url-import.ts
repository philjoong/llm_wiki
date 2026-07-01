/**
 * Import a static web page as a source. Fetches the page's HTML through
 * the Tauri HTTP plugin (same path as every other third-party request —
 * see tauri-fetch.ts) and reuses the Readability + Turndown pipeline in
 * html-convert.ts that already powers `.html` file imports. No new
 * dependency: the only thing URL import adds over file import is the
 * fetch step.
 *
 * Static pages only: the HTML is taken as served, so JS-rendered SPAs
 * that inject their content client-side will yield little or no text.
 * That's an accepted limitation — a headless browser would be needed to
 * cover those, which is out of scope here.
 */

import { getHttpFetch, isFetchNetworkError } from "./tauri-fetch"
import { convertHtmlToMarkdown } from "./html-convert"

export interface FetchedPage {
  /** Markdown body, with a `source_url:` frontmatter ref prepended. */
  markdown: string
  /** Filesystem-safe basename (no extension) derived from the URL. */
  baseName: string
}

/**
 * Normalize whatever the user typed into a usable http(s) URL. Prepends
 * `https://` when no scheme is given, rejects non-http(s) schemes, and
 * returns the canonical href (or null when unparseable).
 */
export function normalizeUrl(input: string): string | null {
  let s = input.trim()
  if (!s) return null
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`
  try {
    const u = new URL(s)
    if (u.protocol !== "http:" && u.protocol !== "https:") return null
    return u.href
  } catch {
    return null
  }
}

/**
 * Fetch a static page and convert it to markdown. Throws with a
 * user-facing message on bad input / network failure / non-OK status —
 * the caller surfaces it the same way file-import failures are surfaced.
 */
export async function fetchUrlAsMarkdown(rawUrl: string): Promise<FetchedPage> {
  const url = normalizeUrl(rawUrl)
  if (!url) throw new Error("Enter a valid http(s) URL.")

  let html: string
  try {
    const httpFetch = await getHttpFetch()
    const resp = await httpFetch(url, {
      method: "GET",
      headers: { Accept: "text/html,application/xhtml+xml" },
    })
    if (!resp.ok) {
      if (resp.status === 403) {
        throw new Error(`Access denied (HTTP 403). The site blocks automated requests. Try saving the page manually and importing it as a file.`)
      }
      throw new Error(`Server returned HTTP ${resp.status}.`)
    }
    html = await resp.text()
  } catch (err) {
    if (isFetchNetworkError(err)) {
      throw new Error("Could not reach the URL (network error).")
    }
    throw err
  }

  const markdown = convertHtmlToMarkdown(html)
  if (!markdown.trim()) {
    throw new Error(
      "No readable content found — the page may be empty or rendered with JavaScript.",
    )
  }
  return { markdown: injectSourceUrlRef(markdown, url), baseName: deriveBaseName(url) }
}

/**
 * Turn a URL into a filesystem-safe basename, e.g.
 *   https://example.com/blog/my-post/ → "example.com-blog-my-post"
 * Strips a leading `www.`, collapses non-alphanumerics to single dashes,
 * and caps the length so deep paths don't produce absurd filenames.
 */
function deriveBaseName(url: string): string {
  let host = "page"
  let path = ""
  try {
    const u = new URL(url)
    host = u.hostname.replace(/^www\./, "")
    path = u.pathname
  } catch {
    // url is already validated by normalizeUrl; defensive only
  }
  const slug = `${host}${path}`
    .replace(/\/+$/, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
  return slug || "page"
}

/**
 * Record the origin URL in a YAML frontmatter block so the source stays
 * traceable back to the web page it came from — the URL analogue of
 * `injectOriginalRef` for binary files. Merges into an existing leading
 * frontmatter block rather than stacking a second one.
 */
function injectSourceUrlRef(markdown: string, url: string): string {
  if (markdown.startsWith("---\n")) {
    const end = markdown.indexOf("\n---\n", 4)
    if (end > 0) {
      const fm = markdown.slice(4, end)
      const body = markdown.slice(end + 5)
      const lines = fm.split("\n")
      const idx = lines.findIndex((l) => /^source_url:\s*/.test(l))
      const replacement = `source_url: ${url}`
      if (idx >= 0) lines[idx] = replacement
      else lines.push(replacement)
      return `---\n${lines.join("\n")}\n---\n${body}`
    }
  }
  return `---\nsource_url: ${url}\n---\n\n${markdown}`
}
