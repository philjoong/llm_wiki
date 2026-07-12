use super::{db, error::{KnowledgeError, KnowledgeErrorCode}, integrity, model::*};
use chrono::Utc;
use rusqlite::{params, OptionalExtension, Transaction};
use serde_json::json;
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;
use std::{fs, io::Write, path::{Path, PathBuf}};

fn fail(code: KnowledgeErrorCode, message: impl Into<String>) -> KnowledgeError { KnowledgeError::new(code, message) }
fn sql(e: rusqlite::Error) -> KnowledgeError { fail(KnowledgeErrorCode::ValidationFailed, e.to_string()) }
fn id(prefix: &str) -> String { format!("{prefix}-{}", Uuid::new_v4()) }
fn normalized_alias(value: &str) -> String { value.trim().nfkc().flat_map(char::to_lowercase).collect() }

fn resolve_or_create_ingest_entity(tx:&Transaction<'_>,name:&str,entity_type:&str)->Result<EntityRecord,KnowledgeError>{let norm=normalized_alias(name);if let Some(entity)=tx.query_row("SELECT e.entity_id,e.canonical_name,e.entity_type,e.description FROM entity_aliases a JOIN entities e ON e.entity_id=a.entity_id WHERE a.normalized_alias=?1",[&norm],|r|Ok(EntityRecord{entity_id:r.get(0)?,canonical_name:r.get(1)?,entity_type:r.get(2)?,description:r.get(3)?})).optional().map_err(sql)?{return Ok(entity)}let entity=EntityRecord{entity_id:id("ent"),canonical_name:name.trim().into(),entity_type:entity_type.into(),description:None};tx.execute("INSERT INTO entities VALUES(?1,?2,?3,?4)",params![entity.entity_id,entity.canonical_name,entity.entity_type,entity.description]).map_err(sql)?;tx.execute("INSERT INTO entity_aliases VALUES(?1,?2,?3)",params![entity.entity_id,entity.canonical_name,norm]).map_err(sql)?;Ok(entity)}

fn write_synced(path: &Path, bytes: &[u8]) -> Result<(), KnowledgeError> {
    let mut file = fs::File::create(path).map_err(|e| fail(KnowledgeErrorCode::ValidationFailed, format!("Cannot create {}: {e}", path.display())))?;
    file.write_all(bytes).map_err(|e| fail(KnowledgeErrorCode::ValidationFailed, format!("Cannot write {}: {e}", path.display())))?;
    file.sync_all().map_err(|e| fail(KnowledgeErrorCode::ValidationFailed, format!("Cannot fsync {}: {e}", path.display())))
}

fn safe_relative_path(value: &str) -> bool {
    value.starts_with("db/") && !value.contains('\0') && !Path::new(value).is_absolute() && !value.split('/').any(|part| part == ".." || part.is_empty())
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct JournalFile { operation_id: String, state: String, files: Vec<JournalEntry> }
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct JournalEntry { target: String, temp: String, backup: String }

fn journal_dir(project_path: &str) -> PathBuf { Path::new(project_path).join(".llm-wiki").join("transactions") }
fn persist_journal(path: &Path, journal: &JournalFile) -> Result<(), KnowledgeError> {
    let bytes = serde_json::to_vec(journal).map_err(|e| fail(KnowledgeErrorCode::ValidationFailed, e.to_string()))?;
    write_synced(path, &bytes)
}
fn apply_journal(journal: &JournalFile) -> Result<(), KnowledgeError> {
    for file in &journal.files {
        let target = Path::new(&file.target); let temp = Path::new(&file.temp); let backup = Path::new(&file.backup);
        if temp.exists() {
            if target.exists() && !backup.exists() { fs::rename(target, backup).map_err(|e| fail(KnowledgeErrorCode::ValidationFailed, format!("Cannot back up {}: {e}", target.display())))?; }
            if !target.exists() { fs::rename(temp, target).map_err(|e| fail(KnowledgeErrorCode::ValidationFailed, format!("Cannot install {}: {e}", target.display())))?; }
        }
    }
    for file in &journal.files { let backup = Path::new(&file.backup); if backup.exists() { fs::remove_file(backup).map_err(|e| fail(KnowledgeErrorCode::ValidationFailed, format!("Cannot remove backup {}: {e}", backup.display())))?; } }
    Ok(())
}

/// Replays only operations whose database transaction was committed. It is
/// safe to call at every project open: completed renames are detected by the
/// missing temp file and journal removal is therefore idempotent.
#[tauri::command]
pub fn recover_ingest_transactions(project_path: String) -> Result<(), KnowledgeError> {
    let dir = journal_dir(&project_path); if !dir.exists() { return Ok(()); }
    for entry in fs::read_dir(&dir).map_err(|e| fail(KnowledgeErrorCode::ValidationFailed, e.to_string()))? {
        let path = entry.map_err(|e| fail(KnowledgeErrorCode::ValidationFailed, e.to_string()))?.path();
        if path.extension().and_then(|v| v.to_str()) != Some("json") { continue; }
        let bytes = fs::read(&path).map_err(|e| fail(KnowledgeErrorCode::ValidationFailed, e.to_string()))?;
        let journal: JournalFile = serde_json::from_slice(&bytes).map_err(|e| fail(KnowledgeErrorCode::ValidationFailed, format!("Invalid ingest journal {}: {e}", path.display())))?;
        if journal.state == "db_committed" { apply_journal(&journal)?; }
        else { for f in &journal.files { let _ = fs::remove_file(&f.temp); } }
        fs::remove_file(path).map_err(|e| fail(KnowledgeErrorCode::ValidationFailed, e.to_string()))?;
    }
    Ok(())
}

#[tauri::command]
pub fn commit_ingest_plan(project_path: String, input: CommitIngestPlanInput) -> Result<(), KnowledgeError> {
    if input.operation_id.is_empty() || input.operation_id.contains('/') || input.pages.is_empty() { return Err(fail(KnowledgeErrorCode::ValidationFailed, "Invalid ingest operation")); }
    let dir = journal_dir(&project_path); fs::create_dir_all(&dir).map_err(|e| fail(KnowledgeErrorCode::ValidationFailed, e.to_string()))?;
    let mut entries = Vec::new();
    let mut paths = std::collections::HashSet::new();
    let mut page_ids = std::collections::HashSet::new();
    let mut section_ids = std::collections::HashSet::new();
    for (index, document) in input.pages.iter().enumerate() {
        if !safe_relative_path(&document.relative_path) || document.page.page_path != document.relative_path { return Err(fail(KnowledgeErrorCode::ValidationFailed, "Unsafe path or page path mismatch")); }
        if !paths.insert(&document.relative_path) || !page_ids.insert(&document.page.page_id) { return Err(fail(KnowledgeErrorCode::ValidationFailed, "Duplicate page in ingest plan")); }
        if document.sections.iter().any(|s| s.page_id != document.page.page_id) { return Err(fail(KnowledgeErrorCode::ValidationFailed, "All sections must belong to their page")); }
        if document.sections.iter().any(|s| !section_ids.insert(&s.section_id)) { return Err(fail(KnowledgeErrorCode::ValidationFailed, "Duplicate section in ingest plan")); }
        let target = Path::new(&project_path).join(&document.relative_path);
        let parent = target.parent().ok_or_else(|| fail(KnowledgeErrorCode::ValidationFailed, "Target has no parent"))?;
        fs::create_dir_all(parent).map_err(|e| fail(KnowledgeErrorCode::ValidationFailed, e.to_string()))?;
        let temp = parent.join(format!(".{}.{}.tmp", target.file_name().unwrap().to_string_lossy(), input.operation_id));
        let backup = parent.join(format!(".{}.{}.bak", target.file_name().unwrap().to_string_lossy(), input.operation_id));
        entries.push(JournalEntry { target: target.to_string_lossy().into_owned(), temp: temp.to_string_lossy().into_owned(), backup: backup.to_string_lossy().into_owned() });
        let _ = index;
    }
    let journal_path = dir.join(format!("{}.json", input.operation_id));
    let mut journal = JournalFile { operation_id: input.operation_id, state: "staged".into(), files: entries };
    persist_journal(&journal_path, &journal)?;
    // Persist the recovery record before creating any temporary replacement.
    // A crash while staging therefore has a deterministic cleanup path on the
    // next project open instead of leaving an untracked partial temp file.
    for (document, entry) in input.pages.iter().zip(journal.files.iter()) {
        if let Err(error) = write_synced(Path::new(&entry.temp), document.content.as_bytes()) {
            for file in &journal.files { let _ = fs::remove_file(&file.temp); }
            let _ = fs::remove_file(&journal_path);
            return Err(error);
        }
    }
    let result = (|| -> Result<(), KnowledgeError> {
        let mut connection = db::open_project(&project_path, true)?;
        let tx = connection.transaction().map_err(sql)?;
        for document in &input.pages {
            let p = &document.page;
            tx.execute("INSERT INTO pages VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(page_id) DO UPDATE SET page_path=excluded.page_path,title=excluded.title,page_type=excluded.page_type,summary=excluded.summary,primary_entity_id=excluded.primary_entity_id,updated_at=excluded.updated_at",params![p.page_id,p.page_path,p.title,p.page_type,p.summary,p.primary_entity_id,p.updated_at]).map_err(sql)?;
            tx.execute("DELETE FROM sections WHERE page_id=?1",[&p.page_id]).map_err(sql)?;
            for s in &document.sections { tx.execute("INSERT INTO sections VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",params![s.section_id,s.page_id,s.parent_id,s.heading_level,s.heading_text,s.section_type,s.ui_scope,s.ui_anchor,s.ui_layer,s.ui_aspect,s.content_entity_id,s.host_entity_id,s.ordinal,s.summary]).map_err(sql)?; }
        }
        for write in &input.assertions {
            if write.subject_name.trim().is_empty()||write.object_name.trim().is_empty()||write.predicate.trim().is_empty()||write.relation_description.trim().is_empty(){return Err(fail(KnowledgeErrorCode::ValidationFailed,"Ingest assertion fields are required"));}
            let graph_exists:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM graphs WHERE graph_id=?1)",[&write.graph_id],|r|r.get(0)).map_err(sql)?;if !graph_exists{return Err(fail(KnowledgeErrorCode::NotFound,"Ingest graph does not exist"));}
            let subject=resolve_or_create_ingest_entity(&tx,&write.subject_name,&write.subject_type)?;let object=resolve_or_create_ingest_entity(&tx,&write.object_name,&write.object_type)?;
            let relation_exists:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM relation_types WHERE graph_id=?1 AND name=?2)",params![write.graph_id,write.predicate],|r|r.get(0)).map_err(sql)?;
            if !relation_exists { tx.execute("INSERT INTO relation_types VALUES(?1,?2,?3,?4,?5,NULL,0,'many')",params![write.graph_id,write.predicate,write.relation_description,json!([write.subject_type]).to_string(),json!([write.object_type]).to_string()]).map_err(sql)?; }
            tx.execute("INSERT OR IGNORE INTO graph_nodes(node_id,graph_id,entity_id,role) VALUES(?1,?2,?3,NULL)",params![id("node"),write.graph_id,subject.entity_id]).map_err(sql)?;tx.execute("INSERT OR IGNORE INTO graph_nodes(node_id,graph_id,entity_id,role) VALUES(?1,?2,?3,NULL)",params![id("node"),write.graph_id,object.entity_id]).map_err(sql)?;
            let record=assertion(&tx,CreateAssertionInput{graph_id:write.graph_id.clone(),subject_entity_id:subject.entity_id,predicate:write.predicate.clone(),object_entity_id:object.entity_id,evidence:Some(vec![CreateEvidenceInput{page_id:Some(write.page_id.clone()),section_id:Some(write.section_id.clone()),quote:write.quote.clone(),confidence:Some(1.0)}])},"ingest")?;
            let _=record;
        }
        tx.commit().map_err(sql)?;
        Ok(())
    })();
    if let Err(error) = result { for file in &journal.files { let _ = fs::remove_file(&file.temp); } let _ = fs::remove_file(&journal_path); return Err(error); }
    journal.state = "db_committed".into(); persist_journal(&journal_path, &journal)?;
    apply_journal(&journal)?;
    fs::remove_file(&journal_path).map_err(|e| fail(KnowledgeErrorCode::ValidationFailed, e.to_string()))?;
    Ok(())
}

