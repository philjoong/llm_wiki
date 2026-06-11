mod clip_server;
mod commands;
mod panic_guard;
mod types;

use panic_guard::run_guarded;
use tauri::{Emitter, Window};

#[tauri::command]
fn clip_server_status() -> String {
    run_guarded("clip_server_status", || {
        Ok(clip_server::get_daemon_status().to_string())
    })
    .unwrap_or_else(|e| format!("error: {e}"))
}

#[tauri::command]
fn set_window_title(window: Window, title: String) -> Result<(), String> {
    window
        .set_title(&title)
        .map_err(|e| format!("failed to set window title: {e}"))
}

#[tauri::command]
fn app_debug(message: String) {
    eprintln!("[app-debug] {message}");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    eprintln!("[tauri-debug] run: starting clip server");
    clip_server::start_clip_server();
    eprintln!("[tauri-debug] run: building tauri app");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        // Rust-backed fetch so third-party LLM APIs that reject
        // browser-origin headers via CORS preflight (MiniMax, Volcengine
        // Ark's api/coding/v3, etc.) still work. Requests leave the app
        // from Rust, never the webview.
        .plugin(tauri_plugin_http::init())
        .on_page_load(|webview, payload| {
            eprintln!(
                "[tauri-debug] page-load: label={} url={}",
                webview.label(),
                payload.url()
            );
        })
        .setup(|app| {
            eprintln!("[tauri-debug] setup: start");
            // Let the PDF extractor find the bundled pdfium dynamic
            // library via Tauri's platform-correct resource path.
            use tauri::Manager;
            if let Ok(dir) = app.path().resource_dir() {
                eprintln!("[tauri-debug] setup: resource_dir={}", dir.display());
                commands::fs::set_resource_dir_hint(dir);
            } else {
                eprintln!("[tauri-debug] setup: resource_dir unavailable");
            }

            // Registry of running `claude` subprocesses, keyed by the
            // frontend-generated stream id. Populated by claude_cli_spawn,
            // drained on process exit or by claude_cli_kill.
            app.manage(commands::claude_cli::ClaudeCliState::default());
            // Same pattern for the codex / gemini CLI providers — each
            // owns its own child registry so kill targets the right pid.
            app.manage(commands::codex_cli::CodexCliState::default());
            app.manage(commands::gemini_cli::GeminiCliState::default());
            eprintln!("[tauri-debug] setup: finished");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_window_title,
            commands::fs::read_file,
            commands::fs::write_file,
            commands::fs::list_directory,
            commands::fs::copy_file,
            commands::fs::copy_directory,
            commands::fs::preprocess_file,
            commands::fs::delete_file,
            commands::fs::find_related_wiki_pages,
            commands::fs::create_directory,
            commands::fs::file_exists,
            commands::fs::seed_question_types,
            commands::fs::project_export,
            commands::fs::project_import,
            commands::project::create_project,
            commands::project::open_project,
            commands::migrate::migrate_raw_sources,
            clip_server_status,
            app_debug,
            commands::vectorstore::vector_upsert,
            commands::vectorstore::vector_search,
            commands::vectorstore::vector_delete,
            commands::vectorstore::vector_count,
            commands::vectorstore::vector_upsert_chunks,
            commands::vectorstore::vector_search_chunks,
            commands::vectorstore::vector_delete_page,
            commands::vectorstore::vector_count_chunks,
            commands::vectorstore::vector_legacy_row_count,
            commands::vectorstore::vector_drop_legacy,
            commands::vectorstore::vector_drop_v2,
            commands::vectorstore::embed_text_builtin,
            commands::claude_cli::claude_cli_detect,
            commands::claude_cli::claude_cli_spawn,
            commands::claude_cli::claude_cli_kill,
            commands::codex_cli::codex_cli_detect,
            commands::codex_cli::codex_cli_spawn,
            commands::codex_cli::codex_cli_kill,
            commands::gemini_cli::gemini_cli_detect,
            commands::gemini_cli::gemini_cli_spawn,
            commands::gemini_cli::gemini_cli_kill,
            commands::git_ops::git_init,
            commands::git_ops::git_commit,
            commands::git_ops::git_status,
            commands::git_ops::git_log,
            commands::git_ops::git_show,
            commands::git_ops::git_diff,
            commands::git_ops::git_checkout_path,
            commands::git_ops::git_revert,
            commands::git_ops::git_ls_remote,
            commands::git_ops::git_setup_from_remote,
            commands::git_ops::git_create_branch,
            commands::git_ops::git_remote_add,
            commands::git_ops::git_push,
            commands::git_ops::git_pull,
            commands::graph_db::graph_db_create,
            commands::graph_db::graph_db_delete,
            commands::graph_db::graph_db_list,
            commands::graph_db::graph_db_query,
            commands::graph_db::graph_db_ping,
            commands::graph_db::graph_db_export,
            commands::graph_db::graph_db_import,
            commands::vc_db::vc_db_init,
            commands::vc_db::vc_db_save_snapshot,
            commands::vc_db::vc_db_get_snapshot,
            commands::vc_db::vc_db_record_commit,
            commands::vc_db::vc_db_set_meta,
            commands::vc_db::vc_db_get_meta,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                #[cfg(target_os = "macos")]
                {
                    let _ = window.hide();
                    api.prevent_close();
                }

                #[cfg(not(target_os = "macos"))]
                {
                    api.prevent_close();
                    let _ = window.emit("tauri://close-requested", ());
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { has_visible_windows, .. } = event {
                if !has_visible_windows {
                    use tauri::Manager;
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
            let _ = (app, event); // suppress unused warnings on non-macOS
        });
}
