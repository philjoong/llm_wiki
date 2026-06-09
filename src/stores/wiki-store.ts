import { create } from "zustand"
import type { WikiProject, FileNode } from "@/types/wiki"

/**
 * Wire protocol used when `provider === "custom"`. Other providers have a
 * fixed protocol (openai → OpenAI chat; anthropic → Anthropic messages;
 * etc.), so this field is ignored for them. `undefined` defaults to
 * `chat_completions` for backward compatibility with pre-0.3.7 configs.
 */
export type CustomApiMode = "chat_completions" | "anthropic_messages"

interface LlmConfig {
  provider: "openai" | "anthropic" | "google" | "ollama" | "custom" | "claude-code" | "codex-cli" | "gemini-cli"
  apiKey: string
  model: string
  ollamaUrl: string
  customEndpoint: string
  maxContextSize: number // max context window in characters
  apiMode?: CustomApiMode
}

interface EmbeddingConfig {
  source: "builtin" | "external"
  enabled: boolean
  endpoint: string // e.g. "http://127.0.0.1:1234/v1/embeddings"
  apiKey: string
  model: string // e.g. "text-embedding-qwen3-embedding-0.6b"
  /**
   * Chunking knobs (Phase 1 RAG). Undefined values fall back to the
   * chunker's built-in defaults in `src/lib/text-chunker.ts`:
   *   targetChars   1000
   *   maxChars      1500
   *   minChars      200
   *   overlapChars  200
   *
   * Users on small-context endpoints (e.g. llama.cpp with n_ctx=512,
   * Ollama `mxbai-embed-large`) should lower `maxChunkChars` to avoid
   * per-request rejections; fetchEmbedding also auto-halves on
   * "too long" server errors as a second line of defence.
   */
  maxChunkChars?: number
  overlapChunkChars?: number
}

/**
 * Output language for LLM-generated content (wiki pages, chat responses).
 * "auto" = detect from user input / source document language.
 * Otherwise = force all LLM output to use the specified language.
 */
type OutputLanguage =
  | "auto"
  | "English"
  | "Chinese"
  | "Traditional Chinese"
  | "Japanese"
  | "Korean"
  | "Vietnamese"
  | "French"
  | "German"
  | "Spanish"
  | "Portuguese"
  | "Italian"
  | "Russian"
  | "Arabic"
  | "Hindi"
  | "Turkish"
  | "Dutch"
  | "Polish"
  | "Swedish"
  | "Indonesian"
  | "Thai"

/**
 * Per-preset saved fields. Each entry survives turning the preset off
 * and coming back — users don't have to re-enter an API key when they
 * briefly switch to a different provider.
 */
export interface ProviderOverride {
  apiKey?: string
  model?: string
  baseUrl?: string           // customEndpoint for custom presets, ollamaUrl for ollama
  apiMode?: CustomApiMode
  maxContextSize?: number
}

export type ProviderConfigs = Record<string, ProviderOverride>

export type NavSnapshot = {
  view: WikiState["activeView"]
  selectedFile: string | null
  graphTab?: "knowledge" | "files"
  graphDbFile?: string | null  // selectedDbFile.path
}

export interface WikiState {
  project: WikiProject | null
  fileTree: FileNode[]
  selectedFile: string | null
  fileContent: string
  chatExpanded: boolean
  activeView: "wiki" | "graph" | "review" | "history" | "settings"
  llmConfig: LlmConfig
  /** Per-provider-preset stored overrides (API key, model, endpoint, …). */
  providerConfigs: ProviderConfigs
  /** Which preset is currently active. `null` = no LLM configured. */
  activePresetId: string | null
  embeddingConfig: EmbeddingConfig
  outputLanguage: OutputLanguage
  selectedBranch: string | null
  dataVersion: number
  selectedGraph: string // Active sub-graph name for visualization
  highlightSource: string | null // Source file path to highlight in graph
  /** Absolute path set when the user clicks a Reference — GraphView.Files picks this up. */
  pendingOpenFile: string | null
  navHistory: NavSnapshot[]
  /** Set by goBack when it needs GraphView to restore its internal tab/file state. */
  pendingGraphRestore: { graphTab: "knowledge" | "files"; graphDbFile: string | null } | null