fn validate_entity_types(tx: &Transaction<'_>, graph_id: &str, predicate: &str, subject: &str, object: &str) -> Result<(bool, String), KnowledgeError> {
    if ["RELATED", "LINKED", "ASSOCIATED"].contains(&predicate.trim().to_uppercase().as_str()) {
        return Err(fail(KnowledgeErrorCode::ValidationFailed, "Generic relation predicate is forbidden"));
    }
    let row: Option<(String, String, bool, String)> = tx.query_row("SELECT subject_types, object_types, symmetric, object_cardinality FROM relation_types WHERE graph_id=?1 AND name=?2", params![graph_id, predicate], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional().map_err(sql)?;
    let (subjects, objects, symmetric, cardinality) = row.ok_or_else(|| fail(KnowledgeErrorCode::NotFound, "Relation type does not exist"))?;
    let subject_type: String = tx.query_row("SELECT entity_type FROM entities WHERE entity_id=?1", [subject], |r| r.get(0)).optional().map_err(sql)?.ok_or_else(|| fail(KnowledgeErrorCode::NotFound, "Subject entity does not exist"))?;
    let object_type: String = tx.query_row("SELECT entity_type FROM entities WHERE entity_id=?1", [object], |r| r.get(0)).optional().map_err(sql)?.ok_or_else(|| fail(KnowledgeErrorCode::NotFound, "Object entity does not exist"))?;
    let allowed_subjects: Vec<String> = serde_json::from_str(&subjects).map_err(|_| fail(KnowledgeErrorCode::ValidationFailed, "Invalid relation subject types"))?;
    let allowed_objects: Vec<String> = serde_json::from_str(&objects).map_err(|_| fail(KnowledgeErrorCode::ValidationFailed, "Invalid relation object types"))?;
    if !allowed_subjects.contains(&subject_type) || !allowed_objects.contains(&object_type) { return Err(fail(KnowledgeErrorCode::ValidationFailed, "Entity types violate relation type")); }
    Ok((symmetric, cardinality))
}

fn assertion(tx: &Transaction<'_>, input: CreateAssertionInput, origin: &str) -> Result<AssertionRecord, KnowledgeError> {
    let (symmetric, cardinality) = validate_entity_types(tx, &input.graph_id, &input.predicate, &input.subject_entity_id, &input.object_entity_id)?;
    let (subject, object) = if symmetric && input.subject_entity_id > input.object_entity_id {(input.object_entity_id, input.subject_entity_id)} else {(input.subject_entity_id, input.object_entity_id)};
    let existing: Option<AssertionRecord> = tx.query_row("SELECT assertion_id,graph_id,subject_entity_id,predicate,object_entity_id,origin,status,created_at FROM assertions WHERE graph_id=?1 AND subject_entity_id=?2 AND predicate=?3 AND object_entity_id=?4 AND status IN ('active','review') ORDER BY status='active' DESC LIMIT 1", params![input.graph_id, subject, input.predicate, object], |r| Ok(AssertionRecord { assertion_id:r.get(0)?,graph_id:r.get(1)?,subject_entity_id:r.get(2)?,predicate:r.get(3)?,object_entity_id:r.get(4)?,origin:r.get(5)?,status:r.get(6)?,created_at:r.get(7)?})).optional().map_err(sql)?;
    if let Some(record) = existing { for evidence in input.evidence.unwrap_or_default(){if let Some(section_id)=&evidence.section_id{let section_page:Option<String>=tx.query_row("SELECT page_id FROM sections WHERE section_id=?1",[section_id],|r|r.get(0)).optional().map_err(sql)?;if section_page.as_deref()!=evidence.page_id.as_deref(){return Err(fail(KnowledgeErrorCode::ValidationFailed,"Evidence section must belong to its page"));}}tx.execute("INSERT OR IGNORE INTO assertion_evidence(evidence_id,assertion_id,page_id,section_id,evidence_type,quote,confidence) VALUES(?1,?2,?3,?4,'supports',?5,?6)",params![id("evidence"),record.assertion_id,evidence.page_id,evidence.section_id,evidence.quote,evidence.confidence]).map_err(sql)?;}return Ok(record); }
    let conflict: bool = cardinality == "one" && tx.query_row("SELECT EXISTS(SELECT 1 FROM assertions WHERE graph_id=?1 AND subject_entity_id=?2 AND predicate=?3 AND status='active' AND object_entity_id<>?4)", params![input.graph_id, subject, input.predicate, object], |r| r.get(0)).map_err(sql)?;
    let record = AssertionRecord { assertion_id:id("assert"), graph_id:input.graph_id, subject_entity_id:subject, predicate:input.predicate, object_entity_id:object, origin:origin.to_string(), status:if conflict {"review".into()} else {"active".into()}, created_at:Utc::now().to_rfc3339() };
    tx.execute("INSERT INTO assertions VALUES (?1,?2,?3,?4,?5,?6,?7,?8)", params![record.assertion_id,record.graph_id,record.subject_entity_id,record.predicate,record.object_entity_id,record.origin,record.status,record.created_at]).map_err(sql)?;
    for evidence in input.evidence.unwrap_or_default() {
        if let Some(section_id) = &evidence.section_id {
            let section_page: Option<String> = tx.query_row("SELECT page_id FROM sections WHERE section_id=?1", [section_id], |r| r.get(0)).optional().map_err(sql)?;
            if section_page.as_deref() != evidence.page_id.as_deref() { return Err(fail(KnowledgeErrorCode::ValidationFailed, "Evidence section must belong to its page")); }
        }
        tx.execute("INSERT INTO assertion_evidence (evidence_id,assertion_id,page_id,section_id,evidence_type,quote,confidence) VALUES (?1,?2,?3,?4,'supports',?5,?6)", params![id("evidence"),record.assertion_id,evidence.page_id,evidence.section_id,evidence.quote,evidence.confidence]).map_err(sql)?;
    }
    Ok(record)
}

#[tauri::command]
pub fn bootstrap_knowledge_db(project_path: String) -> Result<KnowledgeDbStatus, KnowledgeError> { let conn = db::open_project(&project_path, true)?; Ok(KnowledgeDbStatus { schema_version: 1, foreign_keys_enabled: conn.query_row("PRAGMA foreign_keys", [], |r| r.get::<_,i64>(0)).unwrap_or(0)==1, bootstrapped:true }) }
#[tauri::command]
pub fn get_knowledge_db_status(project_path: String) -> Result<KnowledgeDbStatus, KnowledgeError> { let conn = db::open_project(&project_path, false)?; let version=conn.query_row("PRAGMA user_version",[],|r|r.get(0)).map_err(sql)?; Ok(KnowledgeDbStatus {schema_version:version,foreign_keys_enabled:conn.query_row("PRAGMA foreign_keys",[],|r|r.get::<_,i64>(0)).map_err(sql)?==1,bootstrapped:true}) }

#[tauri::command]
pub fn upsert_page_document(project_path: String, input: UpsertPageDocumentInput) -> Result<PageRecord, KnowledgeError> {
 let mut c=db::open_project(&project_path,true)?; let tx=c.transaction().map_err(sql)?; let p=&input.page;
 tx.execute("INSERT INTO pages VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(page_id) DO UPDATE SET page_path=excluded.page_path,title=excluded.title,page_type=excluded.page_type,summary=excluded.summary,primary_entity_id=excluded.primary_entity_id,updated_at=excluded.updated_at",params![p.page_id,p.page_path,p.title,p.page_type,p.summary,p.primary_entity_id,p.updated_at]).map_err(sql)?;
 tx.execute("DELETE FROM sections WHERE page_id=?1",[&p.page_id]).map_err(sql)?;
 for s in &input.sections { if s.page_id!=p.page_id {return Err(fail(KnowledgeErrorCode::ValidationFailed,"All sections must belong to page"));} tx.execute("INSERT INTO sections VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",params![s.section_id,s.page_id,s.parent_id,s.heading_level,s.heading_text,s.section_type,s.ui_scope,s.ui_anchor,s.ui_layer,s.ui_aspect,s.content_entity_id,s.host_entity_id,s.ordinal,s.summary]).map_err(sql)?; }
 for s in &input.sections { if let Some(parent)=&s.parent_id { let parent_page:String=tx.query_row("SELECT page_id FROM sections WHERE section_id=?1",[parent],|r|r.get(0)).map_err(sql)?; if parent_page!=p.page_id{return Err(fail(KnowledgeErrorCode::ValidationFailed,"Section parent must be on the same page"));} } }
 tx.commit().map_err(sql)?; Ok(input.page)
}

#[tauri::command]
pub fn create_or_link_entity(project_path:String,input:CreateOrLinkEntityInput)->Result<EntityRecord,KnowledgeError>{let mut c=db::open_project(&project_path,true)?;let tx=c.transaction().map_err(sql)?;let norm=normalized_alias(&input.canonical_name);let found:Option<EntityRecord>=tx.query_row("SELECT e.entity_id,e.canonical_name,e.entity_type,e.description FROM entity_aliases a JOIN entities e ON e.entity_id=a.entity_id WHERE a.normalized_alias=?1",[&norm],|r|Ok(EntityRecord{entity_id:r.get(0)?,canonical_name:r.get(1)?,entity_type:r.get(2)?,description:r.get(3)?})).optional().map_err(sql)?;let record=if let Some(e)=found{e}else{let e=EntityRecord{entity_id:input.entity_id.unwrap_or_else(||id("ent")),canonical_name:input.canonical_name,entity_type:input.entity_type,description:input.description};tx.execute("INSERT INTO entities VALUES(?1,?2,?3,?4)",params![e.entity_id,e.canonical_name,e.entity_type,e.description]).map_err(sql)?;e};let mut aliases=input.aliases.unwrap_or_default();aliases.push(record.canonical_name.clone());for alias in aliases{let n=normalized_alias(&alias);tx.execute("INSERT INTO entity_aliases VALUES(?1,?2,?3) ON CONFLICT(normalized_alias) DO NOTHING",params![record.entity_id,alias,n]).map_err(sql)?;}tx.commit().map_err(sql)?;Ok(record)}

#[tauri::command]
pub fn register_graph(project_path:String, graph:GraphRecord)->Result<GraphRecord,KnowledgeError>{let c=db::open_project(&project_path,true)?;c.execute("INSERT INTO graphs VALUES(?1,?2,?3) ON CONFLICT(graph_id) DO UPDATE SET graph_name=excluded.graph_name,purpose=excluded.purpose",params![graph.graph_id,graph.graph_name,graph.purpose]).map_err(sql)?;Ok(graph)}
#[tauri::command]
pub fn rename_knowledge_graph(project_path:String,input:RenameGraphInput)->Result<GraphRecord,KnowledgeError>{let c=db::open_project(&project_path,true)?;let n=c.execute("UPDATE graphs SET graph_name=?1 WHERE graph_id=?2",params![input.graph_name.trim(),input.graph_id]).map_err(sql)?;if n==0{return Err(fail(KnowledgeErrorCode::NotFound,"Graph does not exist"));}c.query_row("SELECT graph_id,graph_name,purpose FROM graphs WHERE graph_id=?1",[input.graph_id],|r|Ok(GraphRecord{graph_id:r.get(0)?,graph_name:r.get(1)?,purpose:r.get(2)?})).map_err(sql)}
#[tauri::command]
pub fn delete_knowledge_graph(project_path:String,graph_id:String)->Result<(),KnowledgeError>{let c=db::open_project(&project_path,true)?;let n=c.execute("DELETE FROM graphs WHERE graph_id=?1",[graph_id]).map_err(sql)?;if n==0{return Err(fail(KnowledgeErrorCode::NotFound,"Graph does not exist"));}Ok(())}
#[tauri::command]
pub fn list_knowledge_graphs(project_path:String)->Result<Vec<GraphRecord>,KnowledgeError>{let c=db::open_project(&project_path,false)?;let mut q=c.prepare("SELECT graph_id,graph_name,purpose FROM graphs ORDER BY graph_name").map_err(sql)?;let rows=q.query_map([],|r|Ok(GraphRecord{graph_id:r.get(0)?,graph_name:r.get(1)?,purpose:r.get(2)?})).map_err(sql)?;let result=rows.collect::<Result<Vec<_>,_>>().map_err(sql)?;Ok(result)}
#[tauri::command]
pub fn register_relation_type(project_path:String,input:RegisterRelationTypeInput)->Result<RelationTypeRecord,KnowledgeError>{let r=input.relation_type;if ["RELATED","LINKED","ASSOCIATED"].contains(&r.name.trim().to_uppercase().as_str()) {return Err(fail(KnowledgeErrorCode::ValidationFailed,"Generic relation predicate is forbidden"));}if r.name.trim().is_empty()||r.description.trim().is_empty()||r.subject_types.is_empty()||r.object_types.is_empty()||!matches!(r.object_cardinality.as_str(),"one"|"many"){return Err(fail(KnowledgeErrorCode::ValidationFailed,"Relation name, description, types, and cardinality are required"));}let c=db::open_project(&project_path,true)?;c.execute("INSERT INTO relation_types VALUES(?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(graph_id,name) DO UPDATE SET description=excluded.description,subject_types=excluded.subject_types,object_types=excluded.object_types,inverse_name=excluded.inverse_name,symmetric=excluded.symmetric,object_cardinality=excluded.object_cardinality",params![r.graph_id,r.name,r.description,json!(r.subject_types).to_string(),json!(r.object_types).to_string(),r.inverse_name,r.symmetric,r.object_cardinality]).map_err(sql)?;Ok(r)}
#[tauri::command]
pub fn list_knowledge_relation_types(project_path:String,graph_id:String)->Result<Vec<RelationTypeRecord>,KnowledgeError>{let c=db::open_project(&project_path,false)?;let mut q=c.prepare("SELECT graph_id,name,description,subject_types,object_types,inverse_name,symmetric,object_cardinality FROM relation_types WHERE graph_id=?1 ORDER BY name").map_err(sql)?;let rows=q.query_map([graph_id],|r|Ok(RelationTypeRecord{graph_id:r.get(0)?,name:r.get(1)?,description:r.get(2)?,subject_types:serde_json::from_str(&r.get::<_,String>(3)?).unwrap_or_default(),object_types:serde_json::from_str(&r.get::<_,String>(4)?).unwrap_or_default(),inverse_name:r.get(5)?,symmetric:r.get(6)?,object_cardinality:r.get(7)?})).map_err(sql)?.collect::<Result<Vec<_>,_>>().map_err(sql)?;Ok(rows)}
#[tauri::command]
pub fn rename_knowledge_relation_type(project_path:String,input:RenameRelationTypeInput)->Result<(),KnowledgeError>{let mut c=db::open_project(&project_path,true)?;let tx=c.transaction().map_err(sql)?;tx.execute_batch("PRAGMA defer_foreign_keys = ON").map_err(sql)?;let n=tx.execute("UPDATE relation_types SET name=?1 WHERE graph_id=?2 AND name=?3",params![input.new_name.trim(),input.graph_id,input.old_name]).map_err(sql)?;if n==0{return Err(fail(KnowledgeErrorCode::NotFound,"Relation type does not exist"));}tx.execute("UPDATE assertions SET predicate=?1 WHERE graph_id=?2 AND predicate=?3",params![input.new_name.trim(),input.graph_id,input.old_name]).map_err(sql)?;tx.commit().map_err(sql)?;Ok(())}
#[tauri::command]
pub fn delete_knowledge_relation_type(project_path:String,graph_id:String,name:String)->Result<(),KnowledgeError>{let mut c=db::open_project(&project_path,true)?;let tx=c.transaction().map_err(sql)?;let n=tx.execute("DELETE FROM assertions WHERE graph_id=?1 AND predicate=?2",params![graph_id,name]).map_err(sql)?;let deleted=tx.execute("DELETE FROM relation_types WHERE graph_id=?1 AND name=?2",params![graph_id,name]).map_err(sql)?;if deleted==0{return Err(fail(KnowledgeErrorCode::NotFound,"Relation type does not exist"));}let _=n;tx.commit().map_err(sql)?;Ok(())}

#[tauri::command]
pub fn create_assertion_with_evidence(project_path:String,input:CreateAssertionInput)->Result<AssertionRecord,KnowledgeError>{let mut c=db::open_project(&project_path,true)?;let tx=c.transaction().map_err(sql)?;let r=assertion(&tx,input,"ingest")?;tx.commit().map_err(sql)?;Ok(r)}
#[tauri::command]
pub fn create_manual_assertion(project_path:String,input:CreateAssertionInput)->Result<AssertionRecord,KnowledgeError>{let mut c=db::open_project(&project_path,true)?;let tx=c.transaction().map_err(sql)?;let r=assertion(&tx,input,"manual")?;tx.commit().map_err(sql)?;Ok(r)}
#[tauri::command]
pub fn edit_knowledge_assertion(project_path:String,input:EditAssertionInput)->Result<AssertionRecord,KnowledgeError>{
 let mut c=db::open_project(&project_path,true)?;let tx=c.transaction().map_err(sql)?;
 let origin:String=tx.query_row("SELECT origin FROM assertions WHERE assertion_id=?1",[&input.assertion_id],|r|r.get(0)).optional().map_err(sql)?.ok_or_else(||fail(KnowledgeErrorCode::NotFound,"Assertion does not exist"))?;
 let(symmetric,cardinality)=validate_entity_types(&tx,&input.graph_id,&input.predicate,&input.subject_entity_id,&input.object_entity_id)?;
 let(subject,object)=if symmetric&&input.subject_entity_id>input.object_entity_id{(input.object_entity_id,input.subject_entity_id)}else{(input.subject_entity_id,input.object_entity_id)};
 let conflict:bool=cardinality=="one"&&tx.query_row("SELECT EXISTS(SELECT 1 FROM assertions WHERE graph_id=?1 AND subject_entity_id=?2 AND predicate=?3 AND status='active' AND object_entity_id<>?4 AND assertion_id<>?5)",params![input.graph_id,subject,input.predicate,object,input.assertion_id],|r|r.get(0)).map_err(sql)?;
 let status=if conflict{"review"}else{"active"};
 tx.execute("UPDATE assertions SET graph_id=?1,subject_entity_id=?2,predicate=?3,object_entity_id=?4,status=?5 WHERE assertion_id=?6",params![input.graph_id,subject,input.predicate,object,status,input.assertion_id]).map_err(sql)?;
 tx.execute("DELETE FROM assertion_evidence WHERE assertion_id=?1",[&input.assertion_id]).map_err(sql)?;
 for evidence in input.evidence.unwrap_or_default(){if let Some(section_id)=&evidence.section_id{let section_page:Option<String>=tx.query_row("SELECT page_id FROM sections WHERE section_id=?1",[section_id],|r|r.get(0)).optional().map_err(sql)?;if section_page.as_deref()!=evidence.page_id.as_deref(){return Err(fail(KnowledgeErrorCode::ValidationFailed,"Evidence section must belong to its page"));}}tx.execute("INSERT INTO assertion_evidence(evidence_id,assertion_id,page_id,section_id,evidence_type,quote,confidence) VALUES(?1,?2,?3,?4,'supports',?5,?6)",params![id("evidence"),input.assertion_id,evidence.page_id,evidence.section_id,evidence.quote,evidence.confidence]).map_err(sql)?;}
 let record=tx.query_row("SELECT assertion_id,graph_id,subject_entity_id,predicate,object_entity_id,origin,status,created_at FROM assertions WHERE assertion_id=?1",[input.assertion_id],|r|Ok(AssertionRecord{assertion_id:r.get(0)?,graph_id:r.get(1)?,subject_entity_id:r.get(2)?,predicate:r.get(3)?,object_entity_id:r.get(4)?,origin:r.get(5)?,status:r.get(6)?,created_at:r.get(7)?})).map_err(sql)?;
 debug_assert_eq!(record.origin,origin);tx.commit().map_err(sql)?;Ok(record)
}
#[tauri::command]
pub fn resolve_cardinality_conflict(project_path:String,input:ResolveCardinalityConflictInput)->Result<(),KnowledgeError>{let mut c=db::open_project(&project_path,true)?;let tx=c.transaction().map_err(sql)?;let a:(String,String,String,String)=tx.query_row("SELECT graph_id,subject_entity_id,predicate,object_entity_id FROM assertions WHERE assertion_id=?1 AND status='review'",[&input.assertion_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional().map_err(sql)?.ok_or_else(||fail(KnowledgeErrorCode::NotFound,"Review assertion not found"))?;tx.execute("UPDATE assertions SET status='superseded' WHERE graph_id=?1 AND subject_entity_id=?2 AND predicate=?3 AND status='active'",params![a.0,a.1,a.2]).map_err(sql)?;tx.execute("UPDATE assertions SET status='active' WHERE assertion_id=?1",[input.assertion_id]).map_err(sql)?;tx.commit().map_err(sql)?;Ok(())}
#[tauri::command]
pub fn delete_page(project_path:String,page_id:String)->Result<(),KnowledgeError>{let c=db::open_project(&project_path,true)?;c.execute("DELETE FROM pages WHERE page_id=?1",[page_id]).map_err(sql)?;Ok(())}
#[tauri::command]
pub fn run_knowledge_integrity_check(project_path: String) -> Result<Vec<IntegrityIssue>, KnowledgeError> {
    let connection = db::open_project(&project_path, false)?;
    let mut issues = integrity::run(&connection)?;
    let root = Path::new(&project_path);
    let tag_schema = root.join(".llm-wiki/tag-schema.yaml");
    let schema_namespaces = match fs::read_to_string(&tag_schema) {
        Ok(text) if text.lines().any(|line| line.trim_start() == "namespaces:" || line.trim_start().starts_with("namespaces:")) => text.lines()
            .filter_map(|line| line.trim().strip_suffix(':'))
            .filter(|name| *name != "namespaces" && !name.contains(' '))
            .map(str::to_owned).collect::<std::collections::HashSet<_>>(),
        Ok(_) => {
            issues.push(IntegrityIssue { category: "tag_schema".into(), message: "tag-schema.yaml has no namespaces mapping".into(), record_id: None });
            std::collections::HashSet::new()
        }
        Err(_) => {
            issues.push(IntegrityIssue { category: "tag_schema".into(), message: "tag-schema.yaml is missing or unreadable".into(), record_id: None });
            std::collections::HashSet::new()
        }
    };
    let mut tags = connection.prepare("SELECT tag_id, namespace FROM tags").map_err(sql)?;
    for tag in tags.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))).map_err(sql)? {
        let (tag_id, namespace) = tag.map_err(sql)?;
        if !schema_namespaces.contains(&namespace) {
            issues.push(IntegrityIssue { category: "tag_schema".into(), message: format!("Tag namespace '{namespace}' is not declared"), record_id: Some(tag_id) });
        }
    }
    let journals = journal_dir(&project_path);
    if journals.is_dir() {
        for entry in fs::read_dir(&journals).map_err(|e| fail(KnowledgeErrorCode::ValidationFailed, e.to_string()))? {
            let path = entry.map_err(|e| fail(KnowledgeErrorCode::ValidationFailed, e.to_string()))?.path();
            if path.extension().and_then(|value| value.to_str()) == Some("json") {
                issues.push(IntegrityIssue { category: "recovery_journal".into(), message: "Unfinished ingest recovery journal".into(), record_id: path.file_name().map(|value| value.to_string_lossy().into_owned()) });
            }
        }
    }
    for scan_root in [root.join("db"), journals] { collect_orphan_write_files(&scan_root, &mut issues)?; }
    let mut pages = connection.prepare("SELECT page_id,page_path FROM pages").map_err(sql)?;
    let rows = pages.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))).map_err(sql)?.collect::<Result<Vec<_>, _>>().map_err(sql)?;
    for (page_id, page_path) in rows {
        let path = root.join(&page_path);
        let content = fs::read_to_string(&path).ok();
        if content.as_ref().is_none_or(|text| !text.contains(&format!("page_id: {page_id}"))) {
            issues.push(IntegrityIssue { category: "markdown_db_mismatch".into(), message: format!("Markdown page identity does not match {page_path}"), record_id: Some(page_id.clone()) });
            continue;
        }
        let mut sections = connection.prepare("SELECT section_id FROM sections WHERE page_id=?1").map_err(sql)?;
        for section in sections.query_map([&page_id], |row| row.get::<_, String>(0)).map_err(sql)? {
            let section = section.map_err(sql)?;
            if content.as_ref().is_none_or(|text| !text.contains(&format!("{{#{section}}}"))) {
                issues.push(IntegrityIssue { category: "markdown_db_mismatch".into(), message: format!("Markdown section identity is missing in {page_path}"), record_id: Some(section) });
            }
        }
    }
    Ok(issues)
}

