//! Claude Code CLI subprocess transport.
//!
//! Users with a Claude Code subscription already have OAuth credentials
//! in ~/.claude/ and the `claude` binary on PATH. This module lets LLM
//! Wiki reuse that subscription instead of requiring a separate API key.
//! We treat `claude` purely as a text-completion engine — its agent
//! tools, MCPs, file-edit abilities, and --resume session state are all
//! out of scope. Multi-turn history is reconstructed from `messages`
//! on every call, symmetric with every other provider.
//!
//! Why tokio::process directly (not tauri-plugin-shell): the plugin's
//! scope model is designed for sidecars or fixed absolute paths; scoping
//! a user-installed PATH binary cleanly is awkward. A hardcoded Rust
//! command that always and only spawns `claude` provides the same
//! security property (the webview can't call this command to execute
//! anything else) without pulling in another plugin or editing
//! capabilities JSON.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use uuid::Uuid;

/// Shared state holding running `claude` child processes keyed by the
/// frontend-generated stream id. Registered via .manage() in lib.rs.
#[derive(Default)]
pub struct ClaudeCliState {
    children: Arc<Mutex<HashMap<String, Child>>>,
}

#[derive(Serialize)]
pub struct DetectResult {
    installed: bool,
    version: Option<String>,
    path: Option<String>,
    /// When !installed, a short human-readable reason (missing from PATH,
    /// quarantined on macOS, spawn failed, etc). The frontend shows this
    /// verbatim in the status pill.
    error: Option<String>,
}

#[derive(Deserialize)]
pub struct ClaudeMessage {
    /// "system" | "user" | "assistant"
    role: String,
    content: String,
}

/// Locate `claude` on PATH and confirm it's runnable by calling
/// `claude --version` with a short timeout. Cheap — safe to call on
/// mount of the settings panel.
#[tauri::command]
pub async fn claude_cli_detect() -> Result<DetectResult, String> {
    let path = match which::which("claude") {
        Ok(p) => p,
        Err(_) => {
            return Ok(DetectResult {
                installed: false,
                version: None,
                path: None,
                error: Some("`claude` not found on PATH".to_string()),
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
            // macOS Gatekeeper quarantines produce a predictable error. If
            // we detect it, surface the remediation hint directly; the UI
            // renders this string into an actionable message.
            let error = if stderr.contains("quarantine") || stderr.contains("damaged") {
                Some(format!(
                    "Binary quarantined — try: xattr -d com.apple.quarantine {path_str}"
                ))
            } else if stderr.is_empty() {
                Some(format!("`claude --version` exited with {}", out.status))
            } else {
                Some(stderr)
            };
            Ok(DetectResult {
                installed: false,
                version: None,
                path: Some(path_str),
                error,
            })
        }
        Ok(Err(e)) => Ok(DetectResult {
            installed: false,
            version: None,
            path: Some(path_str),
            error: Some(format!("Failed to spawn `claude`: {e}")),
        }),
        Err(_) => Ok(DetectResult {
            installed: false,
            version: None,
            path: Some(path_str),
            error: Some("`claude --version` timed out after 3s".to_string()),
        }),
    }
}

/// Build the CLI argument list for `claude -p`. Extracted so unit
/// tests can verify ingest-specific flags (`--tools ""`,
/// `--system-prompt`) compose correctly without spawning a process.
fn build_cli_args(
    model: &str,
    disable_tools: bool,
    system_prompt_file: Option<&Path>,
) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "-p".into(),
        "--output-format".into(),
        "stream-json".into(),
        "--input-format".into(),
        "stream-json".into(),
        "--verbose".into(),
        "--model".into(),
        model.into(),
    ];
    // Stage A finding: `--tools ""` (NOT `--allowed-tools ""`) is the
    // flag that empties the tool definition list. With no tools in
    // sight, the model has no choice but to answer in text — required
    // for the ingest JSON path.
    if disable_tools {
        args.push("--tools".into());
        args.push(String::new());
    }
    // `--system-prompt-file` replaces the default system prompt
    // wholesale, matching `--system-prompt` semantics while avoiding a
    // long/quote-heavy command-line argument. This is also friendlier to
    // Windows npm `.cmd` shims.
    if let Some(path) = system_prompt_file {
        args.push("--system-prompt-file".into());
        args.push(path.to_string_lossy().into_owned());
    }
    args
}

fn write_system_prompt_file(system_prompt: &str) -> Result<PathBuf, String> {
    let path = std::env::temp_dir().join(format!(
        "llm-wiki-claude-system-prompt-{}.md",
        Uuid::new_v4()
    ));
    std::fs::write(&path, system_prompt)
        .map_err(|e| format!("Failed to write claude system prompt file: {e}"))?;
    Ok(path)
}

#[cfg(windows)]
fn is_windows_batch_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("cmd") || ext.eq_ignore_ascii_case("bat"))
        .unwrap_or(false)
}

