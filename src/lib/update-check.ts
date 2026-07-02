/**
 * Lightweight update checker: hits the GitHub or GitLab Releases API
 * for the repo's latest release, compares against the app's build-time
 * version, and returns a status the UI can surface. We intentionally
 * don't download or install — the user gets a "new version available"
 * hint in Settings → About and a button that opens the release page
 * in their browser. See `update-store.ts` for the UI state layer and
 * `about-section.tsx` for the surfacing.
 *
 * Why not tauri-plugin-updater: a real auto-install flow needs Tauri-
 * signed release manifests plus a paid Windows code-signing cert to
 * avoid SmartScreen warnings. Worth doing later, but for a free OSS
 * distribution a polite "here's the new version, click to download"
 * covers 95% of the value.
 */

import { getHttpFetch, isFetchNetworkError } from "./tauri-fetch"

/**
 * Where fresh installs check for updates. Points at the internal
 * GitLab project this app is distributed from; users can override it
 * in Settings → About.
 */
export const DEFAULT_UPDATE_REPO = "set-git.cloud.ncsoft.com/gameqa/asset"
/**
 * Read-only access token fresh installs use against the internal
 * GitLab API (the project is not publicly visible, so unauthenticated
 * release queries 404). Anyone with read access to this repo can see
 * this value — it must stay a low-privilege token (read_api scope,
 * Reporter role at most). Users can override it in Settings → About.
 */
export const DEFAULT_UPDATE_TOKEN = "zxjzw8pt1d9MaYZYqy6p"

/** Normalized release info (GitHub and GitLab responses map onto this). */
export interface ReleaseInfo {
  tag_name: string          // e.g. "v0.3.10"
  name: string              // display title
  body: string              // markdown release notes
  html_url: string          // browser URL for the release page
  published_at: string      // ISO timestamp
}

export type UpdateStatus =
  | { kind: "available"; local: string; remote: string; release: ReleaseInfo }
  | { kind: "up-to-date"; local: string; remote: string }
  | { kind: "error"; local: string; message: string }

/**
 * Strict semver-ish comparison of two "MAJOR.MINOR.PATCH" strings.
 * We don't use pre-release tags or build metadata in this project, so
 * a plain three-component numeric compare is enough and avoids pulling
 * in the `semver` npm package just for this.
 *
 * Returns true iff `remote` is strictly greater than `local`. A leading
 * `v` on either side is tolerated; anything non-numeric in a slot
 * defaults to 0 (so a weirdly-shaped remote tag can't trigger a false
 * upgrade).
 */
export function isNewer(remote: string, local: string): boolean {
  const parse = (s: string): [number, number, number] => {
    const [a = 0, b = 0, c = 0] = s
      .replace(/^v/, "")
      .split(".")
      .map((n) => {
        const v = parseInt(n, 10)
        return Number.isFinite(v) ? v : 0
      })
    return [a, b, c]
  }
  const [ra, rb, rc] = parse(remote)
  const [la, lb, lc] = parse(local)
  if (ra !== la) return ra > la
  if (rb !== lb) return rb > lb
  return rc > lc
}

/**
 * How a stored repo string should be queried. GitHub repos are stored
 * as `owner/repo`; anything whose first segment looks like a hostname
 * (contains a dot — GitHub owner names can't) is treated as a GitLab
 * instance: `host/group/.../project`.
 */
export type RepoRef =
  | { kind: "github"; slug: string }
  | { kind: "gitlab"; host: string; path: string }

export function parseRepoRef(repo: string): RepoRef {
  const parts = repo.split("/")
  if (parts[0]?.includes(".")) {
    return { kind: "gitlab", host: parts[0], path: parts.slice(1).join("/") }
  }
  return { kind: "github", slug: repo }
}

/** Browser URL for the repo's home page (used by the About footer link). */
export function repoWebUrl(repo: string): string {
  const ref = parseRepoRef(repo)
  return ref.kind === "github"
    ? `https://github.com/${ref.slug}`
    : `https://${ref.host}/${ref.path}`
}

/**
 * Fetch the latest release from a GitHub or GitLab repo. Returns null
 * on any failure (network / rate-limit / auth / 404 when no release
 * exists yet). Doesn't throw — the caller's job is to render the
 * failure as an "error" status, not to log it or alert the user.
 *
 * Routes through the Tauri HTTP plugin so it stays consistent with the
 * rest of the app's third-party traffic and doesn't depend on the
 * webview's CORS policy for the API host (GitLab instances in
 * particular rarely send permissive CORS headers).
 */
