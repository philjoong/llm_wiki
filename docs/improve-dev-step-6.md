# Improve 개발 Step 6 — Multi-graph traversal과 section 검색

## 목표

page/entity/assertion에서 시작해 여러 graph를 제한된 비용으로 탐색하고, 문서 전체가 아닌 section 후보와 설명 경로를 반환한다. 이 API가 Graph와 Chat의 공용 검색 기반이 된다.

## traversal API

```ts
interface TraversalRequest {
  seedPageIds?: string[]
  seedEntityIds?: string[]
  allowedGraphIds?: string[]
  maxCost: number          // 기본 3
  maxGraphSwitches: number // 기본 2
}

interface TraversalHit {
  entityId: string
  assertionId?: string
  cost: number
  graphSwitches: number
  path: TraversalStep[]
}
```

같은 graph assertion 이동과 동일 entity의 graph projection 전환 비용은 각각 1이다. 방문 상태는 단순 entity ID가 아니라 `(entity_id, graph_id, cost, switches)`를 고려해 더 싼 경로가 비싼 경로를 대체하도록 한다.

## 구현 권장

첫 버전은 Rust에서 bounded BFS/Dijkstra로 구현한다.

1. page seed는 `page_entities`와 `assertion_evidence`에서 구한다.
2. assertion을 subject/object 양방향으로 조회하되 path에는 실제 predicate 방향을 보존한다.
3. `graph_nodes`를 통해 동일 entity의 다른 graph projection을 구한다.
4. `allowedGraphIds` 밖으로는 절대 전환하지 않는다.
5. 각 hit의 evidence를 따라 page/section을 모은다.
6. 같은 section은 최저 비용·최고 점수 경로 하나를 기본 설명으로 유지한다.

derived 관계는 저장하지 않는다. `PART_OF` 같은 transitive relation을 지원할 경우 relation type에 별도 추론 속성이 아직 없으므로 첫 버전은 명시 allowlist로 제한하거나 제외한다.

## section candidate pipeline

기존 `searchWiki()`의 token/vector recall과 RRF/threshold는 유지하되 결과를 section 단위로 자른다.

1. Markdown v2 parser로 section index를 생성한다.
2. token/vector hit도 `page_id + section_id`로 정규화한다.
3. entity/traversal 후보와 lexical/vector 후보를 합친다.
4. page/section metadata와 tags로 filter한다.
5. 다음 기본 가중치를 각각 0..1로 정규화해 계산한다.

```text
0.35 entity match
+ 0.25 graph path relevance
+ 0.20 section_type match
+ 0.10 tag match
+ 0.10 summary semantic match
```

기존 RRF score를 그대로 위 식에 더하지 않는다. scale이 다르므로 recall rank를 `summary semantic` 또는 별도 정규화 feature로 매핑한다.

## 반환 계약

`improve-dev.md`의 `SectionCandidate`를 구현하고 다음을 추가하는 것을 권장한다.

- `ordinal`: 원문 section 위치
- `matchedRanges`: token/vector match 위치
- `assertionIds`: 결과 근거가 된 assertion
- `scoreBreakdown`: 개발/debug 모드에서 점수 설명

`pagePath`는 반환 시 pages table에서 현재 값을 join한다.

## index 갱신

- DB 관계가 진실 원천이다.
- embedding/token index는 `(page_id, section_id, content_hash)`를 key로 하는 재생성 가능 cache다.
- heading rename이나 page move는 content hash가 같으면 embedding을 재사용할 수 있다.
- section 삭제 시 cache 정리를 job으로 수행하되 stale result는 DB 존재 확인 단계에서 제외한다.

## 기존 기능 보존

- 관련 결과가 없으면 폴백 문서를 넣지 않는다.
- `graphPrefixFilter`는 prefix를 graph ID 목록으로 해석한 뒤 `allowedGraphIds`로 강제한다.
- RAG off면 vector만 끄고 entity/graph/metadata 검색은 유지할지 제품 결정을 명시한다. 권장은 RAG를 embedding 토글로 유지하는 것이다.
- graph context가 비면 prompt section을 만들지 않는다.

## 테스트

- 같은 graph 3 cost 경로
- graph switch 2회 제한과 allowlist 이탈 차단
- cycle이 있어도 종료하며 최저 비용 경로 선택
- manual assertion도 동일 비용으로 탐색
- documented/manual/contradicted evidence state 계산
- page move/heading rename 후 같은 candidate ID 반환
- section 단위 threshold와 no fallback
- stale cache hit 제외
- graph prefix scoped Chat 격리

## 완료 기준

- Chat/Graph가 사용할 하나의 traversal API가 있다.
- 모든 결과에 안정 ID와 설명 경로가 있다.
- `page-graph-index.json` 없이 양방향 탐색한다.
- 비용/전환 제한과 graph scope test가 통과한다.

## 다음 단계로 넘어가기 전 체크

- path가 assertion ID와 graph switch를 충분히 설명하는가?
- 동일 점수 결과의 정렬이 deterministic한가?
- 큰 graph에서 query count와 응답 시간이 허용 가능한가?