fn collect_orphan_write_files(path: &Path, issues: &mut Vec<IntegrityIssue>) -> Result<(), KnowledgeError> {
    if !path.is_dir() { return Ok(()); }
    for entry in fs::read_dir(path).map_err(|e| fail(KnowledgeErrorCode::ValidationFailed, e.to_string()))? {
        let path = entry.map_err(|e| fail(KnowledgeErrorCode::ValidationFailed, e.to_string()))?.path();
        if path.is_dir() { collect_orphan_write_files(&path, issues)?; continue; }
        let name = path.file_name().and_then(|value| value.to_str()).unwrap_or_default();
        if name.ends_with(".tmp") || name.ends_with(".bak") {
            issues.push(IntegrityIssue { category: "orphan_write_file".into(), message: "Orphaned ingest temporary or backup file".into(), record_id: Some(path.to_string_lossy().into_owned()) });
        }
    }
    Ok(())
}

#[tauri::command]
pub fn get_knowledge_page(project_path:String,page_id:String)->Result<Option<PageRecord>,KnowledgeError>{let c=db::open_project(&project_path,false)?;c.query_row("SELECT page_id,page_path,title,page_type,summary,primary_entity_id,updated_at FROM pages WHERE page_id=?1",[page_id],|r|Ok(PageRecord{page_id:r.get(0)?,page_path:r.get(1)?,title:r.get(2)?,page_type:r.get(3)?,summary:r.get(4)?,primary_entity_id:r.get(5)?,updated_at:r.get(6)?})).optional().map_err(sql)}
#[tauri::command]
pub fn get_knowledge_section(project_path:String,section_id:String)->Result<Option<SectionRecord>,KnowledgeError>{let c=db::open_project(&project_path,false)?;c.query_row("SELECT section_id,page_id,parent_id,heading_level,heading_text,section_type,ui_scope,ui_anchor,ui_layer,ui_aspect,content_entity_id,host_entity_id,ordinal,summary FROM sections WHERE section_id=?1",[section_id],|r|Ok(SectionRecord{section_id:r.get(0)?,page_id:r.get(1)?,parent_id:r.get(2)?,heading_level:r.get(3)?,heading_text:r.get(4)?,section_type:r.get(5)?,ui_scope:r.get(6)?,ui_anchor:r.get(7)?,ui_layer:r.get(8)?,ui_aspect:r.get(9)?,content_entity_id:r.get(10)?,host_entity_id:r.get(11)?,ordinal:r.get(12)?,summary:r.get(13)?})).optional().map_err(sql)}
#[tauri::command]
pub fn find_knowledge_entities(project_path:String,query:String)->Result<Vec<EntityRecord>,KnowledgeError>{let c=db::open_project(&project_path,false)?;let needle=format!("%{}%",normalized_alias(&query));let mut s=c.prepare("SELECT DISTINCT e.entity_id,e.canonical_name,e.entity_type,e.description FROM entities e LEFT JOIN entity_aliases a ON a.entity_id=e.entity_id WHERE lower(e.canonical_name) LIKE ?1 OR a.normalized_alias LIKE ?1 ORDER BY e.canonical_name").map_err(sql)?;let rows=s.query_map([needle],|r|Ok(EntityRecord{entity_id:r.get(0)?,canonical_name:r.get(1)?,entity_type:r.get(2)?,description:r.get(3)?})).map_err(sql)?.collect::<Result<Vec<_>,_>>().map_err(sql);rows}
#[tauri::command]
pub fn list_knowledge_entities(project_path:String)->Result<Vec<EntityDetail>,KnowledgeError>{let c=db::open_project(&project_path,false)?;let mut q=c.prepare("SELECT entity_id,canonical_name,entity_type,description FROM entities ORDER BY canonical_name").map_err(sql)?;let entities=q.query_map([],|r|Ok(EntityRecord{entity_id:r.get(0)?,canonical_name:r.get(1)?,entity_type:r.get(2)?,description:r.get(3)?})).map_err(sql)?.collect::<Result<Vec<_>,_>>().map_err(sql)?;let mut out=Vec::new();for entity in entities{let mut aq=c.prepare("SELECT alias FROM entity_aliases WHERE entity_id=?1 AND normalized_alias<>?2 ORDER BY alias").map_err(sql)?;let aliases=aq.query_map(params![entity.entity_id,normalized_alias(&entity.canonical_name)],|r|r.get(0)).map_err(sql)?.collect::<Result<Vec<String>,_>>().map_err(sql)?;let mut nq=c.prepare("SELECT node_id FROM graph_nodes WHERE entity_id=?1 ORDER BY node_id").map_err(sql)?;let node_ids=nq.query_map([&entity.entity_id],|r|r.get(0)).map_err(sql)?.collect::<Result<Vec<String>,_>>().map_err(sql)?;out.push(EntityDetail{entity,aliases,node_ids});}Ok(out)}
#[tauri::command]
pub fn rename_knowledge_entity(project_path:String,input:RenameEntityInput)->Result<EntityRecord,KnowledgeError>{let name=input.canonical_name.trim();if name.is_empty(){return Err(fail(KnowledgeErrorCode::ValidationFailed,"Canonical name is required"));}let mut c=db::open_project(&project_path,true)?;let tx=c.transaction().map_err(sql)?;let n=tx.execute("UPDATE entities SET canonical_name=?1 WHERE entity_id=?2",params![name,input.entity_id]).map_err(sql)?;if n==0{return Err(fail(KnowledgeErrorCode::NotFound,"Entity does not exist"));}tx.execute("INSERT INTO entity_aliases(entity_id,alias,normalized_alias) VALUES(?1,?2,?3) ON CONFLICT(normalized_alias) DO UPDATE SET alias=excluded.alias",params![input.entity_id,name,normalized_alias(name)]).map_err(sql)?;let record=tx.query_row("SELECT entity_id,canonical_name,entity_type,description FROM entities WHERE entity_id=?1",[input.entity_id],|r|Ok(EntityRecord{entity_id:r.get(0)?,canonical_name:r.get(1)?,entity_type:r.get(2)?,description:r.get(3)?})).map_err(sql)?;tx.commit().map_err(sql)?;Ok(record)}
#[tauri::command]
pub fn add_knowledge_entity_alias(project_path:String,input:EntityAliasInput)->Result<(),KnowledgeError>{let alias=input.alias.trim();if alias.is_empty(){return Err(fail(KnowledgeErrorCode::ValidationFailed,"Alias is required"));}let c=db::open_project(&project_path,true)?;c.execute("INSERT INTO entity_aliases(entity_id,alias,normalized_alias) VALUES(?1,?2,?3)",params![input.entity_id,alias,normalized_alias(alias)]).map_err(sql)?;Ok(())}
#[tauri::command]
pub fn remove_knowledge_entity_alias(project_path:String,input:EntityAliasInput)->Result<(),KnowledgeError>{let c=db::open_project(&project_path,true)?;let canonical:String=c.query_row("SELECT canonical_name FROM entities WHERE entity_id=?1",[&input.entity_id],|r|r.get(0)).map_err(sql)?;if normalized_alias(&canonical)==normalized_alias(&input.alias){return Err(fail(KnowledgeErrorCode::ValidationFailed,"Canonical name alias cannot be removed"));}c.execute("DELETE FROM entity_aliases WHERE entity_id=?1 AND normalized_alias=?2",params![input.entity_id,normalized_alias(&input.alias)]).map_err(sql)?;Ok(())}
#[tauri::command]
pub fn merge_knowledge_entities(project_path:String,input:MergeEntitiesInput)->Result<(),KnowledgeError>{if input.source_entity_id==input.target_entity_id{return Err(fail(KnowledgeErrorCode::ValidationFailed,"Choose two different entities"));}let mut c=db::open_project(&project_path,true)?;let tx=c.transaction().map_err(sql)?;tx.execute_batch("PRAGMA defer_foreign_keys=ON").map_err(sql)?;tx.execute("DELETE FROM graph_nodes WHERE entity_id=?1 AND EXISTS(SELECT 1 FROM graph_nodes target WHERE target.graph_id=graph_nodes.graph_id AND target.entity_id=?2 AND target.role IS graph_nodes.role)",params![input.source_entity_id,input.target_entity_id]).map_err(sql)?;tx.execute("UPDATE graph_nodes SET entity_id=?1 WHERE entity_id=?2",params![input.target_entity_id,input.source_entity_id]).map_err(sql)?;tx.execute("UPDATE assertions SET subject_entity_id=?1 WHERE subject_entity_id=?2",params![input.target_entity_id,input.source_entity_id]).map_err(sql)?;tx.execute("UPDATE assertions SET object_entity_id=?1 WHERE object_entity_id=?2",params![input.target_entity_id,input.source_entity_id]).map_err(sql)?;tx.execute("UPDATE OR IGNORE page_entities SET entity_id=?1 WHERE entity_id=?2",params![input.target_entity_id,input.source_entity_id]).map_err(sql)?;tx.execute("DELETE FROM page_entities WHERE entity_id=?1",[&input.source_entity_id]).map_err(sql)?;tx.execute("UPDATE OR IGNORE entity_aliases SET entity_id=?1 WHERE entity_id=?2",params![input.target_entity_id,input.source_entity_id]).map_err(sql)?;tx.execute("DELETE FROM entity_aliases WHERE entity_id=?1",[&input.source_entity_id]).map_err(sql)?;tx.execute("DELETE FROM entities WHERE entity_id=?1",[input.source_entity_id]).map_err(sql)?;tx.commit().map_err(sql)?;Ok(())}
#[tauri::command]
pub fn split_knowledge_entity(project_path:String,input:SplitEntityInput)->Result<EntityRecord,KnowledgeError>{if input.node_ids.is_empty(){return Err(fail(KnowledgeErrorCode::ValidationFailed,"Select at least one graph projection"));}let mut c=db::open_project(&project_path,true)?;let tx=c.transaction().map_err(sql)?;let source_type:String=tx.query_row("SELECT entity_type FROM entities WHERE entity_id=?1",[&input.entity_id],|r|r.get(0)).optional().map_err(sql)?.ok_or_else(||fail(KnowledgeErrorCode::NotFound,"Entity does not exist"))?;let entity=EntityRecord{entity_id:id("ent"),canonical_name:input.canonical_name.trim().into(),entity_type:source_type,description:None};if entity.canonical_name.is_empty(){return Err(fail(KnowledgeErrorCode::ValidationFailed,"Canonical name is required"));}tx.execute("INSERT INTO entities VALUES(?1,?2,?3,?4)",params![entity.entity_id,entity.canonical_name,entity.entity_type,entity.description]).map_err(sql)?;tx.execute("INSERT INTO entity_aliases VALUES(?1,?2,?3)",params![entity.entity_id,entity.canonical_name,normalized_alias(&entity.canonical_name)]).map_err(sql)?;for node_id in input.node_ids{let graph_id:Option<String>=tx.query_row("SELECT graph_id FROM graph_nodes WHERE node_id=?1 AND entity_id=?2",params![node_id,input.entity_id],|r|r.get(0)).optional().map_err(sql)?;let graph_id=graph_id.ok_or_else(||fail(KnowledgeErrorCode::ValidationFailed,"Projection does not belong to entity"))?;tx.execute("UPDATE graph_nodes SET entity_id=?1 WHERE node_id=?2",params![entity.entity_id,node_id]).map_err(sql)?;tx.execute("UPDATE assertions SET subject_entity_id=?1 WHERE graph_id=?2 AND subject_entity_id=?3",params![entity.entity_id,graph_id,input.entity_id]).map_err(sql)?;tx.execute("UPDATE assertions SET object_entity_id=?1 WHERE graph_id=?2 AND object_entity_id=?3",params![entity.entity_id,graph_id,input.entity_id]).map_err(sql)?;}tx.commit().map_err(sql)?;Ok(entity)}
#[tauri::command]
pub fn delete_knowledge_entity(project_path:String,input:DeleteEntityInput)->Result<(),KnowledgeError>{let mut c=db::open_project(&project_path,true)?;let tx=c.transaction().map_err(sql)?;let current=entity_impact_revision(&tx,&input.entity_id)?;if current!=input.impact_revision{return Err(fail(KnowledgeErrorCode::ValidationFailed,"Delete impact changed; review the current impact before retrying"));}tx.execute("DELETE FROM assertions WHERE subject_entity_id=?1 OR object_entity_id=?1",[&input.entity_id]).map_err(sql)?;tx.execute("DELETE FROM graph_nodes WHERE entity_id=?1",[&input.entity_id]).map_err(sql)?;tx.execute("DELETE FROM page_entities WHERE entity_id=?1",[&input.entity_id]).map_err(sql)?;tx.execute("UPDATE pages SET primary_entity_id=NULL WHERE primary_entity_id=?1",[&input.entity_id]).map_err(sql)?;tx.execute("UPDATE sections SET content_entity_id=NULL WHERE content_entity_id=?1",[&input.entity_id]).map_err(sql)?;tx.execute("UPDATE sections SET host_entity_id=NULL WHERE host_entity_id=?1",[&input.entity_id]).map_err(sql)?;let n=tx.execute("DELETE FROM entities WHERE entity_id=?1",[input.entity_id]).map_err(sql)?;if n==0{return Err(fail(KnowledgeErrorCode::NotFound,"Entity does not exist"));}tx.commit().map_err(sql)?;Ok(())}

