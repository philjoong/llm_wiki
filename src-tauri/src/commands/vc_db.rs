use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug)]
pub struct VCCommit {
    pub hash: String,
    pub author: String,
    pub date: String,
    pub message: String,
}

fn get_conn(project_path: &str) -> Result<Connection, String> {
    let db_path = Path::new(project_path).join("vc.db");
    Connection::open(db_path).map_err(|e| format!("SQLite 연결 실패: {}", e))
}

#[tauri::command]
pub async fn vc_db_init(project_path: String) -> Result<(), String> {
    let conn = get_conn(&project_path)?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS project_meta (
            key TEXT PRIMARY KEY,
            value TEXT
        )",
        [],
    ).map_err(|e| format!("project_meta 테이블 생성 실패: {}", e))?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS commits (
            hash TEXT PRIMARY KEY,
            author TEXT,
            date TEXT,
            message TEXT
        )",
        [],
    ).map_err(|e| format!("commits 테이블 생성 실패: {}", e))?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS graph_snapshots (
            commit_hash TEXT PRIMARY KEY,
            snapshot TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(commit_hash) REFERENCES commits(hash)
        )",
        [],
    ).map_err(|e| format!("graph_snapshots 테이블 생성 실패: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn vc_db_save_snapshot(project_path: String, commit_hash: String, snapshot: String) -> Result<(), String> {
    let conn = get_conn(&project_path)?;

    // We assume the commit already exists in the 'commits' table or we don't strictly enforce FK for now if git and sqlite are slightly out of sync.
    // Actually, let's make sure the commit exists or at least upsert it if we have info.
    // For now, let's just insert the snapshot.
    
    conn.execute(
        "INSERT OR REPLACE INTO graph_snapshots (commit_hash, snapshot) VALUES (?1, ?2)",
        params![commit_hash, snapshot],
    ).map_err(|e| format!("스냅샷 저장 실패: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn vc_db_get_snapshot(project_path: String, commit_hash: String) -> Result<Option<String>, String> {
    let conn = get_conn(&project_path)?;
    
    let mut stmt = conn.prepare("SELECT snapshot FROM graph_snapshots WHERE commit_hash = ?1")
        .map_err(|e| e.to_string())?;
    
    let snapshot: Option<String> = stmt.query_row(params![commit_hash], |row| row.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
        
    Ok(snapshot)
}

#[tauri::command]
pub async fn vc_db_record_commit(project_path: String, commit: VCCommit) -> Result<(), String> {
    let conn = get_conn(&project_path)?;
    
    conn.execute(
        "INSERT OR REPLACE INTO commits (hash, author, date, message) VALUES (?1, ?2, ?3, ?4)",
        params![commit.hash, commit.author, commit.date, commit.message],
    ).map_err(|e| format!("커밋 기록 실패: {}", e))?;
    
    Ok(())
}

#[tauri::command]
pub async fn vc_db_set_meta(project_path: String, key: String, value: String) -> Result<(), String> {
    let conn = get_conn(&project_path)?;
    conn.execute(
        "INSERT OR REPLACE INTO project_meta (key, value) VALUES (?1, ?2)",
        params![key, value],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn vc_db_get_meta(project_path: String, key: String) -> Result<Option<String>, String> {
    let conn = get_conn(&project_path)?;
    let mut stmt = conn.prepare("SELECT value FROM project_meta WHERE key = ?1")
        .map_err(|e| e.to_string())?;
    let value: Option<String> = stmt.query_row(params![key], |row| row.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(value)
}
