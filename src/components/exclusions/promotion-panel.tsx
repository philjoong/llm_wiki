/**
 * Stage 13 + Stage 14 — promotion candidates + exclusion entry management.
 *
 * Two stacked sections share this view:
 *
 *   - Top: promotion candidates (Stage 13). (typeId, path) pairs whose
 *     instance frequency crosses the threshold from
 *     `exclusions/promotion_rules.md`. Actions per candidate:
 *       [Promote to Pattern] / [Promote to Axiom] / [Dismiss]
 *
 *   - Bottom: existing exclusion entries (Stage 14). Every pattern/axiom
 *     entry across the project, with `needs_review` and `stale` badges
 *     and per-entry actions:
 *       [Mark validated]  → refresh `last_validated_at`, clear flag
 *       [Archive]/[Restore] → toggle `archived`
 *
 * A "Check freshness" button runs `runFreshnessCheck` to (a) walk git
 * mtimes for cited sources and flag entries whose sources changed since
 * `last_validated_at`, and (b) surface stale axioms for re-validation.
 *
 * IDEA.md §2.6 — every promotion is human-driven. IDEA.md §2.8 — the
 * four invalidation mechanisms (source dependency / freshness /
 * counterexample / explicit retract) are surfaced here so the human can
 * inspect and decide; the system never auto-archives or auto-promotes.
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Archive,
  CheckCircle2,
  Clock,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  ShieldPlus,
  TrendingUp,
  X,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { useWikiStore } from "@/stores/wiki-store"
import { normalizePath } from "@/lib/path-utils"
import {
  analyzePromotionCandidates,
  dismissCandidate,
  loadThresholds,
  promoteToAxiom,
  promoteToPattern,
  type PromotionCandidate,
} from "@/lib/promotion"
import {
  loadAllEntries,
  markValidated,
  runFreshnessCheck,
  setEntryFlag,
  type EntryListing,
  type EntryRef,
  type StaleAxiomResult,
} from "@/lib/exclusion-validity"

export function PromotionPanel() {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const dataVersion = useWikiStore((s) => s.dataVersion)
  const bumpDataVersion = useWikiStore((s) => s.bumpDataVersion)

  const [candidates, setCandidates] = useState<PromotionCandidate[]>([])
  const [entries, setEntries] = useState<EntryListing[]>([])
  const [staleness, setStaleness] = useState<StaleAxiomResult>({ rows: [] })
  const [showOnlyNeedsReview, setShowOnlyNeedsReview] = useState(false)
  const [loading, setLoading] = useState(false)
  const [freshnessChecking, setFreshnessChecking] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!project) return
    setLoading(true)
    setError(null)
    try {
      const pp = normalizePath(project.path)
      const [cands, ents] = await Promise.all([
        analyzePromotionCandidates(pp),
        loadAllEntries(pp),
      ])
      setCandidates(cands)
      setEntries(ents)
    } catch (err) {
      console.error("[promotion] reload failed:", err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [project])

  useEffect(() => {
    reload()
  }, [reload, dataVersion])

  const handleCheckFreshness = useCallback(async () => {
    if (!project) return
    setFreshnessChecking(true)
    setError(null)
    try {
      const pp = normalizePath(project.path)
      const { freshnessDays } = await loadThresholds(pp)
      const { staleness: st } = await runFreshnessCheck(pp, freshnessDays)
      setStaleness(st)
      bumpDataVersion()
    } catch (err) {
      console.error("[promotion] freshness check failed:", err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setFreshnessChecking(false)
    }
  }, [project, bumpDataVersion])

  const handlePromotePattern = useCallback(
    async (c: PromotionCandidate) => {
      if (!project) return
      const key = candidateKey(c)
      setBusyKey(key)
      try {
        await promoteToPattern(normalizePath(project.path), c)
        bumpDataVersion()
      } catch (err) {
        console.error("[promotion] promoteToPattern failed:", err)
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusyKey(null)
      }
    },
    [project, bumpDataVersion],
  )

  const handlePromoteAxiom = useCallback(
    async (c: PromotionCandidate) => {
      if (!project) return
      const proposed = c.path
        .replace(/^db\//, "")
        .replace(/\.md$/, "")
        .replace(/\//g, "_")
      const name = window.prompt(t("promotion.axiomNamePrompt"), proposed)
      if (!name) return
      const key = candidateKey(c)
      setBusyKey(key)
      try {
        await promoteToAxiom(normalizePath(project.path), c, name)
        bumpDataVersion()
      } catch (err) {
        console.error("[promotion] promoteToAxiom failed:", err)
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusyKey(null)
      }
    },
    [project, bumpDataVersion, t],
  )

  const handleDismiss = useCallback(
    async (c: PromotionCandidate) => {
      if (!project) return
      const reason = window.prompt(t("promotion.dismissReasonPrompt"), "") ?? ""
      const key = candidateKey(c)
      setBusyKey(key)
      try {
        await dismissCandidate(normalizePath(project.path), c, reason)
        bumpDataVersion()
      } catch (err) {
        console.error("[promotion] dismiss failed:", err)
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusyKey(null)
      }
    },
    [project, bumpDataVersion, t],
  )

  const handleEntryAction = useCallback(
    async (ref: EntryRef, action: "archive" | "restore" | "validate") => {
      if (!project) return
      const key = entryKey(ref)
      setBusyKey(key)
      try {
        const pp = normalizePath(project.path)
        if (action === "archive") {
          await setEntryFlag(pp, ref, "archived", true)
        } else if (action === "restore") {
          await setEntryFlag(pp, ref, "archived", false)
        } else {
          await markValidated(pp, ref)
        }
        bumpDataVersion()
      } catch (err) {
        console.error("[promotion] entry action failed:", err)
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusyKey(null)
      }
    },
    [project, bumpDataVersion],
  )

  const staleRefs = useMemo(() => {
    const s = new Set<string>()
    for (const row of staleness.rows) s.add(entryKey(row.ref))
    return s
  }, [staleness])

  const visibleEntries = useMemo(() => {
    if (!showOnlyNeedsReview) return entries
    return entries.filter(
      (e) => e.entry.needsReview || staleRefs.has(entryKey(e.ref)),
    )
  }, [entries, showOnlyNeedsReview, staleRefs])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">{t("promotion.title")}</span>
          {candidates.length > 0 && (
            <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
              {candidates.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCheckFreshness}
            disabled={freshnessChecking}
            className="text-xs"
            title={t("exclusion.checkFreshnessHint")}
          >
            <Clock
              className={`mr-1 h-3 w-3 ${freshnessChecking ? "animate-spin" : ""}`}
            />
            {t("exclusion.checkFreshness")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={reload}
            disabled={loading}
            className="text-xs"
          >
            <RefreshCw
              className={`mr-1 h-3 w-3 ${loading ? "animate-spin" : ""}`}
            />
            {t("promotion.reload")}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="m-3 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {/* ── Promotion candidates (Stage 13) ───────────────────── */}
        <section>
          <SectionHeader
            icon={ShieldPlus}
            label={t("promotion.section.candidates")}
            count={candidates.length}
          />
          {!loading && candidates.length === 0 ? (
            <EmptyHint
              icon={CheckCircle2}
              primary={t("promotion.empty")}
              secondary={t("promotion.emptyHint")}
            />
          ) : (
            <div className="flex flex-col gap-2 px-3 pb-3">
              {candidates.map((c) => (
                <CandidateCard
                  key={candidateKey(c)}
                  candidate={c}
                  busy={busyKey === candidateKey(c)}
                  onPattern={() => handlePromotePattern(c)}
                  onAxiom={() => handlePromoteAxiom(c)}
                  onDismiss={() => handleDismiss(c)}
                />
              ))}
            </div>
          )}
        </section>

        {/* ── Existing exclusion entries (Stage 14) ─────────────── */}
        <section className="border-t">
          <div className="flex items-center justify-between px-3 pt-3">
            <SectionHeader
              icon={ShieldCheck}
              label={t("exclusion.entriesTitle")}
              count={visibleEntries.length}
              inline
            />
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                className="h-3 w-3"
                checked={showOnlyNeedsReview}
                onChange={(e) => setShowOnlyNeedsReview(e.target.checked)}
              />
              {t("exclusion.needsReviewFilter")}
            </label>
          </div>
          {visibleEntries.length === 0 ? (
            <EmptyHint
              icon={CheckCircle2}
              primary={t("exclusion.entriesEmpty")}
              secondary={t("exclusion.entriesEmptyHint")}
            />
          ) : (
            <div className="flex flex-col gap-2 p-3">
              {visibleEntries.map((e) => (
                <EntryCard
                  key={entryKey(e.ref)}
                  listing={e}
                  stale={staleRefs.has(entryKey(e.ref))}
                  busy={busyKey === entryKey(e.ref)}
                  onArchive={() => handleEntryAction(e.ref, "archive")}
                  onRestore={() => handleEntryAction(e.ref, "restore")}
                  onValidate={() => handleEntryAction(e.ref, "validate")}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function candidateKey(c: PromotionCandidate): string {
  return `${c.typeId}::${c.path}`
}

function entryKey(ref: EntryRef): string {
  return `${ref.filePath}::${ref.pattern}`
}

function SectionHeader({
  icon: Icon,
  label,
  count,
  inline,
}: {
  icon: typeof TrendingUp
  label: string
  count: number
  inline?: boolean
}) {
  return (
    <div
      className={`flex items-center gap-1.5 text-xs font-semibold text-muted-foreground ${
        inline ? "" : "px-3 pt-3 pb-1"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{label}</span>
      {count > 0 && (
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-foreground">
          {count}
        </span>
      )}
    </div>
  )
}

function EmptyHint({
  icon: Icon,
  primary,
  secondary,
}: {
  icon: typeof CheckCircle2
  primary: string
  secondary?: string
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
      <Icon className="h-7 w-7 text-muted-foreground/30" />
      <p>{primary}</p>
      {secondary && (
        <p className="text-xs text-muted-foreground/70">{secondary}</p>
      )}
    </div>
  )
}

function CandidateCard({
  candidate,
  busy,
  onPattern,
  onAxiom,
  onDismiss,
}: {
  candidate: PromotionCandidate
  busy: boolean
  onPattern: () => void
  onAxiom: () => void
  onDismiss: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="rounded-lg border p-3 text-sm">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-xs text-muted-foreground">
            {candidate.typeId}
          </div>
          <div className="font-mono text-sm break-all">{candidate.path}</div>
        </div>
        <button
          onClick={onDismiss}
          disabled={busy}
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-50"
          title={t("promotion.dismiss")}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="rounded-full bg-muted px-2 py-0.5">
          {t("promotion.countLabel", { count: candidate.count })}
        </span>
        <span className="truncate">
          {t("promotion.instancesLabel", {
            count: candidate.instances.length,
          })}
        </span>
      </div>

      <details className="mb-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer hover:text-foreground">
          {t("promotion.citationsToggle")}
        </summary>
        <ul className="mt-1 list-disc pl-5">
          {candidate.instances.slice(0, 10).map((p, i) => (
            <li key={i} className="font-mono">
              {p}
            </li>
          ))}
          {candidate.instances.length > 10 && (
            <li>… {candidate.instances.length - 10} more</li>
          )}
        </ul>
      </details>

      <div className="flex flex-wrap gap-1.5">
        <Button
          variant="default"
          size="sm"
          className="h-7 text-xs"
          onClick={onPattern}
          disabled={busy}
        >
          <ShieldPlus className="mr-1 h-3 w-3" />
          {t("promotion.promotePattern")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={onAxiom}
          disabled={busy}
        >
          <ShieldCheck className="mr-1 h-3 w-3" />
          {t("promotion.promoteAxiom")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={onDismiss}
          disabled={busy}
        >
          {t("promotion.dismiss")}
        </Button>
      </div>
    </div>
  )
}

function EntryCard({
  listing,
  stale,
  busy,
  onArchive,
  onRestore,
  onValidate,
}: {
  listing: EntryListing
  stale: boolean
  busy: boolean
  onArchive: () => void
  onRestore: () => void
  onValidate: () => void
}) {
  const { t } = useTranslation()
  const { entry, ref, level, questionTypeIds } = listing
  const isArchived = entry.archived === true
  const needsReview = entry.needsReview === true

  return (
    <div
      className={`rounded-lg border p-3 text-sm ${
        isArchived ? "opacity-60" : ""
      } ${needsReview || stale ? "border-amber-500/40 bg-amber-50/30 dark:bg-amber-950/10" : ""}`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase">
              {level}
            </span>
            {questionTypeIds.length > 0 && (
              <span className="text-xs text-muted-foreground font-mono">
                {questionTypeIds.join(", ")}
              </span>
            )}
            {isArchived && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {t("exclusion.archivedBadge")}
              </span>
            )}
            {needsReview && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                <ShieldAlert className="h-2.5 w-2.5" />
                {t("exclusion.needsReview")}
              </span>
            )}
            {stale && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-orange-500/20 px-2 py-0.5 text-[10px] font-medium text-orange-700 dark:text-orange-400">
                <Clock className="h-2.5 w-2.5" />
                {t("exclusion.stale")}
              </span>
            )}
          </div>
          <div className="mt-1 font-mono text-sm break-all">{ref.pattern}</div>
        </div>
      </div>

      {entry.rationale && (
        <p className="mb-2 text-xs text-muted-foreground italic">
          {entry.rationale}
        </p>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
        <span className="font-mono truncate">{ref.filePath}</span>
        {entry.lastValidatedAt && (
          <span>
            · {t("exclusion.validatedAt")}: {entry.lastValidatedAt}
          </span>
        )}
        {entry.sources.length > 0 && (
          <span>· {t("exclusion.sourcesLabel", { count: entry.sources.length })}</span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {!isArchived ? (
          <>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={onValidate}
              disabled={busy}
            >
              <ShieldCheck className="mr-1 h-3 w-3" />
              {t("exclusion.markValidated")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={onArchive}
              disabled={busy}
            >
              <Archive className="mr-1 h-3 w-3" />
              {t("exclusion.archive")}
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={onRestore}
            disabled={busy}
          >
            <RotateCcw className="mr-1 h-3 w-3" />
            {t("exclusion.restore")}
          </Button>
        )}
      </div>
    </div>
  )
}