fn entity_for_node(tx: &Transaction<'_>, input: &CreateOrLinkGraphNodeInput) -> Result<EntityRecord, KnowledgeError> {
    if let Some(entity_id) = &input.entity_id { return tx.query_row("SELECT entity_id,canonical_name,entity_type,description FROM entities WHERE entity_id=?1", [entity_id], |r| Ok(EntityRecord { entity_id:r.get(0)?, canonical_name:r.get(1)?, entity_type:r.get(2)?, description:r.get(3)? })).optional().map_err(sql)?.ok_or_else(|| fail(KnowledgeErrorCode::NotFound, "Entity does not exist")); }
    let name=input.canonical_name.as_deref().map(str::trim).filter(|v|!v.is_empty()).ok_or_else(||fail(KnowledgeErrorCode::ValidationFailed,"Choose an entity or provide a canonical name"))?;
    let entity_type=input.entity_type.clone().filter(|v|!v.trim().is_empty()).ok_or_else(||fail(KnowledgeErrorCode::ValidationFailed,"Entity type is required"))?;
    let norm=normalized_alias(name);
    if let Some(e)=tx.query_row("SELECT e.entity_id,e.canonical_name,e.entity_type,e.description FROM entity_aliases a JOIN entities e ON e.entity_id=a.entity_id WHERE a.normalized_alias=?1",[&norm],|r|Ok(EntityRecord{entity_id:r.get(0)?,canonical_name:r.get(1)?,entity_type:r.get(2)?,description:r.get(3)?})).optional().map_err(sql)? { return Ok(e); }
    let e=EntityRecord{entity_id:id("ent"),canonical_name:name.into(),entity_type,description:input.description.clone()};
    tx.execute("INSERT INTO entities VALUES(?1,?2,?3,?4)",params![e.entity_id,e.canonical_name,e.entity_type,e.description]).map_err(sql)?;
    for alias in input.aliases.clone().unwrap_or_default().into_iter().chain(std::iter::once(e.canonical_name.clone())) { tx.execute("INSERT INTO entity_aliases VALUES(?1,?2,?3) ON CONFLICT(normalized_alias) DO NOTHING",params![e.entity_id,alias,normalized_alias(&alias)]).map_err(sql)?; }
    Ok(e)
}

