//! Phase B migration: rename a project's `wiki/` tree to `db/`.
//!
//! Triggered automatically by the frontend on project open. The migration
//! is one-shot — completion is recorded in `.llm-wiki/project.json` so
//! subsequent opens become no-ops.
//!
//! Safety contract:
//!   - We NEVER delete `wiki/`. Either we move it intact to `db/` or we
//!     leave the project untouched and surface the error.
//!   - If `db/` already exists (and is non-empty), we refuse to migrate —
//!     the user has a partial / dual layout and human judgment is needed.
//!   - The LanceDB v2 chunks table is dropped on a successful migration so
//!     stale stem-only `page_id`s don't leak through Phase B's new
//!     relative-path encoding. The frontend triggers re-indexing.

use std::fs;
use std::path::Path;

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
}
