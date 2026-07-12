# Improve 개발 Step 4 — Ingest 계획과 원자적 파일·DB 반영

## 목표

현재의 `파일 저장 → syncGraphToBackend()` 분리 흐름을 검증된 ingest plan과 복구 가능한 commit 흐름으로 교체한다. chunk 하나의 page/section/entity/assertion/evidence는 전부 반영되거나 전부 실패해야 한다.

## 선행 단계 참고 (Step 2·3)

Step 4는 Step 2의 knowledge DB와 Step 3의 Markdown v2를 새 ingest 경로의 유일한 저장 모델로 사용한다. 구현 중 아래 계약을 유지한다.

- DB write는 Step 2의 use-case command 또는 이를 묶은 단일 transaction command로만 수행한다. 기존 graph backend, `graph-policy`, `page-graph-index`, `graphs.json`을 새 ingest의 adapter나 fallback으로 다시 연결하지 않는다.
- Markdown은 Step 3의 v2 parser/validator를 통과한 결과만 plan에 넣는다. v1 문서는 자동 보정·fallback 처리하지 않고 `VALIDATION_FAILED`로 거부한다.
- `page_id`와 `section_id`는 path·heading·ordinal로 유도하지 않는 안정 identity다. 같은 기존 page를 선택한 순차 chunk에는 최신 page/section ID 목록을 제공하고, hydrate 단계가 그 ID를 보존하거나 신규 ID를 명시적으로 부여한다.
- section conflict map key와 modification proposal/approve splice 기준은 오직 `section_id`다. proposal에는 반드시 `page_id`, `section_id`, 기존/제안 body, source reference를 저장한다.
- plan 실행 직전에도 page의 `primary_entity`, section의 `content_entity`·`host_entity`, assertion evidence의 page/section 소속을 같은 DB transaction에서 검증한다. DB의 전역 `section_id` unique 제약을 우회하지 않는다.
- Markdown v2 parser가 제공하는 offset은 UTF-16 string offset이다. Rust/SQLite 경계에서 이를 UTF-8 byte slice offset으로 직접 사용하지 않는다.

## 핵심 구조

```text
LLM outputs
  -> hydrate
  -> deterministic validation
  -> IngestPlan (memory only)
  -> stage Markdown temp files + fsync
  -> DB transaction
  -> DB commit
  -> atomic rename files
  -> embedding job / cache / git commit
```

권장 모듈:

```text
src/lib/ingest-v2/
  plan.ts
  hydrate.ts
  validate.ts
  execute.ts
  recovery.ts
  prompts.ts
```

`ingest.ts`를 한 번에 재작성하기보다 queue/chunk 제어는 유지하고 chunk 내부 pipeline을 `executeIngestPlan()`로 교체한다.

## IngestPlan 계약

```ts
interface IngestPlan {
  operationId: string
  pages: PlannedPage[]
  entities: PlannedEntity[]
  graphNodes: PlannedGraphNode[]
  assertions: PlannedAssertion[]
  evidence: PlannedEvidence[]
  tempFiles: PlannedFileReplacement[]
  embeddingJobs: PlannedEmbeddingJob[]
}
```

plan에는 확정된 ID와 relation type이 들어 있어야 한다. 실행 중 LLM을 다시 호출하거나 fuzzy entity merge를 하지 않는다.

## decomposition과 entity 확정

1. 질문/원문에서 entity 후보와 alias를 추출한다.
2. normalized alias exact match를 먼저 수행한다.
3. fuzzy 결과는 자동 확정하지 않고 새 entity 또는 review 선택으로 보낸다.
4. 동일 `page_id`를 선택한 후속 chunk에는 최신 DB page/section index를 제공한다.
5. `page_path`는 새 문서의 저장 위치 후보이며 identity가 아니다.
6. data type의 파일당·타입당 단일 문서, 빈 추출 skip, 다중 task 분리는 유지한다.

Graph assignment 출력에는 subject/object 이름만 두지 말고 hydrate 후 반드시 entity ID로 확정한다. 신규 relation type은 description, subject/object types, inverse/symmetric, cardinality가 모두 있어야 plan에 포함할 수 있다.

## 파일·DB commit 프로토콜

SQLite와 filesystem 사이에는 진짜 단일 transaction이 없으므로 recovery journal이 필요하다.

1. `{project}/.llm-wiki/transactions/{operationId}.json`에 대상/임시/backup 경로와 DB 이전 상태 식별자를 기록하고 fsync한다.
2. 같은 디렉터리에 temp Markdown을 쓰고 fsync한다.
3. DB transaction에서 모든 row를 갱신하고 journal 상태를 `db_committed`로 바꾼다.
4. 기존 파일을 backup으로 옮긴 뒤 temp를 target으로 atomic rename한다.
5. 모두 성공하면 backup과 journal을 제거한다.
6. 앱 시작 시 미완료 journal을 검사한다. target 상태에 따라 rename 재시도 또는 보상 transaction을 수행한다.

보상 transaction 설계가 복잡하면 DB에 operation별 before-image를 journal table로 저장하는 방식을 사용한다. 단순히 DB commit 후 rename 실패를 로그만 남기면 완료가 아니다.

## modification proposal

- 충돌 없는 새 section만 자동 반영하는 현재 동작을 유지할지 확인한다. 유지한다면 한 chunk 내 부분 성공과 모순되지 않도록 **proposal 생성까지 포함한 계획 전체**를 한 transaction으로 처리한다.
- 충돌 proposal은 `page_id`, `section_id`, 기존/제안 body, source reference를 저장한다.
- Approve/Merge는 최종 Markdown 전체를 다시 parse하되 승인되지 않은 충돌 section의 assertion/evidence는 건드리지 않는다.
- Reject는 해당 proposal의 graph assignment를 저장하지 않는다.

## 후속 작업 순서

DB+파일 성공 후에만 다음을 실행한다.

1. ingest cache 기록
2. git commit
3. embedding 갱신

embedding 실패는 core rollback 사유가 아니며 재생성 가능한 job으로 남긴다. git 실패의 제품 정책도 정해야 한다. 권장은 콘텐츠 저장은 유지하고 activity에 재시도 오류를 표시하는 것이다.

## 테스트

- LLM 출력 오류가 temp file/DB를 전혀 변경하지 않음
- DB transaction 중간 실패 rollback
- DB commit 직후 rename 실패 recovery
- 앱 재시작 후 journal replay가 idempotent
- chunk A 실패 후 chunk B 계속 진행
- 같은 page ID를 선택하는 순차 chunk
- 승인되지 않은 conflict section의 assertion 보존
- unsafe path, bare scalar object, unknown relation type 거부
- embedding/git 실패가 core data를 손상하지 않음

fault injection 지점을 명시적으로 두어 각 단계 실패를 테스트한다.

## 완료 기준

- 신규 ingest 경로에서 `syncGraphToBackend()`를 호출하지 않는다.
- chunk 결과가 Markdown v2와 DB 양쪽에서 일치한다.
- crash/restart 테스트로 미완료 operation을 복구한다.
- 기존 queue/review/data type 주요 시나리오 테스트가 v2 기준으로 통과한다.

## 다음 단계로 넘어가기 전 체크

- filesystem rename 실패를 실제로 재현해 보았는가?
- recovery 중 같은 operation을 두 번 적용해도 결과가 같은가?
- ingest assertion마다 supports/mentions evidence가 있는가?