#[tauri::command]
pub fn create_or_link_graph_node(project_path:String,input:CreateOrLinkGraphNodeInput)->Result<CreateOrLinkGraphNodeResult,KnowledgeError>{let mut c=db::open_project(&project_path,true)?;let tx=c.transaction().map_err(sql)?;let exists:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM graphs WHERE graph_id=?1)",[&input.graph_id],|r|r.get(0)).map_err(sql)?;if !exists{return Err(fail(KnowledgeErrorCode::NotFound,"Graph does not exist"));}let entity=entity_for_node(&tx,&input)?;let node=tx.query_row("SELECT node_id,graph_id,entity_id,role FROM graph_nodes WHERE graph_id=?1 AND entity_id=?2 AND role IS ?3",params![input.graph_id,entity.entity_id,input.role],|r|Ok(GraphNodeRecord{node_id:r.get(0)?,graph_id:r.get(1)?,entity_id:r.get(2)?,role:r.get(3)?})).optional().map_err(sql)?.unwrap_or_else(||GraphNodeRecord{node_id:id("node"),graph_id:input.graph_id.clone(),entity_id:entity.entity_id.clone(),role:input.role.clone()});tx.execute("INSERT INTO graph_nodes(node_id,graph_id,entity_id,role) VALUES(?1,?2,?3,?4) ON CONFLICT(node_id) DO NOTHING",params![node.node_id,node.graph_id,node.entity_id,node.role]).map_err(sql)?;tx.commit().map_err(sql)?;Ok(CreateOrLinkGraphNodeResult{node,entity})}

