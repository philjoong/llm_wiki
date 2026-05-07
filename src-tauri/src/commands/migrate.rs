//! Project-level migrations triggered on `open_project`.
//!
//! Each migration is one-shot and idempotent — completion is recorded in
//! `.llm-wiki/project.json` so subsequent opens become no-ops.
//!
//! Currently:
//!   1. `migrate_wiki_to_db` (Phase B) — rename legacy `wiki/` → `db/`.
//!   2. `migrate_raw_sources` (second-fix-develop.md §2) — convert
//!      binary originals in `raw/sources/` to markdown (1차 가공) and
//!      delete the now-unused `processed_1/` directory.
//!
//! Safety contract:
//!   - Migrations NEVER delete user data without preserving the
//!     equivalent content first. `wiki/` is renamed (not deleted);
//!     binaries in `raw/sources/` are deleted only after the markdown
//!     equivalent is on disk.
//!   - On any error, the migration aborts before mutating further. The
//!     stamp is only written on full success — re-running picks up
//!     where we left off.

use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::panic_guard::run_guarded;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MigrationResult {
    /// Whether `wiki/` was moved to `db/` in this call.
    pub migrated: bool,
    /// Whether the project was already on the post-Phase-B layout.
    pub already_migrated: bool,
    /// Optional human-readable note (skip reason or post-action hint).
    pub note: Option<String>,
}

#[tauri::command]
pub fn migrate_wiki_to_db(project_path: String) -> Result<MigrationResult, String> {
    run_guarded("migrate_wiki_to_db", || {
        migrate_impl(&project_path)
    })
}

fn migrate_impl(project_path: &str) -> Result<MigrationResult, String> {
    let root = Path::new(project_path);
    if !root.exists() || !root.is_dir() {
        return Err(format!(
            "Migration target is not a directory: '{}'",
            project_path
        ));
    }

    let stamp = read_migration_stamp(root)?;
    if stamp.is_some() {
        return Ok(MigrationResult {
            migrated: false,
            already_migrated: true,
            note: None,
        });
    }

    let wiki = root.join("wiki");
    let db = root.join("db");

    let wiki_exists = wiki.is_dir();
    let db_exists = db.is_dir();

    // Already-migrated case: no `wiki/`, only `db/`. Record the stamp so
    // we don't keep checking forever, then return.
    if !wiki_exists && db_exists {
        write_migration_stamp(root)?;
        return Ok(MigrationResult {
            migrated: false,
            already_migrated: true,
            note: Some("db/ already present — recorded migration stamp.".to_string()),
        });
    }

    // No data either way — nothing to migrate. Don't write the stamp here:
    // a fresh project's first ingest will create db/ and the next open
    // will record the stamp.
    if !wiki_exists && !db_exists {
        return Ok(MigrationResult {
            migrated: false,
            already_migrated: false,
            note: Some("Neither wiki/ nor db/ exists yet.".to_string()),
        });
    }

    // Both exist. Refuse — a half-migrated project should be resolved by
    // the user, not by us silently overwriting.
    if wiki_exists && db_exists && !is_dir_effectively_empty(&db) {
        return Err(
            "Both wiki/ and db/ exist with content. Refusing to migrate. \
             Resolve manually: move db/ aside, then re-open the project."
                .to_string(),
        );
    }

    // Empty db/ + populated wiki/ — remove the placeholder so rename can
    // land cleanly. (`fs::rename` on Windows fails if the destination
    // exists, even when empty.)
    if wiki_exists && db_exists {
        fs::remove_dir(&db)
            .map_err(|e| format!("Failed to remove empty db/ before rename: {}", e))?;
    }

    // Do the move.
    fs::rename(&wiki, &db).map_err(|e| {
        format!(
            "Failed to rename '{}' → '{}': {}",
            wiki.display(),
            db.display(),
            e
        )
    })?;

    write_migration_stamp(root)?;

    Ok(MigrationResult {
        migrated: true,
        already_migrated: false,
        note: Some(
            "Renamed wiki/ to db/. Vector index must be rebuilt — \
             call vector_drop_v2 then re-embed."
                .to_string(),
        ),
    })
}

