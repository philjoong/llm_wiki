import { useState, useEffect } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import { invoke } from "@tauri-apps/api/core"
import i18n from "@/i18n"
import { useWikiStore } from "@/stores/wiki-store"
import { useReviewStore } from "@/stores/review-store"
import { useChatStore } from "@/stores/chat-store"
import { listDirectory, openProject } from "@/commands/fs"
import { getLastProject, getRecentProjects, saveLastProject, loadLlmConfig, loadLanguage, loadEmbeddingConfig, loadOutputLanguage, loadProviderConfigs, loadActivePresetId, loadSelectedBranch, saveSelectedBranch } from "@/lib/project-store"
import { loadReviewItems, loadChatHistory } from "@/lib/persist"
import { setupAutoSave } from "@/lib/auto-save"
import { startClipWatcher } from "@/lib/clip-watcher"
import { AppLayout } from "@/components/layout/app-layout"
import { WelcomeScreen } from "@/components/project/welcome-screen"
import { CreateProjectDialog } from "@/components/project/create-project-dialog"
import { ProjectBranchSelector } from "@/components/project/project-branch-selector"
import { SyncOnExitDialog } from "@/components/project/sync-on-exit-dialog"
import type { WikiProject } from "@/types/wiki"
import { listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"

function debug(message: string, data?: unknown) {
  const suffix = data === undefined ? "" : ` ${formatDebugData(data)}`
  const line = `${message}${suffix}`
  console.log(`[app-debug] ${line}`)
  invoke("app_debug", { message: line }).catch((err) => {
    console.warn("[app-debug] failed to write to Tauri terminal:", err)
  })
}

function formatDebugData(data: unknown) {
  if (data instanceof Error) {
    return `${data.name}: ${data.message}`
  }
  if (typeof data === "string") {
    return data
  }
  try {
    return JSON.stringify(data)
  } catch {
    return String(data)
  }
}

function App() {
  const project = useWikiStore((s) => s.project)
  const selectedBranch = useWikiStore((s) => s.selectedBranch)
  const setProject = useWikiStore((s) => s.setProject)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showSyncExitDialog, setShowSyncExitDialog] = useState(false)
  const [loading, setLoading] = useState(true)

  // Set up auto-save and clip watcher once on mount
  useEffect(() => {
    debug("mount: setup auto-save, clip watcher, close listener")
    setupAutoSave()
    startClipWatcher()

    const unlisten = listen("tauri://close-requested", () => {
      if (useWikiStore.getState().project) {
        setShowSyncExitDialog(true)
      } else {
        getCurrentWindow().destroy()
      }
    })

    return () => {
      unlisten.then((u) => u())
    }
  }, [])

  // Background update check ??hydrate persisted user preferences, then
  // hit GitHub at most once every UPDATE_CHECK_CACHE_MS. Runs 5 s after
  // mount so it doesn't contend with startup work. Silent on failure;
  // the UI in Settings ??About surfaces the result.
  useEffect(() => {
    let cancelled = false
    debug("update-check: timer scheduled")
    const timer = setTimeout(async () => {
      if (cancelled) return
      try {
        debug("update-check: start")
        const { loadUpdateCheckState, saveUpdateCheckState } = await import(
          "@/lib/project-store"
        )
        const { useUpdateStore } = await import("@/stores/update-store")
        const { checkForUpdates, UPDATE_CHECK_CACHE_MS } = await import(
          "@/lib/update-check"
        )

        const persisted = await loadUpdateCheckState()
        debug("update-check: persisted state loaded", {
          hasPersisted: Boolean(persisted),
        })
        if (persisted) useUpdateStore.getState().hydrate(persisted)

        const state = useUpdateStore.getState()
        if (!state.enabled) {
          debug("update-check: skipped because disabled")
          return
        }
        // No repo configured yet ??skip silently. The Settings ??About
        // card lets the user enter one to enable update checks.
        if (!state.repo) {
          debug("update-check: skipped because repo is empty")
          return
        }

        const now = Date.now()
        const fresh =
          state.lastCheckedAt !== null &&
          now - state.lastCheckedAt < UPDATE_CHECK_CACHE_MS
        if (fresh) {
          debug("update-check: skipped because cache is fresh")
          return
        }

        useUpdateStore.getState().setChecking(true)
        debug("update-check: requesting GitHub release data", { repo: state.repo })
        const result = await checkForUpdates({
          currentVersion: __APP_VERSION__,
          repo: state.repo,
        })
        if (cancelled) return
        useUpdateStore.getState().setResult(result, Date.now())
        await saveUpdateCheckState({
          enabled: useUpdateStore.getState().enabled,
          lastCheckedAt: Date.now(),
          dismissedVersion: useUpdateStore.getState().dismissedVersion,
          repo: useUpdateStore.getState().repo,
        })
        debug("update-check: finished")
      } catch (err) {
        // Silent ??Settings ??About lets the user retry manually.
        debug("update-check: failed", err)
      }
    }, 5000)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [])

  // Auto-open last project on startup
  useEffect(() => {
    async function init() {
      debug("init: start")
      try {
        debug("init: before loadLlmConfig")
        const savedConfig = await loadLlmConfig()
        debug("init: after loadLlmConfig", { hasConfig: Boolean(savedConfig) })
        if (savedConfig) {
          useWikiStore.getState().setLlmConfig(savedConfig)
        }
        debug("init: before loadProviderConfigs")
        const savedProviderConfigs = await loadProviderConfigs()
        debug("init: after loadProviderConfigs", {
          providers: savedProviderConfigs ? Object.keys(savedProviderConfigs) : [],
        })
        if (savedProviderConfigs) {
          useWikiStore.getState().setProviderConfigs(savedProviderConfigs)
        }
        debug("init: before loadActivePresetId")
        const savedActivePreset = await loadActivePresetId()
        debug("init: after loadActivePresetId", { savedActivePreset })
        if (savedActivePreset) {
          useWikiStore.getState().setActivePresetId(savedActivePreset)
          // Re-resolve the active preset's LlmConfig from (preset defaults
          // + saved overrides). Without this, preset default updates
          // (e.g. a corrected Anthropic model ID shipped in a release)
          // never reach users who are relying on defaults ??their stored
          // `llmConfig` snapshot from a previous launch would keep the
          // old value. Overrides still win, so an explicit user choice
          // is preserved.
          const { LLM_PRESETS } = await import("@/components/settings/llm-presets")
          const { resolveConfig } = await import("@/components/settings/preset-resolver")
          const preset = LLM_PRESETS.find((p) => p.id === savedActivePreset)
          if (preset) {
            debug("init: resolving active preset", { preset: preset.id })
            const currentFallback = useWikiStore.getState().llmConfig
            const override = (savedProviderConfigs ?? {})[savedActivePreset]
            const resolved = resolveConfig(preset, override, currentFallback)
            useWikiStore.getState().setLlmConfig(resolved)
            const { saveLlmConfig } = await import("@/lib/project-store")
            await saveLlmConfig(resolved)
            debug("init: active preset resolved and saved")
          } else {
            debug("init: active preset id not found in presets", {
              savedActivePreset,
            })
          }
        }
        debug("init: before loadEmbeddingConfig")
        const savedEmbeddingConfig = await loadEmbeddingConfig()
        debug("init: after loadEmbeddingConfig", {
          hasConfig: Boolean(savedEmbeddingConfig),
        })
        if (savedEmbeddingConfig) {
          useWikiStore.getState().setEmbeddingConfig(savedEmbeddingConfig)
        }
        debug("init: before loadOutputLanguage")
        const savedOutputLang = await loadOutputLanguage()
        debug("init: after loadOutputLanguage", { savedOutputLang })
        if (savedOutputLang) {
          useWikiStore.getState().setOutputLanguage(savedOutputLang)
        }
        debug("init: before loadSelectedBranch")
        const savedBranch = await loadSelectedBranch()
        debug("init: after loadSelectedBranch", { savedBranch })
        if (savedBranch) {
          useWikiStore.getState().setSelectedBranch(savedBranch)
        } else if (!import.meta.env.VITE_GIT_REPO_URL) {
          debug("init: no saved branch and no repo url, defaulting to main")
          useWikiStore.getState().setSelectedBranch("main")
          await saveSelectedBranch("main")
        }
        debug("init: before loadLanguage")
        const savedLang = await loadLanguage()
        debug("init: after loadLanguage", { savedLang })
        if (savedLang === "en" || savedLang === "ko") {
          debug("init: before i18n.changeLanguage", { savedLang })
          await i18n.changeLanguage(savedLang)
          debug("init: after i18n.changeLanguage")
        }
        debug("init: before getLastProject")
        const lastProject = await getLastProject()
        debug("init: after getLastProject", lastProject)
        if (lastProject) {
          try {
            debug("init: before openProject(lastProject)", {
              path: lastProject.path,
            })
            const proj = await openProject(lastProject.path)
            debug("init: after openProject(lastProject)", proj)
            await handleProjectOpened(proj)
            debug("init: after handleProjectOpened(lastProject)")
          } catch (e) {
            console.error("[App.init] openProject failed:", e)
            debug("init: openProject(lastProject) failed", e)
          }
        }
        debug("init: finished, loading=false", {
          selectedBranch: useWikiStore.getState().selectedBranch,
          hasProject: Boolean(useWikiStore.getState().project),
        })
      } catch (e) {
        console.error("[App.init] unexpected error:", e)
        debug("init: unexpected error", e)
      } finally {
        debug("init: finally setLoading(false)")
        setLoading(false)
      }
    }
    init()
  }, [])

  async function handleProjectOpened(proj: WikiProject) {
    debug("project-open: start", { name: proj.name, path: proj.path })
    // Clear all per-project state BEFORE loading new project data
    // to prevent cross-project contamination. MUST be awaited so the
    // ingest queue / graph cache are actually cleared before the new
    // project's state is populated.
    const { resetProjectState } = await import("@/lib/reset-project-state")
    debug("project-open: before resetProjectState")
    await resetProjectState()
    debug("project-open: after resetProjectState")

    setProject(proj)
    setSelectedFile(null)
    setActiveView("wiki")
    // Bump data version so any cached graphs/views invalidate
    useWikiStore.getState().bumpDataVersion()
    debug("project-open: before saveLastProject")
    await saveLastProject(proj)
    debug("project-open: after saveLastProject")

    // Restore ingest queue (resume interrupted tasks). Keyed by the
    // project's stable UUID so the queue still finds the right project
    // even if the filesystem path changed since the task was enqueued.
    import("@/lib/ingest-queue").then(({ restoreQueue }) => {
      debug("project-open: restoreQueue scheduled", { projectId: proj.id })
      restoreQueue(proj.id, proj.path).catch((err) =>
        {
          console.error("Failed to restore ingest queue:", err)
          debug("project-open: restoreQueue failed", err)
        }
      )
    })
    // Notify local clip server of the current project + all recent projects
    fetch("http://127.0.0.1:19827/project", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: proj.path }),
    }).catch(() => {})

    // Send all recent projects to clip server for extension project picker
    getRecentProjects().then((recents) => {
      debug("project-open: recent projects loaded", { count: recents.length })
      const projects = recents.map((p) => ({ name: p.name, path: p.path }))
      fetch("http://127.0.0.1:19827/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projects }),
      }).catch(() => {})
    }).catch(() => {})
    try {
      debug("project-open: before listDirectory", { path: proj.path })
      const tree = await listDirectory(proj.path)
      setFileTree(tree)
      debug("project-open: after listDirectory", { count: tree.length })
    } catch (err) {
      console.error("Failed to load file tree:", err)
      debug("project-open: listDirectory failed", err)
    }

    // Initialize local VC database and sync with remote
    try {
      debug("project-open: before import vc/git commands")
      const { vcDbInit } = await import("@/commands/vc-db")
      const { gitPull } = await import("@/commands/git")
      debug("project-open: before vcDbInit", { path: proj.path })
      await vcDbInit(proj.path)
      debug("project-open: after vcDbInit")
      
      const branch = useWikiStore.getState().selectedBranch || "main"
      // Attempt to pull from origin. Fail silently if remote is not set up yet.
      try {
        debug("project-open: before gitPull", { remote: "origin", branch })
        await gitPull(proj.path, "origin", branch)
        debug("project-open: after gitPull")
      } catch (err) {
        // origin may not exist yet, skip
        debug("project-open: gitPull skipped/failed", err)
      }
    } catch (err) {
      console.error("Failed to initialize VC or sync:", err)
      debug("project-open: VC init or sync failed", err)
    }

    // Load persisted review items
    try {
      debug("project-open: before loadReviewItems")
      const savedReview = await loadReviewItems(proj.path)
      if (savedReview.length > 0) {
        useReviewStore.getState().setItems(savedReview)
      }
      debug("project-open: after loadReviewItems", { count: savedReview.length })
    } catch (err) {
      // ignore, start fresh
      debug("project-open: loadReviewItems failed", err)
    }
    // Load persisted chat history
    try {
      debug("project-open: before loadChatHistory")
      const savedChat = await loadChatHistory(proj.path)
      if (savedChat.conversations.length > 0) {
        useChatStore.getState().setConversations(savedChat.conversations)
        useChatStore.getState().setMessages(savedChat.messages)
        // Set most recent conversation as active
        const sorted = [...savedChat.conversations].sort((a, b) => b.updatedAt - a.updatedAt)
        if (sorted[0]) {
          useChatStore.getState().setActiveConversation(sorted[0].id)
        }
      }
      debug("project-open: after loadChatHistory", {
        conversations: savedChat.conversations.length,
        messages: savedChat.messages.length,
      })
    } catch (err) {
      // ignore, start fresh
      debug("project-open: loadChatHistory failed", err)
    }
    debug("project-open: finished")
  }

  async function handleSelectRecent(proj: WikiProject) {
    try {
      const validated = await openProject(proj.path)
      await handleProjectOpened(validated)
    } catch (err) {
      window.alert(`Failed to open project: ${err}`)
    }
  }

  async function handleOpenProject() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Open Wiki Project",
    })
    if (!selected) return
    try {
      const proj = await openProject(selected)
      await handleProjectOpened(proj)
    } catch (err) {
      window.alert(`Failed to open project: ${err}`)
    }
  }

  async function handleSwitchProject() {
    // Clear all per-project state BEFORE flipping back to the welcome screen
    // so old data cannot leak in via any async render pass.
    const { resetProjectState } = await import("@/lib/reset-project-state")
    await resetProjectState()
    setProject(null)
    setFileTree([])
    setSelectedFile(null)
  }

  async function handleSync() {
    if (!project) return
    const { exportGraphDb } = await import("@/commands/graph-db")
    const { writeFile } = await import("@/commands/fs")
    const { gitCommit, gitPush } = await import("@/commands/git")
    const { vcDbSaveSnapshot } = await import("@/commands/vc-db")
    
    // 1. Export graph to JSON
    const graphData = await exportGraphDb(project.name, "main")
    const graphJson = JSON.stringify(graphData, null, 2)
    
    // 2. Write to graph.json
    await writeFile(`${project.path}/graph.json`, graphJson)
    
    // 3. Commit graph.json
    const commitRes = await gitCommit(project.path, "sync: update graph snapshot", ["graph.json"])
    
    // 4. Save to SQLite if committed
    if (commitRes.committed && commitRes.commitHash) {
      await vcDbSaveSnapshot(project.path, commitRes.commitHash, graphJson)
    }
    
    // 5. Push to remote
    const branch = useWikiStore.getState().selectedBranch || "main"
    await gitPush(project.path, "origin", branch)
  }

  function handleExit() {
    getCurrentWindow().destroy()
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        Loading...
      </div>
    )
  }

  if (!selectedBranch) {
    return <ProjectBranchSelector />
  }

  if (!project) {
    return (
      <>
        <WelcomeScreen
          onCreateProject={() => setShowCreateDialog(true)}
          onOpenProject={handleOpenProject}
          onSelectProject={handleSelectRecent}
        />
        <CreateProjectDialog
          open={showCreateDialog}
          onOpenChange={setShowCreateDialog}
          onCreated={handleProjectOpened}
        />
      </>
    )
  }

  return (
    <>
      <AppLayout onSwitchProject={handleSwitchProject} />
      <CreateProjectDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onCreated={handleProjectOpened}
      />
      <SyncOnExitDialog
        open={showSyncExitDialog}
        onOpenChange={setShowSyncExitDialog}
        onSync={handleSync}
        onExit={handleExit}
      />
    </>
  )
}

export default App
