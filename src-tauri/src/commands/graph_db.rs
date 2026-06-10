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
        redis::Value::SimpleString(s) => serde_json::Value::String(s),
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

/// Import nodes and edges (clean JSON, already parsed by the frontend) into a FalkorDB graph.
/// nodes: array of { id, labels, properties }
/// edges: array of { id, type, src_node, dest_node, properties }
#[tauri::command]
pub async fn graph_db_import(
    graph_name: String,
    nodes: serde_json::Value,
    edges: serde_json::Value,
    url: Option<String>,
) -> Result<u32, String> {
    validate_graph_name(&graph_name)?;
    let resolved = resolve_url(url.as_deref());
    let mut conn = connect(&resolved).await?;

    // Ensure graph exists
    let _: redis::Value = redis::cmd("GRAPH.QUERY")
        .arg(graph_name.trim())
        .arg("RETURN 1")
        .query_async(&mut conn)
        .await
        .map_err(|e| format!("Failed to create graph '{}': {}", graph_name, e))?;

    let mut count: u32 = 0;

    // Import nodes
    if let Some(node_arr) = nodes.as_array() {
        for node in node_arr {
            let id = node["id"].as_i64().unwrap_or(0);
            let labels = node["labels"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str())
                        .collect::<Vec<_>>()
                        .join(":")
                })
                .unwrap_or_default();
            let label_part = if labels.is_empty() {
                "Node".to_string()
            } else {
                labels
            };

            let mut set_parts: Vec<String> = vec![format!("n.__import_id__ = {}", id)];
            if let Some(props) = node["properties"].as_object() {
                for (k, v) in props {
                    let safe_key = k.replace('`', "");
                    let val_str = match v {
                        serde_json::Value::String(s) => {
                            format!("'{}'", s.replace('\\', "\\\\").replace('\'', "\\'"))
                        }
                        serde_json::Value::Number(n) => n.to_string(),
                        serde_json::Value::Bool(b) => b.to_string(),
                        serde_json::Value::Null => "null".to_string(),
                        other => format!("'{}'", other.to_string().replace('\'', "\\'")),
                    };
                    set_parts.push(format!("n.`{}` = {}", safe_key, val_str));
                }
            }

            let cypher = format!(
                "MERGE (n:{} {{__import_id__: {}}}) SET {}",
                label_part,
                id,
                set_parts.join(", ")
            );
            let _: redis::Value = redis::cmd("GRAPH.QUERY")
                .arg(graph_name.trim())
                .arg(&cypher)
                .query_async(&mut conn)
                .await
                .map_err(|e| format!("Node import failed (id={}): {}", id, e))?;
            count += 1;
        }
    }

    // Import edges
    if let Some(edge_arr) = edges.as_array() {
        for edge in edge_arr {
            let src = edge["src_node"].as_i64().unwrap_or(0);
            let dst = edge["dest_node"].as_i64().unwrap_or(0);
            let rel_type = edge["type"]
                .as_str()
                .unwrap_or("RELATED")
                .replace('`', "");

            let mut set_parts: Vec<String> = Vec::new();
            if let Some(props) = edge["properties"].as_object() {
                for (k, v) in props {
                    let safe_key = k.replace('`', "");
                    let val_str = match v {
                        serde_json::Value::String(s) => {
                            format!("'{}'", s.replace('\\', "\\\\").replace('\'', "\\'"))
                        }
                        serde_json::Value::Number(n) => n.to_string(),
                        serde_json::Value::Bool(b) => b.to_string(),
                        serde_json::Value::Null => "null".to_string(),
                        other => format!("'{}'", other.to_string().replace('\'', "\\'")),
                    };
                    set_parts.push(format!("r.`{}` = {}", safe_key, val_str));
                }
            }

            let set_clause = if set_parts.is_empty() {
                String::new()
            } else {
                format!(" SET {}", set_parts.join(", "))
            };

            let cypher = format!(
                "MATCH (a {{__import_id__: {}}}), (b {{__import_id__: {}}}) MERGE (a)-[r:`{}`]->(b){}",
                src, dst, rel_type, set_clause
            );
            let _: redis::Value = redis::cmd("GRAPH.QUERY")
                .arg(graph_name.trim())
                .arg(&cypher)
                .query_async(&mut conn)
                .await
                .map_err(|e| format!("Edge import failed ({}->{} [{}]): {}", src, dst, rel_type, e))?;
            count += 1;
        }
    }

    Ok(count)
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

