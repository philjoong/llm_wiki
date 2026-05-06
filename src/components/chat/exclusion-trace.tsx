/**
 * Exclusion trace block rendered above chat messages. Renders the
 * SearchTrace returned by runExcludeSearch as a collapsible panel —
 * header with summary counts, click to expand the per-entry breakdown.
 */
import { useState } from "react"
import { Filter, ChevronDown, ChevronRight } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { SearchTrace } from "@/lib/exclude-search"

export function ExclusionTrace({ trace }: { trace: SearchTrace }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  const hasType = trace.judgedType !== null
  const hasEntries = trace.appliedEntries.length > 0
  const removedCount = trace.initialCandidateCount - trace.residueCount

  // Nothing meaningful to show — no type judged AND no exclusions fired.
  // (residue/initial counts alone aren't worth a panel.)
  if (!hasType && !hasEntries) return null

  return (
    <div className="mb-2 rounded-md border border-dashed border-blue-500/30 bg-blue-50/50 dark:bg-blue-950/20">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-xs text-blue-700 dark:text-blue-400 hover:bg-blue-100/50 dark:hover:bg-blue-900/20 transition-colors"
      >
        <Filter className="h-3 w-3 shrink-0" />
        <span className="font-medium">
          {hasType
            ? t("chat.trace.headerWithType", {
                name: trace.judgedType!.name,
                removed: removedCount,
                initial: trace.initialCandidateCount,
              })
            : t("chat.trace.headerNoType", {
                initial: trace.initialCandidateCount,
              })}
        </span>
        {expanded ? (
          <ChevronDown className="h-3 w-3 ml-auto" />
        ) : (
          <ChevronRight className="h-3 w-3 ml-auto" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-blue-500/20 px-2.5 py-2 text-xs text-blue-900/80 dark:text-blue-200/70 space-y-2">
          {hasType && (
            <div>
              <div className="font-medium">
                {t("chat.trace.judgedType")}: {trace.judgedType!.name}
                <span className="ml-1 text-blue-600/60 dark:text-blue-400/60">
                  ({Math.round(trace.judgedType!.confidence * 100)}%)
                </span>
              </div>
              {trace.judgedType!.reasoning && (
                <div className="text-blue-800/70 dark:text-blue-300/60 italic mt-0.5">
                  {trace.judgedType!.reasoning}
                </div>
              )}
            </div>
          )}

          <div>
            <div className="font-medium">
              {t("chat.trace.appliedExclusions")}:{" "}
              {t("chat.trace.removedOfInitial", {
                removed: removedCount,
                initial: trace.initialCandidateCount,
              })}
            </div>
            {hasEntries ? (
              <ul className="mt-0.5 space-y-0.5">
                {trace.appliedEntries.map((e) => (
                  <li key={`${e.filePath}::${e.pattern}`}>
                    <span className="font-mono">{e.pattern}</span>
                    {" → "}
                    {e.matched.length}
                    {e.rationale && (
                      <span className="text-blue-800/60 dark:text-blue-300/50">
                        {" "}— {e.rationale}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-blue-800/60 dark:text-blue-300/50 mt-0.5">
                {t("chat.trace.noEntriesFired")}
              </div>
            )}
          </div>

          <div className="font-medium">
            {t("chat.trace.residueCount", { count: trace.residueCount })}
          </div>
        </div>
      )}
    </div>
  )
}