#[tauri::command]
pub fn list_allowed_relation_types(project_path:String,graph_id:String,source_entity_id:String,target_entity_id:String)->Result<Vec<RelationTypeRecord>,KnowledgeError>{let c=db::open_project(&project_path,false)?;let st:String=c.query_row("SELECT entity_type FROM entities WHERE entity_id=?1",[source_entity_id],|r|r.get(0)).optional().map_err(sql)?.ok_or_else(||fail(KnowledgeErrorCode::NotFound,"Source entity does not exist"))?;let ot:String=c.query_row("SELECT entity_type FROM entities WHERE entity_id=?1",[target_entity_id],|r|r.get(0)).optional().map_err(sql)?.ok_or_else(||fail(KnowledgeErrorCode::NotFound,"Target entity does not exist"))?;let mut q=c.prepare("SELECT graph_id,name,description,subject_types,object_types,inverse_name,symmetric,object_cardinality FROM relation_types WHERE graph_id=?1").map_err(sql)?;let rows=q.query_map([graph_id],|r|Ok(RelationTypeRecord{graph_id:r.get(0)?,name:r.get(1)?,description:r.get(2)?,subject_types:serde_json::from_str(&r.get::<_,String>(3)?).unwrap_or_default(),object_types:serde_json::from_str(&r.get::<_,String>(4)?).unwrap_or_default(),inverse_name:r.get(5)?,symmetric:r.get(6)?,object_cardinality:r.get(7)?})).map_err(sql)?.collect::<Result<Vec<_>,_>>().map_err(sql)?;Ok(rows.into_iter().filter(|r|r.subject_types.contains(&st)&&r.object_types.contains(&ot)).collect())}