  setProject: (project: WikiProject | null) => void
  setFileTree: (tree: FileNode[]) => void
  setSelectedFile: (path: string | null) => void
  setFileContent: (content: string) => void
  setChatExpanded: (expanded: boolean) => void
  setActiveView: (view: WikiState["activeView"]) => void
  setLlmConfig: (config: LlmConfig) => void
  setProviderConfigs: (configs: ProviderConfigs) => void
  setActivePresetId: (id: string | null) => void
  setEmbeddingConfig: (config: EmbeddingConfig) => void
  setOutputLanguage: (lang: OutputLanguage) => void
  setSelectedBranch: (branch: string | null) => void
  bumpDataVersion: () => void
  setSelectedGraph: (graph: string) => void
  setHighlightSource: (source: string | null) => void
  setPendingOpenFile: (path: string | null) => void
  setPendingGraphRestore: (v: WikiState["pendingGraphRestore"]) => void
  goBack: () => void
}

export const useWikiStore = create<WikiState>((set) => ({
  project: null,
  fileTree: [],
  selectedFile: null,
  fileContent: "",
  chatExpanded: false,
  activeView: "wiki",
  llmConfig: {
    provider: "openai",
    apiKey: "",
    maxContextSize: 204800,
    model: "",
    ollamaUrl: "http://localhost:11434",
    customEndpoint: "",
  },
  providerConfigs: {},
  activePresetId: null,
  selectedBranch: null,

  dataVersion: 0,
  selectedGraph: "main",
  highlightSource: null,
  pendingOpenFile: null,
  navHistory: [],
  pendingGraphRestore: null,

  setProject: (project) => set({ project }),
  setFileTree: (fileTree) => set({ fileTree }),
  setSelectedFile: (path) => set((state) => {
    if (path === state.selectedFile) return { selectedFile: path }
    const snap: NavSnapshot = { view: state.activeView, selectedFile: state.selectedFile }
    return { selectedFile: path, navHistory: [...state.navHistory, snap].slice(-5) }
  }),
  setFileContent: (fileContent) => set({ fileContent }),
  setChatExpanded: (chatExpanded) => set({ chatExpanded }),
  setActiveView: (view) => set((state) => {
    if (view === state.activeView) return { activeView: view }
    const snap: NavSnapshot = { view: state.activeView, selectedFile: state.selectedFile }
    return { activeView: view, navHistory: [...state.navHistory, snap].slice(-5) }
  }),
  embeddingConfig: {
    source: "builtin",
    enabled: true,
    endpoint: "",
    apiKey: "",
    model: "",
  },

  outputLanguage: "auto",

  setLlmConfig: (llmConfig) => set({ llmConfig }),
  setProviderConfigs: (providerConfigs) => set({ providerConfigs }),
  setActivePresetId: (activePresetId) => set({ activePresetId }),
  setEmbeddingConfig: (embeddingConfig) => set({ embeddingConfig }),
  setOutputLanguage: (outputLanguage) => set({ outputLanguage }),
  setSelectedBranch: (selectedBranch) => set({ selectedBranch }),
  bumpDataVersion: () => set((state) => ({ dataVersion: state.dataVersion + 1 })),
  setSelectedGraph: (selectedGraph) => set({ selectedGraph }),
  setHighlightSource: (highlightSource) => set({ highlightSource }),
  setPendingOpenFile: (pendingOpenFile) => set({ pendingOpenFile }),
  setPendingGraphRestore: (pendingGraphRestore) => set({ pendingGraphRestore }),
  goBack: () => set((state) => {
    if (state.navHistory.length === 0) return {}
    const prev = state.navHistory[state.navHistory.length - 1]
    const graphRestore = (prev.graphTab != null)
      ? { graphTab: prev.graphTab, graphDbFile: prev.graphDbFile ?? null }
      : null
    return {
      activeView: prev.view,
      selectedFile: prev.selectedFile,
      navHistory: state.navHistory.slice(0, -1),
      pendingGraphRestore: graphRestore,
    }
  }),
}))

export type { WikiState, LlmConfig, EmbeddingConfig, OutputLanguage }
