# Improve 개발 Step 5 — 수동 Graph 편집과 provenance UI

## 목표

Graph 화면을 entity projection과 assertion 기반으로 전환한다. `page_path`가 없는 수동 node/edge도 정상 저장·탐색되며, 잘못된 predicate나 entity type 조합을 UI와 backend 양쪽에서 차단한다.

## 시작 조건과 전환 범위

Step 4의 ingest assertion/evidence 반영이 완료되기 전에는 Documented provenance를 실제 ingest 결과로 검증할 수 없다. Step 5의 수동 node/edge 경로는 먼저 구현할 수 있지만, Step 4의 다음 계약이 충족되기 전에는 Step 5 전체를 완료로 표시하지 않는다.

- ingest가 새 knowledge tables에 entity, assertion, evidence를 같은 operation으로 저장한다.
- `supports`/`mentions` evidence가 assertion의 page/section 소속을 참조한다.
- graph 화면은 legacy `GraphBackend`, `graph-policy`, `page-graph-index`, `graphs.json`을 조회·쓰기 fallback으로 사용하지 않는다. 전환 후의 canvas/검색/영향 분석은 knowledge DB만 source of truth로 사용한다.
- 기존 legacy graph 데이터의 표시가 제품상 필요하면, 새 테이블로의 명시적 migration을 별도 작업으로 두거나 “migration 전에는 표시하지 않음”을 선택한다. 두 저장소를 runtime에 merge하지 않는다.

현재 `KnowledgeRepository.getGraphSnapshot()`은 미구현이므로 UI 전환보다 먼저 아래 조회/명령 계약을 제공해야 한다.

```ts
getKnowledgeGraphSnapshot(projectPath, graphId): Promise<KnowledgeGraphSnapshot>
createOrLinkGraphNode(projectPath, input): Promise<{ node: GraphNodeRecord; entity: EntityRecord }>
listAllowedRelationTypes(projectPath, graphId, sourceEntityId, targetEntityId): Promise<RelationTypeRecord[]>
getKnowledgeDeleteImpact(projectPath, input): Promise<DeleteImpact>
deleteGraphProjection(projectPath, nodeId): Promise<void>
deleteAssertion(projectPath, assertionId): Promise<void>
rejectReviewAssertion(projectPath, assertionId): Promise<void>
```

`createOrLinkGraphNode`는 exact alias 조회, 필요 시 entity 생성, projection 생성까지 하나의 transaction으로 수행한다. `getKnowledgeGraphSnapshot`은 node별 entity와 assertion별 evidence state를 조립해 반환하며, client가 별도 tables를 조합하지 않는다.

## 조회 모델

Graph canvas에는 다음 projection을 반환한다.

```ts
interface KnowledgeGraphSnapshot {
  graph: GraphRecord
  nodes: Array<GraphNodeRecord & { entity: EntityRecord }>
  assertions: Array<AssertionRecord & {
    evidenceState: "documented" | "manual" | "contradicted"
  }>
}
```

canvas node ID와 entity ID를 혼용하지 않는다. 화면 내 선택은 `node_id`, graph 전환과 관련 문서 검색은 `entity_id`를 사용한다.

각 assertion에는 canvas가 provenance popover를 표시할 수 있도록 evidence 요약도 함께 반환한다. `evidenceState`는 다음 우선순위로 backend가 계산한다: `contradicts` evidence 존재 → `contradicted`, `supports` 또는 `mentions` evidence 존재 → `documented`, 그 외 manual origin → `manual`. ingest origin인데 evidence가 없으면 정상 상태로 숨기지 말고 integrity issue로 보고한다.

## node 추가 흐름

1. canonical name/alias exact 검색 결과를 표시한다.
2. 기존 entity 선택 또는 새 entity 생성을 반드시 선택한다.
3. 새 entity는 canonical name과 entity type이 필수다.
4. entity 생성과 graph node 생성은 같은 transaction이다.
5. 같은 `(graph_id, entity_id, role)` projection 중복은 기존 node로 이동한다.

fuzzy 후보는 “비슷한 결과”로만 보여주고 자동 merge하지 않는다.

