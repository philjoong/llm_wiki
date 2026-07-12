# Improve 개발 Step 9 — graph/ingest 완전 전환과 레거시 제거 마감

상태: 구현 완료 (2026-07-12)

## 배경과 범위

Step 8에서 프로젝트 lifecycle, import/export, structured citation, Chat section candidate와 Chat graph context의 v2 경로를 전환했다. 남은 작업은 **production graph·entity·review·ingest 화면이 legacy graph backend를 더 이상 호출하지 않게 만들고, 그 뒤 legacy 구현과 fixture를 삭제하는 것**이다.

이미 완료된 항목은 다시 구현하지 않는다.

- authoritative export는 `.llm-wiki/knowledge.sqlite`이며 `graphs.json` snapshot import/export는 제거됨
- open/export/import은 knowledge DB/tag schema/schema version을 검증하고 legacy DB를 거부함
- Chat 문서 context는 `SectionCandidate`만 사용하며 `searchWiki()` 재독해 adapter는 제거됨
- Chat persistence는 schema v2만 허용하며 legacy citation/chat fallback은 제거됨
- `graph-qna.ts`의 Chat graph context는 knowledge DB snapshot을 사용함

## 목표

1. 모든 graph 쓰기·조회·관리 UI를 `knowledge` command/repository로 전환한다.
2. `graph.sqlite`, graph policy JSON, page graph index JSON, graph backend wrapper를 production에서 완전히 제거한다.
3. ingest/review/entity 화면이 page path·heading text·node name을 relation identity로 사용하지 않게 한다.
4. legacy 동작을 기대하는 테스트 fixture를 v2 stable ID 계약으로 교체한다.

feature flag, silent fallback, dual write는 허용하지 않는다. 새 DB가 없거나 schema가 맞지 않으면 프로젝트 open/import가 명확히 실패해야 한다.

## 1. knowledge command 보강

현재 있는 command(`registerGraph`, `registerRelationType`, `createOrLinkGraphNode`, assertion/evidence, traversal, snapshot, delete impact)을 UI와 ingest가 충분히 사용할 수 있게 보강한다.

- graph 목록/rename/delete command: graph ID를 기준으로 동작하고 graph name은 표시값으로만 사용
- relation type 목록/rename/delete command: graph당 4개 제한을 제거하고 DB relation type validation만 적용
- entity rename/alias/merge/split command: canonical name과 alias를 DB에서 원자적으로 관리. entity fuzzy merge는 자동 수행 금지
- assertion edit/delete/review approve/reject command: assertion ID와 evidence ID를 사용
- graph snapshot은 `graphId`로 조회하며 canvas용 projection은 UI adapter에서만 생성
- `list_knowledge_graphs`와 `get_knowledge_graph_snapshot`의 error/status contract를 통일

필요한 command는 Rust transaction 안에서 foreign key와 schema version을 확인한다. 기존 `graph_sqlite`의 integer node/edge ID를 재사용하거나 변환하지 않는다.

## 2. Graph/Entity 화면 전환

### GraphView

`src/components/graph/graph-view.tsx`를 knowledge snapshot adapter로 변경한다.

- graph 선택값은 name이 아닌 `graphId`를 저장한다. name은 label/UI route에만 사용
- canvas node는 `graph_nodes.node_id`, edge는 `assertions.assertion_id`를 사용
- node 클릭의 문서 연결은 evidence의 page/section ID로 해석한다. `pagePath` property fallback을 사용하지 않는다
- entity-centric hop view는 `traverseKnowledgeGraph` 또는 snapshot assertion graph을 사용한다
- `graph-hop.ts`, `graph-result-mappers.ts`가 필요하면 knowledge snapshot 타입을 입력으로 바꾸고 기존 backend `GraphSnapshot` 타입을 제거한다
- `page-graph-index`의 related graph/file lookup을 evidence page ID 기반 query로 대체한다

### GraphsTab

`src/components/layout/graphs-tab.tsx`에서 `graph-policy.json`을 제거한다.

- graph 생성/rename/delete는 knowledge command 사용
- relation type add/rename/delete는 relation_types table 사용
- 영향을 받는 문서 표시는 assertion evidence의 page ID → current page path로 조회
- graph name prefix는 UI 검색/표시 정책일 뿐, authorization 또는 relation identity가 아님

### EntityView

`src/components/entity/entity-view.tsx`, `src/lib/entity-dict.ts`의 JSON dictionary를 DB entity/alias/projection으로 바꾼다.

- add/rename/alias/remove alias/merge/split 모두 knowledge command로 처리
- entity delete는 delete impact를 표시하고 사용자의 명시적 승인 후에만 수행
- local `entity-dict.json`을 생성·읽기·쓰기 하지 않는다

## 3. ingest와 review 전환

`src/lib/ingest.ts` 및 `src/lib/graph-sync.ts`의 graph assignment 후처리를 knowledge write plan으로 바꾼다.

