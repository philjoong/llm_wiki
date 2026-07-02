import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { confirm } from "@tauri-apps/plugin-dialog"
import { useWikiStore } from "@/stores/wiki-store"
import { normalizePath } from "@/lib/path-utils"
import { Button } from "@/components/ui/button"
import {
  loadTestPlans,
  saveTestPlan,
  deleteTestPlan,
  loadRules,
  saveRules,
} from "@/lib/casemap/storage"
import {
  runAbstraction,
  runAxisRecommendation,
  generateCandidates,
  runImpossibleFilter,
  runRiskGrading,
  runCaseGeneration,
  type StepContext,
} from "@/lib/casemap/generate"
import { applyRules } from "@/lib/casemap/rule-filter"
import { renderCombination } from "@/lib/casemap/prompts"
import { exportTestPlan } from "@/lib/casemap/export"
import { approveTagLink, fuzzyCandidates, linkExactTags } from "@/lib/casemap/entity-links"
import { loadEntityDict, saveEntityDict, type EntityDict } from "@/lib/entity-dict"
import {
  createEmptyPlan,
  type AbstractionTag,
  type CandidateCombo,
  type RiskLevel,
  type Rule,
  type TestAxis,
  type TestCase,
  type TestPlan,
} from "@/lib/casemap/types"

const STEP_COUNT = 7
const RISK_ORDER: Record<RiskLevel, number> = { high: 0, medium: 1, low: 2 }

const inputCls =
  "rounded border bg-background px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"

