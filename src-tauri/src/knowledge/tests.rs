use super::{commands, db, model::*};
use rusqlite::Connection;
use std::{fs, path::PathBuf};
use uuid::Uuid;

fn project() -> PathBuf { let path=std::env::temp_dir().join(format!("llm-wiki-knowledge-{}",Uuid::new_v4())); fs::create_dir_all(&path).unwrap(); path }
fn entity(project:&str,name:&str,kind:&str)->EntityRecord { commands::create_or_link_entity(project.into(),CreateOrLinkEntityInput{entity_id:None,canonical_name:name.into(),entity_type:kind.into(),description:None,aliases:None}).unwrap() }
// On Windows the SQLite file handle can outlive the connection Drop by a few
// milliseconds, so an immediate remove_dir_all hits a sharing violation
// (os error 32). Retry with a short backoff so cleanup is environment-independent.
fn cleanup(dir:&std::path::Path) { for _ in 0..20 { if fs::remove_dir_all(dir).is_ok() || !dir.exists() { return; } std::thread::sleep(std::time::Duration::from_millis(25)); } fs::remove_dir_all(dir).unwrap(); }

#[test]
fn bootstrap_is_versioned_and_enforces_foreign_keys_after_reopen() {
 let dir=project(); let project=dir.to_str().unwrap(); commands::bootstrap_knowledge_db(project.into()).unwrap();
 let db_path=db::path_for_project(project).unwrap(); let conn=Connection::open(&db_path).unwrap(); let conn=db::open_connection(conn,false).unwrap();
 assert_eq!(conn.query_row("PRAGMA user_version",[],|r|r.get::<_,i32>(0)).unwrap(),1);
 assert_eq!(conn.query_row("PRAGMA foreign_keys",[],|r|r.get::<_,i64>(0)).unwrap(),1);
 for table in ["pages","sections","entities","entity_aliases","graphs","relation_types","graph_nodes","assertions","assertion_evidence","page_entities","tags","page_tags"] { assert_eq!(conn.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",[table],|r|r.get::<_,i64>(0)).unwrap(),1); }
 drop(conn); cleanup(&dir);
}

#[test]
fn legacy_or_unknown_schema_is_refused() {
 let dir=project(); let path=dir.join("bad.sqlite"); let c=Connection::open(&path).unwrap(); c.execute_batch("CREATE TABLE nodes(x); PRAGMA user_version=9;").unwrap();
 let err=db::open_connection(Connection::open(path).unwrap(),true).unwrap_err(); assert!(err.to_string().contains("SCHEMA_VERSION_MISMATCH")); drop(c); cleanup(&dir);
}

#[test]
fn cardinality_conflict_and_alias_normalization_are_transactional() {
 let dir=project();let p=dir.to_str().unwrap();commands::bootstrap_knowledge_db(p.into()).unwrap();
 let a=entity(p,"Alpha","concept"); let a_same=commands::create_or_link_entity(p.into(),CreateOrLinkEntityInput{entity_id:None,canonical_name:"  ALPHA  ".into(),entity_type:"wrong".into(),description:None,aliases:None}).unwrap();assert_eq!(a.entity_id,a_same.entity_id);
 let b=entity(p,"Beta","concept");let c=entity(p,"Gamma","concept");let graph=GraphRecord{graph_id:"graph-a".into(),graph_name:"A".into(),purpose:"test".into()};commands::register_graph(p.into(),graph.clone()).unwrap();commands::register_relation_type(p.into(),RegisterRelationTypeInput{relation_type:RelationTypeRecord{graph_id:graph.graph_id.clone(),name:"PARENT".into(),description:"x".into(),subject_types:vec!["concept".into()],object_types:vec!["concept".into()],inverse_name:None,symmetric:false,object_cardinality:"one".into()}}).unwrap();
 let first=commands::create_manual_assertion(p.into(),CreateAssertionInput{graph_id:graph.graph_id.clone(),subject_entity_id:a.entity_id.clone(),predicate:"PARENT".into(),object_entity_id:b.entity_id,evidence:None}).unwrap();assert_eq!(first.status,"active");let review=commands::create_manual_assertion(p.into(),CreateAssertionInput{graph_id:graph.graph_id,subject_entity_id:a.entity_id,predicate:"PARENT".into(),object_entity_id:c.entity_id,evidence:None}).unwrap();assert_eq!(review.status,"review");commands::resolve_cardinality_conflict(p.into(),ResolveCardinalityConflictInput{assertion_id:review.assertion_id}).unwrap();cleanup(&dir);
}

#[test]
fn review_resolution_preserves_approved_ids_and_rejection_cascades_evidence() {
 let dir=project(); let p=dir.to_str().unwrap(); commands::bootstrap_knowledge_db(p.into()).unwrap();
 let a=entity(p,"Alpha","concept"); let b=entity(p,"Beta","concept"); let c=entity(p,"Gamma","concept");
 let graph=GraphRecord{graph_id:"g-review".into(),graph_name:"Review".into(),purpose:"test".into()}; commands::register_graph(p.into(),graph.clone()).unwrap(); commands::register_relation_type(p.into(),RegisterRelationTypeInput{relation_type:RelationTypeRecord{graph_id:graph.graph_id.clone(),name:"OWNER".into(),description:"owner".into(),subject_types:vec!["concept".into()],object_types:vec!["concept".into()],inverse_name:None,symmetric:false,object_cardinality:"one".into()}}).unwrap();
 let active=commands::create_manual_assertion(p.into(),CreateAssertionInput{graph_id:graph.graph_id.clone(),subject_entity_id:a.entity_id.clone(),predicate:"OWNER".into(),object_entity_id:b.entity_id.clone(),evidence:None}).unwrap();
 let approved=commands::create_manual_assertion(p.into(),CreateAssertionInput{graph_id:graph.graph_id.clone(),subject_entity_id:a.entity_id.clone(),predicate:"OWNER".into(),object_entity_id:c.entity_id.clone(),evidence:None}).unwrap(); assert_eq!(approved.status,"review");
 let db=db::open_project(p,false).unwrap(); db.execute("INSERT INTO assertion_evidence VALUES('ev-active',?1,NULL,NULL,'supports',NULL,NULL)",[&active.assertion_id]).unwrap(); db.execute("INSERT INTO assertion_evidence VALUES('ev-approved',?1,NULL,NULL,'supports',NULL,NULL)",[&approved.assertion_id]).unwrap(); drop(db);
 commands::resolve_cardinality_conflict(p.into(),ResolveCardinalityConflictInput{assertion_id:approved.assertion_id.clone()}).unwrap();
 let db=db::open_project(p,false).unwrap(); assert_eq!(db.query_row("SELECT status FROM assertions WHERE assertion_id=?1",[&active.assertion_id],|r|r.get::<_,String>(0)).unwrap(),"superseded"); assert_eq!(db.query_row("SELECT status FROM assertions WHERE assertion_id=?1",[&approved.assertion_id],|r|r.get::<_,String>(0)).unwrap(),"active"); assert_eq!(db.query_row("SELECT evidence_id FROM assertion_evidence WHERE assertion_id=?1",[&approved.assertion_id],|r|r.get::<_,String>(0)).unwrap(),"ev-approved"); drop(db);
 let rejected=commands::create_manual_assertion(p.into(),CreateAssertionInput{graph_id:graph.graph_id,subject_entity_id:a.entity_id,predicate:"OWNER".into(),object_entity_id:b.entity_id,evidence:None}).unwrap(); assert_eq!(rejected.status,"review");
 let db=db::open_project(p,false).unwrap(); db.execute("INSERT INTO assertion_evidence VALUES('ev-rejected',?1,NULL,NULL,'supports',NULL,NULL)",[&rejected.assertion_id]).unwrap(); drop(db);
 commands::reject_review_assertion(p.into(),rejected.assertion_id.clone()).unwrap(); let db=db::open_project(p,false).unwrap(); assert_eq!(db.query_row("SELECT COUNT(*) FROM assertions WHERE assertion_id=?1",[&rejected.assertion_id],|r|r.get::<_,i64>(0)).unwrap(),0); assert_eq!(db.query_row("SELECT COUNT(*) FROM assertion_evidence WHERE evidence_id='ev-rejected'",[],|r|r.get::<_,i64>(0)).unwrap(),0); drop(db);
 cleanup(&dir);
}

#[test]
fn assertion_edit_uses_stable_id_and_revalidates_cardinality() {
 let dir=project();let p=dir.to_str().unwrap();commands::bootstrap_knowledge_db(p.into()).unwrap();
 let a=entity(p,"Alpha","concept");let b=entity(p,"Beta","concept");let c=entity(p,"Gamma","concept");let graph=GraphRecord{graph_id:"g-edit".into(),graph_name:"Edit".into(),purpose:"test".into()};commands::register_graph(p.into(),graph.clone()).unwrap();commands::register_relation_type(p.into(),RegisterRelationTypeInput{relation_type:RelationTypeRecord{graph_id:graph.graph_id.clone(),name:"PARENT".into(),description:"parent".into(),subject_types:vec!["concept".into()],object_types:vec!["concept".into()],inverse_name:None,symmetric:false,object_cardinality:"one".into()}}).unwrap();
 let active=commands::create_manual_assertion(p.into(),CreateAssertionInput{graph_id:graph.graph_id.clone(),subject_entity_id:a.entity_id.clone(),predicate:"PARENT".into(),object_entity_id:b.entity_id,evidence:None}).unwrap();let edited=commands::edit_knowledge_assertion(p.into(),EditAssertionInput{assertion_id:active.assertion_id.clone(),graph_id:graph.graph_id,subject_entity_id:a.entity_id,predicate:"PARENT".into(),object_entity_id:c.entity_id,evidence:None}).unwrap();assert_eq!(edited.assertion_id,active.assertion_id);assert_eq!(edited.status,"active");cleanup(&dir);
}

#[test]
fn graph_projection_snapshot_and_delete_are_knowledge_db_only() {
 let dir=project(); let p=dir.to_str().unwrap(); commands::bootstrap_knowledge_db(p.into()).unwrap();
 let alpha=entity(p,"Alpha","concept"); let beta=entity(p,"Beta","concept");
 let graph=GraphRecord{graph_id:"g".into(),graph_name:"G".into(),purpose:"test".into()}; commands::register_graph(p.into(),graph.clone()).unwrap();
 commands::register_relation_type(p.into(),RegisterRelationTypeInput{relation_type:RelationTypeRecord{graph_id:graph.graph_id.clone(),name:"DEPENDS_ON".into(),description:"dependency".into(),subject_types:vec!["concept".into()],object_types:vec!["concept".into()],inverse_name:None,symmetric:false,object_cardinality:"many".into()}}).unwrap();
 let projection=commands::create_or_link_graph_node(p.into(),CreateOrLinkGraphNodeInput{graph_id:graph.graph_id.clone(),entity_id:None,canonical_name:Some(" alpha ".into()),entity_type:Some("wrong".into()),description:None,aliases:None,role:None}).unwrap(); assert_eq!(projection.entity.entity_id,alpha.entity_id);
 let beta_projection=commands::create_or_link_graph_node(p.into(),CreateOrLinkGraphNodeInput{graph_id:graph.graph_id.clone(),entity_id:Some(beta.entity_id.clone()),canonical_name:None,entity_type:None,description:None,aliases:None,role:None}).unwrap();
 let assertion=commands::create_manual_assertion(p.into(),CreateAssertionInput{graph_id:graph.graph_id.clone(),subject_entity_id:alpha.entity_id.clone(),predicate:"DEPENDS_ON".into(),object_entity_id:beta.entity_id,evidence:None}).unwrap();
 let allowed=commands::list_allowed_relation_types(p.into(),graph.graph_id.clone(),alpha.entity_id.clone(),beta_projection.entity.entity_id.clone()).unwrap(); assert_eq!(allowed[0].name,"DEPENDS_ON");
 let snapshot=commands::get_knowledge_graph_snapshot(p.into(),graph.graph_id.clone()).unwrap(); assert_eq!(snapshot.nodes.len(),2); assert_eq!(snapshot.assertions[0].evidence_state,"manual");
 let impact=commands::get_knowledge_delete_impact(p.into(),DeleteImpactInput{node_id:Some(projection.node.node_id.clone()),assertion_id:None,entity_id:None}).unwrap(); assert_eq!(impact.assertion_ids,vec![assertion.assertion_id]);
 commands::delete_graph_projection(p.into(),projection.node.node_id).unwrap(); assert_eq!(commands::get_knowledge_graph_snapshot(p.into(),graph.graph_id).unwrap().nodes.len(),1);
 cleanup(&dir);
}

#[test]
fn entity_delete_rechecks_the_reviewed_impact() {
 let dir=project(); let p=dir.to_str().unwrap(); commands::bootstrap_knowledge_db(p.into()).unwrap();
 let alpha=entity(p,"Alpha","concept"); let beta=entity(p,"Beta","concept");
 let graph=GraphRecord{graph_id:"g-delete".into(),graph_name:"Delete".into(),purpose:"test".into()}; commands::register_graph(p.into(),graph.clone()).unwrap(); commands::register_relation_type(p.into(),RegisterRelationTypeInput{relation_type:RelationTypeRecord{graph_id:graph.graph_id.clone(),name:"REL".into(),description:"relation".into(),subject_types:vec!["concept".into()],object_types:vec!["concept".into()],inverse_name:None,symmetric:false,object_cardinality:"many".into()}}).unwrap();
 let impact=commands::get_knowledge_delete_impact(p.into(),DeleteImpactInput{node_id:None,assertion_id:None,entity_id:Some(alpha.entity_id.clone())}).unwrap();
 commands::create_manual_assertion(p.into(),CreateAssertionInput{graph_id:graph.graph_id,subject_entity_id:alpha.entity_id.clone(),predicate:"REL".into(),object_entity_id:beta.entity_id,evidence:None}).unwrap();
 let err=commands::delete_knowledge_entity(p.into(),DeleteEntityInput{entity_id:alpha.entity_id.clone(),impact_revision:impact.revision}).unwrap_err(); assert_eq!(err.code,super::error::KnowledgeErrorCode::ValidationFailed);
 assert!(commands::find_knowledge_entities(p.into(),"Alpha".into()).unwrap().iter().any(|entity|entity.entity_id==alpha.entity_id)); cleanup(&dir);
}

#[test]
fn entity_merge_keeps_all_references_on_the_target_stable_id() {
 let dir=project(); let p=dir.to_str().unwrap(); commands::bootstrap_knowledge_db(p.into()).unwrap();
 let source=entity(p,"Source","concept"); let target=entity(p,"Target","concept"); commands::add_knowledge_entity_alias(p.into(),EntityAliasInput{entity_id:source.entity_id.clone(),alias:"Source alias".into()}).unwrap();
 let graph=GraphRecord{graph_id:"g-merge".into(),graph_name:"Merge".into(),purpose:"test".into()}; commands::register_graph(p.into(),graph.clone()).unwrap(); commands::register_relation_type(p.into(),RegisterRelationTypeInput{relation_type:RelationTypeRecord{graph_id:graph.graph_id.clone(),name:"REL".into(),description:"relation".into(),subject_types:vec!["concept".into()],object_types:vec!["concept".into()],inverse_name:None,symmetric:false,object_cardinality:"many".into()}}).unwrap();
 commands::create_or_link_graph_node(p.into(),CreateOrLinkGraphNodeInput{graph_id:graph.graph_id.clone(),entity_id:Some(source.entity_id.clone()),canonical_name:None,entity_type:None,description:None,aliases:None,role:None}).unwrap(); commands::create_manual_assertion(p.into(),CreateAssertionInput{graph_id:graph.graph_id.clone(),subject_entity_id:source.entity_id.clone(),predicate:"REL".into(),object_entity_id:target.entity_id.clone(),evidence:None}).unwrap();
 let c=db::open_project(p,true).unwrap(); c.execute("INSERT INTO pages(page_id,page_path,title,page_type,summary,primary_entity_id,updated_at) VALUES('page-merge','db/merge.md','Merge','guide',NULL,?1,'now')",[&source.entity_id]).unwrap(); c.execute("INSERT INTO page_entities(page_id,section_id,entity_id,role) VALUES('page-merge',NULL,?1,'mentions')",[&source.entity_id]).unwrap(); c.execute("INSERT INTO sections(section_id,page_id,parent_id,heading_level,heading_text,section_type,ui_scope,ui_anchor,ui_layer,ui_aspect,content_entity_id,host_entity_id,ordinal,summary) VALUES('sec-merge','page-merge',NULL,2,'Facts','overview',NULL,NULL,NULL,NULL,?1,?1,0,NULL)",[&source.entity_id]).unwrap(); drop(c);
 commands::merge_knowledge_entities(p.into(),MergeEntitiesInput{source_entity_id:source.entity_id.clone(),target_entity_id:target.entity_id.clone()}).unwrap();
 let snapshot=commands::get_knowledge_graph_snapshot(p.into(),graph.graph_id).unwrap(); assert!(snapshot.nodes.iter().any(|node|node.entity.entity_id==target.entity_id)); assert!(snapshot.assertions.iter().all(|assertion|assertion.assertion.subject_entity_id==target.entity_id || assertion.assertion.object_entity_id==target.entity_id));
 let c=db::open_project(p,false).unwrap(); assert_eq!(c.query_row("SELECT entity_id FROM page_entities WHERE page_id='page-merge'",[],|r|r.get::<_,String>(0)).unwrap(),target.entity_id); assert_eq!(c.query_row("SELECT entity_id FROM entity_aliases WHERE alias='Source alias'",[],|r|r.get::<_,String>(0)).unwrap(),target.entity_id);
 assert_eq!(c.query_row("SELECT primary_entity_id FROM pages WHERE page_id='page-merge'",[],|r|r.get::<_,String>(0)).unwrap(),target.entity_id);
 assert_eq!(c.query_row("SELECT content_entity_id FROM sections WHERE section_id='sec-merge'",[],|r|r.get::<_,String>(0)).unwrap(),target.entity_id);
 assert_eq!(c.query_row("SELECT host_entity_id FROM sections WHERE section_id='sec-merge'",[],|r|r.get::<_,String>(0)).unwrap(),target.entity_id);
 drop(c); cleanup(&dir);
}

#[test]
fn entity_split_moves_only_the_selected_graph_assertions() {
 let dir=project(); let p=dir.to_str().unwrap(); commands::bootstrap_knowledge_db(p.into()).unwrap();
 let source=entity(p,"Shared","concept"); let other=entity(p,"Other","concept");
 for graph in [GraphRecord{graph_id:"g-split-a".into(),graph_name:"A".into(),purpose:"test".into()},GraphRecord{graph_id:"g-split-b".into(),graph_name:"B".into(),purpose:"test".into()}] { commands::register_graph(p.into(),graph.clone()).unwrap(); commands::register_relation_type(p.into(),RegisterRelationTypeInput{relation_type:RelationTypeRecord{graph_id:graph.graph_id.clone(),name:"REL".into(),description:"relation".into(),subject_types:vec!["concept".into()],object_types:vec!["concept".into()],inverse_name:None,symmetric:false,object_cardinality:"many".into()}}).unwrap(); }
 let node_a=commands::create_or_link_graph_node(p.into(),CreateOrLinkGraphNodeInput{graph_id:"g-split-a".into(),entity_id:Some(source.entity_id.clone()),canonical_name:None,entity_type:None,description:None,aliases:None,role:None}).unwrap().node; commands::create_or_link_graph_node(p.into(),CreateOrLinkGraphNodeInput{graph_id:"g-split-b".into(),entity_id:Some(source.entity_id.clone()),canonical_name:None,entity_type:None,description:None,aliases:None,role:None}).unwrap();
 let a=commands::create_manual_assertion(p.into(),CreateAssertionInput{graph_id:"g-split-a".into(),subject_entity_id:source.entity_id.clone(),predicate:"REL".into(),object_entity_id:other.entity_id.clone(),evidence:None}).unwrap(); let b=commands::create_manual_assertion(p.into(),CreateAssertionInput{graph_id:"g-split-b".into(),subject_entity_id:source.entity_id.clone(),predicate:"REL".into(),object_entity_id:other.entity_id,evidence:None}).unwrap();
 let split=commands::split_knowledge_entity(p.into(),SplitEntityInput{entity_id:source.entity_id.clone(),canonical_name:"Split".into(),node_ids:vec![node_a.node_id]}).unwrap(); let c=db::open_project(p,false).unwrap(); assert_eq!(c.query_row("SELECT subject_entity_id FROM assertions WHERE assertion_id=?1",[a.assertion_id],|r|r.get::<_,String>(0)).unwrap(),split.entity_id); assert_eq!(c.query_row("SELECT subject_entity_id FROM assertions WHERE assertion_id=?1",[b.assertion_id],|r|r.get::<_,String>(0)).unwrap(),source.entity_id); drop(c); cleanup(&dir);
}

#[test]
fn ingest_plan_commits_page_assertion_and_evidence_as_one_operation() {
 let dir=project();let p=dir.to_str().unwrap();commands::bootstrap_knowledge_db(p.into()).unwrap();
 let graph=GraphRecord{graph_id:"g-ingest".into(),graph_name:"main".into(),purpose:"test".into()};commands::register_graph(p.into(),graph.clone()).unwrap();
 let page=PageRecord{page_id:"page-ingest".into(),page_path:"db/ingest.md".into(),title:"Ingest".into(),page_type:"guide".into(),summary:None,primary_entity_id:None,updated_at:"now".into()};
 let section=SectionRecord{section_id:"sec-ingest".into(),page_id:page.page_id.clone(),parent_id:None,heading_level:2,heading_text:"Facts".into(),section_type:"overview".into(),ui_scope:None,ui_anchor:None,ui_layer:None,ui_aspect:None,content_entity_id:None,host_entity_id:None,ordinal:0,summary:None};
 commands::commit_ingest_plan(p.into(),CommitIngestPlanInput{operation_id:"op-ingest".into(),pages:vec![IngestPageDocument{relative_path:page.page_path.clone(),content:"v2".into(),page,sections:vec![section]}],assertions:vec![IngestAssertionWrite{graph_id:graph.graph_id.clone(),subject_name:"Alpha".into(),subject_type:"concept".into(),predicate:"DEPENDS_ON".into(),relation_description:"dependency".into(),object_name:"Beta".into(),object_type:"concept".into(),page_id:"page-ingest".into(),section_id:"sec-ingest".into(),quote:Some("v2".into())}],origin:None}).unwrap();
 let snapshot=commands::get_knowledge_graph_snapshot(p.into(),graph.graph_id.clone()).unwrap();assert_eq!(snapshot.assertions.len(),1);assert_eq!(snapshot.assertions[0].evidence_state,"documented");assert_eq!(snapshot.assertions[0].evidence[0].section_id.as_deref(),Some("sec-ingest"));
 // Default origin is "ingest" when the field is omitted.
 assert_eq!(snapshot.assertions[0].assertion.origin,"ingest");
 cleanup(&dir);
}

#[test]
fn ingest_plan_records_user_chat_origin_and_rejects_unknown_origin() {
 let dir=project();let p=dir.to_str().unwrap();commands::bootstrap_knowledge_db(p.into()).unwrap();
 let graph=GraphRecord{graph_id:"g-chat".into(),graph_name:"main".into(),purpose:"test".into()};commands::register_graph(p.into(),graph.clone()).unwrap();
 let page=PageRecord{page_id:"page-chat".into(),page_path:"db/chat.md".into(),title:"Chat".into(),page_type:"reference".into(),summary:None,primary_entity_id:None,updated_at:"now".into()};
 let section=SectionRecord{section_id:"sec-chat".into(),page_id:page.page_id.clone(),parent_id:None,heading_level:2,heading_text:"Facts".into(),section_type:"overview".into(),ui_scope:None,ui_anchor:None,ui_layer:None,ui_aspect:None,content_entity_id:None,host_entity_id:None,ordinal:0,summary:None};
 let assertion=IngestAssertionWrite{graph_id:graph.graph_id.clone(),subject_name:"Alpha".into(),subject_type:"concept".into(),predicate:"DEPENDS_ON".into(),relation_description:"dependency".into(),object_name:"Beta".into(),object_type:"concept".into(),page_id:"page-chat".into(),section_id:"sec-chat".into(),quote:Some("v2".into())};
 // Step 12: the chat "위키에 저장" path stamps origin=user_chat.
 commands::commit_ingest_plan(p.into(),CommitIngestPlanInput{operation_id:"op-chat".into(),pages:vec![IngestPageDocument{relative_path:page.page_path.clone(),content:"v2".into(),page:page.clone(),sections:vec![section.clone()]}],assertions:vec![assertion.clone()],origin:Some("user_chat".into())}).unwrap();
 let snapshot=commands::get_knowledge_graph_snapshot(p.into(),graph.graph_id.clone()).unwrap();assert_eq!(snapshot.assertions.len(),1);assert_eq!(snapshot.assertions[0].assertion.origin,"user_chat");
 // An origin outside the schema CHECK set is refused before any write.
 let err=commands::commit_ingest_plan(p.into(),CommitIngestPlanInput{operation_id:"op-bad".into(),pages:vec![IngestPageDocument{relative_path:page.page_path.clone(),content:"v2".into(),page,sections:vec![section]}],assertions:vec![assertion],origin:Some("bogus".into())}).unwrap_err();
 assert!(err.to_string().contains("origin"));
 cleanup(&dir);
}

#[test]
fn traversal_respects_cost_switch_limit_and_graph_allowlist() {
 let dir=project(); let p=dir.to_str().unwrap(); commands::bootstrap_knowledge_db(p.into()).unwrap();
 let a=entity(p,"A","concept"); let b=entity(p,"B","concept"); let d=entity(p,"D","concept");
 for graph in [GraphRecord{graph_id:"g1".into(),graph_name:"G1".into(),purpose:"test".into()},GraphRecord{graph_id:"g2".into(),graph_name:"G2".into(),purpose:"test".into()}] { commands::register_graph(p.into(),graph.clone()).unwrap(); commands::register_relation_type(p.into(),RegisterRelationTypeInput{relation_type:RelationTypeRecord{graph_id:graph.graph_id,name:"REL".into(),description:"relation".into(),subject_types:vec!["concept".into()],object_types:vec!["concept".into()],inverse_name:None,symmetric:false,object_cardinality:"many".into()}}).unwrap(); }
 for (graph, entity_id) in [("g1",&a.entity_id),("g1",&b.entity_id),("g2",&b.entity_id),("g2",&d.entity_id)] { commands::create_or_link_graph_node(p.into(),CreateOrLinkGraphNodeInput{graph_id:graph.into(),entity_id:Some(entity_id.clone()),canonical_name:None,entity_type:None,description:None,aliases:None,role:None}).unwrap(); }
 commands::create_manual_assertion(p.into(),CreateAssertionInput{graph_id:"g1".into(),subject_entity_id:a.entity_id.clone(),predicate:"REL".into(),object_entity_id:b.entity_id.clone(),evidence:None}).unwrap();
 commands::create_manual_assertion(p.into(),CreateAssertionInput{graph_id:"g2".into(),subject_entity_id:b.entity_id.clone(),predicate:"REL".into(),object_entity_id:d.entity_id.clone(),evidence:None}).unwrap();
 let all=commands::traverse_knowledge_graph(p.into(),TraversalRequest{seed_page_ids:None,seed_entity_ids:Some(vec![a.entity_id.clone()]),allowed_graph_ids:None,max_cost:Some(3),max_graph_switches:Some(1),allowed_predicates:None}).unwrap(); assert!(all.iter().any(|h|h.entity_id==d.entity_id&&h.cost==3&&h.graph_switches==1));
 let scoped=commands::traverse_knowledge_graph(p.into(),TraversalRequest{seed_page_ids:None,seed_entity_ids:Some(vec![a.entity_id]),allowed_graph_ids:Some(vec!["g1".into()]),max_cost:Some(3),max_graph_switches:Some(2),allowed_predicates:None}).unwrap(); assert!(!scoped.iter().any(|h|h.entity_id==d.entity_id));
 cleanup(&dir);
}

#[test]
fn traversal_includes_manual_assertions_without_graph_projections_and_keeps_direction() {
 let dir=project(); let p=dir.to_str().unwrap(); commands::bootstrap_knowledge_db(p.into()).unwrap();
 let a=entity(p,"A","concept"); let b=entity(p,"B","concept");
 let graph=GraphRecord{graph_id:"g".into(),graph_name:"G".into(),purpose:"test".into()}; commands::register_graph(p.into(),graph.clone()).unwrap();
 commands::register_relation_type(p.into(),RegisterRelationTypeInput{relation_type:RelationTypeRecord{graph_id:graph.graph_id.clone(),name:"REL".into(),description:"relation".into(),subject_types:vec!["concept".into()],object_types:vec!["concept".into()],inverse_name:None,symmetric:false,object_cardinality:"many".into()}}).unwrap();
 let assertion=commands::create_manual_assertion(p.into(),CreateAssertionInput{graph_id:graph.graph_id,subject_entity_id:a.entity_id.clone(),predicate:"REL".into(),object_entity_id:b.entity_id.clone(),evidence:None}).unwrap();
 let forward=commands::traverse_knowledge_graph(p.into(),TraversalRequest{seed_page_ids:None,seed_entity_ids:Some(vec![a.entity_id.clone()]),allowed_graph_ids:None,max_cost:Some(1),max_graph_switches:Some(0),allowed_predicates:None}).unwrap();
 let hit=forward.iter().find(|hit|hit.entity_id==b.entity_id).unwrap(); assert_eq!(hit.cost,1); assert_eq!(hit.assertion_id.as_deref(),Some(assertion.assertion_id.as_str())); assert_eq!(hit.path[0].forward,Some(true));
 let backward=commands::traverse_knowledge_graph(p.into(),TraversalRequest{seed_page_ids:None,seed_entity_ids:Some(vec![b.entity_id]),allowed_graph_ids:None,max_cost:Some(1),max_graph_switches:Some(0),allowed_predicates:None}).unwrap();
 assert_eq!(backward.iter().find(|hit|hit.entity_id==a.entity_id).unwrap().path[0].forward,Some(false));
 cleanup(&dir);
}

#[test]
fn traversal_keeps_a_longer_path_when_it_preserves_graph_switch_budget() {
 let dir=project(); let p=dir.to_str().unwrap(); commands::bootstrap_knowledge_db(p.into()).unwrap();
 let names=["A","B","C","D","F","H","I","J","E","G"]; let entities=names.iter().map(|name|entity(p,name,"concept")).collect::<Vec<_>>();
 let by_name=|name:&str| entities.iter().find(|entity|entity.canonical_name==name).unwrap().entity_id.clone();
 for graph in [GraphRecord{graph_id:"g1".into(),graph_name:"G1".into(),purpose:"test".into()},GraphRecord{graph_id:"g2".into(),graph_name:"G2".into(),purpose:"test".into()}] { commands::register_graph(p.into(),graph.clone()).unwrap(); commands::register_relation_type(p.into(),RegisterRelationTypeInput{relation_type:RelationTypeRecord{graph_id:graph.graph_id,name:"REL".into(),description:"relation".into(),subject_types:vec!["concept".into()],object_types:vec!["concept".into()],inverse_name:None,symmetric:false,object_cardinality:"many".into()}}).unwrap(); }
 for name in ["A","B","C","D","F","H","I","J","E"] { commands::create_or_link_graph_node(p.into(),CreateOrLinkGraphNodeInput{graph_id:"g1".into(),entity_id:Some(by_name(name)),canonical_name:None,entity_type:None,description:None,aliases:None,role:None}).unwrap(); }
 for name in ["B","C","E","G"] { commands::create_or_link_graph_node(p.into(),CreateOrLinkGraphNodeInput{graph_id:"g2".into(),entity_id:Some(by_name(name)),canonical_name:None,entity_type:None,description:None,aliases:None,role:None}).unwrap(); }
 for (source,target) in [("A","B"),("C","E"),("A","D"),("D","F"),("F","H"),("H","I"),("I","J"),("J","E")] { commands::create_manual_assertion(p.into(),CreateAssertionInput{graph_id:"g1".into(),subject_entity_id:by_name(source),predicate:"REL".into(),object_entity_id:by_name(target),evidence:None}).unwrap(); }
 commands::create_manual_assertion(p.into(),CreateAssertionInput{graph_id:"g2".into(),subject_entity_id:by_name("B"),predicate:"REL".into(),object_entity_id:by_name("C"),evidence:None}).unwrap();
 commands::create_manual_assertion(p.into(),CreateAssertionInput{graph_id:"g2".into(),subject_entity_id:by_name("E"),predicate:"REL".into(),object_entity_id:by_name("G"),evidence:None}).unwrap();
 let hits=commands::traverse_knowledge_graph(p.into(),TraversalRequest{seed_page_ids:None,seed_entity_ids:Some(vec![by_name("A")]),allowed_graph_ids:None,max_cost:Some(8),max_graph_switches:Some(2),allowed_predicates:None}).unwrap();
 let goal=hits.iter().find(|hit|hit.entity_id==by_name("G")).unwrap(); assert_eq!((goal.cost,goal.graph_switches),(8,1));
 cleanup(&dir);
}

#[test]
fn traversal_allowed_predicates_filters_neighbour_expansion() {
 let dir=project(); let p=dir.to_str().unwrap(); commands::bootstrap_knowledge_db(p.into()).unwrap();
 let a=entity(p,"A","concept"); let b=entity(p,"B","concept"); let c=entity(p,"C","concept");
 let graph=GraphRecord{graph_id:"g-pred".into(),graph_name:"GPred".into(),purpose:"test".into()}; commands::register_graph(p.into(),graph.clone()).unwrap();
 for name in ["DEPENDS_ON","ATTACKS"] { commands::register_relation_type(p.into(),RegisterRelationTypeInput{relation_type:RelationTypeRecord{graph_id:graph.graph_id.clone(),name:name.into(),description:"relation".into(),subject_types:vec!["concept".into()],object_types:vec!["concept".into()],inverse_name:None,symmetric:false,object_cardinality:"many".into()}}).unwrap(); }
 // A --DEPENDS_ON--> B  and  A --ATTACKS--> C
 commands::create_manual_assertion(p.into(),CreateAssertionInput{graph_id:graph.graph_id.clone(),subject_entity_id:a.entity_id.clone(),predicate:"DEPENDS_ON".into(),object_entity_id:b.entity_id.clone(),evidence:None}).unwrap();
 commands::create_manual_assertion(p.into(),CreateAssertionInput{graph_id:graph.graph_id,subject_entity_id:a.entity_id.clone(),predicate:"ATTACKS".into(),object_entity_id:c.entity_id.clone(),evidence:None}).unwrap();
 // Unfiltered: both neighbours reachable.
 let all=commands::traverse_knowledge_graph(p.into(),TraversalRequest{seed_page_ids:None,seed_entity_ids:Some(vec![a.entity_id.clone()]),allowed_graph_ids:None,max_cost:Some(1),max_graph_switches:Some(0),allowed_predicates:None}).unwrap();
 assert!(all.iter().any(|h|h.entity_id==b.entity_id)); assert!(all.iter().any(|h|h.entity_id==c.entity_id));
 // Filtered to DEPENDS_ON: only B reachable, ATTACKS edge to C not expanded.
 let scoped=commands::traverse_knowledge_graph(p.into(),TraversalRequest{seed_page_ids:None,seed_entity_ids:Some(vec![a.entity_id]),allowed_graph_ids:None,max_cost:Some(1),max_graph_switches:Some(0),allowed_predicates:Some(vec!["DEPENDS_ON".into()])}).unwrap();
 assert!(scoped.iter().any(|h|h.entity_id==b.entity_id)); assert!(!scoped.iter().any(|h|h.entity_id==c.entity_id));
 cleanup(&dir);
}

#[test]
fn integrity_reports_schema_and_orphan_files_without_repairing_them() {
 let dir=project(); let p=dir.to_str().unwrap(); commands::bootstrap_knowledge_db(p.into()).unwrap();
 fs::write(dir.join(".llm-wiki/tag-schema.yaml"),"namespaces: {}\n").unwrap();
 let c=db::open_project(p,false).unwrap(); c.execute("INSERT INTO tags(tag_id,namespace,value) VALUES('tag-invalid','undeclared','value')",[]).unwrap(); drop(c);
 // Join components separately so the path uses OS-native separators and
 // matches what the integrity scan reports from read_dir (backslashes on
 // Windows); a literal "db/.page..." would keep a forward slash and mismatch.
 let orphan=dir.join("db").join(".page.operation.tmp"); fs::create_dir_all(orphan.parent().unwrap()).unwrap(); fs::write(&orphan,"uncommitted").unwrap();
 let issues=commands::run_knowledge_integrity_check(p.into()).unwrap();
 assert!(issues.iter().any(|issue|issue.category=="unused_tag"&&issue.record_id.as_deref()==Some("tag-invalid")));
 assert!(issues.iter().any(|issue|issue.category=="tag_schema"&&issue.record_id.as_deref()==Some("tag-invalid")));
 assert!(issues.iter().any(|issue|issue.category=="orphan_write_file"&&issue.record_id.as_deref()==Some(orphan.to_string_lossy().as_ref())));
 assert!(orphan.is_file());
 let c=db::open_project(p,false).unwrap(); assert_eq!(c.query_row("SELECT COUNT(*) FROM tags WHERE tag_id='tag-invalid'",[],|r|r.get::<_,i64>(0)).unwrap(),1); drop(c);
 cleanup(&dir);
}
