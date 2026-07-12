use super::{error::{KnowledgeError, KnowledgeErrorCode}, schema::{SCHEMA_SQL, SCHEMA_VERSION}};
use rusqlite::{Connection, OpenFlags};
use std::{fs, path::{Path, PathBuf}};

pub fn path_for_project(project_path: &str) -> Result<PathBuf, KnowledgeError> {
    let dir = Path::new(project_path).join(".llm-wiki");
    fs::create_dir_all(&dir).map_err(|e| KnowledgeError::new(KnowledgeErrorCode::ValidationFailed, format!("Cannot create knowledge directory: {e}")))?;
    Ok(dir.join("knowledge.sqlite"))
}

fn error(message: impl Into<String>) -> KnowledgeError { KnowledgeError::new(KnowledgeErrorCode::SchemaVersionMismatch, message) }

pub fn open_project(project_path: &str, bootstrap: bool) -> Result<Connection, KnowledgeError> {
    let state_dir = Path::new(project_path).join(".llm-wiki");
    let path = state_dir.join("knowledge.sqlite");
    if bootstrap {
        fs::create_dir_all(&state_dir).map_err(|e| KnowledgeError::new(KnowledgeErrorCode::ValidationFailed, format!("Cannot create knowledge directory: {e}")))?;
    } else if !path.is_file() {
        return Err(error("Knowledge database is missing. This project uses an unsupported legacy format; create a new project and import a v2 export."));
    }
    let flags = if bootstrap {
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE
    } else {
        OpenFlags::SQLITE_OPEN_READ_WRITE
    };
    let conn = Connection::open_with_flags(&path, flags)
        .map_err(|e| error(format!("Cannot open knowledge database: {e}")))?;
    open_connection(conn, bootstrap)
}

/// Opens an externally chosen DB path too, which keeps integration tests honest.
pub fn open_connection(conn: Connection, bootstrap: bool) -> Result<Connection, KnowledgeError> {
    conn.execute_batch("PRAGMA foreign_keys = ON;").map_err(|e| error(e.to_string()))?;
    let foreign_keys: i64 = conn.query_row("PRAGMA foreign_keys", [], |row| row.get(0)).map_err(|e| error(e.to_string()))?;
    if foreign_keys != 1 { return Err(error("SQLite foreign key enforcement could not be enabled")); }
    let legacy: i64 = conn.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('nodes','edges')", [], |r| r.get(0)).map_err(|e| error(e.to_string()))?;
    if legacy > 0 { return Err(error("Legacy nodes/edges tables found; migration is required")); }
    let version: i32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).map_err(|e| error(e.to_string()))?;
    let table_count: i64 = conn.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'", [], |r| r.get(0)).map_err(|e| error(e.to_string()))?;
    if version == 0 && table_count == 0 && bootstrap {
        conn.execute_batch(SCHEMA_SQL).map_err(|e| error(format!("Cannot bootstrap knowledge schema: {e}")))?;
        conn.pragma_update(None, "user_version", SCHEMA_VERSION).map_err(|e| error(e.to_string()))?;
    } else if version != SCHEMA_VERSION || table_count == 0 {
        return Err(error(format!("Expected schema version {SCHEMA_VERSION}, found {version}")));
    }
    Ok(conn)
}
