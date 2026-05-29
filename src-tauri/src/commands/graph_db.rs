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

#[tauri::command]
pub async fn graph_db_ping(url: Option<String>) -> Result<(), String> {
    let resolved = resolve_url(url.as_deref());
    connect(&resolved).await?;
    Ok(())
}

