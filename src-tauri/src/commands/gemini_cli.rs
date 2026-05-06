//! Gemini CLI subprocess transport (Google's `gemini` binary).
//!
//! Mirrors `claude_cli.rs` / `codex_cli.rs`: detect, spawn in non-
//! interactive mode, stream stdout line-by-line. The user's existing
//! gemini-cli login (~/.gemini) is reused — no API key handling here.
//!
//! The full conversation is collapsed into a single prompt and sent on
//! stdin (gemini-cli auto-detects piped stdin and runs non-interactively).

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
pub struct GeminiCliState {
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
pub struct GeminiMessage {
    role: String,
    content: String,
}

#[tauri::command]
pub async fn gemini_cli_detect() -> Result<DetectResult, String> {
    let path = match which::which("gemini") {
        Ok(p) => p,
        Err(_) => {
            return Ok(DetectResult {
                installed: false,
                version: None,
                path: None,
                error: Some("`gemini` not found on PATH".to_string()),
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
                    format!("`gemini --version` exited with {}", out.status)
                } else {
                    stderr
                }),
            })
        }
        Ok(Err(e)) => Ok(DetectResult {
            installed: false,
            version: None,
            path: Some(path_str),
            error: Some(format!("Failed to spawn `gemini`: {e}")),
        }),
        Err(_) => Ok(DetectResult {
            installed: false,
            version: None,
            path: Some(path_str),
            error: Some("`gemini --version` timed out after 3s".to_string()),
        }),
    }
}

fn build_prompt(messages: &[GeminiMessage]) -> String {
    let system_preamble: String = messages
        .iter()
        .filter(|m| m.role == "system")
        .map(|m| m.content.clone())
        .collect::<Vec<_>>()
        .join("\n\n");

    let convo: Vec<&GeminiMessage> = messages
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
pub async fn gemini_cli_spawn(
    app: AppHandle,
    state: State<'_, GeminiCliState>,
    stream_id: String,
    model: String,
    messages: Vec<GeminiMessage>,
) -> Result<(), String> {
    let prompt = build_prompt(&messages);
    if prompt.trim().is_empty() {
        return Err("No prompt content to send to gemini CLI".to_string());
    }

    // gemini-cli auto-enters non-interactive mode when stdin is piped.
    // `--model` selects the underlying model; `--yolo` skips approval
    // prompts so a long-running ingest doesn't stall waiting for a TTY.
    let mut cmd = Command::new("gemini");
    cmd.arg("--model").arg(&model).arg("--yolo");

    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn gemini: {e}"))?;

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
        .map_err(|e| format!("Failed to write to gemini stdin: {e}"))?;
    stdin
        .flush()
        .await
        .map_err(|e| format!("Failed to flush gemini stdin: {e}"))?;
    drop(stdin);

    state
        .children
        .lock()
        .await
        .insert(stream_id.clone(), child);

    let children = Arc::clone(&state.children);
    let app_for_task = app.clone();
    let stream_id_task = stream_id.clone();
    let topic = format!("gemini-cli:{stream_id}");
    let done_topic = format!("gemini-cli:{stream_id}:done");

    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        let mut stderr_reader = BufReader::new(stderr).lines();
        let app = app_for_task;

        let stderr_task = tokio::spawn(async move {
            let mut collected = String::new();
            while let Ok(Some(line)) = stderr_reader.next_line().await {
                eprintln!("[gemini-cli stderr] {line}");
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
                    eprintln!("[gemini-cli stdout] read error: {e}");
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
pub async fn gemini_cli_kill(
    state: State<'_, GeminiCliState>,
    stream_id: String,
) -> Result<(), String> {
    if let Some(mut child) = state.children.lock().await.remove(&stream_id) {
        let _ = child.start_kill();
    }
    Ok(())
}
