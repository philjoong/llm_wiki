import { useEffect, useState, useCallback } from "react"
import { Download, RefreshCw, CheckCircle2, Sparkles } from "lucide-react"
import { useTranslation } from "react-i18next"
import { clipServerStatus } from "@/commands/fs"
import { Button } from "@/components/ui/button"
import { useUpdateStore, shouldShowUpdateBanner } from "@/stores/update-store"
import {
  checkForUpdates,
  normalizeRepo,
  parseRepoRef,
  repoWebUrl,
} from "@/lib/update-check"
import { saveUpdateCheckState } from "@/lib/project-store"

export function AboutSection() {
  const { t } = useTranslation()
  const [clipStatus, setClipStatus] = useState<string>("...")
  const updateStore = useUpdateStore()
  const [repoDraft, setRepoDraft] = useState(updateStore.repo)
  const [tokenDraft, setTokenDraft] = useState(updateStore.token)
  // Keep the inputs in sync if the store values change (e.g. hydrate
  // from disk completes after this component mounts).
  useEffect(() => {
    setRepoDraft(updateStore.repo)
  }, [updateStore.repo])
  useEffect(() => {
    setTokenDraft(updateStore.token)
  }, [updateStore.token])
  const normalizedRepo = normalizeRepo(repoDraft)
  const repoInvalid = repoDraft.trim().length > 0 && normalizedRepo === null
  // The token only matters for GitLab repos — hide the field otherwise.
  const isGitlabRepo =
    !!updateStore.repo && parseRepoRef(updateStore.repo).kind === "gitlab"

  useEffect(() => {
    let alive = true
    clipServerStatus()
      .then((s) => {
        if (alive) setClipStatus(s)
      })
      .catch(() => {
        if (alive) setClipStatus("unknown")
      })
    return () => {
      alive = false
    }
  }, [])

  const handleCheckNow = useCallback(async () => {
    const repo = useUpdateStore.getState().repo
    if (!repo) return
    useUpdateStore.getState().setChecking(true)
    const result = await checkForUpdates({
      currentVersion: __APP_VERSION__,
      repo,
      token: useUpdateStore.getState().token,
    })
    const now = Date.now()
    useUpdateStore.getState().setResult(result, now)
    // On a manual check, wipe any prior "dismissed" memo so that if
    // the user re-clicks they see the banner again for the same
    // version — a manual check implies "I want to see this now".
    useUpdateStore.getState().setDismissed(null)
    await saveUpdateCheckState({
      enabled: useUpdateStore.getState().enabled,
      lastCheckedAt: now,
      dismissedVersion: null,
      repo,
      token: useUpdateStore.getState().token,
    })
  }, [])

  const handleDismiss = useCallback(async () => {
    const result = useUpdateStore.getState().lastResult
    if (result?.kind !== "available") return
    useUpdateStore.getState().setDismissed(result.remote)
    await saveUpdateCheckState({
      enabled: useUpdateStore.getState().enabled,
      lastCheckedAt: useUpdateStore.getState().lastCheckedAt ?? Date.now(),
      dismissedVersion: result.remote,
      repo: useUpdateStore.getState().repo,
      token: useUpdateStore.getState().token,
    })
  }, [])

  const handleToggleAutoCheck = useCallback(async () => {
    const next = !useUpdateStore.getState().enabled
    useUpdateStore.getState().setEnabled(next)
    await saveUpdateCheckState({
      enabled: next,
      lastCheckedAt: useUpdateStore.getState().lastCheckedAt,
      dismissedVersion: useUpdateStore.getState().dismissedVersion,
      repo: useUpdateStore.getState().repo,
      token: useUpdateStore.getState().token,
    })
  }, [])

  const handleSaveRepo = useCallback(async () => {
    const next = normalizeRepo(repoDraft) ?? ""
    if (next === useUpdateStore.getState().repo) return
    useUpdateStore.getState().setRepo(next)
    setRepoDraft(next)
    await saveUpdateCheckState({
      enabled: useUpdateStore.getState().enabled,
      lastCheckedAt: useUpdateStore.getState().lastCheckedAt,
      dismissedVersion: useUpdateStore.getState().dismissedVersion,
      repo: next,
      token: useUpdateStore.getState().token,
    })
  }, [repoDraft])

  const handleSaveToken = useCallback(async () => {
    const next = tokenDraft.trim()
    if (next === useUpdateStore.getState().token) return
    useUpdateStore.getState().setToken(next)
    setTokenDraft(next)
    await saveUpdateCheckState({
      enabled: useUpdateStore.getState().enabled,
      lastCheckedAt: useUpdateStore.getState().lastCheckedAt,
      dismissedVersion: useUpdateStore.getState().dismissedVersion,
      repo: useUpdateStore.getState().repo,
      token: next,
    })
  }, [tokenDraft])

  const rows: Array<{ label: string; value: string; mono?: boolean }> = [
    { label: t("settings.sections.about.version"), value: `v${__APP_VERSION__}`, mono: true },
    { label: t("settings.sections.about.clipServer"), value: `${clipStatus}  @  127.0.0.1:19827`, mono: true },
  ]

  const showBanner = shouldShowUpdateBanner(updateStore)
  const lastCheckFailed = updateStore.lastResult?.kind === "error"
  const lastCheckedLabel = updateStore.lastCheckedAt
    ? lastCheckFailed
      // Failed checks are overwhelmingly "GitHub unreachable from the
      // user's network" (common in mainland China). Not actionable,
      // so don't display a colored warning — keep the status in the
      // same muted timestamp line and move on.
      ? `${formatRelative(updateStore.lastCheckedAt, t)} · ${t("settings.sections.about.unreachable")}`
      : formatRelative(updateStore.lastCheckedAt, t)
    : t("settings.sections.about.lastCheckedNever")

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">{t("settings.sections.about.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.sections.about.description")}
        </p>
      </div>

      <div className="rounded-md border divide-y">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between px-4 py-2.5">
            <span className="text-sm text-muted-foreground">{r.label}</span>
            <span className={`text-sm ${r.mono ? "font-mono" : ""}`}>{r.value}</span>
          </div>
        ))}
      </div>

      {/* ── Update check card ──────────────────────────────────── */}
      <div className="space-y-3 rounded-md border p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium">{t("settings.sections.about.updateCheck")}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {t("settings.sections.about.lastChecked")}: {lastCheckedLabel}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCheckNow}
            disabled={updateStore.checking || !updateStore.repo}
            className="shrink-0 gap-1.5"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${updateStore.checking ? "animate-spin" : ""}`}
            />
            {updateStore.checking
              ? t("settings.sections.about.checking")
              : t("settings.sections.about.checkNow")}
          </Button>
        </div>

        {showBanner && updateStore.lastResult?.kind === "available" && (
          <UpdateAvailableBanner
            remote={updateStore.lastResult.remote}
            releaseUrl={updateStore.lastResult.release.html_url}
            releaseName={updateStore.lastResult.release.name}
            releaseBody={updateStore.lastResult.release.body}
            onDismiss={handleDismiss}
          />
        )}

        {!showBanner && updateStore.lastResult?.kind === "up-to-date" && (
          <div className="flex items-center gap-2 rounded border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {t("settings.sections.about.upToDate", { version: updateStore.lastResult.local })}
          </div>
        )}

        {/* error state intentionally has no banner — see the timestamp
            line above for the muted "couldn't reach GitHub" hint. GitHub
            is regularly unreachable from certain networks (notably
            mainland China) and a colored warning would misleadingly
            look like a bug in the app. */}

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            {t("settings.sections.about.repoLabel", { defaultValue: "Repository" })}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={repoDraft}
              onChange={(e) => setRepoDraft(e.target.value)}
              onBlur={handleSaveRepo}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  handleSaveRepo()
                }
              }}
              placeholder="owner/repo · gitlab.host/group/project"
              spellCheck={false}
              className={`flex-1 rounded-md border bg-background px-2.5 py-1.5 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring ${
                repoInvalid ? "border-destructive" : "border-input"
              }`}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={handleSaveRepo}
              disabled={
                repoInvalid || (normalizedRepo ?? "") === updateStore.repo
              }
            >
              {t("settings.sections.about.repoSave", { defaultValue: "Save" })}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {repoInvalid
              ? t("settings.sections.about.repoInvalid", {
                  defaultValue:
                    "Enter a GitHub repo as owner/repo, or paste a full GitHub/GitLab URL.",
                })
              : t("settings.sections.about.repoHint", {
                  defaultValue:
                    "Update checks query the latest release of this repo.",
                })}
          </p>
        </div>

        {isGitlabRepo && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              {t("settings.sections.about.tokenLabel", {
                defaultValue: "GitLab access token",
              })}
            </label>
            <input
              type="password"
              value={tokenDraft}
              onChange={(e) => setTokenDraft(e.target.value)}
              onBlur={handleSaveToken}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  handleSaveToken()
                }
              }}
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="text-[11px] text-muted-foreground">
              {t("settings.sections.about.tokenHint", {
                defaultValue:
                  "Needed when the GitLab project is private or internal (read_api scope).",
              })}
            </p>
          </div>
        )}

        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={updateStore.enabled}
            onChange={handleToggleAutoCheck}
            className="h-3.5 w-3.5"
          />
          {t("settings.sections.about.autoCheck")}
        </label>
      </div>

      <div className="rounded-md border p-4 text-sm">
        <div className="font-medium">LLM Wiki</div>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("settings.sections.about.appDescription")}
          {updateStore.repo && (
            <>
              {" "}
              <a
                className="underline underline-offset-2 hover:text-primary"
                href={repoWebUrl(updateStore.repo)}
                target="_blank"
                rel="noreferrer"
              >
                {repoWebUrl(updateStore.repo).replace(/^https:\/\//, "")}
              </a>
            </>
          )}
        </p>
      </div>
    </div>
  )
}

interface UpdateAvailableBannerProps {
  remote: string
  releaseUrl: string
  releaseName: string
  releaseBody: string
  onDismiss: () => void
}

function UpdateAvailableBanner({
  remote,
  releaseUrl,
  releaseName,
  releaseBody,
  onDismiss,
}: UpdateAvailableBannerProps) {
  const { t } = useTranslation()
  const handleOpen = () => {
    // window.open with target=_blank delegates to the system browser
    // in Tauri via the opener plugin registered in src-tauri/src/lib.rs.
    // Works identically in a regular browser during dev mode.
    window.open(releaseUrl, "_blank", "noopener,noreferrer")
  }

  const preview = releaseBody.slice(0, 400)
  const truncated = releaseBody.length > preview.length

  return (
    <div className="rounded border border-primary/40 bg-primary/5 p-3">
      <div className="flex items-center gap-2 text-sm font-medium text-primary">
        <Sparkles className="h-4 w-4 shrink-0" />
        {t("settings.sections.about.updateAvailable", { version: remote.replace(/^v/, "") })}
      </div>
      {releaseName && releaseName !== `v${remote.replace(/^v/, "")}` && (
        <div className="mt-1 text-xs text-muted-foreground">{releaseName}</div>
      )}
      {preview.trim().length > 0 && (
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-background/60 px-2 py-1.5 text-[11px] leading-relaxed text-foreground/80">
          {preview}
          {truncated && " …"}
        </pre>
      )}
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" onClick={handleOpen} className="gap-1.5">
          <Download className="h-3.5 w-3.5" />
          {t("settings.sections.about.openDownload")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          {t("settings.sections.about.later")}
        </Button>
      </div>
    </div>
  )
}

/** Translated relative-time formatter. Signature accepts a `t` passed
 *  in from the caller so the function stays pure and unit-testable. */
function formatRelative(timestamp: number, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const delta = Date.now() - timestamp
  if (delta < 0) return t("time.justNow", { defaultValue: "just now" })
  const mins = Math.floor(delta / 60_000)
  if (mins < 1) return t("time.justNow", { defaultValue: "just now" })
  if (mins < 60) return t("time.minutesAgo", { count: mins, defaultValue: `${mins} min ago` })
  const hours = Math.floor(mins / 60)
  if (hours < 24) return t("time.hoursAgo", { count: hours, defaultValue: `${hours} h ago` })
  const days = Math.floor(hours / 24)
  return t("time.daysAgo", { count: days, defaultValue: `${days} d ago` })
}