## edge 추가 흐름

1. source/target node의 entity type을 구한다.
2. 해당 조합을 허용하는 graph의 relation type만 표시한다.
3. 적합한 relation type이 없으면 먼저 relation type 등록 dialog를 연다.
4. relation type 등록에는 description, 양쪽 type, inverse(없으면 명시적으로 없음), symmetric, cardinality가 필요하다. 저장 전 backend도 빈 description/미지정 cardinality를 거부한다.
5. assertion은 backend가 `origin=manual`을 기록한다. 사용자 입력 필드로 받지 않는다.
6. evidence 연결은 선택 사항이다.

`RELATED`, `LINKED`, `ASSOCIATED`는 client filter뿐 아니라 backend에서 거부한다.

## cardinality review

`one` 충돌 시 edge 생성 실패처럼 보이지 않게 review assertion이 생성되었음을 표시한다.

- 기존 active edge는 canvas에 유지
- 새 edge는 review 스타일로 표시
- 승인: 새 active + 기존 superseded
- 거절: review assertion 삭제 또는 rejected 상태 정책을 결정. 현재 schema에 rejected가 없으므로 첫 버전은 삭제를 권장
- 모든 상태 변경은 한 transaction

## 삭제 영향 분석

삭제 버튼보다 먼저 dry-run query를 호출한다.

- node 삭제: 같은 entity의 다른 graph projections, 연결 assertion, evidence, 관련 pages
- assertion 삭제: 연결 evidence
- entity 삭제: 모든 projection/assertion/page entity 참조

기본 node 삭제는 **현재 graph projection만** 삭제한다. entity 전체 삭제는 별도 명시 동작으로 두고 참조가 있으면 거부하는 것이 안전하다.

dry-run 응답은 표시용 문자열이 아니라 stable ID 목록과 count를 포함해야 한다. 실제 delete command는 dry-run token 또는 다시 계산한 동일한 reference set을 transaction에서 검증해, 확인 dialog 이후 변경된 참조를 조용히 삭제하지 않는다.

## UI 변경 대상

- `src/components/graph/graph-view.tsx`
- `src/components/graph/falkor-canvas.tsx`
- `src/components/layout/graphs-tab.tsx`
- 필요 시 새 `entity-picker`, `relation-type-dialog`, `impact-dialog`

기존 `GraphBackend.addNode/addEdge/updateEdge` 호출을 새 use case command로 교체한다.

## provenance 표시

- Documented: supports evidence 1개 이상
- Manual: manual origin이며 evidence 없음
- Contradicted: contradicts evidence 존재
- Review: assertion status가 review

Orphaned는 정상 생성 가능한 상태가 아니다. integrity 화면에서 복구 대상으로만 표시하고 일반 저장은 거부한다.

## 테스트

- entity를 선택하지 않은 node 생성 불가
- alias exact match로 기존 entity projection 생성
- entity type에 맞는 predicate만 후보로 표시
- UI 우회 호출에도 금지 predicate/type mismatch 거부
- manual assertion이 evidence 없이 재조회됨
- snapshot이 evidence로부터 documented/manual/contradicted 상태를 계산함
- one 충돌 review/approve/supersede
- review assertion 거절 시 assertion과 evidence가 함께 제거됨
- node 삭제 dry-run과 projection-only 삭제
- 같은 entity의 여러 graph projection 전환
- legacy graph backend를 사용할 수 없는 상태에서도 Graph 화면의 조회·추가·삭제가 동작함

## 완료 기준

- 수동 node/edge가 새 tables만 사용한다.
- page path 없는 manual assertion을 저장하고 재실행 후에도 볼 수 있다.
- provenance와 review 상태가 canvas에서 구분된다.
- 삭제 전에 영향 범위가 표시된다.

## 다음 단계로 넘어가기 전 체크

- node ID와 entity ID가 이벤트/URL/state에서 명확히 구분되는가?
- 수동 edge가 relation type 등록을 우회할 방법이 없는가?
- graph 전환 버튼이 이름 비교 없이 entity ID를 사용하는가?
