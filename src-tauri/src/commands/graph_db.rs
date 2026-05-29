const DEFAULT_FALKORDB_URL: &str = "redis://10.246.42.51:6379/";

fn resolve_url(url: Option<&str>) -> String {
    // Explicit parameter > env var > compile-time default.
    if let Some(u) = url {
        let u = u.trim();
        if !u.is_empty() {
            return u.to_string();
        }
    }
    std::env::var("FALKORDB_URL").unwrap_or_else(|_| DEFAULT_FALKORDB_URL.to_string())
}

fn validate_graph_name(name: &str) -> Result<(), String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Graph name cannot be empty".to_string());
    }
    if trimmed.len() > 128 {
        return Err("Graph name is too long (max 128)".to_string());
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err("Graph name can only contain letters, digits, '_' and '-'".to_string());
    }
    Ok(())
}

async fn connect(url: &str) -> Result<redis::aio::MultiplexedConnection, String> {
    let client = redis::Client::open(url)
        .map_err(|e| format!("Invalid FalkorDB URL '{}': {}", url, e))?;
    client
        .get_multiplexed_tokio_connection()
        .await
        .map_err(|e| format!("Failed to connect to FalkorDB at '{}': {}", url, e))
}

#[tauri::command]
pub async fn graph_db_create(graph_name: String, url: Option<String>) -> Result<(), String> {
    validate_graph_name(&graph_name)?;
    let resolved = resolve_url(url.as_deref());
    let mut conn = connect(&resolved).await?;
    let _: redis::Value = redis::cmd("GRAPH.QUERY")
        .arg(graph_name.trim())
        .arg("RETURN 1")
        .query_async(&mut conn)
        .await
        .map_err(|e| format!("Failed to create graph '{}': {}", graph_name, e))?;
    Ok(())
}

#[tauri::command]
pub async fn graph_db_delete(graph_name: String, url: Option<String>) -> Result<(), String> {
    validate_graph_name(&graph_name)?;
    let resolved = resolve_url(url.as_deref());
    let mut conn = connect(&resolved).await?;
    let _: String = redis::cmd("GRAPH.DELETE")
        .arg(graph_name.trim())
        .query_async(&mut conn)
        .await
        .map_err(|e| format!("Failed to delete graph '{}': {}", graph_name, e))?;
    Ok(())
}

#[tauri::command]
pub async fn graph_db_list(url: Option<String>) -> Result<Vec<String>, String> {
    let resolved = resolve_url(url.as_deref());
    let mut conn = connect(&resolved).await?;
    // GRAPH.LIST returns only graph names, not internal metadata keys.
    let names: Vec<String> = redis::cmd("GRAPH.LIST")
        .query_async(&mut conn)
        .await
        .map_err(|e| format!("Failed to list graphs from FalkorDB: {}", e))?;
    Ok(names)
}

fn redis_value_to_json(val: redis::Value) -> serde_json::Value {
    match val {
        redis::Value::Nil => serde_json::Value::Null,
        redis::Value::Int(i) => serde_json::Value::Number(i.into()),
        redis::Value::Data(d) => {
            if let Ok(s) = String::from_utf8(d) {
                serde_json::Value::String(s)
            } else {
                serde_json::Value::String("<binary>".to_string())
            }
        }
        redis::Value::BulkString(d) => {
            if let Ok(s) = String::from_utf8(d) {
                serde_json::Value::String(s)
            } else {
                serde_json::Value::String("<binary>".to_string())
            }
        }
        redis::Value::Array(arr) => {
            serde_json::Value::Array(arr.into_iter().map(redis_value_to_json).collect())
        }
        redis::Value::Status(s) => serde_json::Value::String(s),
        redis::Value::Okay => serde_json::Value::String("OK".to_string()),
        _ => serde_json::Value::String(format!("{:?}", val)),
    }
}

#[tauri::command]
pub async fn graph_db_query(
    graph_name: String,
    cypher: String,
    url: Option<String>,
) -> Result<serde_json::Value, String> {
    validate_graph_name(&graph_name)?;
    let resolved = resolve_url(url.as_deref());
    let mut conn = connect(&resolved).await?;
    let res: redis::Value = redis::cmd("GRAPH.QUERY")
        .arg(graph_name.trim())
        .arg(cypher)
        .query_async(&mut conn)
        .await
        .map_err(|e| format!("Query failed on graph '{}': {}", graph_name, e))?;

    Ok(redis_value_to_json(res))
}

#[tauri::command]
pub async fn graph_db_ping(url: Option<String>) -> Result<(), String> {
    let resolved = resolve_url(url.as_deref());
    connect(&resolved).await?;
    Ok(())
}

#[tauri::command]
pub async fn graph_db_export(graph_name: String, url: Option<String>) -> Result<serde_json::Value, String> {
    validate_graph_name(&graph_name)?;
    let resolved = resolve_url(url.as_deref());
    let mut conn = connect(&resolved).await?;

    // Export nodes
    let nodes_res: redis::Value = redis::cmd("GRAPH.QUERY")
        .arg(graph_name.trim())
        .arg("MATCH (n) RETURN n")
        .query_async(&mut conn)
        .await
        .map_err(|e| format!("Failed to export nodes from '{}': {}", graph_name, e))?;

    // Export edges
    let edges_res: redis::Value = redis::cmd("GRAPH.QUERY")
        .arg(graph_name.trim())
        .arg("MATCH ()-[r]->() RETURN r")
        .query_async(&mut conn)
        .await
        .map_err(|e| format!("Failed to export edges from '{}': {}", graph_name, e))?;

    Ok(serde_json::json!({
        "nodes": redis_value_to_json(nodes_res),
        "edges": redis_value_to_json(edges_res)
    }))
}