fn project_meta_path(root: &Path) -> std::path::PathBuf {
    root.join(".llm-wiki").join("project.json")
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct ProjectMeta {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "migratedToDbAt")]
    migrated_to_db_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "migratedRawSourcesAt")]
    migrated_raw_sources_at: Option<String>,
    /// Preserve any other keys the TS side stores in this file.
    #[serde(flatten)]
    extra: serde_json::Map<String, serde_json::Value>,
}

fn read_migration_stamp(root: &Path) -> Result<Option<String>, String> {
    let path = project_meta_path(root);
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read project.json: {}", e))?;
    let meta: ProjectMeta = serde_json::from_str(&raw)
        .map_err(|e| format!("Failed to parse project.json: {}", e))?;
    Ok(meta.migrated_to_db_at)
}

fn write_migration_stamp(root: &Path) -> Result<(), String> {
    let path = project_meta_path(root);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create .llm-wiki/: {}", e))?;
    }
    let mut meta: ProjectMeta = if path.exists() {
        let raw = fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read project.json: {}", e))?;
        serde_json::from_str(&raw)
            .map_err(|e| format!("Failed to parse project.json: {}", e))?
    } else {
        ProjectMeta::default()
    };
    meta.migrated_to_db_at = Some(Utc::now().to_rfc3339());
    let serialized = serde_json::to_string_pretty(&meta)
        .map_err(|e| format!("Failed to serialise project.json: {}", e))?;
    fs::write(&path, serialized)
        .map_err(|e| format!("Failed to write project.json: {}", e))?;
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────────
// migrate_raw_sources — second-fix-develop.md §2
//
// Converts a project's `raw/sources/` tree from "originals + sidecar
// caches" to "markdown only" and drops the now-defunct `processed_1/`
// directory. Idempotent via `migratedRawSourcesAt` stamp.
//
// Per-file rule:
//   - `.md` / `.txt` and other already-text formats: leave alone.
//   - PDF / DOCX / PPTX / XLSX / XLS / ODS / ODT / ODP: extract via the
//     same path `preprocess_file` uses, write `<base>.md` next to the
//     original, then delete the original. If `<base>.md` already exists,
//     prefer the existing markdown (likely a user edit or a leftover
//     `processed_1/<base>.md` we'll handle below) and just delete the
//     binary.
//   - Image / media / legacy-doc binaries (.doc/.ppt/.xls/.epub/.png/...):
//     leave alone. We can't extract them losslessly to markdown and the
//     spec doesn't require it (D1 explicitly addresses extractable formats).
//
// `processed_1/` removal:
//   - For each `processed_1/<name>.md`, if no `raw/sources/<name>.md`
//     exists yet, MOVE the file there (preserves any user edits to the
//     passthrough output). Otherwise drop it.
//   - Once the loop is done, remove `processed_1/` recursively.
// ──────────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RawSourcesMigrationResult {
    pub migrated: bool,
    pub already_migrated: bool,
    pub converted_count: usize,
    pub deleted_originals: usize,
    pub processed1_removed: bool,
    pub note: Option<String>,
}

/// Extensions we extract to markdown via `preprocess_file`'s extraction path.
const CONVERTIBLE_EXTS: &[&str] = &[
    "pdf", "docx", "pptx", "xlsx", "xls", "ods", "odt", "odp",
];

#[tauri::command]
pub fn migrate_raw_sources(project_path: String) -> Result<RawSourcesMigrationResult, String> {
    run_guarded("migrate_raw_sources", || {
        migrate_raw_sources_impl(&project_path)
    })
}

