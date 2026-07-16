import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { confirm } from "@tauri-apps/plugin-dialog"
import { useWikiStore } from "@/stores/wiki-store"
import { normalizePath } from "@/lib/path-utils"
import { Button } from "@/components/ui/button"
import {
  loadPersonas,
  savePersonas,
  loadScenarios,
  saveScenarios,
} from "@/lib/persona/storage"
import { generateScenarios } from "@/lib/persona/generate"
import { exportScenario } from "@/lib/persona/export"
import { createPersona, type Persona, type PlayScenario } from "@/lib/persona/types"

const inputCls =
  "rounded border bg-background px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"

export function PersonaView() {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const projectPath = project ? normalizePath(project.path) : ""

  const [tab, setTab] = useState<"scenarios" | "manage">("scenarios")
  const [personas, setPersonas] = useState<Persona[]>([])
  const [scenarios, setScenarios] = useState<PlayScenario[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!projectPath) return
    setLoaded(false)
    Promise.all([loadPersonas(projectPath), loadScenarios(projectPath)]).then(([p, s]) => {
      setPersonas(p)
      setScenarios(s)
      setLoaded(true)
    })
  }, [projectPath])

  async function persistPersonas(next: Persona[]) {
    setPersonas(next)
    await savePersonas(projectPath, next)
  }

  async function persistScenarios(next: PlayScenario[]) {
    setScenarios(next)
    await saveScenarios(projectPath, next)
  }

  if (!projectPath) {
    return <div className="p-4 text-sm text-muted-foreground">{t("persona.noProject")}</div>
  }
  if (!loaded) {
    return <div className="p-4 text-sm text-muted-foreground">{t("persona.loading")}</div>
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-1 border-b px-4 py-2">
        <h2 className="mr-3 text-sm font-semibold">{t("persona.title")}</h2>
        {(["scenarios", "manage"] as const).map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`rounded px-2 py-0.5 text-xs transition-colors ${
              tab === key ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50"
            }`}
          >
            {t(`persona.tab.${key}`)}
          </button>
        ))}
      </div>
      {tab === "scenarios" ? (
        <ScenariosTab
          personas={personas}
          scenarios={scenarios}
          projectPath={projectPath}
          onChange={(next) => void persistScenarios(next)}
        />
      ) : (
        <ManageTab personas={personas} onChange={(next) => void persistPersonas(next)} />
      )}
    </div>
  )
}

// ── 페르소나 관리 탭 ─────────────────────────────────────────────────────────

