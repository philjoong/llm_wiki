import type { LlmConfig } from "@/stores/wiki-store"
import type { ProviderOverride } from "@/stores/wiki-store"
import type { LlmPreset } from "./llm-presets"

/**
 * Build a full LlmConfig from a preset template + the user's saved
 * override fields for that preset. Falls back to the preset defaults
 * (or the existing LlmConfig) when an override is missing.
 */
export function resolveConfig(
  preset: LlmPreset,
  override: ProviderOverride | undefined,
  fallback: LlmConfig,
): LlmConfig {
  const ov = override ?? {}
  const apiKey = ov.apiKey ?? ""
  const model = ov.model ?? preset.defaultModel ?? ""
  const maxContextSize =
    ov.maxContextSize ?? preset.suggestedContextSize ?? fallback.maxContextSize

  if (preset.provider === "custom") {
    return {
      provider: "custom",
      apiKey,
      model,
      ollamaUrl: fallback.ollamaUrl,
      customEndpoint: ov.baseUrl ?? preset.baseUrl ?? "",
      maxContextSize,
      apiMode: ov.apiMode ?? preset.apiMode ?? "chat_completions",
    }
  }

  if (preset.provider === "ollama") {
    return {
      provider: "ollama",
      apiKey: "",
      model,
      ollamaUrl: ov.baseUrl ?? preset.baseUrl ?? "http://localhost:11434",
      customEndpoint: fallback.customEndpoint,
      maxContextSize,
    }
  }

  if (preset.provider === "claude-code") {
    // Subprocess transport — no apiKey, no endpoint URL. Model id is
    // passed straight to `claude --model`.
    return {
      provider: "claude-code",
      apiKey: "",
      model,
      ollamaUrl: fallback.ollamaUrl,
      customEndpoint: fallback.customEndpoint,
      maxContextSize,
    }
  }

  if (preset.provider === "codex-cli" || preset.provider === "gemini-cli") {
    // Same shape as claude-code: subprocess transport, no apiKey, no
    // endpoint. Model id flows through to the CLI's `--model` flag.
    return {
      provider: preset.provider,
      apiKey: "",
      model,
      ollamaUrl: fallback.ollamaUrl,
      customEndpoint: fallback.customEndpoint,
      maxContextSize,
    }
  }

  // openai / anthropic / google — use fixed endpoint baked into the provider dispatch.
  return {
    provider: preset.provider,
    apiKey,
    model,
    ollamaUrl: fallback.ollamaUrl,
    customEndpoint: fallback.customEndpoint,
    maxContextSize,
  }
}