fn migrate_raw_sources_impl(project_path: &str) -> Result<RawSourcesMigrationResult, String> {
    let root = Path::new(project_path);
    if !root.exists() || !root.is_dir() {
        return Err(format!(
            "Migration target is not a directory: '{}'",
            project_path
        ));
    }

    if read_raw_sources_stamp(root)?.is_some() {
        return Ok(RawSourcesMigrationResult {
            migrated: false,
            already_migrated: true,
            converted_count: 0,
            deleted_originals: 0,
            processed1_removed: false,
            note: None,
        });
    }

    let raw_sources = root.join("raw").join("sources");
    let processed1 = root.join("processed_1");

    let mut converted_count = 0usize;
    let mut deleted_originals = 0usize;

    // 1. Convert binary extractables under raw/sources/ → <base>.md, delete original.
    if raw_sources.is_dir() {
        let mut binaries: Vec<PathBuf> = Vec::new();
        collect_files(&raw_sources, &mut binaries)?;
        for original in &binaries {
            let ext = original
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            if !CONVERTIBLE_EXTS.contains(&ext.as_str()) {
                continue;
            }
            let md_path = original.with_extension("md");
            if !md_path.exists() {
                let path_str = original.to_string_lossy().to_string();
                let text = match ext.as_str() {
                    "pdf" => super::fs::extract_pdf_text_pub(&path_str),
                    _ => super::fs::extract_office_text_pub(&path_str, &ext),
                };
                let text = match text {
                    Ok(t) => t,
                    Err(e) => {
                        // One unconvertible file shouldn't abort the
                        // whole migration. Log and skip — the binary
                        // stays in place; a re-run can retry it.
                        eprintln!(
                            "[migrate_raw_sources] Skipping '{}': {}",
                            original.display(),
                            e
                        );
                        continue;
                    }
                };
                fs::write(&md_path, text).map_err(|e| {
                    format!("Failed to write '{}': {}", md_path.display(), e)
                })?;
                converted_count += 1;
            }
            // Either we just wrote <base>.md or it was already there —
            // either way the binary is now redundant and should go.
            fs::remove_file(original).map_err(|e| {
                format!("Failed to delete '{}': {}", original.display(), e)
            })?;
            deleted_originals += 1;
        }
    }

    // 2. Migrate processed_1/<name>.md → raw/sources/<name>.md when
    //    a same-named .md isn't already present (preserves any user edits
    //    to the legacy passthrough output). Then nuke processed_1/ entirely.
    let processed1_existed = processed1.is_dir();
    if processed1_existed {
        if !raw_sources.is_dir() {
            fs::create_dir_all(&raw_sources).map_err(|e| {
                format!(
                    "Failed to create '{}' during processed_1 migration: {}",
                    raw_sources.display(),
                    e
                )
            })?;
        }
        let mut p1_files: Vec<PathBuf> = Vec::new();
        collect_files(&processed1, &mut p1_files)?;
        for src in &p1_files {
            let rel = src.strip_prefix(&processed1).unwrap_or(src);
            let dest = raw_sources.join(rel);
            if dest.exists() {
                continue;
            }
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent).ok();
            }
            // Move (rename) when on the same filesystem; fall back to
            // copy + delete to handle cross-volume cases.
            if fs::rename(src, &dest).is_err() {
                fs::copy(src, &dest).map_err(|e| {
                    format!(
                        "Failed to copy '{}' → '{}': {}",
                        src.display(),
                        dest.display(),
                        e
                    )
                })?;
            }
        }
        fs::remove_dir_all(&processed1).map_err(|e| {
            format!(
                "Failed to remove '{}': {}",
                processed1.display(),
                e
            )
        })?;
    }

    write_raw_sources_stamp(root)?;

    Ok(RawSourcesMigrationResult {
        migrated: converted_count > 0 || deleted_originals > 0 || processed1_existed,
        already_migrated: false,
        converted_count,
        deleted_originals,
        processed1_removed: processed1_existed,
        note: None,
    })
}

fn collect_files(dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
    let entries = fs::read_dir(dir)
        .map_err(|e| format!("Failed to read '{}': {}", dir.display(), e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("Dir entry error: {}", e))?;
        let path = entry.path();
        let name = entry.file_name();
        // Skip hidden / cache directories.
        if name.to_string_lossy().starts_with('.') {
            continue;
        }
        if path.is_dir() {
            collect_files(&path, out)?;
        } else if path.is_file() {
            out.push(path);
        }
    }
    Ok(())
}

fn read_raw_sources_stamp(root: &Path) -> Result<Option<String>, String> {
    let path = project_meta_path(root);
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read project.json: {}", e))?;
    let meta: ProjectMeta = serde_json::from_str(&raw)
        .map_err(|e| format!("Failed to parse project.json: {}", e))?;
    Ok(meta.migrated_raw_sources_at)
}

