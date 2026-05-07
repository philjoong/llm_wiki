/**
 * Codex CLI subprocess transport.
 *
 * Rust-side counterpart: src-tauri/src/commands/codex_cli.rs. Each
 * stdout line from `codex exec` is forwarded as a `codex-cli:{streamId}`
 * event; we emit it verbatim (with a trailing newline) so the chat
 * panel sees the same text the user would see in a real terminal.
 */

import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import type { LlmConfig } from "@/stores/wiki-store"
import type { ChatMessage } from "./llm-providers"
import type { StreamCallbacks } from "./llm-client"

type SpawnPayload = Record<string, unknown> & {
  streamId: string
  model: string
  messages: ChatMessage[]
}

export async function streamCodexCli(
  config: LlmConfig,
  messages: ChatMessage[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const { onToken, onDone, onError } = callbacks

  // Sampling knobs are stripped by the dispatcher (see isCliProvider in
  // llm-providers.ts) — codex exec has no flag equivalents.

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
    void invoke("codex_cli_kill", { streamId }).catch(() => {})
    finishWith(onDone)
  }
  signal?.addEventListener("abort", abortListener)

  try {
    unlistenData = await listen<string>(`codex-cli:${streamId}`, (event) => {
      // Re-insert the newline that BufReader stripped so multi-line
      // output renders correctly. Skip the leading newline so the
      // assistant message doesn't start with a blank line.
      const line = event.payload
      onToken(firstLine ? line : `\n${line}`)
      firstLine = false
    })

    unlistenDone = await listen<{ code: number | null; stderr: string }>(
      `codex-cli:${streamId}:done`,
      (event) => {
        const code = event.payload?.code
        const stderr = event.payload?.stderr?.trim() ?? ""
        if (code !== null && code !== undefined && code !== 0) {
          const detail = stderr ? `: ${stderr}` : ""
          finishWith(() =>
            onError(new Error(`codex CLI exited with code ${code}${detail}`)),
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
    await invoke("codex_cli_spawn", payload)
  } catch (err) {
    finishWith(() => {
      const message = err instanceof Error ? err.message : String(err)
      if (/not found|No such file|executable file not found/i.test(message)) {
        onError(new Error(
          "Codex CLI not found. Install `codex` (https://github.com/openai/codex) or pick a different provider.",
        ))
      } else {
        onError(err instanceof Error ? err : new Error(message))
      }
    })
  } finally {
    signal?.removeEventListener("abort", abortListener)
  }
}
