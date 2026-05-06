/**
 * Gemini CLI subprocess transport.
 *
 * Rust-side counterpart: src-tauri/src/commands/gemini_cli.rs. Each
 * stdout line from `gemini` is forwarded as a `gemini-cli:{streamId}`
 * event and emitted as text (with a separator newline reinserted).
 */

import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import type { LlmConfig } from "@/stores/wiki-store"
import type { ChatMessage, RequestOverrides } from "./llm-providers"
import type { StreamCallbacks } from "./llm-client"

type SpawnPayload = Record<string, unknown> & {
  streamId: string
  model: string
  messages: ChatMessage[]
}

export async function streamGeminiCli(
  config: LlmConfig,
  messages: ChatMessage[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  overrides?: RequestOverrides,
): Promise<void> {
  const { onToken, onDone, onError } = callbacks

  if (import.meta.env?.DEV && overrides) {
    for (const key of ["temperature", "top_p", "top_k", "max_tokens", "stop"] as const) {
      if (overrides[key] !== undefined) {
        // eslint-disable-next-line no-console
        console.warn(`[gemini-cli] ignoring unsupported override "${key}": CLI has no equivalent flag`)
      }
    }
  }

  const streamId = crypto.randomUUID()

  let unlistenData: UnlistenFn | undefined
  let unlistenDone: UnlistenFn | undefined
  let finished = false
  let firstLine = true

  const cleanup = () => {
    unlistenData?.()
    unlistenDone?.()
  }

  const finishWith = (cb: () => void) => {
    if (finished) return
    finished = true
    cleanup()
    cb()
  }

  const abortListener = () => {
    void invoke("gemini_cli_kill", { streamId }).catch(() => {})
    finishWith(onDone)
  }
  signal?.addEventListener("abort", abortListener)

  try {
    unlistenData = await listen<string>(`gemini-cli:${streamId}`, (event) => {
      const line = event.payload
      onToken(firstLine ? line : `\n${line}`)
      firstLine = false
    })

    unlistenDone = await listen<{ code: number | null; stderr: string }>(
      `gemini-cli:${streamId}:done`,
      (event) => {
        const code = event.payload?.code
        const stderr = event.payload?.stderr?.trim() ?? ""
        if (code !== null && code !== undefined && code !== 0) {
          const detail = stderr ? `: ${stderr}` : ""
          finishWith(() =>
            onError(new Error(`gemini CLI exited with code ${code}${detail}`)),
          )
        } else {
          finishWith(onDone)
        }
      },
    )

    const payload: SpawnPayload = {
      streamId,
      model: config.model,
      messages,
    }
    await invoke("gemini_cli_spawn", payload)
  } catch (err) {
    finishWith(() => {
      const message = err instanceof Error ? err.message : String(err)
      if (/not found|No such file|executable file not found/i.test(message)) {
        onError(new Error(
          "Gemini CLI not found. Install `gemini` (https://github.com/google-gemini/gemini-cli) or pick a different provider.",
        ))
      } else {
        onError(err instanceof Error ? err : new Error(message))
      }
    })
  } finally {
    signal?.removeEventListener("abort", abortListener)
  }
}