export function CasemapView() {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const projectPath = project ? normalizePath(project.path) : ""

  const [plans, setPlans] = useState<TestPlan[]>([])
  const [loaded, setLoaded] = useState(false)
  const [plan, setPlan] = useState<TestPlan | null>(null)
  const [rules, setRules] = useState<Rule[]>([])
  const [dict, setDict] = useState<EntityDict>({})
  const [viewStep, setViewStep] = useState(1)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newPlanName, setNewPlanName] = useState("")

  useEffect(() => {
    if (!projectPath) return
    setPlan(null)
    setLoaded(false)
    Promise.all([loadTestPlans(projectPath), loadRules(projectPath), loadEntityDict(projectPath)]).then(
      ([p, r, d]) => {
        setPlans(p)
        setRules(r)
        setDict(d)
        setLoaded(true)
      },
    )
  }, [projectPath])

  async function persistPlan(next: TestPlan) {
    setPlan(next)
    setPlans((prev) => [next, ...prev.filter((p) => p.id !== next.id)])
    await saveTestPlan(projectPath, next)
  }

  async function persistRules(next: Rule[]) {
    setRules(next)
    await saveRules(projectPath, next)
  }

  /** User approved a fuzzy tag→entity suggestion: link + record the tag as an alias. */
  async function approveLink(tagText: string, entityId: string) {
    if (!plan) return
    const { tags, dict: nextDict } = approveTagLink(plan.abstraction, tagText, entityId, dict)
    setDict(nextDict)
    await saveEntityDict(projectPath, nextDict)
    await persistPlan({ ...plan, abstraction: tags })
  }

  function openPlan(p: TestPlan) {
    setPlan(p)
    setError(null)
    setViewStep(Math.min(p.step + 1, STEP_COUNT))
  }

  async function handleCreatePlan() {
    const name = newPlanName.trim()
    if (!name) return
    const p = createEmptyPlan(name)
    await persistPlan(p)
    setNewPlanName("")
    openPlan(p)
  }

  async function handleDeletePlan(p: TestPlan) {
    const ok = await confirm(t("casemap.deleteConfirm", { name: p.name }))
    if (!ok) return
    await deleteTestPlan(projectPath, p.id)
    setPlans((prev) => prev.filter((x) => x.id !== p.id))
    if (plan?.id === p.id) setPlan(null)
  }

  /** Run one LLM/pure step; on success persist the plan and advance the wizard. */
  async function runStep(action: () => Promise<TestPlan>) {
    if (!plan || busy) return
    setBusy(true)
    setError(null)
    setProgress(null)
    try {
      const next = await action()
      await persistPlan(next)
      setViewStep(Math.min(next.step + 1, STEP_COUNT))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const ctx: StepContext = {
    llmConfig,
    projectPath,
    onProgress: (done, total) => setProgress({ done, total }),
  }

  if (!projectPath) {
    return <div className="p-4 text-sm text-muted-foreground">{t("casemap.noProject")}</div>
  }
  if (!loaded) {
    return <div className="p-4 text-sm text-muted-foreground">{t("casemap.loading")}</div>
  }

  // ── Plan list ──────────────────────────────────────────────────────────────
  if (!plan) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
          <h2 className="flex-1 text-sm font-semibold">{t("casemap.title")}</h2>
          <input
            value={newPlanName}
            onChange={(e) => setNewPlanName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void handleCreatePlan() }}
            placeholder={t("casemap.planNamePlaceholder")}
            className={`w-56 ${inputCls}`}
          />
          <Button size="sm" onClick={() => void handleCreatePlan()} disabled={!newPlanName.trim()}>
            {t("casemap.newPlan")}
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {plans.length === 0 && (
            <div className="p-4 text-sm text-muted-foreground">{t("casemap.noPlans")}</div>
          )}
          {plans.map((p) => (
            <div key={p.id} className="flex items-center gap-3 border-b px-4 py-2 hover:bg-muted/30">
              <button className="flex-1 text-left" onClick={() => openPlan(p)}>
                <div className="text-sm font-medium">{p.name}</div>
                <div className="text-xs text-muted-foreground">
                  {t("casemap.stepBadge", { step: p.step, total: STEP_COUNT })}
                  {p.finalized ? ` · ${t("casemap.finalized")}` : ""}
                  {" · "}{new Date(p.updatedAt).toLocaleString()}
                </div>
              </button>
              <button
                onClick={() => void handleDeletePlan(p)}
                className="text-xs text-muted-foreground hover:text-destructive"
              >
                {t("casemap.delete")}
              </button>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ── Wizard ─────────────────────────────────────────────────────────────────
  const stepLabels = [1, 2, 3, 4, 5, 6, 7].map((n) => t(`casemap.step${n}`))

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
        <button
          onClick={() => setPlan(null)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← {t("casemap.backToList")}
        </button>
        <h2 className="flex-1 truncate text-sm font-semibold">{plan.name}</h2>
        {busy && (
          <span className="text-xs text-muted-foreground animate-pulse">
            {progress
              ? t("casemap.progressBatch", { done: progress.done, total: progress.total })
              : t("casemap.running")}
          </span>
        )}
      </div>

      {/* Step chips */}
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b px-4 py-1.5">
        {stepLabels.map((label, i) => {
          const n = i + 1
          const reachable = n <= Math.min(plan.step + 1, STEP_COUNT)
          return (
            <button
              key={n}
              disabled={!reachable || busy}
              onClick={() => setViewStep(n)}
              className={`rounded px-2 py-0.5 text-xs transition-colors ${
                viewStep === n
                  ? "bg-accent text-accent-foreground"
                  : reachable
                    ? "text-muted-foreground hover:bg-accent/50"
                    : "text-muted-foreground/40"
              }`}
            >
              {n}. {label}
            </button>
          )
        })}
      </div>

      {error && (
        <div className="shrink-0 border-b bg-destructive/10 px-4 py-1.5 text-xs text-destructive">
          {t("casemap.error", { error })}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {viewStep === 1 && (
          <StepFeatureInput
            plan={plan}
            busy={busy}
            onChange={(featureInput) => void persistPlan({ ...plan, featureInput })}
            onRun={() =>
              void runStep(async () => {
                const tags = await runAbstraction(plan.featureInput, ctx)
                return {
                  ...plan,
                  abstraction: linkExactTags(tags, dict),
                  axes: [],
                  priorityValues: [],
                  candidates: [],
                  cases: [],
                  finalized: false,
                  step: 2,
                }
              })
            }
          />
        )}
        {viewStep === 2 && (
          <StepAbstraction
            plan={plan}
            dict={dict}
            busy={busy}
            onChange={(abstraction) => void persistPlan({ ...plan, abstraction })}
            onApproveLink={(tagText, entityId) => void approveLink(tagText, entityId)}
            onRun={() =>
              void runStep(async () => {
                const { axes, priorityValues } = await runAxisRecommendation(plan.featureInput, plan.abstraction, ctx)
                return { ...plan, axes, priorityValues, candidates: [], cases: [], finalized: false, step: 3 }
              })
            }
          />
        )}
        {viewStep === 3 && (
          <StepAxes
            plan={plan}
            busy={busy}
            onChange={(axes) => void persistPlan({ ...plan, axes })}
            onRun={() =>
              void runStep(async () => {
                const candidates = generateCandidates(plan.axes, plan.priorityValues)
                return { ...plan, candidates, cases: [], finalized: false, step: 4 }
              })
            }
          />
        )}
        {viewStep === 4 && (
          <StepCombinations
            plan={plan}
            rules={rules}
            busy={busy}
            onRulesChange={(next) => void persistRules(next)}
            onRun={() =>
              void runStep(async () => {
                const ruled = applyRules(rules, plan.candidates, plan.axes)
                const candidates = await runImpossibleFilter(plan.featureInput, ruled, plan.axes, ctx)
                return { ...plan, candidates, step: 5 }
              })
            }
          />
        )}
        {viewStep === 5 && (
          <StepImpossibleReview
            plan={plan}
            busy={busy}
            onChange={(candidates) => void persistPlan({ ...plan, candidates })}
            onRun={() =>
              void runStep(async () => {
                const candidates = await runRiskGrading(plan.featureInput, plan.candidates, plan.axes, ctx)
                return { ...plan, candidates, step: 6 }
              })
            }
          />
        )}
        {viewStep === 6 && (
          <StepRiskReview
            plan={plan}
            busy={busy}
            onChange={(candidates) => void persistPlan({ ...plan, candidates })}
            onRun={() =>
              void runStep(async () => {
                const cases = await runCaseGeneration(plan.featureInput, plan.abstraction, plan.candidates, plan.axes, ctx)
                return { ...plan, cases, step: 7 }
              })
            }
          />
        )}
        {viewStep === 7 && (
          <StepQaReview
            plan={plan}
            busy={busy}
            onChange={(next) => void persistPlan(next)}
            onFinalize={() =>
              void runStep(async () => {
                const next = { ...plan, finalized: true, step: 7 }
                const rel = await exportTestPlan(projectPath, next)
                window.alert(t("casemap.exportDone", { path: rel }))
                return next
              })
            }
          />
        )}
      </div>
    </div>
  )
}

// ── Step 1: feature input ─────────────────────────────────────────────────────

function StepFeatureInput({ plan, busy, onChange, onRun }: {
  plan: TestPlan
  busy: boolean
  onChange: (featureInput: string) => void
  onRun: () => void
}) {
  const { t } = useTranslation()
  const [text, setText] = useState(plan.featureInput)
  return (
    <div className="flex max-w-3xl flex-col gap-2">
      <p className="text-xs text-muted-foreground">{t("casemap.featureInputHint")}</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => { if (text !== plan.featureInput) onChange(text) }}
        rows={10}
        placeholder={t("casemap.featureInputPlaceholder")}
        className={`w-full resize-y ${inputCls}`}
        disabled={busy}
      />
      <div>
        <Button
          size="sm"
          disabled={busy || !text.trim()}
          onClick={() => { if (text !== plan.featureInput) onChange(text); onRun() }}
        >
          {t("casemap.runAbstraction")}
        </Button>
      </div>
    </div>
  )
}

// ── Step 2: abstraction tags ─────────────────────────────────────────────────

function StepAbstraction({ plan, dict, busy, onChange, onApproveLink, onRun }: {
  plan: TestPlan
  dict: EntityDict
  busy: boolean
  onChange: (tags: AbstractionTag[]) => void
  onApproveLink: (tagText: string, entityId: string) => void
  onRun: () => void
}) {
  const { t } = useTranslation()
  const [newTag, setNewTag] = useState("")
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  function addTag() {
    const tag = newTag.trim()
    if (!tag || plan.abstraction.some((x) => x.tag === tag)) return
    onChange([...plan.abstraction, ...linkExactTags([{ tag }], dict)])
    setNewTag("")
  }
  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <p className="text-xs text-muted-foreground">{t("casemap.abstractionHint")}</p>
      <div className="flex flex-wrap gap-1.5">
        {plan.abstraction.map((item) => {
          const linked = item.entityId ? dict[item.entityId] : undefined
          const suggestion = dismissed.has(item.tag) ? undefined : fuzzyCandidates(item, dict)[0]
          return (
            <span
              key={item.tag}
              className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs ${item.entityId ? "bg-primary/10" : "bg-muted"}`}
              title={linked ? t("casemap.entityLinked", { name: linked.canonicalName }) : undefined}
            >
              {item.entityId && <span aria-hidden>🔗</span>}
              {item.tag}
              {suggestion && (
                <span className="flex items-center gap-1 text-muted-foreground">
                  · {t("casemap.linkSuggestion", { name: suggestion.entry.canonicalName })}
                  <button
                    onClick={() => onApproveLink(item.tag, suggestion.entry.id)}
                    className="text-primary hover:underline"
                    disabled={busy}
                  >
                    [{t("casemap.link")}]
                  </button>
                  <button
                    onClick={() => setDismissed((prev) => new Set(prev).add(item.tag))}
                    className="hover:text-foreground"
                    disabled={busy}
                  >
                    [{t("casemap.dismiss")}]
                  </button>
                </span>
              )}
              <button
                onClick={() => onChange(plan.abstraction.filter((x) => x.tag !== item.tag))}
                className="text-muted-foreground hover:text-destructive"
                disabled={busy}
              >
                ✕
              </button>
            </span>
          )
        })}
      </div>
      <div className="flex items-center gap-1">
        <input
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addTag() }}
          placeholder={t("casemap.addTagPlaceholder")}
          className={`w-64 ${inputCls}`}
          disabled={busy}
        />
        <button onClick={addTag} className="text-xs text-muted-foreground hover:text-foreground" disabled={busy}>
          {t("casemap.add")}
        </button>
      </div>
      <div>
        <Button size="sm" disabled={busy || plan.abstraction.length === 0} onClick={onRun}>
          {t("casemap.runAxes")}
        </Button>
      </div>
    </div>
  )
}

// ── Step 3: axes editor ──────────────────────────────────────────────────────

function StepAxes({ plan, busy, onChange, onRun }: {
  plan: TestPlan
  busy: boolean
  onChange: (axes: TestAxis[]) => void
  onRun: () => void
}) {
  const { t } = useTranslation()
  const [newAxisName, setNewAxisName] = useState("")
  const [newValues, setNewValues] = useState<Record<string, string>>({})

  function updateAxis(id: string, patch: Partial<TestAxis>) {
    onChange(plan.axes.map((a) => (a.id === id ? { ...a, ...patch } : a)))
  }
  function addValue(axis: TestAxis) {
    const v = (newValues[axis.id] ?? "").trim()
    if (!v || axis.values.includes(v)) return
    updateAxis(axis.id, { values: [...axis.values, v] })
    setNewValues((prev) => ({ ...prev, [axis.id]: "" }))
  }
  function addAxis() {
    const name = newAxisName.trim()
    if (!name) return
    onChange([...plan.axes, { id: crypto.randomUUID(), name, values: [], enabled: true }])
    setNewAxisName("")
  }
  const enabledCount = plan.axes.filter((a) => a.enabled && a.values.length > 0).length

  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <p className="text-xs text-muted-foreground">{t("casemap.axesHint")}</p>
      {plan.axes.map((axis) => (
        <div key={axis.id} className={`rounded border p-2 ${axis.enabled ? "" : "opacity-50"}`}>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={axis.enabled}
              onChange={(e) => updateAxis(axis.id, { enabled: e.target.checked })}
              disabled={busy}
            />
            <span className="text-sm font-medium">{axis.name}</span>
            <span className="flex-1" />
            <button
              onClick={() => onChange(plan.axes.filter((a) => a.id !== axis.id))}
              className="text-xs text-muted-foreground hover:text-destructive"
              disabled={busy}
            >
              {t("casemap.delete")}
            </button>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {axis.values.map((v) => {
              const risky = plan.priorityValues.some((p) => p.axisId === axis.id && p.value === v)
              return (
                <span
                  key={v}
                  className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs ${risky ? "bg-destructive/10 text-destructive" : "bg-muted"}`}
                  title={risky ? t("casemap.riskyValue") : undefined}
                >
                  {v}
                  <button
                    onClick={() => updateAxis(axis.id, { values: axis.values.filter((x) => x !== v) })}
                    className="text-muted-foreground hover:text-destructive"
                    disabled={busy}
                  >
                    ✕
                  </button>
                </span>
              )
            })}
            <input
              value={newValues[axis.id] ?? ""}
              onChange={(e) => setNewValues((prev) => ({ ...prev, [axis.id]: e.target.value }))}
              onKeyDown={(e) => { if (e.key === "Enter") addValue(axis) }}
              placeholder={t("casemap.addValuePlaceholder")}
              className={`w-32 ${inputCls}`}
              disabled={busy}
            />
          </div>
        </div>
      ))}
      <div className="flex items-center gap-1">
        <input
          value={newAxisName}
          onChange={(e) => setNewAxisName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addAxis() }}
          placeholder={t("casemap.addAxisPlaceholder")}
          className={`w-64 ${inputCls}`}
          disabled={busy}
        />
        <button onClick={addAxis} className="text-xs text-muted-foreground hover:text-foreground" disabled={busy}>
          {t("casemap.add")}
        </button>
      </div>
      <div>
        <Button size="sm" disabled={busy || enabledCount < 1} onClick={onRun}>
          {t("casemap.generateCombos")}
        </Button>
      </div>
    </div>
  )
}

