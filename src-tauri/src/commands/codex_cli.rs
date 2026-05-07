//! Codex CLI subprocess transport (OpenAI's `codex` binary).
//!
//! Mirrors the architecture of `claude_cli.rs`: detect the binary on
//! PATH, spawn it in non-interactive mode, stream stdout line-by-line
//! back to the frontend over Tauri events. The user's existing Codex
//! login (~/.codex) is reused — no API key handling here.
//!
//! Unlike claude's stream-json protocol, codex `exec` emits plain text
//! (and incidental status lines) on stdout. We forward each stdout line
//! verbatim and let the TS transport append it to the assistant message.

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

#[derive(Default)]
pub struct CodexCliState {
    children: Arc<Mutex<HashMap<String, Child>>>,
}

#[derive(Serialize)]
pub struct DetectResult {
    installed: bool,
    version: Option<String>,
    path: Option<String>,
    error: Option<String>,
}

#[derive(Deserialize)]
pub struct CodexMessage {
    role: String,
    content: String,
}

#[tauri::command]
pub async fn codex_cli_detect() -> Result<DetectResult, String> {
    let path = match which::which("codex") {
        Ok(p) => p,
        Err(_) => {
            return Ok(DetectResult {
                installed: false,
                version: None,
                path: None,
                error: Some("`codex` not found on PATH".to_string()),
            });
        }
    };

    let path_str = path.to_string_lossy().to_string();

    let output = tokio::time::timeout(
        Duration::from_secs(3),
        Command::new(&path).arg("--version").output(),
    )
    .await;

    match output {
        Ok(Ok(out)) if out.status.success() => {
            let version = String::from_utf8_lossy(&out.stdout).trim().to_string();
            Ok(DetectResult {
                installed: true,
                version: Some(version),
                path: Some(path_str),
                error: None,
            })
        }
        Ok(Ok(out)) => {
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            Ok(DetectResult {
                installed: false,
                version: None,
                path: Some(path_str),
                error: Some(if stderr.is_empty() {
                    format!("`codex --version` exited with {}", out.status)
                } else {
                    stderr
                }),
            })
        }
        Ok(Err(e)) => Ok(DetectResult {
            installed: false,
            version: None,
            path: Some(path_str),
            error: Some(format!("Failed to spawn `codex`: {e}")),
        }),
        Err(_) => Ok(DetectResult {
            installed: false,
            version: None,
            path: Some(path_str),
            error: Some("`codex --version` timed out after 3s".to_string()),
        }),
    }
}

/// Flatten the message list into a single prompt suitable for codex's
/// non-interactive `exec` mode. System messages become a preamble; if
/// there is more than one conversational turn we annotate them with
/// "User:" / "Assistant:" headers so the model has the history.
fn build_prompt(messages: &[CodexMessage]) -> String {
    let system_preamble: String = messages
        .iter()
        .filter(|m| m.role == "system")
        .map(|m| m.content.clone())
        .collect::<Vec<_>>()
        .join("\n\n");

    let convo: Vec<&CodexMessage> = messages
        .iter()
        .filter(|m| m.role == "user" || m.role == "assistant")
        .collect();

    let body = if convo.len() <= 1 {
        convo.iter().map(|m| m.content.clone()).collect::<Vec<_>>().join("\n\n")
    } else {
        convo
            .iter()
            .map(|m| {
                let header = if m.role == "assistant" { "Assistant" } else { "User" };
                format!("{header}: {}", m.content)
            })
            .collect::<Vec<_>>()
            .join("\n\n")
    };

    if system_preamble.is_empty() {
        body
    } else {
        format!("{system_preamble}\n\n{body}")
    }
}

#[tauri::command]
pub async fn codex_cli_spawn(
    app: AppHandle,
    state: State<'_, CodexCliState>,
    stream_id: String,
    model: String,
    messages: Vec<CodexMessage>,
) -> Result<(), String> {
    let prompt = build_prompt(&messages);
    if prompt.trim().is_empty() {
        return Err("No prompt content to send to codex CLI".to_string());
    }

    // `codex exec` is the non-interactive entry point. `--skip-git-repo-check`
    // avoids the "not in a git repo" warning since we're running outside
    // any source tree. The trailing `-` tells codex to read the prompt
    // from stdin rather than expecting a positional argument — this lets
    // us stream large multi-turn histories without ARG_MAX issues.
    //
    // Resolve the full path via `which` rather than passing a bare name.
    // On Windows, `Command::new("codex")` only finds `codex.exe`; the
    // npm-installed CLI ships as `codex.cmd`, which is invisible to a
    // bare-name spawn. Same fix as `claude_cli_spawn`.
    let codex_path = which::which("codex")
        .map_err(|_| "`codex` not found on PATH".to_string())?;

    let mut cmd = Command::new(&codex_path);
    cmd.arg("exec")
        .arg("--skip-git-repo-check")
        .arg("--model")
        .arg(&model)
        .arg("-");

    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn codex: {e}"))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Missing stdin handle".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Missing stdout handle".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Missing stderr handle".to_string())?;

    stdin
        .write_all(prompt.as_bytes())
        .await
        .map_err(|e| format!("Failed to write to codex stdin: {e}"))?;
    stdin
        .flush()
        .await
        .map_err(|e| format!("Failed to flush codex stdin: {e}"))?;
    drop(stdin);

    state
        .children
        .lock()
        .await
        .insert(stream_id.clone(), child);

    let children = Arc::clone(&state.children);
    let app_for_task = app.clone();
    let stream_id_task = stream_id.clone();
    let topic = format!("codex-cli:{stream_id}");
    let done_topic = format!("codex-cli:{stream_id}:done");

    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        let mut stderr_reader = BufReader::new(stderr).lines();
        let app = app_for_task;

        let stderr_task = tokio::spawn(async move {
            let mut collected = String::new();
            while let Ok(Some(line)) = stderr_reader.next_line().await {
                eprintln!("[codex-cli stderr] {line}");
                collected.push_str(&line);
                collected.push('\n');
            }
            collected
        });

        loop {
            match reader.next_line().await {
                Ok(Some(line)) => {
                    if app.emit(&topic, line).is_err() {
                        break;
                    }
                }
                Ok(None) => break,
                Err(e) => {
                    eprintln!("[codex-cli stdout] read error: {e}");
                    break;
                }
            }
        }

        let child_opt = children.lock().await.remove(&stream_id_task);
        let exit_code = if let Some(mut child) = child_opt {
            match child.wait().await {
                Ok(status) => status.code(),
                Err(_) => None,
            }
        } else {
            None
        };

        let stderr_text = stderr_task.await.unwrap_or_default();

        let _ = app.emit(
            &done_topic,
            serde_json::json!({
                "code": exit_code,
                "stderr": stderr_text,
            }),
        );
    });

    Ok(())
}

#[tauri::command]
pub async fn codex_cli_kill(
    state: State<'_, CodexCliState>,
    stream_id: String,
) -> Result<(), String> {
    if let Some(mut child) = state.children.lock().await.remove(&stream_id) {
        let _ = child.start_kill();
    }
    Ok(())
}
