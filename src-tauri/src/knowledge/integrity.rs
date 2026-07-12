use super::{error::{KnowledgeError, KnowledgeErrorCode}, model::IntegrityIssue};
use rusqlite::Connection;

fn error(error: impl ToString) -> KnowledgeError {
    KnowledgeError::new(KnowledgeErrorCode::ValidationFailed, error.to_string())
}

fn append_query_issues(
    connection: &Connection,
    issues: &mut Vec<IntegrityIssue>,
    category: &str,
    query: &str,
) -> Result<(), KnowledgeError> {
    let mut statement = connection.prepare(query).map_err(error)?;
    let rows = statement.query_map([], |row| row.get::<_, String>(0)).map_err(error)?;
    for row in rows {
        issues.push(IntegrityIssue {
            category: category.into(),
            message: format!("{category} record"),
            record_id: Some(row.map_err(error)?),
        });
    }
    Ok(())
}

/// Database-only checks.  This function intentionally issues no mutation
/// statements: the command is a diagnostic gate, never an auto-repair tool.
pub fn run(connection: &Connection) -> Result<Vec<IntegrityIssue>, KnowledgeError> {
    let mut issues = Vec::new();

    // Covers every declared relation/page/section/entity foreign key,
    // including corrupted databases opened from an archive.
    let mut foreign_keys = connection.prepare("PRAGMA foreign_key_check").map_err(error)?;
    let rows = foreign_keys.query_map([], |row| {
        Ok(format!("{}:{}", row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    }).map_err(error)?;
    for row in rows {
        issues.push(IntegrityIssue {
            category: "dangling_reference".into(),
            message: "Foreign-key reference does not resolve".into(),
            record_id: Some(row.map_err(error)?),
        });
    }

    for (category, query) in [
        ("dangling_reference", "SELECT evidence_id FROM assertion_evidence e WHERE e.page_id IS NOT NULL AND e.section_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM sections s WHERE s.section_id=e.section_id AND s.page_id=e.page_id)"),
        ("evidence_less_ingest", "SELECT assertion_id FROM assertions a WHERE origin='ingest' AND NOT EXISTS(SELECT 1 FROM assertion_evidence e WHERE e.assertion_id=a.assertion_id)"),
        ("unused_entity", "SELECT entity_id FROM entities e WHERE NOT EXISTS(SELECT 1 FROM graph_nodes n WHERE n.entity_id=e.entity_id) AND NOT EXISTS(SELECT 1 FROM page_entities p WHERE p.entity_id=e.entity_id) AND NOT EXISTS(SELECT 1 FROM assertions a WHERE a.subject_entity_id=e.entity_id OR a.object_entity_id=e.entity_id)"),
        ("unused_tag", "SELECT tag_id FROM tags t WHERE NOT EXISTS(SELECT 1 FROM page_tags p WHERE p.tag_id=t.tag_id)"),
    ] {
        append_query_issues(connection, &mut issues, category, query)?;
    }
    Ok(issues)
}