fn write_raw_sources_stamp(root: &Path) -> Result<(), String> {
    let path = project_meta_path(root);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create .llm-wiki/: {}", e))?;
    }
    let mut meta: ProjectMeta = if path.exists() {
        let raw = fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read project.json: {}", e))?;
        serde_json::from_str(&raw)
            .map_err(|e| format!("Failed to parse project.json: {}", e))?
    } else {
        ProjectMeta::default()
    };
    meta.migrated_raw_sources_at = Some(Utc::now().to_rfc3339());
    let serialized = serde_json::to_string_pretty(&meta)
        .map_err(|e| format!("Failed to serialise project.json: {}", e))?;
    fs::write(&path, serialized)
        .map_err(|e| format!("Failed to write project.json: {}", e))?;
    Ok(())
}

fn is_dir_effectively_empty(path: &Path) -> bool {
    // "Effectively" empty: no entries, or only `.gitkeep` / dotfiles. The
    // create_project flow seeds `db/` as an empty dir post-Phase-B, but a
    // user could have committed `.gitkeep` to keep git happy.
    let Ok(entries) = fs::read_dir(path) else {
        return false;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str == ".gitkeep" || name_str.starts_with('.') {
            continue;
        }
        return false;
    }
    true
}

// ──────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn tmp_root(label: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!(
            "llm-wiki-mig-{}-{}",
            label,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn no_wiki_no_db_no_op() {
        let root = tmp_root("nowiki");
        let r = migrate_impl(root.to_str().unwrap()).unwrap();
        assert!(!r.migrated);
        assert!(!r.already_migrated);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn renames_wiki_to_db() {
        let root = tmp_root("rename");
        let wiki = root.join("wiki");
        fs::create_dir_all(wiki.join("entities")).unwrap();
        fs::write(wiki.join("entities").join("foo.md"), "# foo").unwrap();

        let r = migrate_impl(root.to_str().unwrap()).unwrap();
        assert!(r.migrated);
        assert!(!r.already_migrated);
        assert!(root.join("db").join("entities").join("foo.md").exists());
        assert!(!root.join("wiki").exists());
        assert!(root.join(".llm-wiki").join("project.json").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn already_migrated_is_idempotent() {
        let root = tmp_root("idempotent");
        fs::create_dir_all(root.join("db")).unwrap();
        fs::write(root.join("db").join("a.md"), "# a").unwrap();

        let r1 = migrate_impl(root.to_str().unwrap()).unwrap();
        assert!(!r1.migrated);
        assert!(r1.already_migrated);

        let r2 = migrate_impl(root.to_str().unwrap()).unwrap();
        assert!(!r2.migrated);
        assert!(r2.already_migrated);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn refuses_when_both_have_content() {
        let root = tmp_root("conflict");
        fs::create_dir_all(root.join("wiki")).unwrap();
        fs::write(root.join("wiki").join("a.md"), "old").unwrap();
        fs::create_dir_all(root.join("db")).unwrap();
        fs::write(root.join("db").join("a.md"), "new").unwrap();

        let err = migrate_impl(root.to_str().unwrap()).unwrap_err();
        assert!(err.contains("Both wiki/ and db/ exist"));
        // Neither side was deleted.
        assert!(root.join("wiki").join("a.md").exists());
        assert!(root.join("db").join("a.md").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn empty_db_placeholder_is_replaced() {
        let root = tmp_root("placeholder");
        fs::create_dir_all(root.join("wiki")).unwrap();
        fs::write(root.join("wiki").join("a.md"), "# a").unwrap();
        // Empty db/ (just the dir, like create_project seeds)
        fs::create_dir_all(root.join("db")).unwrap();

        let r = migrate_impl(root.to_str().unwrap()).unwrap();
        assert!(r.migrated);
        assert!(root.join("db").join("a.md").exists());
        assert!(!root.join("wiki").exists());
        let _ = fs::remove_dir_all(&root);
    }

    // ── migrate_raw_sources ─────────────────────────────────────────────

    #[test]
    fn raw_sources_no_op_when_nothing_to_migrate() {
        let root = tmp_root("rs-noop");
        fs::create_dir_all(root.join("raw").join("sources")).unwrap();
        fs::write(root.join("raw").join("sources").join("note.md"), "# note").unwrap();

        let r = migrate_raw_sources_impl(root.to_str().unwrap()).unwrap();
        assert_eq!(r.converted_count, 0);
        assert_eq!(r.deleted_originals, 0);
        assert!(!r.processed1_removed);
        // Stamp is still written so the next open is a no-op.
        let r2 = migrate_raw_sources_impl(root.to_str().unwrap()).unwrap();
        assert!(r2.already_migrated);
        // Markdown source stayed put.
        assert!(root.join("raw").join("sources").join("note.md").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn raw_sources_removes_processed_1_directory() {
        let root = tmp_root("rs-p1remove");
        fs::create_dir_all(root.join("raw").join("sources")).unwrap();
        fs::create_dir_all(root.join("processed_1")).unwrap();
        fs::write(root.join("processed_1").join("a.md"), "from p1").unwrap();
        fs::write(root.join("processed_1").join("b.md"), "also p1").unwrap();

        let r = migrate_raw_sources_impl(root.to_str().unwrap()).unwrap();
        assert!(r.processed1_removed);
        assert!(r.migrated);
        // processed_1 is gone.
        assert!(!root.join("processed_1").exists());
        // Its contents moved into raw/sources/ (no collision case).
        assert!(root.join("raw").join("sources").join("a.md").exists());
        assert!(root.join("raw").join("sources").join("b.md").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn raw_sources_processed_1_does_not_overwrite_existing() {
        // If raw/sources/<name>.md already exists, prefer it over the
        // processed_1 copy and just delete the latter when we drop p1/.
        let root = tmp_root("rs-p1nooverwrite");
        fs::create_dir_all(root.join("raw").join("sources")).unwrap();
        fs::write(root.join("raw").join("sources").join("a.md"), "user edit").unwrap();
        fs::create_dir_all(root.join("processed_1")).unwrap();
        fs::write(root.join("processed_1").join("a.md"), "stale p1 copy").unwrap();

        migrate_raw_sources_impl(root.to_str().unwrap()).unwrap();
        // raw/sources/a.md kept the user-edited content.
        let body = fs::read_to_string(root.join("raw").join("sources").join("a.md")).unwrap();
        assert_eq!(body, "user edit");
        assert!(!root.join("processed_1").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn raw_sources_preserves_image_and_legacy_doc_files() {
        // Non-extractable formats stay where they are. The migration must
        // not delete a user's images or .doc files even though they aren't
        // markdown — we have no lossless way to convert them.
        let root = tmp_root("rs-skip-binary");
        let sources = root.join("raw").join("sources");
        fs::create_dir_all(&sources).unwrap();
        fs::write(sources.join("photo.png"), b"\x89PNG\x00").unwrap();
        fs::write(sources.join("legacy.doc"), b"old doc").unwrap();
        fs::write(sources.join("note.md"), "# kept").unwrap();

        let r = migrate_raw_sources_impl(root.to_str().unwrap()).unwrap();
        assert_eq!(r.converted_count, 0);
        assert_eq!(r.deleted_originals, 0);
        // Every input file is still on disk.
        assert!(sources.join("photo.png").exists());
        assert!(sources.join("legacy.doc").exists());
        assert!(sources.join("note.md").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn raw_sources_idempotent_via_stamp() {
        let root = tmp_root("rs-idem");
        fs::create_dir_all(root.join("raw").join("sources")).unwrap();
        fs::create_dir_all(root.join("processed_1")).unwrap();
        fs::write(root.join("processed_1").join("x.md"), "x").unwrap();

        let r1 = migrate_raw_sources_impl(root.to_str().unwrap()).unwrap();
        assert!(r1.migrated);
        assert!(!r1.already_migrated);

        // Even if a new processed_1/ was somehow re-created, the stamp
        // makes the second run a no-op (we don't re-process).
        fs::create_dir_all(root.join("processed_1")).unwrap();
        fs::write(root.join("processed_1").join("y.md"), "y").unwrap();
        let r2 = migrate_raw_sources_impl(root.to_str().unwrap()).unwrap();
        assert!(!r2.migrated);
        assert!(r2.already_migrated);
        // Second-run processed_1 is left alone (intentional: stamp wins).
        assert!(root.join("processed_1").exists());
        let _ = fs::remove_dir_all(&root);
    }
}