function ManageTab({ personas, onChange }: {
  personas: Persona[]
  onChange: (personas: Persona[]) => void
}) {
  const { t } = useTranslation()
  const [search, setSearch] = useState("")
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return personas
    return personas.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.traits.some((tr) => tr.toLowerCase().includes(q)),
    )
  }, [personas, search])

  async function handleDelete(p: Persona) {
    const ok = await confirm(t("persona.deleteConfirm", { name: p.name }))
    if (!ok) return
    onChange(personas.filter((x) => x.id !== p.id))
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-1.5">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("persona.searchPlaceholder")}
          className={`flex-1 ${inputCls}`}
        />
        <button
          onClick={() => { setAdding(true); setEditingId(null) }}
          className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
        >
          + {t("persona.addPersona")}
        </button>
      </div>

      {adding && (
        <div className="border-b px-4 py-2">
          <PersonaEditor
            onSave={(p) => { onChange([...personas, p]); setAdding(false) }}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="p-4 text-xs text-muted-foreground">{t("persona.noPersonas")}</div>
        )}
        {filtered.map((p) => (
          <div key={p.id} className="border-b px-4 py-2 last:border-b-0">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{p.name}</div>
                {p.description && <div className="text-xs text-muted-foreground">{p.description}</div>}
                {p.traits.length > 0 && (
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {p.traits.map((tr) => (
                      <span key={tr} className="rounded bg-muted px-1.5 py-0.5 text-xs">{tr}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={() => { setEditingId(editingId === p.id ? null : p.id); setAdding(false) }}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  {t("persona.edit")}
                </button>
                <button
                  onClick={() => void handleDelete(p)}
                  className="text-xs text-muted-foreground hover:text-destructive"
                >
                  {t("persona.delete")}
                </button>
              </div>
            </div>
            {editingId === p.id && (
              <div className="mt-2">
                <PersonaEditor
                  persona={p}
                  onSave={(next) => {
                    onChange(personas.map((x) => (x.id === next.id ? next : x)))
                    setEditingId(null)
                  }}
                  onCancel={() => setEditingId(null)}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function PersonaEditor({ persona, onSave, onCancel }: {
  persona?: Persona
  onSave: (persona: Persona) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(persona?.name ?? "")
  const [description, setDescription] = useState(persona?.description ?? "")
  const [traits, setTraits] = useState((persona?.traits ?? []).join(", "))

  function save() {
    const trimmed = name.trim()
    if (!trimmed) return
    const parsedTraits = traits.split(",").map((s) => s.trim()).filter(Boolean)
    if (persona) {
      onSave({ ...persona, name: trimmed, description: description.trim(), traits: parsedTraits })
    } else {
      onSave(createPersona(trimmed, description.trim(), parsedTraits))
    }
  }

  return (
    <div className="space-y-1.5 rounded border bg-muted/30 p-2 text-xs">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("persona.namePlaceholder")}
        className={`w-full ${inputCls}`}
      />
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={t("persona.descriptionPlaceholder")}
        className={`w-full ${inputCls}`}
      />
      <input
        value={traits}
        onChange={(e) => setTraits(e.target.value)}
        placeholder={t("persona.traitsPlaceholder")}
        className={`w-full ${inputCls}`}
      />
      <div className="flex items-center gap-2">
        <button onClick={save} className="text-muted-foreground hover:text-foreground" disabled={!name.trim()}>
          {t("persona.save")}
        </button>
        <button onClick={onCancel} className="text-muted-foreground hover:text-foreground">
          {t("persona.cancel")}
        </button>
      </div>
    </div>
  )
}

// ── 시나리오 생성 탭 ─────────────────────────────────────────────────────────

function ScenariosTab({ personas, scenarios, projectPath, onChange }: {
  personas: Persona[]
  scenarios: PlayScenario[]
  projectPath: string
  onChange: (scenarios: PlayScenario[]) => void
}) {
  const { t } = useTranslation()
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const projectName = useWikiStore((s) => s.project?.name || "default")
  const [personaId, setPersonaId] = useState(personas[0]?.id ?? "")
  const [featureInput, setFeatureInput] = useState("")
  const [count, setCount] = useState(3)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const personaById = useMemo(() => new Map(personas.map((p) => [p.id, p])), [personas])
  const selected = personaById.get(personaId)

  async function handleGenerate() {
    if (!selected || busy || !featureInput.trim()) return
    setBusy(true)
    setError(null)
    try {
      const generated = await generateScenarios(selected, featureInput, count, llmConfig, projectPath, projectName)
      onChange([...generated, ...scenarios])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(s: PlayScenario) {
    const ok = await confirm(t("persona.deleteScenarioConfirm", { title: s.title }))
    if (!ok) return
    onChange(scenarios.filter((x) => x.id !== s.id))
  }

  async function handleExport(s: PlayScenario) {
    try {
      const rel = await exportScenario(projectPath, projectName, s, personaById.get(s.personaId), llmConfig)
      window.alert(t("persona.exportDone", { path: rel }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="shrink-0 space-y-2 border-b px-4 py-2">
        <div className="flex items-center gap-2 text-xs">
          <label className="shrink-0 text-muted-foreground">{t("persona.selectPersona")}</label>
          <select value={personaId} onChange={(e) => setPersonaId(e.target.value)} className={inputCls} disabled={busy}>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <label className="ml-2 shrink-0 text-muted-foreground">{t("persona.scenarioCount")}</label>
          <input
            type="number"
            min={1}
            max={10}
            value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
            className={`w-14 ${inputCls}`}
            disabled={busy}
          />
        </div>
        <textarea
          value={featureInput}
          onChange={(e) => setFeatureInput(e.target.value)}
          rows={3}
          placeholder={t("persona.featurePlaceholder")}
          className={`w-full resize-y ${inputCls}`}
          disabled={busy}
        />
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => void handleGenerate()} disabled={busy || !selected || !featureInput.trim()}>
            {busy ? t("persona.generating") : t("persona.generate")}
          </Button>
          {error && <span className="text-xs text-destructive">{t("persona.error", { error })}</span>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {scenarios.length === 0 && (
          <div className="p-4 text-xs text-muted-foreground">{t("persona.noScenarios")}</div>
        )}
        {scenarios.map((s) => (
          <div key={s.id} className="border-b px-4 py-2 last:border-b-0">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{s.title}</div>
                <div className="text-xs text-muted-foreground">
                  {personaById.get(s.personaId)?.name ?? "?"} · {new Date(s.createdAt).toLocaleString()}
                </div>
                <ol className="mt-1 list-inside list-decimal text-xs text-muted-foreground">
                  {s.steps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={() => void handleExport(s)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  {t("persona.export")}
                </button>
                <button
                  onClick={() => void handleDelete(s)}
                  className="text-xs text-muted-foreground hover:text-destructive"
                >
                  {t("persona.delete")}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