#[cfg(windows)]
fn quote_cmd_arg(arg: &str) -> String {
    if arg.is_empty() {
        return "\"\"".to_string();
    }

    let mut quoted = String::from("\"");
    for ch in arg.chars() {
        match ch {
            '"' => quoted.push_str("\\\""),
            // Escape cmd metacharacters so arguments are not interpreted
            // by the shell wrapper needed for npm-installed .cmd shims.
            '^' | '&' | '|' | '<' | '>' | '(' | ')' | '%' | '!' => {
                quoted.push('^');
                quoted.push(ch);
            }
            _ => quoted.push(ch),
        }
    }
    quoted.push('"');
    quoted
}

#[cfg(windows)]
fn batch_command_line(program: &Path, args: &[String]) -> String {
    let mut parts = Vec::with_capacity(args.len() + 1);
    parts.push(quote_cmd_arg(program.to_string_lossy().as_ref()));
    parts.extend(args.iter().map(|arg| quote_cmd_arg(arg)));
    parts.join(" ")
}

fn claude_command(program: &Path, args: &[String]) -> Command {
    #[cfg(windows)]
    {
        if is_windows_batch_file(program) {
            let mut cmd = Command::new("cmd.exe");
            cmd.arg("/d")
                .arg("/c")
                .arg(batch_command_line(program, args));
            return cmd;
        }
    }

    let mut cmd = Command::new(program);
    for arg in args {
        cmd.arg(arg);
    }
    cmd
}

/// Spawn `claude -p --output-format stream-json --input-format stream-json
/// --verbose --model <model>` and pipe stdout back to the frontend as
/// `claude-cli:{stream_id}` events (one line per event). Closes stdin
/// after writing the serialized history so claude starts processing.
/// Emits a final `claude-cli:{stream_id}:done` event with `{ code }`
/// when the child exits.
///
/// Optional ingest-only knobs (chat callers leave these unset):
///   - `disable_tools`: append `--tools ""` to remove tool definitions.
///   - `system_prompt`: replace the default system prompt entirely.
///   - `cwd`: run the child in this directory (overrides app cwd).
#[tauri::command]
pub async fn claude_cli_spawn(
    app: AppHandle,
    state: State<'_, ClaudeCliState>,
    stream_id: String,
    model: String,
    messages: Vec<ClaudeMessage>,
    disable_tools: Option<bool>,
    system_prompt: Option<String>,
    cwd: Option<String>,
) -> Result<(), String> {
    // Build the turn list: fold any system messages into a preamble on
    // the first user turn rather than using a CLI flag, because
    // --system-prompt / --append-system-prompt availability varies
    // across claude CLI versions. Inlining works on every version.
    let system_preamble: String = messages
        .iter()
        .filter(|m| m.role == "system")
        .map(|m| m.content.clone())
        .collect::<Vec<_>>()
        .join("\n\n");

    let conversation: Vec<&ClaudeMessage> = messages
        .iter()
        .filter(|m| m.role == "user" || m.role == "assistant")
        .collect();

    if conversation.is_empty() {
        return Err("No user/assistant messages to send to claude CLI".to_string());
    }

    // Synthesize turns with the preamble merged into the first user turn.
    let mut first_user_seen = false;
    let turns: Vec<(String, String)> = conversation
        .iter()
        .map(|m| {
            let role = m.role.clone();
            let mut content = m.content.clone();
            if !first_user_seen && role == "user" && !system_preamble.is_empty() {
                content = format!("{system_preamble}\n\n{content}");
                first_user_seen = true;
            }
            (role, content)
        })
        .collect();

    // Resolve the full path via `which` rather than passing a bare name.
    // On Windows, `Command::new("claude")` only finds `claude.exe`; the
    // npm-installed CLI ships as `claude.cmd`, which is invisible to a
    // bare-name spawn and shows up to the user as "CLI not found" even
    // though detection (which uses which::which) succeeded.
    let claude_path =
        which::which("claude").map_err(|_| "`claude` not found on PATH".to_string())?;

    let system_prompt_file = match system_prompt.as_deref() {
        Some(prompt) => Some(write_system_prompt_file(prompt)?),
        None => None,
    };

    let cli_args = build_cli_args(
        &model,
        disable_tools.unwrap_or(false),
        system_prompt_file.as_deref(),
    );

    let mut cmd = claude_command(&claude_path, &cli_args);
    if let Some(dir) = cwd.as_deref() {
        cmd.current_dir(dir);
    }

    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = cmd.spawn().map_err(|e| {
        if let Some(path) = system_prompt_file.as_deref() {
            let _ = std::fs::remove_file(path);
        }
        format!("Failed to spawn claude: {e}")
    })?;

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

    // Serialize turns to stdin then close. stream-json input format
    // expects one JSON event per line. Conversation history is laid out
    // in order; the final user turn triggers claude's response.
    //
    // `content` MUST be an array of blocks, not a plain string. The CLI
    // iterates content blocks looking for `tool_use_id` and crashes with
    // `W is not an Object. (evaluating '"tool_use_id"in W')` if it
    // encounters a raw string. User turns silently tolerated a string
    // in light testing, but assistant turns reject it immediately, so
    // we normalize both roles to the block-array form.
    for (role, content) in &turns {
        let event = serde_json::json!({
            "type": role,
            "message": {
                "role": role,
                "content": [{ "type": "text", "text": content }],
            }
        });
        let line = format!("{}\n", event);
        stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|e| format!("Failed to write to claude stdin: {e}"))?;
    }
    stdin
        .flush()
        .await
        .map_err(|e| format!("Failed to flush claude stdin: {e}"))?;
    drop(stdin);

    // Register the child so `claude_cli_kill` can reach it.
    state.children.lock().await.insert(stream_id.clone(), child);

    let children = Arc::clone(&state.children);
    let app_for_task = app.clone();
    let stream_id_task = stream_id.clone();
    let topic = format!("claude-cli:{stream_id}");
    let done_topic = format!("claude-cli:{stream_id}:done");
    let system_prompt_file_task = system_prompt_file.clone();

    // Drain stdout line-by-line in a background task, emitting each
    // line as an event. Completes when stdout closes (child exited).
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        let mut stderr_reader = BufReader::new(stderr).lines();
        let app = app_for_task;

        // Collect stderr in a background task so we can ship it with the
        // final :done event — otherwise a non-zero exit produces only
        // "exited with code N" with no diagnostic info on the frontend.
        // Also echo each line to the tauri dev terminal so the developer
        // can watch the CLI's stderr live while iterating.
        let stderr_task = tokio::spawn(async move {
            let mut collected = String::new();
            while let Ok(Some(line)) = stderr_reader.next_line().await {
                eprintln!("[claude-cli stderr] {line}");
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
                    eprintln!("[claude-cli stdout] read error: {e}");
                    break;
                }
            }
        }

        // Wait for the child to fully exit so we can report its code.
        // Don't hold the map lock across .wait() — kill could race.
        let child_opt = children.lock().await.remove(&stream_id_task);
        let exit_code = if let Some(mut child) = child_opt {
            match child.wait().await {
                Ok(status) => status.code(),
                Err(_) => None,
            }
        } else {
            // Already removed by claude_cli_kill — leave code as None.
            None
        };

        let stderr_text = stderr_task.await.unwrap_or_default();
        if let Some(path) = system_prompt_file_task {
            let _ = std::fs::remove_file(path);
        }

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

