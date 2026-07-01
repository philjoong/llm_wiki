use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::Path;

#[derive(Debug, Deserialize)]
pub struct Stage2TripleInput {
    subject: String,
    predicate: String,
    object: String,
    graph: Option<String>,
    page_path: Option<String>,
    source_range: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum GraphQueryInput {
    All,
    Neighbors {
        #[serde(rename = "pagePath", alias = "page_path")]
        page_path: String,
        depth: u8,
    },
    Relation {
        #[serde(rename = "relationType", alias = "relation_type")]
        relation_type: String,
    },
    Node {
        #[serde(rename = "nodeName", alias = "node_name")]
        node_name: String,
    },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNodeRecord {
    id: String,
    labels: Vec<String>,
    name: String,
    page_path: Option<String>,
    properties: Value,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdgeRecord {
    id: String,
    source_id: String,
    target_id: String,
    relation_type: String,
    properties: Value,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GraphSnapshot {
    nodes: Vec<GraphNodeRecord>,
    edges: Vec<GraphEdgeRecord>,
}

fn db_path(project_path: &str) -> Result<String, String> {
    let state_dir = Path::new(project_path).join(".llm-wiki");
    fs::create_dir_all(&state_dir)
        .map_err(|e| format!("Failed to create graph state directory: {e}"))?;
    Ok(state_dir.join("graph.sqlite").to_string_lossy().to_string())
}

fn open_db(project_path: &str) -> Result<Connection, String> {
    let conn = Connection::open(db_path(project_path)?)
        .map_err(|e| format!("Failed to open embedded graph database: {e}"))?;
    conn.execute_batch(
        "
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS graphs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_name TEXT NOT NULL,
          graph_name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(project_name, graph_name)
        );
        CREATE TABLE IF NOT EXISTS nodes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          graph_id INTEGER NOT NULL,
          stable_key TEXT NOT NULL,
          name TEXT NOT NULL,
          labels_json TEXT NOT NULL,
          page_path TEXT,
          properties_json TEXT NOT NULL,
          UNIQUE(graph_id, stable_key),
          FOREIGN KEY(graph_id) REFERENCES graphs(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS edges (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          graph_id INTEGER NOT NULL,
          source_node_id INTEGER NOT NULL,
          target_node_id INTEGER NOT NULL,
          relation_type TEXT NOT NULL,
          properties_json TEXT NOT NULL,
          UNIQUE(graph_id, source_node_id, target_node_id, relation_type),
          FOREIGN KEY(graph_id) REFERENCES graphs(id) ON DELETE CASCADE,
          FOREIGN KEY(target_node_id) REFERENCES nodes(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_nodes_page_path ON nodes(graph_id, page_path);
        CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(graph_id, name);
        CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(graph_id, source_node_id);
        CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(graph_id, target_node_id);
        CREATE INDEX IF NOT EXISTS idx_edges_relation ON edges(graph_id, relation_type);
        ",
    )
    .map_err(|e| format!("Failed to initialize embedded graph schema: {e}"))?;
    Ok(conn)
}

fn graph_id(conn: &Connection, project_name: &str, graph_name: &str) -> Result<i64, String> {
    conn.execute(
        "INSERT OR IGNORE INTO graphs (project_name, graph_name, created_at) VALUES (?1, ?2, ?3)",
        params![project_name, graph_name, Utc::now().to_rfc3339()],
    )
    .map_err(|e| format!("Failed to create graph '{graph_name}': {e}"))?;
    conn.query_row(
        "SELECT id FROM graphs WHERE project_name = ?1 AND graph_name = ?2",
        params![project_name, graph_name],
        |row| row.get(0),
    )
    .map_err(|e| format!("Failed to find graph '{graph_name}': {e}"))
}

fn existing_graph_id(conn: &Connection, project_name: &str, graph_name: &str) -> Result<Option<i64>, String> {
    conn.query_row(
        "SELECT id FROM graphs WHERE project_name = ?1 AND graph_name = ?2",
        params![project_name, graph_name],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| format!("Failed to find graph '{graph_name}': {e}"))
}

fn stable_key(name: &str, page_path: Option<&str>) -> String {
    match page_path {
        Some(path) if !path.trim().is_empty() => format!("page:{}", path.trim()),
        _ => format!("name:{}", name.trim().to_lowercase()),
    }
}

fn relation_type(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_uppercase()
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches('_').to_string();
    if trimmed.is_empty() { "RELATED".to_string() } else { trimmed }
}

fn upsert_node(
    conn: &Connection,
    graph_id: i64,
    name: &str,
    page_path: Option<&str>,
    properties: Value,
) -> Result<i64, String> {
    let key = stable_key(name, page_path);
    let labels_json = serde_json::to_string(&vec!["Page"]).unwrap_or_else(|_| "[\"Page\"]".to_string());
    let properties_json = serde_json::to_string(&properties).unwrap_or_else(|_| "{}".to_string());
    conn.execute(
        "
        INSERT INTO nodes (graph_id, stable_key, name, labels_json, page_path, properties_json)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT(graph_id, stable_key) DO UPDATE SET
          name = excluded.name,
          page_path = COALESCE(excluded.page_path, nodes.page_path),
          properties_json = excluded.properties_json
        ",
        params![graph_id, key, name, labels_json, page_path, properties_json],
    )
    .map_err(|e| format!("Failed to upsert node '{name}': {e}"))?;
    conn.query_row(
        "SELECT id FROM nodes WHERE graph_id = ?1 AND stable_key = ?2",
        params![graph_id, stable_key(name, page_path)],
        |row| row.get(0),
    )
    .map_err(|e| format!("Failed to find node '{name}': {e}"))
}

fn snapshot_for_node_ids(conn: &Connection, graph_id: i64, node_ids: Vec<i64>) -> Result<GraphSnapshot, String> {
    if node_ids.is_empty() {
        return Ok(GraphSnapshot { nodes: vec![], edges: vec![] });
    }
    let ids_csv = node_ids.iter().map(|id| id.to_string()).collect::<Vec<_>>().join(",");
    let node_sql = format!(
        "SELECT id, labels_json, name, page_path, properties_json FROM nodes WHERE graph_id = ?1 AND id IN ({ids_csv})"
    );
    let mut node_stmt = conn.prepare(&node_sql).map_err(|e| e.to_string())?;
    let nodes = node_stmt
        .query_map(params![graph_id], |row| {
            let id: i64 = row.get(0)?;
            let labels_json: String = row.get(1)?;
            let properties_json: String = row.get(4)?;
            Ok(GraphNodeRecord {
                id: id.to_string(),
                labels: serde_json::from_str(&labels_json).unwrap_or_else(|_| vec!["Page".to_string()]),
                name: row.get(2)?,
                page_path: row.get(3)?,
                properties: serde_json::from_str(&properties_json).unwrap_or_else(|_| json!({})),
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let edge_sql = format!(
        "
        SELECT id, source_node_id, target_node_id, relation_type, properties_json
        FROM edges
        WHERE graph_id = ?1 AND source_node_id IN ({ids_csv}) AND target_node_id IN ({ids_csv})
        "
    );
    let mut edge_stmt = conn.prepare(&edge_sql).map_err(|e| e.to_string())?;
    let edges = edge_stmt
        .query_map(params![graph_id], |row| {
            let id: i64 = row.get(0)?;
            let source_id: i64 = row.get(1)?;
            let target_id: i64 = row.get(2)?;
            let properties_json: String = row.get(4)?;
            Ok(GraphEdgeRecord {
                id: id.to_string(),
                source_id: source_id.to_string(),
                target_id: target_id.to_string(),
                relation_type: row.get(3)?,
                properties: serde_json::from_str(&properties_json).unwrap_or_else(|_| json!({})),
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(GraphSnapshot { nodes, edges })
}

fn all_node_ids(conn: &Connection, graph_id: i64) -> Result<Vec<i64>, String> {
    let mut stmt = conn
        .prepare("SELECT id FROM nodes WHERE graph_id = ?1 ORDER BY id")
        .map_err(|e| e.to_string())?;
    let ids = stmt.query_map(params![graph_id], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(ids)
}

fn visible_node_ids(conn: &Connection, graph_id: i64) -> Result<Vec<i64>, String> {
    let mut ids = all_node_ids(conn, graph_id)?;
    ids.truncate(50);
    Ok(ids)
}

#[tauri::command]
pub async fn graph_sqlite_ping(project_path: String) -> Result<(), String> {
    open_db(&project_path).map(|_| ())
}

#[tauri::command]
pub async fn graph_sqlite_create(project_path: String, project_name: String, graph_name: String) -> Result<(), String> {
    let conn = open_db(&project_path)?;
    graph_id(&conn, &project_name, &graph_name).map(|_| ())
}

#[tauri::command]
pub async fn graph_sqlite_delete(project_path: String, project_name: String, graph_name: String) -> Result<(), String> {
    let conn = open_db(&project_path)?;
    conn.execute(
        "DELETE FROM graphs WHERE project_name = ?1 AND graph_name = ?2",
        params![project_name, graph_name],
    )
    .map_err(|e| format!("Failed to delete graph: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn graph_sqlite_list(project_path: String, project_name: String) -> Result<Vec<String>, String> {
    let conn = open_db(&project_path)?;
    let mut stmt = conn
        .prepare("SELECT graph_name FROM graphs WHERE project_name = ?1 ORDER BY graph_name")
        .map_err(|e| e.to_string())?;
    let graphs = stmt.query_map(params![project_name], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(graphs)
}

#[tauri::command]
pub async fn graph_sqlite_upsert_triples(
    project_path: String,
    project_name: String,
    triples: Vec<Stage2TripleInput>,
) -> Result<u32, String> {
    let conn = open_db(&project_path)?;
    let mut count = 0;
    for triple in triples {
        let Some(graph_name) = triple.graph.as_deref().filter(|g| !g.trim().is_empty()) else {
            continue;
        };
        if triple.subject.trim().is_empty() || triple.object.trim().is_empty() {
            continue;
        }
        let gid = graph_id(&conn, &project_name, graph_name)?;
        let source_props = json!({ "label": triple.subject, "source_range": triple.source_range, "page_path": triple.page_path });
        let target_props = json!({ "label": triple.object });
        let source_id = upsert_node(&conn, gid, &triple.subject, None, source_props)?;
        let target_id = upsert_node(&conn, gid, &triple.object, None, target_props)?;
        let rel = relation_type(&triple.predicate);
        let edge_props = json!({
            "page_path": triple.page_path,
            "source_range": triple.source_range,
            "subject": triple.subject,
            "object": triple.object,
        });
        conn.execute(
            "
            INSERT INTO edges (graph_id, source_node_id, target_node_id, relation_type, properties_json)
            VALUES (?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(graph_id, source_node_id, target_node_id, relation_type) DO UPDATE SET
              properties_json = excluded.properties_json
            ",
            params![gid, source_id, target_id, rel, edge_props.to_string()],
        )
        .map_err(|e| format!("Failed to upsert edge: {e}"))?;
        count += 1;
    }
    Ok(count)
}

#[tauri::command]
pub async fn graph_sqlite_query(
    project_path: String,
    project_name: String,
    graph_name: String,
    query: GraphQueryInput,
) -> Result<GraphSnapshot, String> {
    let conn = open_db(&project_path)?;
    let Some(gid) = existing_graph_id(&conn, &project_name, &graph_name)? else {
        return Ok(GraphSnapshot { nodes: vec![], edges: vec![] });
    };

    match query {
        GraphQueryInput::All => snapshot_for_node_ids(&conn, gid, visible_node_ids(&conn, gid)?),
        GraphQueryInput::Relation { relation_type: rel_name } => {
            let rel = relation_type(&rel_name);
            let mut stmt = conn
                .prepare("SELECT source_node_id, target_node_id FROM edges WHERE graph_id = ?1 AND relation_type = ?2 LIMIT 80")
                .map_err(|e| e.to_string())?;
            let ids = stmt
                .query_map(params![gid, rel], |row| Ok(vec![row.get(0)?, row.get(1)?]))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<Vec<i64>>, _>>()
                .map_err(|e| e.to_string())?
                .into_iter()
                .flatten()
                .collect();
            snapshot_for_node_ids(&conn, gid, ids)
        }
        GraphQueryInput::Node { node_name } => {
            let like = format!("%{}%", node_name);
            let mut stmt = conn
                .prepare("SELECT id FROM nodes WHERE graph_id = ?1 AND name LIKE ?2 LIMIT 20")
                .map_err(|e| e.to_string())?;
            let ids = stmt
                .query_map(params![gid, like], |row| row.get(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<i64>, _>>()
                .map_err(|e| e.to_string())?;
            snapshot_for_node_ids(&conn, gid, expand_neighbors(&conn, gid, ids, 1)?)
        }
        GraphQueryInput::Neighbors { page_path, depth } => {
            let mut stmt = conn
                .prepare(
                    "SELECT source_node_id, target_node_id FROM edges WHERE graph_id = ?1 AND json_extract(properties_json, '$.page_path') = ?2 LIMIT 40",
                )
                .map_err(|e| e.to_string())?;
            let seed_ids = stmt
                .query_map(params![gid, page_path], |row| Ok(vec![row.get(0)?, row.get(1)?]))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<Vec<i64>>, _>>()
                .map_err(|e| e.to_string())?
                .into_iter()
                .flatten()
                .collect();
            snapshot_for_node_ids(&conn, gid, expand_neighbors(&conn, gid, seed_ids, depth.min(2))?)
        }
    }
}

fn expand_neighbors(conn: &Connection, graph_id: i64, seeds: Vec<i64>, depth: u8) -> Result<Vec<i64>, String> {
    let mut all: Vec<i64> = seeds;
    let mut frontier = all.clone();
    for _ in 0..depth {
        if frontier.is_empty() {
            break;
        }
        let ids_csv = frontier.iter().map(|id| id.to_string()).collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT source_node_id, target_node_id FROM edges WHERE graph_id = ?1 AND (source_node_id IN ({ids_csv}) OR target_node_id IN ({ids_csv})) LIMIT 80"
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let next = stmt
            .query_map(params![graph_id], |row| Ok(vec![row.get(0)?, row.get(1)?]))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<Vec<i64>>, _>>()
            .map_err(|e| e.to_string())?
            .into_iter()
            .flatten()
            .filter(|id| !all.contains(id))
            .collect::<Vec<_>>();
        all.extend(next.iter());
        frontier = next;
    }
    all.sort_unstable();
    all.dedup();
    all.truncate(50);
    Ok(all)
}

#[tauri::command]
pub async fn graph_sqlite_export(project_path: String, project_name: String, graph_name: String) -> Result<GraphSnapshot, String> {
    let conn = open_db(&project_path)?;
    let Some(gid) = existing_graph_id(&conn, &project_name, &graph_name)? else {
        return Ok(GraphSnapshot { nodes: vec![], edges: vec![] });
    };
    snapshot_for_node_ids(&conn, gid, all_node_ids(&conn, gid)?)
}

#[tauri::command]
pub async fn graph_sqlite_import(
    project_path: String,
    project_name: String,
    graph_name: String,
    snapshot: GraphSnapshot,
) -> Result<u32, String> {
    let conn = open_db(&project_path)?;
    let gid = graph_id(&conn, &project_name, &graph_name)?;
    let mut id_map = std::collections::HashMap::new();
    let mut count = 0;
    for node in snapshot.nodes {
        let new_id = upsert_node(
            &conn,
            gid,
            &node.name,
            node.page_path.as_deref(),
            node.properties,
        )?;
        id_map.insert(node.id, new_id);
        count += 1;
    }
    for edge in snapshot.edges {
        let Some(source_id) = id_map.get(&edge.source_id) else { continue };
        let Some(target_id) = id_map.get(&edge.target_id) else { continue };
        conn.execute(
            "INSERT OR IGNORE INTO edges (graph_id, source_node_id, target_node_id, relation_type, properties_json) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![gid, source_id, target_id, relation_type(&edge.relation_type), edge.properties.to_string()],
        )
        .map_err(|e| format!("Failed to import edge: {e}"))?;
        count += 1;
    }
    Ok(count)
}

#[tauri::command]
pub async fn graph_sqlite_rename_relation_type(
    project_path: String,
    project_name: String,
    graph_name: String,
    old_type: String,
    new_type: String,
) -> Result<u32, String> {
    let conn = open_db(&project_path)?;
    let Some(gid) = existing_graph_id(&conn, &project_name, &graph_name)? else { return Ok(0) };
    let changed = conn
        .execute(
            "UPDATE edges SET relation_type = ?1 WHERE graph_id = ?2 AND relation_type = ?3",
            params![relation_type(&new_type), gid, relation_type(&old_type)],
        )
        .map_err(|e| format!("Failed to rename relation type: {e}"))?;
    Ok(changed as u32)
}

#[tauri::command]
pub async fn graph_sqlite_delete_relation_type(
    project_path: String,
    project_name: String,
    graph_name: String,
    relation_type: String,
) -> Result<u32, String> {
    let conn = open_db(&project_path)?;
    let Some(gid) = existing_graph_id(&conn, &project_name, &graph_name)? else { return Ok(0) };
    let changed = conn
        .execute(
            "DELETE FROM edges WHERE graph_id = ?1 AND relation_type = ?2",
            params![gid, self::relation_type(&relation_type)],
        )
        .map_err(|e| format!("Failed to delete relation type: {e}"))?;
    Ok(changed as u32)
}

#[tauri::command]
pub async fn graph_sqlite_delete_node(
    project_path: String,
    project_name: String,
    graph_name: String,
    node_id: i64,
) -> Result<(), String> {
    let conn = open_db(&project_path)?;
    let Some(gid) = existing_graph_id(&conn, &project_name, &graph_name)? else { return Ok(()) };
    // Delete edges where this node is source (cascade doesn't cover source side)
    conn.execute(
        "DELETE FROM edges WHERE graph_id = ?1 AND source_node_id = ?2",
        params![gid, node_id],
    )
    .map_err(|e| format!("Failed to delete edges for node: {e}"))?;
    // Delete the node itself (ON DELETE CASCADE removes edges where it's target)
    conn.execute(
        "DELETE FROM nodes WHERE graph_id = ?1 AND id = ?2",
        params![gid, node_id],
    )
    .map_err(|e| format!("Failed to delete node: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn graph_sqlite_delete_edge(
    project_path: String,
    project_name: String,
    graph_name: String,
    edge_id: i64,
) -> Result<(), String> {
    let conn = open_db(&project_path)?;
    let Some(gid) = existing_graph_id(&conn, &project_name, &graph_name)? else { return Ok(()) };
    conn.execute(
        "DELETE FROM edges WHERE graph_id = ?1 AND id = ?2",
        params![gid, edge_id],
    )
    .map_err(|e| format!("Failed to delete edge: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn graph_sqlite_update_node_name(
    project_path: String,
    project_name: String,
    graph_name: String,
    node_id: i64,
    new_name: String,
) -> Result<(), String> {
    let conn = open_db(&project_path)?;
    let Some(gid) = existing_graph_id(&conn, &project_name, &graph_name)? else { return Ok(()) };
    let new_stable_key = format!("name:{}", new_name.trim().to_lowercase());
    // Check for conflict with another node
    let conflict: Option<i64> = conn
        .query_row(
            "SELECT id FROM nodes WHERE graph_id = ?1 AND stable_key = ?2 AND id != ?3",
            params![gid, new_stable_key, node_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("Failed to check name conflict: {e}"))?;
    if conflict.is_some() {
        return Err(format!("A node named '{}' already exists in this graph", new_name.trim()));
    }
    conn.execute(
        "UPDATE nodes SET name = ?1, stable_key = ?2 WHERE graph_id = ?3 AND id = ?4",
        params![new_name.trim(), new_stable_key, gid, node_id],
    )
    .map_err(|e| format!("Failed to update node name: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn graph_sqlite_update_edge(
    project_path: String,
    project_name: String,
    graph_name: String,
    edge_id: i64,
    new_relation_type: String,
    new_target_node_id: Option<i64>,
) -> Result<(), String> {
    let conn = open_db(&project_path)?;
    let Some(gid) = existing_graph_id(&conn, &project_name, &graph_name)? else { return Ok(()) };
    let rel = relation_type(&new_relation_type);
    // Fetch current edge to get source/target for UNIQUE constraint check
    let (source_id, current_target_id): (i64, i64) = conn
        .query_row(
            "SELECT source_node_id, target_node_id FROM edges WHERE graph_id = ?1 AND id = ?2",
            params![gid, edge_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| format!("Edge not found: {e}"))?;
    let target_id = new_target_node_id.unwrap_or(current_target_id);
    // Check UNIQUE conflict with a different edge
    let conflict: Option<i64> = conn
        .query_row(
            "SELECT id FROM edges WHERE graph_id = ?1 AND source_node_id = ?2 AND target_node_id = ?3 AND relation_type = ?4 AND id != ?5",
            params![gid, source_id, target_id, rel, edge_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("Failed to check edge conflict: {e}"))?;
    if conflict.is_some() {
        return Err("An identical edge already exists".to_string());
    }
    conn.execute(
        "UPDATE edges SET relation_type = ?1, target_node_id = ?2 WHERE graph_id = ?3 AND id = ?4",
        params![rel, target_id, gid, edge_id],
    )
    .map_err(|e| format!("Failed to update edge: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn graph_sqlite_add_edge(
    project_path: String,
    project_name: String,
    graph_name: String,
    source_node_id: i64,
    target_node_id: i64,
    new_relation_type: String,
) -> Result<i64, String> {
    let conn = open_db(&project_path)?;
    let Some(gid) = existing_graph_id(&conn, &project_name, &graph_name)? else {
        return Err("Graph not found".to_string());
    };
    let rel = relation_type(&new_relation_type);
    let props = serde_json::to_string(&json!({})).unwrap_or_else(|_| "{}".to_string());
    conn.execute(
        "INSERT INTO edges (graph_id, source_node_id, target_node_id, relation_type, properties_json) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![gid, source_node_id, target_node_id, rel, props],
    )
    .map_err(|e| format!("Failed to add edge (may already exist): {e}"))?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub async fn graph_sqlite_delete_edges_by_page_path(
    project_path: String,
    project_name: String,
    page_path: String,
) -> Result<u32, String> {
    let conn = open_db(&project_path)?;
    // Delete all edges across all graphs for this project where page_path matches
    let changed = conn
        .execute(
            "
            DELETE FROM edges
            WHERE id IN (
              SELECT e.id FROM edges e
              JOIN graphs g ON g.id = e.graph_id
              WHERE g.project_name = ?1
                AND json_extract(e.properties_json, '$.page_path') = ?2
            )
            ",
            params![project_name, page_path],
        )
        .map_err(|e| format!("Failed to delete edges by page_path: {e}"))?;
    Ok(changed as u32)
}

#[tauri::command]
pub async fn graph_sqlite_add_node(
    project_path: String,
    project_name: String,
    graph_name: String,
    name: String,
) -> Result<i64, String> {
    let conn = open_db(&project_path)?;
    let Some(gid) = existing_graph_id(&conn, &project_name, &graph_name)? else {
        return Err("Graph not found".to_string());
    };
    let props = json!({ "label": name.trim() });
    let id = upsert_node(&conn, gid, name.trim(), None, props)?;
    Ok(id)
}
