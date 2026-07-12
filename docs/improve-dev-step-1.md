# Improve 개발 Step 1 — 전환 경계와 도메인 계약 고정

## 목표

구현을 시작하기 전에 새 모델의 경계와 공용 타입을 고정한다. 이 단계에서는 기능을 연결하지 않는다. 이후 단계가 같은 용어와 ID 규칙을 사용하도록 만드는 것이 완료 조건이다.

`improve-dev.md`의 중요한 전제는 **기존 graph 저장 형식과 호환하지 않는다**는 것이다. `graphs/nodes/edges`, `graph-policy.json`, `page-graph-index.json`, 과거 chat reference shape를 새 코드가 읽는 adapter를 만들지 않는다.

## 먼저 확인할 결정

- DB 파일은 기존 경로인 `{project}/.llm-wiki/graph.sqlite`를 재사용하되 내용은 새 schema만 허용한다.
- DB schema version은 우선 `1`로 시작한다. version 불일치는 자동 migration 대신 프로젝트 열기 실패로 처리한다.
- 모든 안정 ID는 애플리케이션에서 생성한다. 표시 문자열이나 경로를 hash하여 ID를 재계산하지 않는다.
- 권장 접두사: `page-`, `sec-`, `ent-`, `graph-`, `node-`, `assert-`, `evidence-`, `tag-`.
- `section_id`는 `sec-` + ULID로 제한한다. 나머지 ID도 같은 생성기를 쓰되 타입별 접두사를 둔다.
- 시간은 UTC RFC 3339 문자열로 저장한다.
- entity type, page type, section type은 자유 문자열처럼 DB에 저장할 수 있더라도 application validator에서 통제 어휘를 강제한다.

결정을 바꿀 경우 이 문서와 `improve-dev.md`를 먼저 함께 수정한다.

## 권장 코드 구조

```text
src/lib/knowledge/
  ids.ts                 안정 ID 생성·형식 검사
  types.ts               프론트엔드 공용 도메인 타입
  vocabularies.ts        page/section/entity type 통제 어휘
  validation.ts          공용 validation error 타입
  repository.ts          UI가 의존할 repository interface

src-tauri/src/knowledge/
  mod.rs
  model.rs               Rust command 입출력 타입
  error.rs               오류 코드와 사용자 메시지
```

기존 `src/lib/graph-backend/types.ts`를 확장하지 않는다. 새 repository 계약을 별도 모듈로 만들고 전환 완료 후 기존 backend를 삭제한다.

## 구현 작업

1. 각 레코드의 TypeScript/Rust DTO를 정의한다.
2. `KnowledgeError`를 최소한 다음 코드로 구분한다.
   - `SCHEMA_VERSION_MISMATCH`
   - `VALIDATION_FAILED`
   - `NOT_FOUND`
   - `CARDINALITY_CONFLICT`
   - `ATOMIC_WRITE_RECOVERY_REQUIRED`
3. ID 생성기와 접두사별 validator를 구현한다.
4. repository interface를 읽기와 command로 분리한다.

```ts
interface KnowledgeQueries {
  getPage(pageId: string): Promise<PageRecord | null>
  getSection(sectionId: string): Promise<SectionRecord | null>
  findEntities(query: string): Promise<EntityMatch[]>
  getGraphSnapshot(graphId: string): Promise<KnowledgeGraphSnapshot>
}

interface KnowledgeCommands {
  createEntity(input: CreateEntityInput): Promise<EntityRecord>
  createManualAssertion(input: CreateAssertionInput): Promise<AssertionRecord>
}
```

DTO에서 `pagePath`는 page의 현재 위치일 뿐 assertion/node의 필수 속성이 아니어야 한다.

## 레거시 제거 인벤토리

아직 삭제하지 말고 참조 위치와 대체 단계를 기록한다.

| 기존 코드/데이터 | 대체 단계 |
|---|---:|
| `src-tauri/src/commands/graph_sqlite.rs`의 구 schema/API | 2 |
| `src/lib/graph-backend/*` | 2, 5 |
| `.llm-wiki/graph-policy.json`, `src/lib/graph-policy.ts` | 2, 5 |
| `src/lib/page-graph-index.ts` | 6 |
| `splitIntoSections()` heading 기반 identity | 3 |
| `syncGraphToBackend()` | 4 |
| chat의 주석/`[N]`/wikilink reference fallback | 7 |
| `graphs.json` import/export | 8 |

## 테스트

- 접두사별 ID 생성과 형식 검사
- 같은 표시 이름으로 서로 다른 ID 생성 가능
- path/title 변경이 ID에 영향을 주지 않음
- DTO serialization round trip
- 오류 코드별 사용자 메시지 mapping

## 완료 기준

- 새 도메인 타입에서 `page_path`가 관계 식별자로 사용되지 않는다.
- 새 코드가 의존할 repository interface가 합의되어 있다.
- 레거시 요소마다 삭제될 단계가 지정되어 있다.
- `npm run typecheck`와 새 단위 테스트가 통과한다.

## 다음 단계로 넘어가기 전 체크

- ID 형식과 schema version 정책을 바꿀 가능성이 없는가?
- import 시 구 DB를 변환하지 않고 거부한다는 제품 동작이 허용되는가?
- 프로젝트별 DB 하나가 pages, graph, evidence의 단일 진실 원천이라는 데 동의했는가?