/// Kill a running child registered under `stream_id`. Called on
/// AbortSignal in the frontend. No-op if the id is unknown (e.g. the
/// process already exited).
#[tauri::command]
pub async fn claude_cli_kill(
    state: State<'_, ClaudeCliState>,
    stream_id: String,
) -> Result<(), String> {
    if let Some(mut child) = state.children.lock().await.remove(&stream_id) {
        let _ = child.start_kill();
        // Don't wait() here — the stdout-drain task already holds a
        // wait future elsewhere when it can. Dropping the handle is
        // enough; kill_on_drop ensures the SIGKILL is sent.
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn baseline(model: &str) -> Vec<String> {
        vec![
            "-p",
            "--output-format",
            "stream-json",
            "--input-format",
            "stream-json",
            "--verbose",
            "--model",
            model,
        ]
        .into_iter()
        .map(String::from)
        .collect()
    }

    #[test]
    fn baseline_args_unchanged_when_no_options() {
        // Chat callers pass disable_tools=false and no system_prompt.
        // Behavior must be identical to the pre-Stage-B implementation.
        let args = build_cli_args("claude-sonnet-4-5", false, None);
        assert_eq!(args, baseline("claude-sonnet-4-5"));
    }

    #[test]
    fn disable_tools_appends_empty_tools_flag() {
        let args = build_cli_args("m", true, None);
        let pos = args
            .iter()
            .position(|a| a == "--tools")
            .expect("--tools flag must be present");
        // The empty string immediately after is what tells the CLI
        // "no tools available" — non-empty values would whitelist tools.
        assert_eq!(args[pos + 1], "");
    }

    #[test]
    fn system_prompt_file_passes_path() {
        let path = Path::new("C:\\Temp\\prompt file.md");
        let args = build_cli_args("m", false, Some(path));
        let pos = args
            .iter()
            .position(|a| a == "--system-prompt-file")
            .expect("--system-prompt-file flag must be present");
        assert_eq!(args[pos + 1], path.to_string_lossy());
    }

    #[test]
    fn ingest_combo_has_both_flags() {
        let args = build_cli_args("m", true, Some(Path::new("prompt.md")));
        assert!(args.iter().any(|a| a == "--tools"));
        assert!(args.iter().any(|a| a == "--system-prompt-file"));
    }

    #[test]
    fn no_system_prompt_means_flag_absent() {
        // Important regression check: an unset Option must NOT emit
        // `--system-prompt` with an empty argument — that would
        // accidentally clobber the default system prompt for chat.
        let args = build_cli_args("m", false, None);
        assert!(!args.iter().any(|a| a == "--system-prompt-file"));
    }

    #[cfg(windows)]
    #[test]
    fn windows_batch_wrapper_preserves_empty_tools_arg() {
        let line = batch_command_line(
            Path::new("C:\\Program Files\\nodejs\\claude.cmd"),
            &[
                "--tools".to_string(),
                String::new(),
                "--model".to_string(),
                "m".to_string(),
            ],
        );
        assert!(line.contains("\"--tools\" \"\" \"--model\""));
    }
}
