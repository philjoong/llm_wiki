//! Local git CLI subprocess wrapper.
//!
//! Each ingest/modification action commits its result so users can review
//! changes with familiar git tools (log, diff, blame). We deliberately
//! shell out to the `git` binary instead of pulling in libgit2 — the user
//! sees the exact same repository state that any other git tool sees,
//! and we get all of git's edge-case handling for free.
//!
//! Why tokio::process directly: same reasoning as claude_cli.rs — the
//! shell plugin's scope model is awkward for a user-installed PATH binary,
//! and a hardcoded Rust command always-and-only spawns `git` which keeps
//! the security surface minimal.
//!
//! All commands are `#[tauri::command]` async functions and never use
//! AppHandle/State, so they're directly callable from `#[cfg(test)]` too.

use std::path::Path;
use std::process::Stdio;

use serde::{Deserialize, Serialize};
use tokio::process::Command;

const GIT_NOT_INSTALLED: &str =
    "git이 설치되어 있지 않습니다. https://git-scm.com 에서 설치하세요.";

fn locate_git() -> Result<std::path::PathBuf, String> {
    which::which("git").map_err(|_| GIT_NOT_INSTALLED.to_string())
}

/// Spawn `git <args>` in `project_path`, capture stdout/stderr, return the
/// raw `Output`. Caller decides what to do with non-zero exits — some
/// commands (notably `git diff --cached --quiet`) intentionally return
/// non-zero as a signal, not an error.
async fn run_git(
    project_path: &str,
    args: &[&str],
) -> Result<std::process::Output, String> {
    let git = locate_git()?;
    let mut cmd = Command::new(&git);
    cmd.current_dir(project_path)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    cmd.output()
        .await
        .map_err(|e| format!("git {} 실패: {}", args.join(" "), e))
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CommitResult {
    pub committed: bool,
    pub commit_hash: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct StatusEntry {
    /// Two-character porcelain status code (e.g. "M ", " M", "??", "A ").
    pub xy: String,
    pub path: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct CommitInfo {
    pub hash: String,
    pub author: String,
    /// ISO 8601 author date.
    pub date: String,
    pub message: String,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    /// One of "A" / "M" / "D" / "R" / "C" / "T" — git's --name-status code.
    pub status: String,
    pub additions: u32,
    pub deletions: u32,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetail {
    pub hash: String,
    pub author: String,
    /// ISO 8601 author date.
    pub date: String,
    /// Full commit message — subject + body.
    pub message: String,
    pub files: Vec<FileChange>,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RevertResult {
    pub committed: bool,
    pub commit_hash: Option<String>,
    /// Non-empty when revert produced merge conflicts the user must
    /// resolve manually. We do NOT auto-resolve or auto-abort — the
    /// user sees the same conflict state any external git tool would.
    pub conflicts: Vec<String>,
}

/// Initialize a git repo at `project_path` if `.git` doesn't exist, then
/// stage everything bootstrapped by `initProject` (the system-prefix
/// `.gitkeep`s, exclusion seeds, graph policy, and any other files
/// already on disk) and create the initial commit.
///
/// Idempotent: if `.git` already exists, returns Ok(()) without touching
/// anything.
#[tauri::command]
pub async fn git_init(project_path: String) -> Result<(), String> {
    let path = Path::new(&project_path);
    if path.join(".git").exists() {
        return Ok(());
    }

    // Use `init.defaultBranch=main` via -c to avoid the "main vs master"
    // discrepancy across git versions / user defaults.
    let init_out = run_git(
        &project_path,
        &["-c", "init.defaultBranch=main", "init"],
    )
    .await?;
    if !init_out.status.success() {
        let err = String::from_utf8_lossy(&init_out.stderr).to_string();
        return Err(format!("git init 실패: {}", err.trim()));
    }

    // If the user has no global git identity configured, `git commit`
    // will fail with "Please tell me who you are". Set a project-local
    // fallback identity ONLY when global is unset — local always
    // overrides global, so writing it unconditionally would silently
    // shadow the user's real identity in every other commit they make
    // in this repo.
    let global_name =
        run_git(&project_path, &["config", "--global", "--get", "user.name"]).await?;
    if !global_name.status.success() {
        let _ = run_git(
            &project_path,
            &["config", "--local", "user.name", "LLM Wiki"],
        )
        .await?;
    }
    let global_email =
        run_git(&project_path, &["config", "--global", "--get", "user.email"]).await?;
    if !global_email.status.success() {
        let _ = run_git(
            &project_path,
            &["config", "--local", "user.email", "llm-wiki@local"],
        )
        .await?;
    }

    // Stage everything currently on disk under the project root. -A picks
    // up new files, modifications, AND deletions. At init time the dir
    // contains only the bootstrap `.gitkeep`s, exclusion seeds, and
    // graph policy — all of which are new.
    let add_out = run_git(&project_path, &["add", "-A"]).await?;
    if !add_out.status.success() {
        let err = String::from_utf8_lossy(&add_out.stderr).to_string();
        return Err(format!("git add 실패: {}", err.trim()));
    }

    let commit_out = run_git(
        &project_path,
        &["commit", "-m", "init: bootstrap project"],
    )
    .await?;
    if !commit_out.status.success() {
        let err = String::from_utf8_lossy(&commit_out.stderr).to_string();
        return Err(format!("git commit 실패: {}", err.trim()));
    }

    Ok(())
}

/// Stage `paths` (relative to `project_path`) and commit with `message`.
/// Returns `{ committed: false }` if there are no staged changes after
/// `git add` — never uses `--allow-empty`. Removed files are handled
/// because `git add -- <pathspec>` includes deletions for paths that
/// match an existing tracked file.
#[tauri::command]
pub async fn git_commit(
    project_path: String,
    message: String,
    paths: Vec<String>,
) -> Result<CommitResult, String> {
    if paths.is_empty() {
        return Ok(CommitResult {
            committed: false,
            commit_hash: None,
        });
    }

    // Build "git add -- <p1> <p2> ...". The `--` is critical: without it,
    // a path that starts with `-` would be interpreted as a flag.
    let mut add_args: Vec<&str> = vec!["add", "--"];
    for p in &paths {
        add_args.push(p);
    }
    let add_out = run_git(&project_path, &add_args).await?;
    if !add_out.status.success() {
        let err = String::from_utf8_lossy(&add_out.stderr).to_string();
        return Err(format!("git add 실패: {}", err.trim()));
    }

    // `git diff --cached --quiet` exits 0 if there's NOTHING staged, 1
    // if there is. Anything else is an error we don't recognize. Use
    // this instead of parsing porcelain status — it's purpose-built.
    let diff_out = run_git(&project_path, &["diff", "--cached", "--quiet"]).await?;
    let exit_code = diff_out.status.code().unwrap_or(-1);
    match exit_code {
        0 => {
            // Nothing staged — paths matched but didn't change tracked
            // contents. No commit, no error.
            return Ok(CommitResult {
                committed: false,
                commit_hash: None,
            });
        }
        1 => { /* changes staged, proceed to commit */ }
        _ => {
            let err = String::from_utf8_lossy(&diff_out.stderr).to_string();
            return Err(format!("git diff --cached 실패 (code {}): {}", exit_code, err.trim()));
        }
    }

    let commit_out = run_git(&project_path, &["commit", "-m", &message]).await?;
    if !commit_out.status.success() {
        let err = String::from_utf8_lossy(&commit_out.stderr).to_string();
        return Err(format!("git commit 실패: {}", err.trim()));
    }

    let rev_out = run_git(&project_path, &["rev-parse", "HEAD"]).await?;
    let hash = if rev_out.status.success() {
        let s = String::from_utf8_lossy(&rev_out.stdout).trim().to_string();
        if s.is_empty() { None } else { Some(s) }
    } else {
        None
    };

    Ok(CommitResult {
        committed: true,
        commit_hash: hash,
    })
}

/// Return one entry per changed/untracked file in `project_path`. Uses
/// porcelain v2 with -z for unambiguous parsing of paths containing
/// whitespace.
#[tauri::command]
pub async fn git_status(project_path: String) -> Result<Vec<StatusEntry>, String> {
    let out = run_git(&project_path, &["status", "--porcelain=v2", "-z"]).await?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).to_string();
        return Err(format!("git status 실패: {}", err.trim()));
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    let mut entries: Vec<StatusEntry> = Vec::new();

    // porcelain v2 -z record formats:
    //   1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>\0          (changed)
    //   2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>\0<origPath>\0  (renamed/copied)
    //   ? <path>\0                                              (untracked)
    //   ! <path>\0                                              (ignored — only if --ignored)
    //   u ...                                                   (unmerged)
    //
    // We split on \0 and walk records; rename type 2 has a trailing
    // origPath we need to skip.
    let mut tokens = stdout.split('\0').peekable();
    while let Some(record) = tokens.next() {
        if record.is_empty() {
            continue;
        }
        let kind = record.as_bytes()[0];
        match kind {
            b'?' | b'!' => {
                // "? path" — single space then path.
                if record.len() >= 2 {
                    entries.push(StatusEntry {
                        xy: (record[..1]).to_string(),
                        path: record[2..].to_string(),
                    });
                }
            }
            b'1' => {
                // "1 XY sub mH mI mW hH hI path" — splitn 9 to keep paths intact
                let parts: Vec<&str> = record.splitn(9, ' ').collect();
                if parts.len() == 9 {
                    entries.push(StatusEntry {
                        xy: parts[1].to_string(),
                        path: parts[8].to_string(),
                    });
                }
            }
            b'2' => {
                let parts: Vec<&str> = record.splitn(10, ' ').collect();
                if parts.len() == 10 {
                    entries.push(StatusEntry {
                        xy: parts[1].to_string(),
                        path: parts[9].to_string(),
                    });
                }
                // Consume the origPath that follows the rename record.
                let _ = tokens.next();
            }
            b'u' => {
                let parts: Vec<&str> = record.splitn(11, ' ').collect();
                if parts.len() == 11 {
                    entries.push(StatusEntry {
                        xy: parts[1].to_string(),
                        path: parts[10].to_string(),
                    });
                }
            }
            _ => { /* unknown record type — skip */ }
        }
    }
    Ok(entries)
}

/// Return up to `limit` most-recent commits, newest first. Empty repo
/// (no commits yet) returns an empty list rather than an error.
#[tauri::command]
pub async fn git_log(
    project_path: String,
    limit: u32,
) -> Result<Vec<CommitInfo>, String> {
    let limit_str = limit.to_string();
    // Tab is a safe separator: commit hash, author name, ISO date, and
    // subject can't contain literal tabs in a normal git workflow. %x09
    // is a literal tab in pretty-format.
    let out = run_git(
        &project_path,
        &[
            "log",
            "--pretty=format:%H%x09%an%x09%aI%x09%s",
            "-n",
            &limit_str,
        ],
    )
    .await?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        // Empty repository — git exits non-zero with this message. Treat
        // it as "no commits" rather than an error.
        if stderr.contains("does not have any commits yet")
            || stderr.contains("bad default revision")
            || stderr.contains("unknown revision")
        {
            return Ok(Vec::new());
        }
        return Err(format!("git log 실패: {}", stderr.trim()));
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    let mut commits = Vec::new();
    for line in stdout.lines() {
        let parts: Vec<&str> = line.splitn(4, '\t').collect();
        if parts.len() == 4 {
            commits.push(CommitInfo {
                hash: parts[0].to_string(),
                author: parts[1].to_string(),
                date: parts[2].to_string(),
                message: parts[3].to_string(),
            });
        }
    }
    Ok(commits)
}

/// Show metadata + per-file change summary for a single commit.
///
/// Uses two passes:
///   1. `git show -s --format=...` for hash/author/date/message.
///   2. `git show --numstat --format= -- <hash>` for additions/deletions.
///   3. `git show --name-status --format= -- <hash>` for the A/M/D/R code.
///
/// We intentionally don't try to fold all three into one `git show` call —
/// the format strings get fragile with merge commits and we'd rather pay
/// three subprocess hops than ship a brittle parser.
#[tauri::command]
pub async fn git_show(
    project_path: String,
    hash: String,
) -> Result<CommitDetail, String> {
    // 1) Metadata. %B = full message (subject + body) so the UI can render
    // the bullet list ingest commits include.
    let meta = run_git(
        &project_path,
        &[
            "show",
            "-s",
            "--format=%H%x09%an%x09%aI%x09%B",
            &hash,
        ],
    )
    .await?;
    if !meta.status.success() {
        let err = String::from_utf8_lossy(&meta.stderr).to_string();
        return Err(format!("git show 실패: {}", err.trim()));
    }
    let meta_str = String::from_utf8_lossy(&meta.stdout).to_string();
    // Split off the first 3 tab-delimited fields, the rest is the message
    // (which can itself contain newlines).
    let mut parts = meta_str.splitn(4, '\t');
    let hash_out = parts.next().unwrap_or("").trim().to_string();
    let author = parts.next().unwrap_or("").to_string();
    let date = parts.next().unwrap_or("").to_string();
    let message = parts.next().unwrap_or("").trim_end().to_string();

    // 2) Numstat for additions/deletions per file.
    let numstat = run_git(
        &project_path,
        &["show", "--numstat", "--format=", &hash],
    )
    .await?;
    if !numstat.status.success() {
        let err = String::from_utf8_lossy(&numstat.stderr).to_string();
        return Err(format!("git show --numstat 실패: {}", err.trim()));
    }
    let numstat_str = String::from_utf8_lossy(&numstat.stdout);

    // 3) Name-status for A/M/D codes.
    let name_status = run_git(
        &project_path,
        &["show", "--name-status", "--format=", &hash],
    )
    .await?;
    if !name_status.status.success() {
        let err = String::from_utf8_lossy(&name_status.stderr).to_string();
        return Err(format!("git show --name-status 실패: {}", err.trim()));
    }
    let name_status_str = String::from_utf8_lossy(&name_status.stdout);

    // Index: path → status code. Renames produce "R<score>\told\tnew" — we
    // keep the new path so the UI can act on it directly.
    let mut status_by_path: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    for line in name_status_str.lines() {
        if line.is_empty() {
            continue;
        }
        let mut fields = line.split('\t');
        let code = fields.next().unwrap_or("").to_string();
        // Rename/copy: "R100\told\tnew" — take the "new" path.
        let path = if code.starts_with('R') || code.starts_with('C') {
            let _orig = fields.next();
            fields.next().unwrap_or("").to_string()
        } else {
            fields.next().unwrap_or("").to_string()
        };
        if !path.is_empty() {
            // Normalize to first character only so the union of statuses
            // we surface to the UI stays small (A/M/D/R/C/T).
            let short = code.chars().next().unwrap_or('?').to_string();
            status_by_path.insert(path, short);
        }
    }

    let mut files: Vec<FileChange> = Vec::new();
    for line in numstat_str.lines() {
        if line.is_empty() {
            continue;
        }
        // numstat: "<add>\t<del>\t<path>" (or "-\t-\t<path>" for binary).
        let parts: Vec<&str> = line.splitn(3, '\t').collect();
        if parts.len() != 3 {
            continue;
        }
        let additions = parts[0].parse::<u32>().unwrap_or(0);
        let deletions = parts[1].parse::<u32>().unwrap_or(0);
        // For renames numstat shows "old => new" or "{old => new}" syntax;
        // keep the raw form — the UI surfaces it as-is and name-status
        // will still register the new path under the same key for the
        // status lookup below in the common case.
        let path = parts[2].to_string();
        let status = status_by_path
            .get(&path)
            .cloned()
            .unwrap_or_else(|| "M".to_string());
        files.push(FileChange {
            path,
            status,
            additions,
            deletions,
        });
    }

    Ok(CommitDetail {
        hash: hash_out,
        author,
        date,
        message,
        files,
    })
}

/// Return unified diff text between `ref_a` and `ref_b`. If `path` is
/// provided, scope the diff to that single path. We don't try to parse —
/// the UI renders the raw diff.
#[tauri::command]
pub async fn git_diff(
    project_path: String,
    ref_a: String,
    ref_b: String,
    path: Option<String>,
) -> Result<String, String> {
    let mut args: Vec<&str> = vec!["diff", &ref_a, &ref_b];
    let path_owned;
    if let Some(p) = path.as_ref() {
        args.push("--");
        path_owned = p.clone();
        args.push(&path_owned);
    }
    let out = run_git(&project_path, &args).await?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).to_string();
        return Err(format!("git diff 실패: {}", err.trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

/// Restore each path in `paths` to the version at `hash` in the working
/// tree only. Does NOT create a new commit on its own — the frontend
/// follows up with `git_commit` to record the restoration. This separation
/// mirrors how a human would do it (`git checkout <hash> -- file && git
/// commit`) and keeps the commit message authoring on the UI side where
/// translations and templating live.
#[tauri::command]
pub async fn git_checkout_path(
    project_path: String,
    hash: String,
    paths: Vec<String>,
) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    let mut args: Vec<&str> = vec!["checkout", &hash, "--"];
    for p in &paths {
        args.push(p);
    }
    let out = run_git(&project_path, &args).await?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).to_string();
        return Err(format!("git checkout 실패: {}", err.trim()));
    }
    Ok(())
}

/// Revert `hash` with --no-edit. On clean revert returns the new commit
/// hash. On conflict we DO NOT abort or auto-resolve — we list the
/// conflicting paths so the UI can surface them to the user, who then
/// resolves manually and commits via the normal path.
#[tauri::command]
pub async fn git_revert(
    project_path: String,
    hash: String,
) -> Result<RevertResult, String> {
    let out = run_git(&project_path, &["revert", "--no-edit", &hash]).await?;
    if out.status.success() {
        // Clean revert — pick up the new HEAD.
        let rev_out = run_git(&project_path, &["rev-parse", "HEAD"]).await?;
        let new_hash = if rev_out.status.success() {
            let s = String::from_utf8_lossy(&rev_out.stdout).trim().to_string();
            if s.is_empty() { None } else { Some(s) }
        } else {
            None
        };
        return Ok(RevertResult {
            committed: true,
            commit_hash: new_hash,
            conflicts: Vec::new(),
        });
    }

    // Non-zero exit: usually a merge conflict, sometimes an empty revert
    // ("nothing to commit"). Read porcelain v2 to detect "U" (unmerged)
    // entries — those are the conflict files we surface.
    let status = run_git(&project_path, &["status", "--porcelain=v2", "-z"]).await?;
    if status.status.success() {
        let stdout = String::from_utf8_lossy(&status.stdout);
        let mut conflicts: Vec<String> = Vec::new();
        for record in stdout.split('\0') {
            if record.starts_with('u') {
                let parts: Vec<&str> = record.splitn(11, ' ').collect();
                if parts.len() == 11 {
                    conflicts.push(parts[10].to_string());
                }
            }
        }
        if !conflicts.is_empty() {
            return Ok(RevertResult {
                committed: false,
                commit_hash: None,
                conflicts,
            });
        }
    }

    let err = String::from_utf8_lossy(&out.stderr).to_string();
    Err(format!("git revert 실패: {}", err.trim()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn make_tmpdir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "llm-wiki-git-ops-test-{}-{}",
            tag,
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn cleanup(dir: &Path) {
        let _ = fs::remove_dir_all(dir);
    }

    /// One full lifecycle: init → commit a file → log → commit again
    /// → status. Mirrors what ingest will do at runtime.
    #[tokio::test]
    async fn init_commit_log_cycle() {
        // Skip silently if git isn't on PATH (CI without git, etc.).
        if which::which("git").is_err() {
            return;
        }
        let dir = make_tmpdir("cycle");
        let p = dir.to_string_lossy().to_string();

        // Bootstrap files the way initProject would.
        fs::create_dir_all(dir.join("db")).unwrap();
        fs::write(dir.join("db/.gitkeep"), "").unwrap();
        fs::create_dir_all(dir.join("pending")).unwrap();
        fs::write(dir.join("pending/.gitkeep"), "").unwrap();

        git_init(p.clone()).await.expect("git_init");

        // Initial commit should exist.
        let log1 = git_log(p.clone(), 10).await.expect("git_log 1");
        assert_eq!(log1.len(), 1, "expected 1 commit after init, got {:?}", log1);
        assert_eq!(log1[0].message, "init: bootstrap project");

        // Second commit: write a new file and commit explicitly.
        fs::create_dir_all(dir.join("db/foo")).unwrap();
        fs::write(dir.join("db/foo/bar.md"), "# bar").unwrap();
        let commit = git_commit(
            p.clone(),
            "ingest: bar.md → 1 page".to_string(),
            vec!["db/foo/bar.md".to_string()],
        )
        .await
        .expect("git_commit");
        assert!(commit.committed, "expected committed=true");
        assert!(commit.commit_hash.is_some(), "expected hash on real commit");

        let log2 = git_log(p.clone(), 10).await.expect("git_log 2");
        assert_eq!(log2.len(), 2, "expected 2 commits, got {:?}", log2);
        assert_eq!(log2[0].message, "ingest: bar.md → 1 page");

        // No-op commit: nothing changed since last commit.
        let noop = git_commit(
            p.clone(),
            "should not happen".to_string(),
            vec!["db/foo/bar.md".to_string()],
        )
        .await
        .expect("git_commit no-op");
        assert!(!noop.committed, "expected committed=false on no-op");
        assert!(noop.commit_hash.is_none());

        // git_log should still show 2 commits.
        let log3 = git_log(p.clone(), 10).await.expect("git_log 3");
        assert_eq!(log3.len(), 2);

        // git_status on a clean tree should be empty.
        let status_clean = git_status(p.clone()).await.expect("git_status clean");
        assert!(status_clean.is_empty(), "expected clean tree, got {:?}", status_clean);

        // Add an untracked file → status should report it.
        fs::write(dir.join("untracked.md"), "x").unwrap();
        let status_dirty = git_status(p.clone()).await.expect("git_status dirty");
        assert!(
            status_dirty.iter().any(|e| e.path == "untracked.md" && e.xy == "?"),
            "expected untracked.md, got {:?}",
            status_dirty
        );

        cleanup(&dir);
    }

    /// Empty paths short-circuits to no-op without invoking git.
    #[tokio::test]
    async fn commit_with_empty_paths_is_noop() {
        let dir = make_tmpdir("empty");
        let res = git_commit(
            dir.to_string_lossy().to_string(),
            "anything".to_string(),
            vec![],
        )
        .await
        .expect("git_commit empty");
        assert!(!res.committed);
        assert!(res.commit_hash.is_none());
        cleanup(&dir);
    }

    /// Calling git_init twice is idempotent — the second call is a no-op
    /// even though .git already exists.
    #[tokio::test]
    async fn init_is_idempotent() {
        if which::which("git").is_err() {
            return;
        }
        let dir = make_tmpdir("idem");
        let p = dir.to_string_lossy().to_string();
        fs::write(dir.join("db/.gitkeep"), "# bootstrap").unwrap();

        git_init(p.clone()).await.expect("first init");
        let log1 = git_log(p.clone(), 10).await.unwrap();
        assert_eq!(log1.len(), 1);

        git_init(p.clone()).await.expect("second init");
        let log2 = git_log(p.clone(), 10).await.unwrap();
        assert_eq!(log2.len(), 1, "second init should not create a new commit");

        cleanup(&dir);
    }

    /// `git_show` returns a CommitDetail with the right files and diff
    /// counts. Two commits: initial + a follow-up that modifies one file
    /// and adds another. We assert against the second commit.
    #[tokio::test]
    async fn git_show_returns_commit_metadata_and_files() {
        if which::which("git").is_err() {
            return;
        }
        let dir = make_tmpdir("show");
        let p = dir.to_string_lossy().to_string();

        fs::write(dir.join("a.md"), "alpha\n").unwrap();
        git_init(p.clone()).await.expect("git_init");

        // Modify a.md and add b.md, then commit.
        fs::write(dir.join("a.md"), "alpha\nbeta\n").unwrap();
        fs::write(dir.join("b.md"), "new file\n").unwrap();
        git_commit(
            p.clone(),
            "second commit".to_string(),
            vec!["a.md".to_string(), "b.md".to_string()],
        )
        .await
        .expect("commit");

        let log = git_log(p.clone(), 10).await.unwrap();
        assert_eq!(log.len(), 2);
        let head_hash = log[0].hash.clone();
        assert_eq!(log[0].message, "second commit");

        let detail = git_show(p.clone(), head_hash.clone()).await.expect("git_show");
        assert_eq!(detail.hash, head_hash);
        assert_eq!(detail.message.trim_end(), "second commit");
        assert_eq!(detail.files.len(), 2, "expected 2 files, got {:?}", detail.files);
        let by_path: std::collections::HashMap<&str, &FileChange> =
            detail.files.iter().map(|f| (f.path.as_str(), f)).collect();
        let a = by_path.get("a.md").expect("a.md present");
        assert_eq!(a.status, "M");
        assert_eq!(a.additions, 1);
        let b = by_path.get("b.md").expect("b.md present");
        assert_eq!(b.status, "A");

        cleanup(&dir);
    }

    /// `git_diff` returns text containing `+`/`-` lines for a real change.
    #[tokio::test]
    async fn git_diff_between_refs() {
        if which::which("git").is_err() {
            return;
        }
        let dir = make_tmpdir("diff");
        let p = dir.to_string_lossy().to_string();

        fs::write(dir.join("a.md"), "alpha\n").unwrap();
        git_init(p.clone()).await.expect("git_init");

        fs::write(dir.join("a.md"), "alpha\nbeta\n").unwrap();
        git_commit(p.clone(), "add line".to_string(), vec!["a.md".to_string()])
            .await
            .expect("commit");

        let diff = git_diff(p.clone(), "HEAD~1".to_string(), "HEAD".to_string(), None)
            .await
            .expect("git_diff");
        assert!(diff.contains("+beta"), "expected +beta in diff, got: {}", diff);
        assert!(diff.contains("a.md"), "expected a.md in diff, got: {}", diff);

        // Path-scoped diff still includes the change.
        let scoped = git_diff(
            p.clone(),
            "HEAD~1".to_string(),
            "HEAD".to_string(),
            Some("a.md".to_string()),
        )
        .await
        .expect("git_diff scoped");
        assert!(scoped.contains("+beta"));

        cleanup(&dir);
    }

    /// `git_checkout_path` restores the working tree copy of a file from
    /// an older commit. It does NOT create a new commit on its own.
    #[tokio::test]
    async fn git_checkout_path_restores_old_version() {
        if which::which("git").is_err() {
            return;
        }
        let dir = make_tmpdir("checkout");
        let p = dir.to_string_lossy().to_string();

        fs::write(dir.join("a.md"), "v1\n").unwrap();
        git_init(p.clone()).await.expect("git_init");

        fs::write(dir.join("a.md"), "v2\n").unwrap();
        git_commit(p.clone(), "v2".to_string(), vec!["a.md".to_string()])
            .await
            .expect("commit");

        // After commit, working tree has v2.
        let after = fs::read_to_string(dir.join("a.md")).unwrap();
        assert_eq!(after, "v2\n");

        // Restore the v1 version from HEAD~1.
        git_checkout_path(
            p.clone(),
            "HEAD~1".to_string(),
            vec!["a.md".to_string()],
        )
        .await
        .expect("git_checkout_path");
        let restored = fs::read_to_string(dir.join("a.md")).unwrap();
        assert_eq!(restored, "v1\n", "working tree should be back at v1");

        // No new commit was created — log still has 2 entries.
        let log = git_log(p.clone(), 10).await.unwrap();
        assert_eq!(log.len(), 2);

        cleanup(&dir);
    }

    /// `git_revert(HEAD)` adds a new "Revert ..." commit that undoes the
    /// previous one. Plain non-conflicting case.
    #[tokio::test]
    async fn git_revert_creates_new_revert_commit() {
        if which::which("git").is_err() {
            return;
        }
        let dir = make_tmpdir("revert");
        let p = dir.to_string_lossy().to_string();

        fs::write(dir.join("a.md"), "v1\n").unwrap();
        git_init(p.clone()).await.expect("git_init");

        fs::write(dir.join("a.md"), "v2\n").unwrap();
        git_commit(p.clone(), "v2".to_string(), vec!["a.md".to_string()])
            .await
            .expect("commit");

        let head = git_log(p.clone(), 1).await.unwrap()[0].hash.clone();
        let res = git_revert(p.clone(), head).await.expect("git_revert");
        assert!(res.committed, "expected revert to commit cleanly");
        assert!(res.conflicts.is_empty());
        assert!(res.commit_hash.is_some());

        let log = git_log(p.clone(), 10).await.unwrap();
        assert_eq!(log.len(), 3, "expected 3 commits after revert");
        assert!(
            log[0].message.starts_with("Revert"),
            "expected Revert subject, got {}",
            log[0].message
        );

        // Working tree should be back at v1.
        let restored = fs::read_to_string(dir.join("a.md")).unwrap();
        assert_eq!(restored, "v1\n");

        cleanup(&dir);
    }
}