export async function fetchLatestRelease(
  repo: string,
  token?: string,
): Promise<ReleaseInfo | null> {
  const ref = parseRepoRef(repo)
  try {
    const httpFetch = await getHttpFetch()
    if (ref.kind === "github") {
      const url = `https://api.github.com/repos/${ref.slug}/releases/latest`
      const resp = await httpFetch(url, {
        method: "GET",
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      })
      if (!resp.ok) return null
      const data = await resp.json()
      // Duck-type the response shape — GitHub occasionally adds fields
      // but the ones below have been stable since the API's v3 days.
      if (
        typeof data?.tag_name === "string" &&
        typeof data?.html_url === "string"
      ) {
        return {
          tag_name: data.tag_name,
          name: typeof data.name === "string" ? data.name : data.tag_name,
          body: typeof data.body === "string" ? data.body : "",
          html_url: data.html_url,
          published_at:
            typeof data.published_at === "string" ? data.published_at : "",
        }
      }
      return null
    }
    // GitLab: list endpoint (newest first) instead of
    // /releases/permalink/latest so we don't depend on GitLab >= 14.10.
    const url = `https://${ref.host}/api/v4/projects/${encodeURIComponent(ref.path)}/releases?per_page=1`
    const resp = await httpFetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        // Private/internal projects 404 without a token; public ones
        // work fine with the header absent.
        ...(token ? { "PRIVATE-TOKEN": token } : {}),
      },
    })
    if (!resp.ok) return null
    const data = await resp.json()
    const rel = Array.isArray(data) ? data[0] : null
    if (typeof rel?.tag_name !== "string") return null
    return {
      tag_name: rel.tag_name,
      name: typeof rel.name === "string" ? rel.name : rel.tag_name,
      body: typeof rel.description === "string" ? rel.description : "",
      html_url:
        typeof rel._links?.self === "string"
          ? rel._links.self
          : `https://${ref.host}/${ref.path}/-/releases/${encodeURIComponent(rel.tag_name)}`,
      published_at:
        typeof rel.released_at === "string" ? rel.released_at : "",
    }
  } catch (err) {
    if (isFetchNetworkError(err)) return null
    return null
  }
}

/**
 * End-to-end check: fetch + compare + package into a renderable
 * status. Callers pass in `currentVersion` from the build-time define
 * and `repo` from the project config — the module itself stays free
 * of environment coupling so it's easy to unit-test.
 */
export async function checkForUpdates(opts: {
  currentVersion: string
  repo: string
  token?: string
}): Promise<UpdateStatus> {
  const { currentVersion, repo, token } = opts
  const release = await fetchLatestRelease(repo, token)
  if (!release) {
    return {
      kind: "error",
      local: currentVersion,
      message: "Could not reach the releases API.",
    }
  }
  const remote = release.tag_name
  if (isNewer(remote, currentVersion)) {
    return {
      kind: "available",
      local: currentVersion,
      remote,
      release,
    }
  }
  return { kind: "up-to-date", local: currentVersion, remote }
}

/** Cache duration: don't re-hit the API if we checked more recently than this. */
export const UPDATE_CHECK_CACHE_MS = 6 * 60 * 60 * 1000 // 6 hours

/**
 * Normalize whatever the user pasted into the update-check repo field
 * down to a queryable form. Accepts:
 *   - "owner/repo" (GitHub shorthand)
 *   - "https://github.com/owner/repo" / "github.com/owner/repo"
 *   - a full GitLab project URL, e.g.
 *     "https://set-git.cloud.ncsoft.com/group/project" (nested groups OK)
 *   - any of the above with surrounding whitespace or a trailing slash
 *   - ".git" suffix (in case someone pastes a clone URL)
 * GitHub repos normalize to `owner/repo`; GitLab projects keep their
 * host: `host/group/.../project` (see `parseRepoRef`).
 * Returns null when the input doesn't contain a recognizable repo, so
 * callers can distinguish "user hasn't configured this" from "user
 * configured something usable".
 */
export function normalizeRepo(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const s = trimmed
    .replace(/^https?:\/\//i, "")
    .replace(/^github\.com\//i, "")
    .replace(/\.git$/i, "")
    // GitLab web-UI paths ("…/project/-/releases" etc.) — keep only
    // the project path left of the "/-/" separator.
    .replace(/\/-\/.*$/, "")
    .replace(/\/+$/, "")
  const parts = s.split("/").filter(Boolean)
  if (parts.some((p) => !/^[\w.-]+$/.test(p))) return null
  // First segment with a dot = a hostname (GitHub owner names can't
  // contain dots) → GitLab form. Needs at least group/project after it.
  if (parts[0]?.includes(".")) {
    if (parts.length < 3) return null
    return parts.join("/")
  }
  // GitHub form: exactly "owner/repo" (drop any extra path segments)
  if (parts.length < 2) return null
  return `${parts[0]}/${parts[1]}`
}