#[tauri::command]
pub fn get_knowledge_graph_snapshot(project_path:String,graph_id:String)->Result<KnowledgeGraphSnapshot,KnowledgeError>{let c=db::open_project(&project_path,false)?;let graph=c.query_row("SELECT graph_id,graph_name,purpose FROM graphs WHERE graph_id=?1",[&graph_id],|r|Ok(GraphRecord{graph_id:r.get(0)?,graph_name:r.get(1)?,purpose:r.get(2)?})).optional().map_err(sql)?.ok_or_else(||fail(KnowledgeErrorCode::NotFound,"Graph does not exist"))?;let mut q=c.prepare("SELECT n.node_id,n.graph_id,n.entity_id,n.role,e.entity_id,e.canonical_name,e.entity_type,e.description FROM graph_nodes n JOIN entities e ON e.entity_id=n.entity_id WHERE n.graph_id=?1 ORDER BY e.canonical_name").map_err(sql)?;let nodes=q.query_map([&graph_id],|r|Ok(SnapshotNode{node:GraphNodeRecord{node_id:r.get(0)?,graph_id:r.get(1)?,entity_id:r.get(2)?,role:r.get(3)?},entity:EntityRecord{entity_id:r.get(4)?,canonical_name:r.get(5)?,entity_type:r.get(6)?,description:r.get(7)?}})).map_err(sql)?.collect::<Result<Vec<_>,_>>().map_err(sql)?;let mut aq=c.prepare("SELECT assertion_id,graph_id,subject_entity_id,predicate,object_entity_id,origin,status,created_at FROM assertions WHERE graph_id=?1 AND status IN ('active','review') ORDER BY created_at").map_err(sql)?;let assertions=aq.query_map([&graph_id],|r|Ok(AssertionRecord{assertion_id:r.get(0)?,graph_id:r.get(1)?,subject_entity_id:r.get(2)?,predicate:r.get(3)?,object_entity_id:r.get(4)?,origin:r.get(5)?,status:r.get(6)?,created_at:r.get(7)?})).map_err(sql)?.collect::<Result<Vec<_>,_>>().map_err(sql)?.into_iter().map(|a|{let mut eq=c.prepare("SELECT evidence_id,assertion_id,page_id,section_id,evidence_type,quote,confidence FROM assertion_evidence WHERE assertion_id=?1").map_err(sql)?;let evidence=eq.query_map([&a.assertion_id],|r|Ok(AssertionEvidenceRecord{evidence_id:r.get(0)?,assertion_id:r.get(1)?,page_id:r.get(2)?,section_id:r.get(3)?,evidence_type:r.get(4)?,quote:r.get(5)?,confidence:r.get(6)?})).map_err(sql)?.collect::<Result<Vec<_>,_>>().map_err(sql)?;let state=if evidence.iter().any(|e|e.evidence_type=="contradicts"){ "contradicted" }else if evidence.iter().any(|e|e.evidence_type=="supports"||e.evidence_type=="mentions"){ "documented" }else{ "manual" };Ok(SnapshotAssertion{assertion:a,evidence_state:state.into(),evidence})}).collect::<Result<Vec<_>,KnowledgeError>>()?;Ok(KnowledgeGraphSnapshot{graph,nodes,assertions})}

#[tauri::command]
pub fn get_knowledge_delete_impact(project_path:String,input:DeleteImpactInput)->Result<DeleteImpact,KnowledgeError>{
 let c=db::open_project(&project_path,false)?;
 let entity_id=if let Some(node)=input.node_id { c.query_row("SELECT entity_id FROM graph_nodes WHERE node_id=?1",[node],|r|r.get(0)).optional().map_err(sql)? } else { input.entity_id };
 let assertions=if let Some(a)=input.assertion_id { vec![a] } else if let Some(e)=entity_id.as_ref() { let mut q=c.prepare("SELECT assertion_id FROM assertions WHERE subject_entity_id=?1 OR object_entity_id=?1").map_err(sql)?; let result=q.query_map([e],|r|r.get(0)).map_err(sql)?.collect::<Result<Vec<String>,_>>().map_err(sql)?; result } else { vec![] };
 let mut evidence=Vec::new(); let mut pages=Vec::new();
 for a in &assertions { let mut q=c.prepare("SELECT evidence_id,page_id FROM assertion_evidence WHERE assertion_id=?1").map_err(sql)?; for x in q.query_map([a],|r|Ok((r.get::<_,String>(0)?,r.get::<_,Option<String>>(1)?))).map_err(sql)? { let(x,p)=x.map_err(sql)?; evidence.push(x); if let Some(p)=p { pages.push(p) } } }
 let nodes=if let Some(e)=entity_id.as_ref() { let mut q=c.prepare("SELECT node_id FROM graph_nodes WHERE entity_id=?1").map_err(sql)?; let result=q.query_map([e],|r|r.get(0)).map_err(sql)?.collect::<Result<Vec<String>,_>>().map_err(sql)?; result } else { vec![] };
 pages.sort();pages.dedup(); let revision=entity_id.as_ref().map(|id|entity_impact_revision(&c,id)).transpose()?.unwrap_or_default(); Ok(DeleteImpact{node_ids:nodes,assertion_ids:assertions,evidence_ids:evidence,page_ids:pages,revision})
}

fn entity_impact_revision(c:&rusqlite::Connection,entity_id:&str)->Result<String,KnowledgeError>{
 let mut values=Vec::new();
 for query in ["SELECT node_id FROM graph_nodes WHERE entity_id=?1 ORDER BY node_id","SELECT assertion_id FROM assertions WHERE subject_entity_id=?1 OR object_entity_id=?1 ORDER BY assertion_id","SELECT page_id FROM page_entities WHERE entity_id=?1 ORDER BY page_id","SELECT page_id FROM pages WHERE primary_entity_id=?1 ORDER BY page_id","SELECT section_id FROM sections WHERE content_entity_id=?1 OR host_entity_id=?1 ORDER BY section_id"] { let mut statement=c.prepare(query).map_err(sql)?; let rows=statement.query_map([entity_id],|r|r.get::<_,String>(0)).map_err(sql)?; for row in rows { values.push(row.map_err(sql)?); } }
 let mut evidence=c.prepare("SELECT evidence_id FROM assertion_evidence WHERE assertion_id IN (SELECT assertion_id FROM assertions WHERE subject_entity_id=?1 OR object_entity_id=?1) ORDER BY evidence_id").map_err(sql)?; for row in evidence.query_map([entity_id],|r|r.get::<_,String>(0)).map_err(sql)? { values.push(row.map_err(sql)?); }
 Ok(values.join("\u{1f}"))
}

