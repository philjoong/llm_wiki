use super::{commands, db, model::*};
use rusqlite::Connection;
use std::{fs, path::PathBuf};
use uuid::Uuid;

fn project() -> PathBuf { let path=std::env::temp_dir().join(format!("llm-wiki-knowledge-{}",Uuid::new_v4())); fs::create_dir_all(&path).unwrap(); path }
fn entity(project:&str,name:&str,kind:&str)->EntityRecord { commands::create_or_link_entity(project.into(),CreateOrLinkEntityInput{entity_id:None,canonical_name:name.into(),entity_type:kind.into(),description:None,aliases:None}).unwrap() }

#[test]
fn bootstrap_is_versioned_and_enforces_foreign_keys_after_reopen() {
 let dir=project(); let project=dir.to_str().unwrap(); commands::bootstrap_knowledge_db(project.into()).unwrap();
 let db_path=db::path_for_project(project).unwrap(); let conn=Connection::open(&db_path).unwrap(); let conn=db::open_connection(conn,false).unwrap();
 assert_eq!(conn.query_row("PRAGMA user_version",[],|r|r.get::<_,i32>(0)).unwrap(),1);
 assert_eq!(conn.query_row("PRAGMA foreign_keys",[],|r|r.get::<_,i64>(0)).unwrap(),1);
 for table in ["pages","sections","entities","entity_aliases","graphs","relation_types","graph_nodes","assertions","assertion_evidence","page_entities","tags","page_tags"] { assert_eq!(conn.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",[table],|r|r.get::<_,i64>(0)).unwrap(),1); }
 fs::remove_dir_all(dir).unwrap();
}

#[test]
fn legacy_or_unknown_schema_is_refused() {
 let dir=project(); let path=dir.join("bad.sqlite"); let c=Connection::open(&path).unwrap(); c.execute_batch("CREATE TABLE nodes(x); PRAGMA user_version=9;").unwrap();
 let err=db::open_connection(Connection::open(path).unwrap(),true).unwrap_err(); assert!(err.to_string().contains("SCHEMA_VERSION_MISMATCH")); fs::remove_dir_all(dir).unwrap();
}

#[test]
fn cardinality_conflict_and_alias_normalization_are_transactional() {
 let dir=project();let p=dir.to_str().unwrap();commands::bootstrap_knowledge_db(p.into()).unwrap();
 let a=entity(p,"Alpha","concept"); let a_same=commands::create_or_link_entity(p.into(),CreateOrLinkEntityInput{entity_id:None,canonical_name:"  ALPHA  ".into(),entity_type:"wrong".into(),description:None,aliases:None}).unwrap();assert_eq!(a.entity_id,a_same.entity_id);
 let b=entity(p,"Beta","concept");let c=entity(p,"Gamma","concept");let graph=GraphRecord{graph_id:"graph-a".into(),graph_name:"A".into(),purpose:"test".into()};commands::register_graph(p.into(),graph.clone()).unwrap();commands::register_relation_type(p.into(),RegisterRelationTypeInput{relation_type:RelationTypeRecord{graph_id:graph.graph_id.clone(),name:"PARENT".into(),description:"x".into(),subject_types:vec!["concept".into()],object_types:vec!["concept".into()],inverse_name:None,symmetric:false,object_cardinality:"one".into()}}).unwrap();
 let first=commands::create_manual_assertion(p.into(),CreateAssertionInput{graph_id:graph.graph_id.clone(),subject_entity_id:a.entity_id.clone(),predicate:"PARENT".into(),object_entity_id:b.entity_id,evidence:None}).unwrap();assert_eq!(first.status,"active");let review=commands::create_manual_assertion(p.into(),CreateAssertionInput{graph_id:graph.graph_id,subject_entity_id:a.entity_id,predicate:"PARENT".into(),object_entity_id:c.entity_id,evidence:None}).unwrap();assert_eq!(review.status,"review");commands::resolve_cardinality_conflict(p.into(),ResolveCardinalityConflictInput{assertion_id:review.assertion_id}).unwrap();fs::remove_dir_all(dir).unwrap();
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
 fs::remove_dir_all(dir).unwrap();
}

#[test]
fn ingest_plan_commits_page_assertion_and_evidence_as_one_operation() {
 let dir=project();let p=dir.to_str().unwrap();commands::bootstrap_knowledge_db(p.into()).unwrap();
 let graph=GraphRecord{graph_id:"g-ingest".into(),graph_name:"main".into(),purpose:"test".into()};commands::register_graph(p.into(),graph.clone()).unwrap();
 let page=PageRecord{page_id:"page-ingest".into(),page_path:"db/ingest.md".into(),title:"Ingest".into(),page_type:"guide".into(),summary:None,primary_entity_id:None,updated_at:"now".into()};
 let section=SectionRecord{section_id:"sec-ingest".into(),page_id:page.page_id.clone(),parent_id:None,heading_level:2,heading_text:"Facts".into(),section_type:"overview".into(),ui_scope:None,ui_anchor:None,ui_layer:None,ui_aspect:None,content_entity_id:None,host_entity_id:None,ordinal:0,summary:None};
 commands::commit_ingest_plan(p.into(),CommitIngestPlanInput{operation_id:"op-ingest".into(),pages:vec![IngestPageDocument{relative_path:page.page_path.clone(),content:"v2".into(),page,sections:vec![section]}],assertions:vec![IngestAssertionWrite{graph_id:graph.graph_id.clone(),subject_name:"Alpha".into(),subject_type:"concept".into(),predicate:"DEPENDS_ON".into(),relation_description:"dependency".into(),object_name:"Beta".into(),object_type:"concept".into(),page_id:"page-ingest".into(),section_id:"sec-ingest".into(),quote:Some("v2".into())}]}).unwrap();
 let snapshot=commands::get_knowledge_graph_snapshot(p.into(),graph.graph_id).unwrap();assert_eq!(snapshot.assertions.len(),1);assert_eq!(snapshot.assertions[0].evidence_state,"documented");assert_eq!(snapshot.assertions[0].evidence[0].section_id.as_deref(),Some("sec-ingest"));fs::remove_dir_all(dir).unwrap();
}

#[test]
fn traversal_respects_cost_switch_limit_and_graph_allowlist() {
 let dir=project(); let p=dir.to_str().unwrap(); commands::bootstrap_knowledge_db(p.into()).unwrap();
 let a=entity(p,"A","concept"); let b=entity(p,"B","concept"); let d=entity(p,"D","concept");
 for graph in [GraphRecord{graph_id:"g1".into(),graph_name:"G1".into(),purpose:"test".into()},GraphRecord{graph_id:"g2".into(),graph_name:"G2".into(),purpose:"test".into()}] { commands::register_graph(p.into(),graph.clone()).unwrap(); commands::register_relation_type(p.into(),RegisterRelationTypeInput{relation_type:RelationTypeRecord{graph_id:graph.graph_id,name:"REL".into(),description:"relation".into(),subject_types:vec!["concept".into()],object_types:vec!["concept".into()],inverse_name:None,symmetric:false,object_cardinality:"many".into()}}).unwrap(); }
 for (graph, entity_id) in [("g1",&a.entity_id),("g1",&b.entity_id),("g2",&b.entity_id),("g2",&d.entity_id)] { commands::create_or_link_graph_node(p.into(),CreateOrLinkGraphNodeInput{graph_id:graph.into(),entity_id:Some(entity_id.clone()),canonical_name:None,entity_type:None,description:None,aliases:None,role:None}).unwrap(); }
 commands::create_manual_assertion(p.into(),CreateAssertionInput{graph_id:"g1".into(),subject_entity_id:a.entity_id.clone(),predicate:"REL".into(),object_entity_id:b.entity_id.clone(),evidence:None}).unwrap();
 commands::create_manual_assertion(p.into(),CreateAssertionInput{graph_id:"g2".into(),subject_entity_id:b.entity_id.clone(),predicate:"REL".into(),object_entity_id:d.entity_id.clone(),evidence:None}).unwrap();
 let all=commands::traverse_knowledge_graph(p.into(),TraversalRequest{seed_page_ids:None,seed_entity_ids:Some(vec![a.entity_id.clone()]),allowed_graph_ids:None,max_cost:Some(3),max_graph_switches:Some(1)}).unwrap(); assert!(all.iter().any(|h|h.entity_id==d.entity_id&&h.cost==3&&h.graph_switches==1));
 let scoped=commands::traverse_knowledge_graph(p.into(),TraversalRequest{seed_page_ids:None,seed_entity_ids:Some(vec![a.entity_id]),allowed_graph_ids:Some(vec!["g1".into()]),max_cost:Some(3),max_graph_switches:Some(2)}).unwrap(); assert!(!scoped.iter().any(|h|h.entity_id==d.entity_id));
 fs::remove_dir_all(dir).unwrap();
}

#[test]
fn traversal_includes_manual_assertions_without_graph_projections_and_keeps_direction() {
 let dir=project(); let p=dir.to_str().unwrap(); commands::bootstrap_knowledge_db(p.into()).unwrap();
 let a=entity(p,"A","concept"); let b=entity(p,"B","concept");
 let graph=GraphRecord{graph_id:"g".into(),graph_name:"G".into(),purpose:"test".into()}; commands::register_graph(p.into(),graph.clone()).unwrap();
 commands::register_relation_type(p.into(),RegisterRelationTypeInput{relation_type:RelationTypeRecord{graph_id:graph.graph_id.clone(),name:"REL".into(),description:"relation".into(),subject_types:vec!["concept".into()],object_types:vec!["concept".into()],inverse_name:None,symmetric:false,object_cardinality:"many".into()}}).unwrap();
 let assertion=commands::create_manual_assertion(p.into(),CreateAssertionInput{graph_id:graph.graph_id,subject_entity_id:a.entity_id.clone(),predicate:"REL".into(),object_entity_id:b.entity_id.clone(),evidence:None}).unwrap();
 let forward=commands::traverse_knowledge_graph(p.into(),TraversalRequest{seed_page_ids:None,seed_entity_ids:Some(vec![a.entity_id.clone()]),allowed_graph_ids:None,max_cost:Some(1),max_graph_switches:Some(0)}).unwrap();
 let hit=forward.iter().find(|hit|hit.entity_id==b.entity_id).unwrap(); assert_eq!(hit.cost,1); assert_eq!(hit.assertion_id.as_deref(),Some(assertion.assertion_id.as_str())); assert_eq!(hit.path[0].forward,Some(true));
 let backward=commands::traverse_knowledge_graph(p.into(),TraversalRequest{seed_page_ids:None,seed_entity_ids:Some(vec![b.entity_id]),allowed_graph_ids:None,max_cost:Some(1),max_graph_switches:Some(0)}).unwrap();
 assert_eq!(backward.iter().find(|hit|hit.entity_id==a.entity_id).unwrap().path[0].forward,Some(false));
 fs::remove_dir_all(dir).unwrap();
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
 let hits=commands::traverse_knowledge_graph(p.into(),TraversalRequest{seed_page_ids:None,seed_entity_ids:Some(vec![by_name("A")]),allowed_graph_ids:None,max_cost:Some(8),max_graph_switches:Some(2)}).unwrap();
 let goal=hits.iter().find(|hit|hit.entity_id==by_name("G")).unwrap(); assert_eq!((goal.cost,goal.graph_switches),(8,1));
 fs::remove_dir_all(dir).unwrap();
}
