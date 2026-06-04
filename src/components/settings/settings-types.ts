import type { CustomApiMode } from "./llm-presets"

/**
 * Shape of the draft state each section reads from and writes into.
 * The parent (SettingsView) owns one instance and hands it to every
 * section; the Save button at the bottom flushes the whole draft to
 * stores + disk in one commit.
 */
export interface SettingsDraft {
  // LLM provider
  provider: "openai" | "anthropic" | "google" | "ollama" | "custom" | "claude-code" | "codex-cli" | "gemini-cli"
  apiKey: string
  model: string
  ollamaUrl: string
  customEndpoint: string
  maxContextSize: number
  apiMode: CustomApiMode | undefined

  // Embedding
  embeddingEnabled: boolean
  embeddingEndpoint: string
  embeddingApiKey: string
  embeddingModel: string
  /** Target characters per chunk. Empty = use chunker default (1000). */
  embeddingMaxChunkChars: number | undefined
  /** Overlap characters between adjacent chunks. Empty = default (200). */
  embeddingOverlapChunkChars: number | undefined

  // Output preferences
  outputLanguage: string
  maxHistoryMessages: number

  // UI
  uiLanguage: string
}

export type DraftSetter = <K extends keyof SettingsDraft>(
  key: K,
  value: SettingsDraft[K],
) => void