#[tauri::command]
pub fn delete_graph_projection(project_path:String,node_id:String)->Result<(),KnowledgeError>{let c=db::open_project(&project_path,true)?;c.execute("DELETE FROM graph_nodes WHERE node_id=?1",[node_id]).map_err(sql)?;Ok(())}
#[tauri::command]
pub fn delete_assertion(project_path:String,assertion_id:String)->Result<(),KnowledgeError>{let c=db::open_project(&project_path,true)?;c.execute("DELETE FROM assertions WHERE assertion_id=?1",[assertion_id]).map_err(sql)?;Ok(())}
#[tauri::command]
pub fn reject_review_assertion(project_path:String,assertion_id:String)->Result<(),KnowledgeError>{let c=db::open_project(&project_path,true)?;let n=c.execute("DELETE FROM assertions WHERE assertion_id=?1 AND status='review'",[assertion_id]).map_err(sql)?;if n==0{return Err(fail(KnowledgeErrorCode::NotFound,"Review assertion not found"));}Ok(())}

#[derive(Clone)]
struct TraversalState { entity_id:String, graph_id:String, cost:i32, switches:i32, assertion_id:Option<String>, path:Vec<TraversalStep> }

fn traversal_path_key(path: &[TraversalStep]) -> String {
    path.iter().map(|step| format!("{}:{}:{}:{}:{}", step.kind, step.graph_id, step.entity_id, step.assertion_id.as_deref().unwrap_or(""), step.forward.unwrap_or(false))).collect::<Vec<_>>().join("|")
}

fn hit_is_better(candidate: &TraversalHit, current: &TraversalHit) -> bool {
    (candidate.cost, candidate.graph_switches, traversal_path_key(&candidate.path), candidate.assertion_id.as_deref().unwrap_or(""))
        < (current.cost, current.graph_switches, traversal_path_key(&current.path), current.assertion_id.as_deref().unwrap_or(""))
}

#[tauri::command]
pub fn traverse_knowledge_graph(project_path:String, request:TraversalRequest)->Result<Vec<TraversalHit>,KnowledgeError>{
 let c=db::open_project(&project_path,false)?; let max_cost=request.max_cost.unwrap_or(3).max(0); let max_switches=request.max_graph_switches.unwrap_or(2).max(0);
 let allowed:Option<std::collections::HashSet<String>>=request.allowed_graph_ids.map(|v|v.into_iter().collect());
 let mut seeds:std::collections::HashSet<String>=request.seed_entity_ids.unwrap_or_default().into_iter().collect();
 for page in request.seed_page_ids.unwrap_or_default() {
   let mut q=c.prepare("SELECT entity_id FROM page_entities WHERE page_id=?1 UNION SELECT a.subject_entity_id FROM assertion_evidence e JOIN assertions a ON a.assertion_id=e.assertion_id WHERE e.page_id=?1 UNION SELECT a.object_entity_id FROM assertion_evidence e JOIN assertions a ON a.assertion_id=e.assertion_id WHERE e.page_id=?1").map_err(sql)?;
   for id in q.query_map([page],|r|r.get::<_,String>(0)).map_err(sql)? { seeds.insert(id.map_err(sql)?); }
 }
 let mut pending=Vec::new();
 // Assertions are traversable even when a manually-created edge has no
 // canvas projection yet.  Starting from graph_nodes alone silently made
 // those assertions unreachable.
 for entity in seeds { let mut q=c.prepare("SELECT graph_id FROM graph_nodes WHERE entity_id=?1 UNION SELECT graph_id FROM assertions WHERE status IN ('active','review') AND (subject_entity_id=?1 OR object_entity_id=?1) ORDER BY graph_id").map_err(sql)?; for graph in q.query_map([&entity],|r|r.get::<_,String>(0)).map_err(sql)? { let graph=graph.map_err(sql)?; if allowed.as_ref().is_none_or(|a|a.contains(&graph)) { pending.push(TraversalState{entity_id:entity.clone(),graph_id:graph,cost:0,switches:0,assertion_id:None,path:vec![]}); } } }
 // A state with fewer hops but more graph switches does not dominate a
 // slightly longer state with switches remaining. Keep the Pareto frontier
 // for each (entity, graph), rather than one lexicographically "best" pair.
 let mut settled:std::collections::HashMap<(String,String), Vec<(i32,i32)>>=std::collections::HashMap::new();
 let mut hits:std::collections::HashMap<String, TraversalHit>=std::collections::HashMap::new();
 while !pending.is_empty() {
   pending.sort_by(|a,b|(a.cost,a.switches,&a.entity_id,&a.graph_id,traversal_path_key(&a.path)).cmp(&(b.cost,b.switches,&b.entity_id,&b.graph_id,traversal_path_key(&b.path)))); let state=pending.remove(0);
   let key=(state.entity_id.clone(),state.graph_id.clone());
   let frontier=settled.entry(key).or_default();
   if frontier.iter().any(|(cost,switches)| *cost<=state.cost && *switches<=state.switches) { continue; }
   frontier.retain(|(cost,switches)| !(state.cost<=*cost && state.switches<=*switches));
   frontier.push((state.cost,state.switches));
   let hit=TraversalHit{entity_id:state.entity_id.clone(),assertion_id:state.assertion_id.clone(),cost:state.cost,graph_switches:state.switches,path:state.path.clone()};
   match hits.get(&state.entity_id) { Some(current) if !hit_is_better(&hit,current) => {}, _ => { hits.insert(state.entity_id.clone(),hit); } }
   if state.cost>=max_cost { continue; }
   let mut aq=c.prepare("SELECT assertion_id,subject_entity_id,predicate,object_entity_id FROM assertions WHERE graph_id=?1 AND status IN ('active','review') AND (subject_entity_id=?2 OR object_entity_id=?2) ORDER BY assertion_id").map_err(sql)?;
   let rows=aq.query_map(params![state.graph_id,state.entity_id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?))).map_err(sql)?.collect::<Result<Vec<_>,_>>().map_err(sql)?;
   for (assertion,subject,predicate,object) in rows { let forward=subject==state.entity_id; let next=if forward {object}else{subject}; let mut path=state.path.clone(); path.push(TraversalStep{kind:"assertion".into(),graph_id:state.graph_id.clone(),entity_id:next.clone(),assertion_id:Some(assertion.clone()),predicate:Some(predicate),forward:Some(forward)}); pending.push(TraversalState{entity_id:next,graph_id:state.graph_id.clone(),cost:state.cost+1,switches:state.switches,assertion_id:Some(assertion),path}); }
   if state.switches<max_switches { let mut nq=c.prepare("SELECT graph_id FROM graph_nodes WHERE entity_id=?1 AND graph_id<>?2 ORDER BY graph_id").map_err(sql)?; for graph in nq.query_map(params![state.entity_id,state.graph_id],|r|r.get::<_,String>(0)).map_err(sql)? { let graph=graph.map_err(sql)?; if allowed.as_ref().is_some_and(|a|!a.contains(&graph)){continue;} let mut path=state.path.clone();path.push(TraversalStep{kind:"graph_switch".into(),graph_id:graph.clone(),entity_id:state.entity_id.clone(),assertion_id:None,predicate:None,forward:None});pending.push(TraversalState{entity_id:state.entity_id.clone(),graph_id:graph,cost:state.cost+1,switches:state.switches+1,assertion_id:None,path}); } }
 }
 let mut hits=hits.into_values().collect::<Vec<_>>();
 hits.sort_by(|a,b|(a.cost,a.graph_switches,&a.entity_id,traversal_path_key(&a.path),a.assertion_id.as_deref().unwrap_or("")).cmp(&(b.cost,b.graph_switches,&b.entity_id,traversal_path_key(&b.path),b.assertion_id.as_deref().unwrap_or("")))); Ok(hits)
}

#[cfg(test)]
mod recovery_tests {
    use super::*;

    #[test]
    fn committed_journal_replay_installs_temp_and_is_idempotent() {
        let project = std::env::temp_dir().join(format!("llm-wiki-ingest-recovery-{}", Uuid::new_v4()));
        let db = project.join("db");
        fs::create_dir_all(&db).unwrap();
        let target = db.join("page.md");
        let temp = db.join(".page.op.tmp");
        let backup = db.join(".page.op.bak");
        fs::write(&target, "old").unwrap();
        fs::write(&temp, "new").unwrap();
        let transactions = journal_dir(project.to_str().unwrap());
        fs::create_dir_all(&transactions).unwrap();
        let journal_path = transactions.join("op.json");
        persist_journal(&journal_path, &JournalFile {
            operation_id: "op".into(), state: "db_committed".into(),
            files: vec![JournalEntry {
                target: target.to_string_lossy().into_owned(),
                temp: temp.to_string_lossy().into_owned(),
                backup: backup.to_string_lossy().into_owned(),
            }],
        }).unwrap();

        recover_ingest_transactions(project.to_string_lossy().into_owned()).unwrap();
        recover_ingest_transactions(project.to_string_lossy().into_owned()).unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "new");
        assert!(!temp.exists() && !backup.exists() && !journal_path.exists());
        fs::remove_dir_all(project).unwrap();
    }
}
