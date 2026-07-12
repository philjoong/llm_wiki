# Improve 개발 Step 2 — SQLite bootstrap과 repository

## 목표

빈 프로젝트에 새 schema를 직접 생성하고, 모든 관계를 한 SQLite connection/transaction으로 다루는 backend를 만든다. 이 단계가 끝나면 UI 없이 repository integration test만으로 CRUD와 정합성을 검증할 수 있어야 한다.

## 권장 구조

```text
src-tauri/src/knowledge/
  schema.rs              schema SQL, version 상수
  db.rs                  connection open, PRAGMA, transaction helper
  queries.rs             읽기 query
  commands.rs            쓰기 command
  integrity.rs           정기 검사
  model.rs

src/commands/knowledge.ts
src/lib/knowledge/tauri-repository.ts
```

기존 `graph_sqlite.rs` 안에 새 schema를 함께 넣지 않는다. 구·신 테이블이 공존하면 실수로 양쪽을 쓰기 쉽다.

## schema 보완 후 구현

`improve-dev.md`의 DDL을 기준으로 하되 다음을 명시한다.

- `PRAGMA foreign_keys = ON`을 **connection을 열 때마다** 실행하고 확인한다.
- `PRAGMA user_version = 1`을 schema version으로 사용한다.
- 신규/빈 DB만 bootstrap한다. `user_version`이 다르거나 레거시 `nodes/edges`가 있으면 `SCHEMA_VERSION_MISMATCH`로 중단한다.
- assertions 중복 정책을 정한다. 권장 unique key는 `(graph_id, subject_entity_id, predicate, object_entity_id, status)`를 그대로 두기보다 application command가 동일 active/review assertion을 재사용하도록 하는 것이다.
- `assertion_evidence.section_id`가 주어지면 그 section의 `page_id`와 evidence의 `page_id`가 같은지 transaction validator가 확인한다.
- `sections.parent_id`가 다른 page의 section을 가리키지 못하도록 application validator 또는 composite FK를 둔다.
- `entity_aliases.normalized_alias` 정규화 규칙은 Unicode NFKC + trim + locale 독립 lowercase로 고정한다.

## command 단위

처음부터 작은 SQL command를 UI에 직접 노출하지 말고 use case 단위 command를 제공한다.

- `bootstrap_knowledge_db`
- `get_knowledge_db_status`
- `upsert_page_document`
- `create_or_link_entity`
- `register_graph`
- `register_relation_type`
- `create_assertion_with_evidence`
- `create_manual_assertion`
- `resolve_cardinality_conflict`
- `delete_page`
- `run_knowledge_integrity_check`

모든 write command는 transaction 내부에서 domain validation을 수행한다.

## relation type과 충돌 규칙

- 금지 predicate `RELATED`, `LINKED`, `ASSOCIATED`는 등록 단계에서 거부한다.
- subject/object entity type을 relation type JSON 배열과 대조한다.
- `object_cardinality=many`이면 다른 object를 active로 허용한다.
- `one`이면 기존 active를 유지하고 새 assertion을 `review`로 저장한다.
- 승인 command는 새 row를 active, 이전 row를 superseded로 한 transaction에서 바꾼다.
- symmetric relation은 저장 방향을 하나로 canonicalize할지 양방향 조회만 제공할지 결정한다. 권장은 ID 정렬로 한 row만 저장하고 조회에서 양방향 처리하는 것이다.

## 테스트

Rust integration test는 임시 프로젝트 디렉터리의 실제 SQLite 파일을 사용한다.

1. 빈 DB bootstrap과 모든 table/index 존재 확인
2. connection 재오픈 후 FK 활성 확인
3. version mismatch와 legacy table 감지 시 open 거부
4. page 삭제 후 section 삭제, evidence의 page/section `NULL` 처리
5. graph node가 entity 없이 생성되지 않음
6. relation type entity type 위반 거부
7. cardinality one/many 분기와 승인 transaction
8. alias 정규화 중복 방지
9. transaction 중간 오류 시 전체 rollback
10. integrity check가 dangling/evidence 없는 ingest/unused entity/tag 위반을 분류

## 완료 기준

- 새 schema가 신규 프로젝트에서만 생성된다.
- frontend repository를 통해 핵심 CRUD를 실행할 수 있다.
- DB query에 `page-graph-index.json` 또는 graph policy가 필요하지 않다.
- `cargo test`와 frontend repository test가 통과한다.

## 다음 단계로 넘어가기 전 체크

- 삭제/`SET NULL` 동작이 문서 삭제 정책과 일치하는가?
- schema version mismatch 오류가 프로젝트 열기 UI까지 전달되는가?
- relation type과 assertion 생성 우회 API가 없는가?

