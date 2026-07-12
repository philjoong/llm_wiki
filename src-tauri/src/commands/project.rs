use std::fs;
use std::path::Path;

use crate::panic_guard::run_guarded;
use crate::types::wiki::WikiProject;

#[tauri::command]
pub fn create_project(name: String, path: String) -> Result<WikiProject, String> {
    run_guarded("create_project", || create_project_impl(name, path))
}

fn create_project_impl(name: String, path: String) -> Result<WikiProject, String> {
    let root = Path::new(&path).join(&name);

    if root.exists() {
        return Err(format!("Directory already exists: '{}'", root.display()));
    }

    fs::create_dir_all(&root)
        .map_err(|e| format!("Failed to create project directory '{}': {}", root.display(), e))?;

    Ok(WikiProject {
        name,
        // Forward slashes for cross-platform consistency in the TS layer.
        path: root.to_string_lossy().replace('\\', "/"),
    })
}

#[tauri::command]
pub fn open_project(path: String) -> Result<WikiProject, String> {
    run_guarded("open_project", || {
        let root = Path::new(&path);

        if !root.exists() {
            return Err(format!("Path does not exist: '{}'", path));
        }
        if !root.is_dir() {
            return Err(format!("Path is not a directory: '{}'", path));
        }

        if !root.join("db").is_dir() {
            return Err(format!(
                "Not a valid project (missing db/ directory): '{}'",
                path
            ));
        }

        // A v2 project is never silently upgraded from the previous graph
        // database.  Creating an empty knowledge.sqlite here would make the
        // old assertions disappear from the user's view, so fail before any
        // caller can open or mutate the project.
        let knowledge_db = root.join(".llm-wiki").join("knowledge.sqlite");
        if !knowledge_db.is_file() {
            let legacy_graph = root.join(".llm-wiki").join("graph.sqlite");
            let detail = if legacy_graph.is_file() {
                "legacy graph.sqlite was found"
            } else {
                "knowledge.sqlite is missing"
            };
            return Err(format!(
                "Unsupported legacy project ({detail}). Create a new v2 project and restore a v2 export instead: '{}'",
                path
            ));
        }
        if !root.join(".llm-wiki").join("tag-schema.yaml").is_file() {
            return Err(format!(
                "Invalid v2 project (missing .llm-wiki/tag-schema.yaml): '{}'",
                path
            ));
        }

        // Derive project name from the directory name
        let name = root
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Unknown")
            .to_string();

        Ok(WikiProject {
            name,
            // Forward slashes for cross-platform consistency in the TS layer.
            path: path.replace('\\', "/"),
        })
    })
}
