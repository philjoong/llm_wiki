# Improve 개발 Step 8 — 레거시 제거, import/export, 통합 검증

## 목표

새 경로가 완성된 뒤 구 저장/조회 경로를 제거하고 프로젝트 lifecycle 전체를 새 DB 기준으로 닫는다. feature flag나 silent fallback이 남아 있으면 이 단계는 완료가 아니다.

## 제거 대상

- `src/lib/graph-backend/*`와 기존 graph command wrapper
- `src-tauri/src/commands/graph_sqlite.rs`의 `graphs/nodes/edges` 구현
- `src/lib/graph-sync.ts`
- `src/lib/page-graph-index.ts`와 `.llm-wiki/page-graph-index.json` 생성/재빌드
- `src/lib/graph-policy.ts`와 `.llm-wiki/graph-policy.json` runtime 의존
- graph relation type 최대 4개 정책
- page path 기반 edge 삭제/neighbor query
- heading text 기반 reconcile/splice
- chat legacy citation parsing
- Chat에서 `searchWiki()` 결과를 다시 파일 전체로 읽어 section 후보를 임시 구성하는 호환 adapter. Step 6의 공용 `SectionCandidate` API만 입력으로 사용한다.
- `graphs.json` snapshot import/export

`rg`로 symbol과 파일명뿐 아니라 JSON 경로 문자열도 검색한다. 테스트 fixture가 레거시 동작을 계속 요구하지 않도록 함께 정리한다.

## Step 7 citation 마감 조건

- chat persistence/state에 명시적 schema version을 둔다. 새 버전은 `StructuredCitation`만 허용하며 `title/path`, `[N]`, `<!-- cited -->`, wikilink에서 reference를 복원하거나 변환하지 않는다.
- marker는 스트리밍 중 잘려 보일 수 있어도 finalize에서만 파싱한다. 요청 citation map에 없는 marker는 telemetry만 남기고 저장 reference를 만들지 않는다.
- preview는 page/section ID로 현재 문서를 열고 offset → exact quote → prefix/suffix 순서만 사용한다. quote가 바뀌면 section은 열되 no-highlight 상태여야 하며 token/similarity highlight를 다시 도입하지 않는다.
- Step 7의 임시 v2 file-search adapter는 제거한다. Chat의 후보에는 Step 6 API가 제공한 `ordinal`, `matchedRanges`, `assertionIds`, `evidenceState`, `graphPath`를 요청 범위에서 보존하고, `graphPrefixFilter`는 `allowedGraphIds`로 변환해 traversal에 강제한다.

## 프로젝트 생성과 열기

새 프로젝트:

1. 디렉터리와 기본 schema 파일 seed
2. knowledge DB bootstrap
3. tag vocabulary seed
4. DB status 확인 후 UI 진입

프로젝트 열기:

1. DB 존재/version 확인
2. 없고 프로젝트가 완전히 비어 있을 때만 bootstrap 허용
3. 기존 콘텐츠 또는 legacy DB가 있는데 새 DB가 없으면 자동 변환하지 않고 명확한 오류
4. recovery journal replay
5. integrity quick check

현재 `openProject()`의 data type 자동 seed 정책은 import/export 문서의 우려와 함께 정리한다. 권장은 schema bundle은 새 프로젝트 생성 시에만 seed하고, 기존/import 프로젝트 open에서 자동 추가하지 않는 것이다.

레거시 graph backend를 삭제하기 전에는 Graph/Review/Entity 화면과 sync 경로가 knowledge command/repository만 사용하도록 먼저 전환한다. 기존 `graph_sqlite`, graph policy, page-graph-index 호출이 남아 있는 상태에서 파일만 삭제해서는 안 된다.

## import/export 새 계약

프로젝트 전송의 authoritative 항목을 명시한다.

- `db/` Markdown v2
- `.llm-wiki/knowledge.sqlite`
- `.llm-wiki/tag-schema.yaml`
- 프로젝트 공유 `question_types/`, `data_types/`
- 필요한 project identity/version metadata

제외 권장:

- recovery 중인 temp/backup journal
- 재생성 가능한 embedding/search cache
- local-only chat/queue/UI state
- `.git/`

export 전에 recovery pending이 없어야 하며 DB checkpoint/integrity check를 수행한다. zip을 만들기 위한 임시 `graphs.json`은 더 이상 생성하지 않는다.

import는 다음을 강제한다.

- zip entry path traversal 방어
- 허용된 root entry만 추출
- DB/schema version 확인 후 프로젝트 open
- 누락 DB를 graph snapshot에서 복원하는 fallback 없음
- 실패 시 부분 생성 디렉터리 정리 또는 명확한 failed-import 상태

## integrity와 운영 UI

프로젝트 열기에는 가벼운 check, Settings/개발 메뉴에는 전체 check를 제공한다.

보고 항목:

- dangling reference
- evidence 없는 ingest assertion
- 사용되지 않는 entity
- Markdown/DB page·section 불일치
- tag schema 위반
- missing/stale search index
- 미완료 recovery operation

자동 수정은 재생성 가능한 cache에만 허용한다. entity fuzzy merge, assertion 삭제, ID 재발급은 보고만 한다.

## 통합 테스트 시나리오

1. 빈 프로젝트 생성 → ingest → graph → chat citation
2. 같은 entity를 포함한 두 graph 전환
3. page 이동과 heading rename 후 assertion/citation 유지
4. manual edge만으로 다른 graph와 관련 문서 도달
5. cardinality conflict 검토와 승인
6. section modification approve/reject 후 evidence 정합성
7. ingest 중 crash 후 재시작 recovery
8. export → 새 경로 import → 동일 ID/관계/citation 확인
9. legacy DB/schema open 거부와 이해 가능한 오류
10. graph scoped Chat이 허용 graph 밖으로 나가지 않음
11. hallucinated/중복/분할 스트리밍 citation marker가 허용 key 외 reference를 만들지 않음
12. 구형 chat reference shape와 chat schema version mismatch가 path 기반 fallback 없이 안전하게 거부됨

성능 측정도 포함한다.

- 1만/10만 assertion에서 cost 3 traversal p50/p95
- section index rebuild 시간
- 프로젝트 open quick check 시간
- 큰 Markdown의 parser/preview anchor 시간

## 최종 실행 명령

```bash
npm run typecheck
npm run test:mocks
cargo test --manifest-path src-tauri/Cargo.toml
npm run build
```

real LLM test는 API 환경이 있는 별도 단계로 실행하고, deterministic validator와 atomicity는 mock test만으로도 완전히 검증되어야 한다.

## 완료 기준

- production path에서 레거시 파일/테이블/API를 읽거나 쓰지 않는다.
- 프로젝트 생성·열기·ingest·편집·검색·chat·삭제·export/import가 새 안정 ID 모델로 동작한다.
- integrity check에 설명되지 않은 오류가 없다.
- 전체 자동 테스트와 핵심 수동 시나리오가 통과한다.

## 릴리스 전 최종 확인

- 구 프로젝트를 지원하지 않는다는 안내와 백업 지침이 사용자에게 보이는가?
- schema/version mismatch가 데이터 손상 없이 중단되는가?
- export 파일에 local secret, cache, recovery backup이 포함되지 않는가?
- `page_path`와 heading text 변경 테스트가 모든 화면에서 통과하는가?