// ── Step 4: combinations + rules ─────────────────────────────────────────────

function StepCombinations({ plan, rules, busy, onRulesChange, onRun }: {
  plan: TestPlan
  rules: Rule[]
  busy: boolean
  onRulesChange: (rules: Rule[]) => void
  onRun: () => void
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState({ ifAxis: "", ifValue: "", effect: "" })

  function updateRule(id: string, patch: Partial<Rule>) {
    onRulesChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }
  function addRule() {
    if (!draft.ifAxis.trim() || !draft.ifValue.trim() || !draft.effect.trim()) return
    onRulesChange([...rules, { id: crypto.randomUUID(), ...draft, enabled: true }])
    setDraft({ ifAxis: "", ifValue: "", effect: "" })
  }

  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <p className="text-xs">
        {t("casemap.combosGenerated", { count: plan.candidates.length })}
      </p>
      <div className="max-h-48 overflow-y-auto rounded border">
        {plan.candidates.slice(0, 50).map((c, i) => (
          <div key={c.id} className="border-b px-2 py-1 text-xs text-muted-foreground last:border-b-0">
            {i + 1}. {renderCombination(c.combination, plan.axes)}
          </div>
        ))}
        {plan.candidates.length > 50 && (
          <div className="px-2 py-1 text-xs text-muted-foreground">
            {t("casemap.moreCombos", { count: plan.candidates.length - 50 })}
          </div>
        )}
      </div>

      <div className="rounded border p-2">
        <div className="mb-1.5 text-xs font-semibold">{t("casemap.rulesTitle")}</div>
        <p className="mb-2 text-xs text-muted-foreground">{t("casemap.rulesHint")}</p>
        {rules.map((r) => (
          <div key={r.id} className="mb-1 flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={r.enabled}
              onChange={(e) => updateRule(r.id, { enabled: e.target.checked })}
              disabled={busy}
            />
            <span className={r.enabled ? "" : "line-through opacity-50"}>
              IF {r.ifAxis} = {r.ifValue} THEN {r.effect}
            </span>
            <span className="flex-1" />
            <button
              onClick={() => onRulesChange(rules.filter((x) => x.id !== r.id))}
              className="text-muted-foreground hover:text-destructive"
              disabled={busy}
            >
              ✕
            </button>
          </div>
        ))}
        <div className="mt-2 flex items-center gap-1 text-xs">
          <span>IF</span>
          <input
            value={draft.ifAxis}
            onChange={(e) => setDraft({ ...draft, ifAxis: e.target.value })}
            placeholder={t("casemap.ruleIfAxis")}
            className={`w-24 ${inputCls}`}
            disabled={busy}
          />
          <span>=</span>
          <input
            value={draft.ifValue}
            onChange={(e) => setDraft({ ...draft, ifValue: e.target.value })}
            placeholder={t("casemap.ruleIfValue")}
            className={`w-24 ${inputCls}`}
            disabled={busy}
          />
          <span>THEN</span>
          <input
            value={draft.effect}
            onChange={(e) => setDraft({ ...draft, effect: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter") addRule() }}
            placeholder={t("casemap.ruleEffect")}
            className={`flex-1 ${inputCls}`}
            disabled={busy}
          />
          <button onClick={addRule} className="text-muted-foreground hover:text-foreground" disabled={busy}>
            {t("casemap.add")}
          </button>
        </div>
      </div>

      <div>
        <Button size="sm" disabled={busy || plan.candidates.length === 0} onClick={onRun}>
          {t("casemap.runImpossible")}
        </Button>
      </div>
    </div>
  )
}

// ── Step 5: impossible review ────────────────────────────────────────────────

function StepImpossibleReview({ plan, busy, onChange, onRun }: {
  plan: TestPlan
  busy: boolean
  onChange: (candidates: CandidateCombo[]) => void
  onRun: () => void
}) {
  const { t } = useTranslation()
  const [showPossible, setShowPossible] = useState(true)
  const impossibleCount = plan.candidates.filter((c) => c.impossible).length

  function flip(c: CandidateCombo) {
    onChange(plan.candidates.map((x) =>
      x.id === c.id ? { ...x, impossible: !x.impossible, overridden: true } : x,
    ))
  }

  const shown = plan.candidates.filter((c) => c.impossible || showPossible)

  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <div className="flex items-center gap-3 text-xs">
        <span>{t("casemap.impossibleSummary", { impossible: impossibleCount, total: plan.candidates.length })}</span>
        <label className="flex items-center gap-1 text-muted-foreground">
          <input type="checkbox" checked={showPossible} onChange={(e) => setShowPossible(e.target.checked)} />
          {t("casemap.showPossible")}
        </label>
      </div>
      <div className="rounded border">
        {shown.map((c) => (
          <div key={c.id} className={`flex items-start gap-2 border-b px-2 py-1.5 text-xs last:border-b-0 ${c.impossible ? "opacity-60" : ""}`}>
            <div className="flex-1">
              <div>{renderCombination(c.combination, plan.axes)}</div>
              {c.impossible && (
                <div className="mt-0.5 text-muted-foreground">
                  [{c.impossibleSource === "rule" ? t("casemap.byRule") : t("casemap.byLlm")}] {c.impossibleReason}
                </div>
              )}
            </div>
            <span className={`shrink-0 rounded px-1.5 py-0.5 ${c.impossible ? "bg-destructive/10 text-destructive" : "bg-muted"}`}>
              {c.impossible ? t("casemap.impossible") : t("casemap.possible")}
            </span>
            <button
              onClick={() => flip(c)}
              className="shrink-0 text-muted-foreground hover:text-foreground"
              disabled={busy}
            >
              {t("casemap.flip")}
            </button>
          </div>
        ))}
      </div>
      <div>
        <Button size="sm" disabled={busy} onClick={onRun}>
          {t("casemap.runRisk")}
        </Button>
      </div>
    </div>
  )
}

// ── Step 6: risk review ──────────────────────────────────────────────────────

function StepRiskReview({ plan, busy, onChange, onRun }: {
  plan: TestPlan
  busy: boolean
  onChange: (candidates: CandidateCombo[]) => void
  onRun: () => void
}) {
  const { t } = useTranslation()
  const graded = useMemo(
    () =>
      [...plan.candidates.filter((c) => !c.impossible)].sort(
        (a, b) => RISK_ORDER[a.risk ?? "medium"] - RISK_ORDER[b.risk ?? "medium"],
      ),
    [plan.candidates],
  )

  function setRisk(c: CandidateCombo, risk: RiskLevel) {
    onChange(plan.candidates.map((x) => (x.id === c.id ? { ...x, risk } : x)))
  }

  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <p className="text-xs text-muted-foreground">{t("casemap.riskHint")}</p>
      <div className="rounded border">
        {graded.map((c) => (
          <div key={c.id} className="flex items-start gap-2 border-b px-2 py-1.5 text-xs last:border-b-0">
            <div className="flex-1">
              <div>{renderCombination(c.combination, plan.axes)}</div>
              {c.riskReason && <div className="mt-0.5 text-muted-foreground">{c.riskReason}</div>}
            </div>
            <select
              value={c.risk ?? "medium"}
              onChange={(e) => setRisk(c, e.target.value as RiskLevel)}
              className={`shrink-0 ${inputCls}`}
              disabled={busy}
            >
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
        ))}
      </div>
      <div>
        <Button size="sm" disabled={busy || graded.length === 0} onClick={onRun}>
          {t("casemap.runCases")}
        </Button>
      </div>
    </div>
  )
}

// ── Step 7: QA review + export (스탭 2) ──────────────────────────────────────

function StepQaReview({ plan, busy, onChange, onFinalize }: {
  plan: TestPlan
  busy: boolean
  onChange: (plan: TestPlan) => void
  onFinalize: () => void
}) {
  const { t } = useTranslation()
  const [riskFilter, setRiskFilter] = useState<"all" | RiskLevel>("all")
  const [editingId, setEditingId] = useState<string | null>(null)

  const sorted = useMemo(
    () =>
      [...plan.cases].sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk]),
    [plan.cases],
  )
  const shown = sorted.filter((c) => riskFilter === "all" || c.risk === riskFilter)
  const includedCount = plan.cases.filter((c) => c.status !== "excluded").length

  function updateCase(id: string, patch: Partial<TestCase>) {
    onChange({ ...plan, cases: plan.cases.map((c) => (c.id === id ? { ...c, ...patch } : c)) })
  }

  function addManualCase() {
    const tc: TestCase = {
      id: crypto.randomUUID(),
      combination: {},
      purpose: "",
      preconditions: [],
      steps: [],
      expected: [],
      risk: "medium",
      status: "added",
    }
    onChange({ ...plan, cases: [tc, ...plan.cases] })
    setEditingId(tc.id)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-xs">
        <span>{t("casemap.caseSummary", { included: includedCount, total: plan.cases.length })}</span>
        <select
          value={riskFilter}
          onChange={(e) => setRiskFilter(e.target.value as "all" | RiskLevel)}
          className={inputCls}
        >
          <option value="all">{t("casemap.riskAll")}</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <button onClick={addManualCase} className="text-muted-foreground hover:text-foreground" disabled={busy}>
          + {t("casemap.addCase")}
        </button>
        <span className="flex-1" />
        <Button size="sm" onClick={onFinalize} disabled={busy || includedCount === 0}>
          {plan.finalized ? t("casemap.reExport") : t("casemap.finalize")}
        </Button>
      </div>

      <div className="rounded border">
        {shown.length === 0 && (
          <div className="px-3 py-2 text-xs text-muted-foreground">{t("casemap.noCases")}</div>
        )}
        {shown.map((tc) => {
          const excluded = tc.status === "excluded"
          const isEditing = editingId === tc.id
          return (
            <div key={tc.id} className={`border-b px-3 py-2 last:border-b-0 ${excluded ? "opacity-50" : ""}`}>
              <div className="flex items-start gap-2 text-xs">
                <span
                  className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-medium ${
                    tc.risk === "high"
                      ? "bg-destructive/10 text-destructive"
                      : tc.risk === "medium"
                        ? "bg-amber-500/10 text-amber-600"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {tc.risk}
                </span>
                <div className="min-w-0 flex-1">
                  <div className={`text-sm ${excluded ? "line-through" : ""}`}>
                    {tc.purpose || t("casemap.untitledCase")}
                    {tc.status === "added" && (
                      <span className="ml-1 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                        {t("casemap.manualBadge")}
                      </span>
                    )}
                  </div>
                  {Object.keys(tc.combination).length > 0 && (
                    <div className="mt-0.5 text-muted-foreground">
                      {renderCombination(tc.combination, plan.axes)}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setEditingId(isEditing ? null : tc.id)}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  disabled={busy}
                >
                  {isEditing ? t("casemap.closeEdit") : t("casemap.edit")}
                </button>
                <button
                  onClick={() => updateCase(tc.id, { status: excluded ? "generated" : "excluded" })}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  disabled={busy}
                >
                  {excluded ? t("casemap.restore") : t("casemap.exclude")}
                </button>
              </div>

              {isEditing && (
                <CaseEditor tc={tc} busy={busy} onSave={(patch) => { updateCase(tc.id, patch); setEditingId(null) }} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CaseEditor({ tc, busy, onSave }: {
  tc: TestCase
  busy: boolean
  onSave: (patch: Partial<TestCase>) => void
}) {
  const { t } = useTranslation()
  const [purpose, setPurpose] = useState(tc.purpose)
  const [risk, setRisk] = useState<RiskLevel>(tc.risk)
  const [preconditions, setPreconditions] = useState(tc.preconditions.join("\n"))
  const [steps, setSteps] = useState(tc.steps.join("\n"))
  const [expected, setExpected] = useState(tc.expected.join("\n"))

  const toLines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean)

  return (
    <div className="mt-2 space-y-2 rounded border bg-muted/30 p-2 text-xs">
      <div className="flex items-center gap-2">
        <label className="w-20 shrink-0 font-bold uppercase text-[10px] text-muted-foreground">
          {t("casemap.purpose")}
        </label>
        <input value={purpose} onChange={(e) => setPurpose(e.target.value)} className={`flex-1 ${inputCls}`} />
        <select value={risk} onChange={(e) => setRisk(e.target.value as RiskLevel)} className={inputCls}>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>
      {(
        [
          ["preconditions", preconditions, setPreconditions],
          ["steps", steps, setSteps],
          ["expected", expected, setExpected],
        ] as const
      ).map(([key, value, setter]) => (
        <div key={key} className="flex items-start gap-2">
          <label className="w-20 shrink-0 pt-1 font-bold uppercase text-[10px] text-muted-foreground">
            {t(`casemap.${key}`)}
          </label>
          <textarea
            value={value}
            onChange={(e) => setter(e.target.value)}
            rows={3}
            placeholder={t("casemap.linesPlaceholder")}
            className={`flex-1 resize-y ${inputCls}`}
          />
        </div>
      ))}
      <button
        onClick={() =>
          onSave({
            purpose: purpose.trim(),
            risk,
            preconditions: toLines(preconditions),
            steps: toLines(steps),
            expected: toLines(expected),
          })
        }
        className="text-muted-foreground hover:text-foreground"
        disabled={busy}
      >
        {t("casemap.save")}
      </button>
    </div>
  )
}