- graph assignment의 graph name은 ingest 경계에서 `graphId`로 resolve/create
- subject/object는 canonical entity + alias lookup으로 `entityId`를 resolve/create
- predicate는 relation type DB validation을 통과해야 함. generic relation과 최대 4개 정책은 제거
- triple의 `page_path`, `source_range`, heading text는 evidence page/section ID와 quote로 변환한 뒤 저장; edge property로 보존하지 않음
- graph assignment가 실패하면 assertion만 부분 저장하지 않는다. review item에는 안정 ID가 있는 검토 대상 또는 명시적 validation failure를 남긴다
- page 수정/이동/heading rename은 Markdown v2 parse 결과로 page/section ID를 유지하며 assertion/citation/evidence를 재연결하지 않아야 함
- modification approve/reject와 review UI는 assertion/evidence IDs를 사용하고 heading text splice를 제거

## 4. Chat graph scope 마감

Chat은 현재 knowledge snapshot으로 graph context를 읽는다. 다음을 마감한다.

- `graphPrefixFilter`를 `listKnowledgeGraphs()` 결과의 `allowedGraphIds`로 해석하여 traversal request에 강제
- SectionCandidate에 traversal에서 얻은 `assertionIds`, `evidenceState`, `graphPath`를 채워 요청 citation map까지 그대로 전달
- graph scope 밖 assertion/evidence에서 section key가 발급되지 않음을 테스트
- RAG off는 embedding recall만 끄고 metadata/entity/traversal section candidate는 유지

## 5. 삭제 순서

아래 순서를 지킨다. 먼저 import가 0인지 `rg`와 typecheck로 확인하고 삭제한다.

1. production imports를 knowledge adapter로 전환
2. `src/lib/graph-sync.ts` 제거
3. `src/lib/page-graph-index.ts`와 `.llm-wiki/page-graph-index.json` 생성/재빌드 제거
4. `src/lib/graph-policy.ts`와 `.llm-wiki/graph-policy.json` runtime 의존 제거
5. `src/lib/entity-dict.ts`의 persistence와 legacy graph node API 제거
6. `src/lib/graph-backend/*`, `src/lib/graph-hop.ts`의 legacy snapshot 타입 제거 또는 knowledge 타입으로 이전
7. `src-tauri/src/commands/graph_sqlite.rs` 제거, `commands/mod.rs` 및 `lib.rs` invoke registration 제거
8. `graph.sqlite`를 읽거나 쓰는 모든 경로 제거

삭제 후 필수 검색:

```bash
rg -n 'graph-backend|graph-sync|graph-policy|page-graph-index|graph_sqlite|graphs\.json|graph\.sqlite' src src-tauri
rg -n 'deleteEdgesByPagePath|page_path.*edge|heading.*splice|searchWiki\(' src
```

테스트와 문서의 historical mention은 허용할 수 있지만 production import/command registration은 0건이어야 한다.

## 6. integrity와 migration 안전성

- full integrity check에 dangling reference, evidence 없는 ingest assertion, unused entity, Markdown/DB page·section 불일치, tag schema 위반, stale search index, recovery journal을 보고
- cache만 자동 재생성. entity merge/assertion 삭제/ID 재발급은 자동 수정 금지
- v2 export/import roundtrip에서 graph/entity/assertion/evidence/page/section/citation ID가 그대로 유지되는지 확인
- legacy project/DB/schema는 자동 변환하지 않고 backup 안내가 있는 오류로 중단

## 7. 테스트 정리와 완료 기준

다음 legacy fixture를 v2 fixture로 교체하거나 제거한다.

- `agent-ingest`, `ingest.reingest-datatype`, ingest scenario: graph policy 최대 4개와 page path edge delete 기대 제거
- `graph-policy.integration`, `page-graph-index`, `graph-hop`, legacy entity-dict tests: knowledge repository tests로 대체
- `graph-qna` test: knowledge snapshot/allowed graph ID 기반으로 대체
- modification resolve tests: heading text splice 대신 pageId/sectionId proposal fixture 사용

최소 통합 시나리오:

1. 빈 프로젝트 → ingest → graph snapshot → Chat structured citation
2. 동일 entity가 두 graph에 있을 때 allowed graph traversal
3. page 이동/heading rename 뒤 assertion/evidence/citation preview 유지
4. manual assertion만으로 graph 간 traversal
5. relation cardinality conflict review 승인/거절
6. ingest crash recovery
7. export → import 후 모든 stable ID 유지
8. legacy DB/schema open 거부

최종 명령:

```bash
npm run typecheck
npm run test:mocks
cargo test --manifest-path src-tauri/Cargo.toml
npm run build
```

완료는 production path가 legacy graph 파일·table·API·JSON index를 읽거나 쓰지 않고, 위 명령과 핵심 통합 시나리오가 통과할 때만 선언한다.
