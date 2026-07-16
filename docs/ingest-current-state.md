# Ingest 현재 구현: Markdown v2 파이프라인·문서·그래프

raw data ingest 시 파이프라인 전체 흐름, 각 단계 동작, 문서/그래프 생성·배치·충돌 처리를 정리한다.

**아키텍처 노트**: 이 문서는 "Markdown v2" 아키텍처(안정적 `page_id`/`sec-<ULID>` section ID, knowledge.sqlite 기반 원자적 커밋)를 기준으로 작성됐다. 과거 버전(섹션 heading 텍스트 비교, `graph-policy.ts` JSON 정책 파일, `.llm-wiki/entity-dict.json` fuzzy-match 엔티티 사전, `syncGraphToBackend()`/`syncEntityDict()`, `entity_confirmation` review item)은 `mid-dev` 리팩터링 커밋에서 전면 제거됐다. `src/lib/graph-sync.ts`, `src/lib/entity-dict.ts`, `src/lib/graph-policy.ts`, `src/lib/page-graph-index.ts`, `src-tauri/src/commands/graph_sqlite.rs`는 모두 더 이상 존재하지 않는다.

---

## 1. 전체 흐름

```text
raw source file
  -> chunkSourceContent()
  -> Decomposition: LLM document decomposition + page_path 결정
       or
     Decomposition replacement: LLM structured extraction by data type
  -> parseDecomposedSections()  ← DecomposedSection.page_path 포함
  -> page_path 없는 섹션이 있으면: 해당 chunk 실패 처리, 다음 chunk로 계속
  -> File write: buildFileBlocksFromSections()  ← LLM 없음, DecomposedSection[] 기반
  -> writeFileBlocks()
       -> db/ 페이지: parseMarkdownV2()로 기존/incoming 파싱 → reconcileMarkdownV2(): sectionId 매칭 기반 비교
       -> 충돌 섹션 없음 (신규 섹션 자동 병합 포함): 병합된 페이지 전체를 pendingV2Writes에 적재
       -> 충돌 섹션 있음: 충돌 섹션마다 ModificationProposal 생성 (pending/_proposals/), 페이지의 나머지(비충돌) 섹션은 같은 병합 결과에 포함되어 pendingV2Writes로 진행
  -> pendingV2Writes가 있으면 (chunk당 1회):
       -> extractKnowledgeAssertionWrites(): LLM graph assignment — pendingV2Writes의 섹션에서 subject/predicate/object triple 추출
       -> commitMarkdownV2Pages(): pages(+sections) + assertions를 knowledge.sqlite에 원자적으로 1회 커밋 (Rust journal 기반 크래시 복구)
  -> 사용자 Approve (modification 카드) → approveModification()으로 그 섹션만 파일에 스플라이스 → reIngestDocument() → commitMarkdownV2Page()로 페이지만 재커밋 (assertions 없음 — 그래프 assertion은 생성되지 않음)
  -> 사용자 Reject → Discard/Pending — 파일 이동만, knowledge.sqlite 커밋 없음
  -> review items (skipped chunks, modification proposals)
  -> ingest cache
  -> git commit
  -> embeddings (설정 시)
```

---

## 2. Decomposition — 문서 분해

**역할:** source text를 의미 있는 섹션 단위로 쪼개고, 각 섹션의 `page_path`를 결정한다.

관련 코드:
- `src/lib/ingest.ts` — `buildDecompositionPrompt()`, `parseDecomposedSections()`

동작:
- LLM에게 source 문서를 읽고 개념/토픽 단위의 SECTION 블록을 emit하도록 요청한다.
- 각 섹션에 대해 `db/` 아래 저장할 `page_path`도 함께 결정한다 (기존 db/ 인덱스 참고).
- opener 다음 헤더 라인으로 **표시용 메타데이터**(`title`/`summary`/`page_type`/`heading`)도 함께 생성한다. `buildDecompositionPrompt()`가 명명 규칙(title은 `주어-출현-역할-속성` 적응형·최대 4요소·약 40자, heading은 `대상-측면`)과 `page_type` 어휘를 프롬프트에 명시한다.

```text
---SECTION: ## Goblin Warrior | db/enemies/goblin-warrior.md---
title: 고블린 전사
summary: 불에 약한 근접 몬스터
page_type: reference
heading: 고블린 전사 - 약점

(source text 원문 그대로)
---END SECTION---
```

opener 형식: `source_range | page_path`. `parseDecomposedSections()`가 ` | db/` 구분자로 두 값을 분리한다. opener 바로 다음에 오는 `key: value`(title/summary/page_type/heading) 라인은 헤더로 파싱하고 **첫 빈 줄**을 헤더와 verbatim 본문의 경계로 삼는다. 헤더가 하나도 없으면 이전과 동일하게 다음 줄부터 곧바로 본문으로 취급한다(하위 호환). `page_path`가 없거나 안전하지 않은 경로면 해당 섹션이 속한 chunk 전체가 실패로 기록되고 스킵된다 — page_path를 추측해서 채우는 폴백은 없다.

출력 타입:

```ts
interface DecomposedSection {
  source_range: string
  source_text: string
  page_path?: string   // decomposition이 결정; 없으면 이 섹션이 속한 chunk는 실패 처리
  title?: string       // 헤더 라인. buildFileBlocksFromSections에서 검증/폴백
  summary?: string
  page_type?: string
  heading?: string
}
```

큰 파일은 `chunkSourceContent()`로 나뉘며 chunk별로 decomposition → file write → graph assignment가 반복된다. 어떤 chunk가 decomposition에서 실패하면(모델 호출 실패, 섹션 파싱 실패, page_path 누락 등) 해당 chunk만 review item으로 기록되고 나머지 chunk ingest는 계속된다.

chunk는 순서대로(직렬로) 처리되며, 각 chunk의 file write가 끝나면 다음 chunk로 넘어가기 전에 `dbIndex`를 다시 빌드해 decomposition 프롬프트에 주입한다 (`ingest.ts` — chunk 루프의 `currentDbIndex = await buildDbIndex(pp)`). 그래서 chunk 2의 decomposition LLM은 chunk 1이 방금 쓴 `db/` 페이지 목록을 보고, 같은 주제라고 판단하면 동일한 `page_path`를 다시 선택할 수 있다. 이때 실제 병합 여부는 §5의 `reconcileMarkdownV2` sectionId 매칭을 그대로 따른다.

---

## 3. Decomposition 대체 — Data Type 구조화 추출

ingest task에 `dataTypeId`가 있으면 decomposition 자유 분해 대신 구조화 추출을 실행한다.

관련 코드:
- `src/lib/data-types.ts`
- `src/lib/ingest.ts`

동작:
- `loadDataTypes(projectPath)`로 data type YAML을 로드한다.
- 선택된 data type의 `fields`를 LLM system prompt에 넣는다.
- LLM은 raw data에서 각 field에 해당하는 내용을 찾아 하나의 markdown 문서를 만든다.
- 찾을 수 없는 field는 `"정보 없음"` 또는 `"N/A"`로 표기한다.
- 추출 결과가 전부 빈 값/플레이스홀더(`isEmptyDataTypeExtraction()` — 모든 `##` field 본문이 비어 있거나 "정보 없음"/"N/A"류 마커만 있음)면 해당 chunk는 문서·그래프 생성 없이 스킵된다.
- 생성된 markdown은 `db/{dataTypeId}/{slugifyForPagePath(fileName)}.md`를 `page_path`로 갖는 단일 SECTION으로 감싸진다. `page_path`가 미리 채워져 있으므로 file write가 곧바로 실행되고, 이 데이터 타입 + 소스 파일 조합에 대해 정확히 하나의 문서만 생성된다. data type은 단일 문서 보장이 있으므로 표시용 메타데이터를 LLM에 맡기지 않고 **결정론적으로** 헤더에 주입한다 — `title: {소스명} - {dataType.name}`(약 40자), `page_type: data_spec`, `summary`는 data-type 정의 기반 문자열.

data type id가 있지만 해당 YAML을 찾지 못하면 경고를 남기고 ingest를 중단한다. 기본 decomposition 자유 분해로 폴백하지 않는다.

### Data Type YAML

로드 경로: `{projectPath}/data_types/{id}.yaml` — 프로젝트 공유, git에 커밋된다.

```yaml
name: "Patch Notes"
fields:
  version: "Patch version number"
  release_date: "Patch release date"
  balance_changes: "Balance change details"
  bug_fixes: "List of bug fixes"
```

data type 선택 UI: `src/components/layout/icon-sidebar.tsx` — raw file injection / URL injection 경로에 연결된 다중 선택 체크박스 목록. N개 data type을 선택하면 파일당 N개의 ingest task가 큐에 추가되고(`enqueueIngest`를 data type마다 한 번씩 호출), 각 task가 독립적으로 처리되어 data type마다 별도 문서가 생성된다. 아무 것도 선택하지 않으면 표준(비구조화) decomposition 경로로 1개 task만 추가된다.

---

## 4. Markdown v2 문서 포맷

**역할:** `db/` 아래 모든 페이지가 따라야 하는 구조화 포맷. decomposition·data type 추출이 만든 자유 형식 텍스트는 `buildFileBlocksFromSections()`가 FILE 블록으로 감싼 뒤, `writeFileBlocks()` 내부에서 v2 포맷으로 파싱·검증된다.

관련 코드: `src/lib/markdown-v2/` — `parser.ts`, `serializer.ts`, `reconcile.ts`, `validator.ts`, `frontmatter.ts`, `types.ts`

포맷 규칙 (`parseMarkdownV2()`가 강제):
- frontmatter에 `page_id`, `title`, `page_type`, `summary`, `primary_entity`(선택), 그리고 `sections: { <sectionId>: {...메타데이터} }` 맵을 포함해야 한다.
- 본문은 정확히 하나의 H1(`# 제목`)을 가져야 한다.
- 모든 H2는 `## 제목 {#sec-<ULID>}` 형식이어야 한다 (`sec-` 접두사 + Crockford Base32 ULID). 이 형식을 벗어난 H2는 파싱 에러.
- 모든 H2의 `sectionId`는 frontmatter `sections` 맵에 대응 항목이 있어야 하고, 반대로 frontmatter의 모든 section 항목은 대응하는 H2가 있어야 한다 — 양방향 검증.
- section ID 중복은 허용되지 않는다.

즉 문서의 "정체성"은 heading 텍스트가 아니라 안정적인 `page_id`(페이지 단위)와 `sectionId`(섹션 단위)이며, 이 ID들은 decomposition이 아니라 파서·직렬화 계층에서 생성·유지된다.

---

## 5. File Write — 파일 생성과 섹션 단위 충돌 판정 (`writeFileBlocks`)

**역할:** decomposition 섹션을 받아 FILE 블록을 만들고, `db/` 페이지는 Markdown v2로 파싱해 기존 페이지와 병합하거나 충돌을 검출한다.

관련 코드: `src/lib/ingest.ts` — `buildFileBlocksFromSections()`, `writeFileBlocks()` / `src/lib/markdown-v2/reconcile.ts` — `reconcileMarkdownV2()`, `spliceSectionById()`

`buildFileBlocksFromSections()`는 LLM을 호출하지 않는다 — `page_path` 기준으로 섹션을 그룹화하고, 안전하지 않은 경로(`isSafeIngestPath` 실패)는 건너뛴다.

frontmatter의 `title`/`summary`/`page_type`과 각 H2의 heading text는 decomposition이 생성한 헤더 값을 검증해 쓴다. 폴백은 예외 경로다:
- `title`: 빈 값·약 40자 초과·구분자 오용을 교정하고, 유효하지 않으면 **파일 경로가 아니라** 소스 heading(`source_range`에서 `#` 제거) 또는 파일명 기반의 읽을 수 있는 이름으로 폴백한다.
- `page_type`: `PAGE_TYPES`(`vocabularies.ts`) 밖의 값은 `guide`로 폴백.
- `summary`: 없으면 `Generated from {fileName}`.
- section heading: 없으면 `Section N`.

이전 구현은 `title = source_range || pagePath`(위치 locator/파일 경로), `page_type: "guide"` 하드코딩, `summary: "Generated from ..."` 고정, heading `Section N`이었다 — 즉 표시명이 무의미했다. 지금은 그 값들이 명명 규칙에 맞는 생성값이고, 폴백만 위 경로를 탄다.

### 경로 패턴별 처리

| 경로 패턴 | 동작 |
|-----------|------|
| `*/log.md` | 기존 내용에 append |
| `*/index.md`, `*/overview.md` | 무조건 덮어쓰기 (v2 검증도 충돌 판정도 없음) |
| `db/*.md` (일반) | Markdown v2 파싱 후 `reconcileMarkdownV2()`로 sectionId 단위 병합/충돌 판정 |
| `db/` 외 prefix | sources merge 후 덮어쓰기 |

### `db/` 페이지 충돌 판정 (`reconcileMarkdownV2`)

기존 페이지가 없으면: incoming 내용 그대로 `pendingV2Writes`에 적재.

기존 페이지가 있으면 기존/incoming 모두 `parseMarkdownV2()`로 파싱한 뒤(파싱 실패 시 해당 파일 write를 drop하고 warning), **`sectionId` 매칭**으로 비교한다 (heading 텍스트 비교가 아니다):

| 상황 | 동작 |
|------|------|
| 기존 sectionId가 incoming에 없음 | 기존 섹션 그대로 유지 |
| incoming sectionId가 기존에 없음 (신규 섹션) | 충돌 아님 — 결과 페이지에 그대로 추가 |
| 같은 sectionId, 정규화한 본문(trim, 개행·trailing whitespace 정리)이 동일 | 충돌 아님 — incoming으로 교체(내용은 사실상 동일) |
| 같은 sectionId, 본문이 다름 | **그 섹션만 충돌** — 결과에는 기존 본문을 유지하고, 별도로 conflict 레코드 생성 |

충돌이 있으면: 충돌 섹션마다 incoming 본문을 `pending/_proposals/{timestamp}-{idx}-{slug}.md`에 저장하고 `ModificationProposal{targetPath, pageId, sectionId, existingExcerpt, incomingExcerpt, incomingDraftPath, sourceRefs}`를 생성한다. 페이지 전체(비충돌 섹션 포함, page_id는 기존 것을 유지)는 병합된 상태로 `pendingV2Writes`에 적재된다 — 충돌 섹션도 일단은 "기존 유지" 상태로 포함되어 있으므로, 충돌이 있어도 그 chunk의 나머지 내용은 즉시 커밋 대상이 된다.

한 페이지에 신규 섹션과 충돌 섹션이 동시에 있어도(혼합 케이스) 하나의 병합 결과로 합쳐져 처리된다.

---

## 6. Graph Assignment와 원자적 커밋 (`pendingV2Writes` → knowledge.sqlite)

**역할:** 이번 chunk에서 병합된 페이지들의 섹션 텍스트에서 `subject → predicate → object` assertion을 추출하고, 페이지·섹션·assertion을 knowledge.sqlite에 한 번에 원자적으로 반영한다.

관련 코드:
- `src/lib/ingest.ts` — `extractKnowledgeAssertionWrites()` (private)
- `src/lib/ingest-v2/` — `hydrate.ts`(`hydratePageDocument()`), `plan.ts`(`IngestPlan` 타입), `execute.ts`(`executeIngestPlan()`, `commitMarkdownV2Pages()`, `commitMarkdownV2Page()`), `validate.ts`(`validateIngestPlan()`), `recovery.ts`(`recoverPendingIngests()`)
- `src/commands/knowledge.ts` — `commitIngestPlan()` (Tauri invoke)
- `src-tauri/src/knowledge/commands.rs` — `commit_ingest_plan`

### Graph assignment (`extractKnowledgeAssertionWrites`)

- `writeFileBlocks()`가 모은 `pendingV2Writes`(chunk 전체, 여러 페이지 가능)의 각 페이지를 다시 `parseMarkdownV2()`로 파싱해 섹션 텍스트를 추출한다.
- 프로젝트에 등록된 그래프 목록(`listKnowledgeGraphs`)과 그래프별 relation type 카탈로그(`listKnowledgeRelationTypes`)를 LLM 프롬프트에 그래프 카탈로그로 제공한다 — 별도의 JSON 정책 파일은 없다. 카탈로그 자체가 knowledge.sqlite의 `graphs`/`relation_types` 테이블이다.
- LLM은 각 섹션(`targetKey: "page:section"`)에 대해 `{targetKey, graphId, newGraph, graphName, subjectName, subjectType, predicate, relationDescription, objectName, objectType, quote}` 배열(JSON)을 반환한다.
- **그래프 자동 생성**: 카탈로그에 맞는 그래프가 없으면 LLM이 `newGraph:true` + `graphName`을 반환해 새 그래프를 제안할 수 있다. `graphName`은 `{purpose}_{subjectType}_{action}_{objectType}` 형태의 lower snake_case여야 한다(예: `combat_character_attacks_enemy`, `quest_npc_gives_item`). 기존 그래프의 purpose 접두사 목록을 프롬프트에 주입해 재사용을 유도한다. `extractKnowledgeAssertionWrites()`가 커밋 직전 `registerGraph()`로 신규 그래프를 등록하고 write의 `graphId`를 발급된 id로 치환하므로, Rust `commit_ingest_plan`은 기존처럼 실재하는 graphId만 받는다(원자적 커밋 로직 무변경). 커밋이 실패해 빈 그래프가 남아도 해가 없으며 graphs 탭에서 삭제할 수 있다.
- 반환값은 엄격히 검증된다: 기존 그래프면 `graphId`가 실제 등록된 그래프인지, 신규면 `graphName`이 `^[a-z0-9]+(_[a-z0-9]+)+$`에 맞는지, `subjectType`/`objectType`이 `ENTITY_TYPES`(`src/lib/knowledge/vocabularies.ts`)에 속하는지, `quote`가 실제로 그 섹션 본문에 포함되는지(exact substring). 하나라도 어긋나면 `VALIDATION_FAILED` 예외로 전체가 실패한다.
- 그래프가 프로젝트에 하나도 없어도 assertion 추출을 건너뛰지 않는다 — LLM이 도메인별 그래프를 새로 제안한다. 신규 프로젝트는 더 이상 `main` 디폴트 그래프를 시드하지 않는다(`project-init.ts`).

### 원자적 커밋 (`commitMarkdownV2Pages` → `commitIngestPlan`)

- `commitMarkdownV2Pages(projectPath, documents, assertions)`가 각 문서를 `hydratePageDocument()`로 `PageRecord`+`SectionRecord[]`로 변환(entity ID 형식 `ent-<ULID>` 검증 포함)하고, 새 `operationId`(UUID)로 `IngestPlan{operationId, pages, assertions, embeddingJobs}`을 만든다.
- `executeIngestPlan()`이 `validateIngestPlan()`(경로 안전성, 중복 page/section ID 없음, assertion의 pageId/sectionId가 같은 plan의 페이지를 가리키는지, predicate가 `UPPER_SNAKE_CASE`인지)으로 검증한 뒤, 각 페이지를 다시 파싱·hydrate해서 plan에 실린 내용과 정확히 일치하는지 재확인한다(변조 방지) — 그런 다음에만 Rust `commitIngestPlan`을 호출한다.
- Rust `commit_ingest_plan`(`src-tauri/src/knowledge/commands.rs`):
  1. journal(`temp`/`backup` 경로 기록)을 먼저 디스크에 `staged` 상태로 기록하고, 각 페이지의 새 내용을 임시 파일(`.{name}.{operationId}.tmp`)에 먼저 쓴다 — 크래시 시 복구 가능하도록.
  2. SQLite 트랜잭션 안에서 각 페이지를 upsert(`INSERT ... ON CONFLICT(page_id) DO UPDATE`)하고 섹션을 전체 교체(`DELETE` 후 `INSERT`)한다.
  3. 각 assertion에 대해: 그래프 존재 확인 → subject/object 엔티티를 이름 exact-match로 resolve/생성(`resolve_or_create_ingest_entity`, §7) → predicate(relation type)가 그래프에 없으면 새로 등록(`INSERT ... relation_types`) → graph_nodes에 노드 연결 → `assertion()` 헬퍼로 assertion 생성(§7의 cardinality 충돌 판정 포함).
  4. 트랜잭션 커밋 후 journal 상태를 `db_committed`로 갱신하고, 임시 파일을 실제 대상 경로로 적용(`apply_journal`)한 뒤 journal 파일을 삭제한다.
  5. 중간에 실패하면 임시 파일과 journal을 정리하고 에러 반환 — DB도 파일도 반영되지 않는다.
- 프로젝트 오픈 시 `recoverPendingIngests()`(`src/lib/ingest-v2/recovery.ts` → Rust `recover_ingest_transactions`)가 `staged`/`db_committed` 상태로 남은 journal을 정리해 비정상 종료로 인한 부분 커밋을 복구한다.

**결론**: 한 chunk 안에서 페이지 저장(파일시스템)과 그래프 assertion 생성(knowledge.sqlite)이 **하나의 원자적 작업**으로 처리된다 — 과거처럼 "file write 먼저, graph sync는 나중에 별도 호출"하는 2단계 구조가 아니다.

---

## 7. 엔티티 이름 매칭 — exact match만 (fuzzy 사전 없음)

관련 코드: `src-tauri/src/knowledge/commands.rs` — `resolve_or_create_ingest_entity`, `create_or_link_entity`

- entity 이름 매칭은 `normalized_alias()`(trim + NFKC 정규화 + lowercase)로 만든 문자열의 **완전 일치**만 본다. `entity_aliases.normalized_alias`에 일치하는 별칭이 있으면 그 엔티티를 재사용하고, 없으면 새 엔티티 + 별칭을 생성한다.
- **fuzzy(유사) 매칭 로직은 존재하지 않는다.** 과거 `entity-dict.ts`/`checkEntityConflicts()`가 담당하던 "이 이름이 기존 엔티티와 비슷한데 같은 건지 다른 건지 사용자에게 물어보는" 단계는 ingest 경로에 없다 — 신규/기존 판단은 정규화 문자열 완전일치로 자동 결정되며 사용자 확인을 거치지 않는다.
- `find_knowledge_entities`(`LIKE %needle%` 부분일치)는 [entity-view.tsx](../src/components/entity/entity-view.tsx)의 수동 검색 UI 전용이며, ingest 시 자동 매칭에는 쓰이지 않는다. 이름이 비슷하지만 다른 엔티티로 각각 생성된 경우, 사용자가 Graph 화면의 `entity` 탭에서 수동으로 **merge**해야 한다.

### Cardinality 충돌 — entity_confirmation과는 다른 개념

`assertion()`(Rust, `commands.rs`)이 assertion을 생성할 때, 해당 predicate의 `object_cardinality`가 `"one"`이고 같은 subject+predicate로 이미 다른 object를 가진 `active` assertion이 있으면 새 assertion을 `status:"review"`로 넣는다(기존 것을 덮어쓰지 않음).

- 이것은 **"엔티티 이름이 같은 건지 확인"이 아니라 "1개의 subject+predicate가 2개의 서로 다른 object를 가지려는 카디널리티 위반"** 케이스다. 과거 문서가 말하는 `entity_confirmation`(이름 fuzzy 매치 확인)과는 완전히 다른 개념이며, 대체 관계도 아니다 — 이름 매칭 확인 자체가 지금은 없다.
- `resolve_cardinality_conflict`(승인 — 기존 active를 `superseded`로, review 건을 `active`로 승격)과 `reject_review_assertion`(거부 — review 건 삭제)으로 처리하며, UI는 [graph-view.tsx](../src/components/graph/graph-view.tsx)의 `knowledge` 탭이 `status==="review"`인 assertion에 Approve/Reject 버튼을 직접 노출한다 (`src/components/review/review-view.tsx`의 review 카드 큐를 거치지 않는 별도 경로).

### 두 개의 독립된 큐

- **`useReviewStore`(zustand, `src/stores/review-store.ts`)의 `ReviewItem`** — `suggestion`/`modification` 2종. 프론트엔드 메모리 상태이며 ingest의 chunk 실패, 섹션 충돌(modification proposal)을 다룬다.
- **knowledge.sqlite의 `assertions.status = 'review'`** — 위에서 설명한 cardinality 충돌만을 표현하는 DB 레코드.

두 큐 사이에는 코드상 연결이 없다 — cardinality 충돌이 review-store에 아이템을 추가하지 않고, review-store의 카드 처리가 assertion review 상태를 바꾸지도 않는다.

---

## 8. Modification proposal 흐름 (사용자 승인/거부)

사용자 선택 (`src/lib/modification-resolve.ts`, `src/components/review/review-view.tsx`):

| 버튼 | 함수 | 동작 |
|------|------|------|
| **Approve** | `approveModification()` | draft 내용을 읽어 대상 페이지를 `parseMarkdownV2()`로 파싱, `page_id` 일치 확인, `spliceSectionById()`로 **그 섹션만** 교체(다른 섹션·순서는 보존), `serializeMarkdownV2()`로 직렬화해 파일에 직접 저장, draft 삭제. 이후 `reIngestDocument(pp, projectName, targetPath, content, llmConfig, undefined, undefined, proposal.sectionId)` 호출 |
| **Merge** | 없음(UI 전용) | draft를 에디터에서 열기 — 수동 편집 후 같은 카드의 Approve를 다시 눌러야 함 |
| **Reject → Discard** | `discardModification()` | `rejection-log.jsonl`에 사유 append, draft 삭제. knowledge.sqlite 반영 없음 |
| **Reject → Pending** | `pendingModification()` | `pending/{slug}.md`로 이동. knowledge.sqlite 반영 없음 |

`pending/{slug}.md`로 보낸 항목은 [pending-view.tsx](../src/components/review/pending-view.tsx)에서 후속 처리한다(`src/lib/pending-resolve.ts`): **Re-review**(다시 modification 카드로 큐잉), **Promote to db/**(바로 `commitMarkdownV2Page()`로 커밋), **Discard**(rejection-log에 기록 후 삭제).

**Approve 이후 `reIngestDocument()`가 하는 일 (섹션 단위 graph 재할당):**

```ts
export async function reIngestDocument(projectPath, projectName, pagePath, content, llmConfig, dataTypeId?, prefilledFields?, sectionId?) {
  // dataTypeId, prefilledFields는 무시(void)된다. sectionId가 있으면(modification-approve 경로):
  const assertions = await extractKnowledgeAssertionWrites(pp, [{relativePath: pagePath, content}], llmConfig, undefined, [sectionId])
  await discardSectionAssertions(pp, sectionId) // 이 섹션이 근거였던 evidence를 삭제하고, evidence가 하나도 안 남은 assertion은 assertion 자체도 삭제
  await commitMarkdownV2Pages(pp, [{relativePath: pagePath, content}], assertions)
  // sectionId가 없으면(casemap/persona export 경로) 예전처럼 commitMarkdownV2Page()만 호출
}
```

- `sectionId`가 주어지면 `extractKnowledgeAssertionWrites()`를 **그 섹션 텍스트에만 한정**해서 재실행한 뒤(다른 섹션은 LLM에 보내지 않음), 새 assertion을 얻기 **전에** 실패하면 아무것도 건드리지 않고 기존 assertion을 그대로 둔다(LLM 실패 시 안전한 폴백). 추출이 성공하면 `discard_section_assertions`(Rust, `src-tauri/src/knowledge/commands.rs`)로 이 섹션을 근거(evidence)로 삼던 기존 assertion들을 폐기한 다음, `commitMarkdownV2Pages()`로 페이지/섹션 갱신과 새 assertion 생성을 함께 커밋한다.
- `discard_section_assertions`는 `assertion_evidence WHERE section_id=?`에 걸리는 evidence row를 지우고, 그 결과 evidence가 하나도 안 남은 assertion만 삭제한다 — 다른 섹션의 evidence로도 지지되는 assertion은 그대로 유지된다.
- 이 함수는 실패해도(폴백 단계 포함) 예외를 삼키고 콘솔 경고만 남긴다(`console.warn`) — 카드 자체는 여전히 "Approved"로 resolve된다.
- 이건 과거 v1 구현(페이지 전체의 triple을 지우고 문서 전체를 재-decompose하던 방식)과 다르다 — v2에서는 섹션 단위 안정 ID(`assertion_evidence.section_id`)를 활용해 변경된 섹션만 재할당한다.

**Merge를 거쳐 draft를 수동으로 고친 뒤 Approve해도** 위 동작은 동일하다 — splice된 섹션 내용이 다를 뿐, 같은 섹션 단위 재할당 경로를 탄다.

---

## 9. 문서 vs Graph — 개념 대응

| 개념 | 문서 (wiki page) | Graph |
|------|------------------|-------|
| **정체성** | `page_id`(페이지), `sectionId`(섹션) — 둘 다 안정적 ID | assertion은 `(graph_id, subject_entity_id, predicate, object_entity_id)` |
| **내용 단위** | H2 섹션 본문 | assertion + evidence(quote, page_id, section_id) |
| **배치 결정** | decomposition의 `page_path` | graph assignment의 `graphId` |
| **충돌 판정** | `reconcileMarkdownV2()` — sectionId 매칭, 본문 다르면 modification proposal | cardinality 위반만 `status:"review"`로 대기, 그 외 이름 다른 엔티티는 자동 생성 |
| **진실 원천** | `db/*.md` (Markdown v2 파일이자 knowledge.sqlite `pages`/`sections`의 동시 원천) | knowledge.sqlite `assertions`/`entities`/`graphs`/`relation_types` |
| **연결** | section의 evidence가 `page_id`+`section_id`로 assertion을 가리킴 | assertion evidence가 section을 가리킴 (단방향: section → 자신을 근거로 쓰는 assertion 목록은 조회로 구함) |

파일과 DB는 이제 별도 커밋이 아니라 `commitIngestPlan`의 한 트랜잭션 안에서 함께 반영되므로(§6), 과거처럼 "문서는 저장됐는데 그래프에는 반영 안 됨" 같은 두 시스템 간 드리프트가 정상 경로에서는 생기지 않는다. §8에서 설명한 대로 modification Approve도 이제 변경된 섹션에 한해 graph assignment를 재실행하고 그 섹션의 이전 assertion을 폐기하므로, 승인된 내용의 새 관계가 그래프에 반영된다.

---

## 10. 후처리

ingest loop가 끝난 뒤 다음 처리가 이어진다.

- skipped chunk가 있으면 `suggestion` review item 생성
- modification proposal이 있으면 `modification` review item 생성
- 성공적으로 쓴 파일이 있고 hard failure / skipped chunk가 없으면 ingest cache 저장
- 쓴 파일이 있으면 git commit 시도
- embedding 설정이 켜져 있으면 `db/` 페이지를 embedding index에 반영 (`IngestPlan.embeddingJobs`)
- file tree와 data version 갱신

### Review item 종류 (ingest 관련, review-store 기준)

| type | 발생 시점 | 내용 |
|------|-----------|------|
| `suggestion` | decomposition 실패, chunk 스킵(page_path 누락·빈 data-type 추출 포함) — `failedChunks`/`emptyDataTypeChunks` 기반 | 실패한 chunk·이유 설명. Dismiss 액션만 있음 |
| `modification` | `writeFileBlocks`의 `reconcileMarkdownV2` 섹션 단위 충돌 | 충돌난 section의 existing vs incoming diff (`sectionId`/`pageId` 필드로 어느 섹션인지 식별) |

**주의**: `extractKnowledgeAssertionWrites()`(graph assignment)가 `VALIDATION_FAILED`로 실패해도 review-store 카드는 생성되지 않는다 — `writeFileBlocks`의 try/catch가 이를 잡아 `hardFailures`+`warnings`로만 처리하고, activity panel의 warnings 요약(§1 흐름도의 후처리 단계)으로만 노출된다. "graph assignment 실패 = suggestion 카드"라는 서술은 부정확하다.

`entity_confirmation` 타입은 존재하지 않는다 (§7 참고). graph contradictory fact(같은 predicate·다른 값)는 cardinality "one" 제약이 걸린 predicate에 한해서만 §7의 assertion review로 대기하며, 그 외에는 병렬 assertion으로 그냥 추가된다.

---

## 11. 헷갈리기 쉬운 점

| 항목 | 현재 구현 |
|------|-----------|
| 섹션 충돌 판정 기준 | heading 텍스트가 아니라 **`sectionId`**(frontmatter에 명시된 `sec-<ULID>`)로 매칭한다. 같은 sectionId인데 본문이 다르면 충돌, 텍스트가 같은 heading이라도 sectionId가 다르면 별개 섹션으로 취급된다. |
| graph assignment 시점 | chunk의 파일 write(`writeFileBlocks`)가 끝난 직후, `pendingV2Writes`가 있을 때만 실행되고 곧바로 같은 커밋에 포함된다. 충돌이 있어도(비충돌 섹션들이 pendingV2Writes에 들어가 있으므로) 그 chunk의 assertion 추출·커밋은 정상 진행된다 — graph assignment가 "Approve 이후로 미뤄지는" 것은 아니다. |
| entity 매칭 | **ingest 자동 dedup은** 정규화 문자열 완전일치만 본다 — Rust `resolve_or_create_ingest_entity`/`create_or_link_entity`가 `normalized_alias` exact match로만 조회한다. ingest 경로 자체에는 fuzzy 매칭도 자동 병합도 없다. 다만 (1) 입력 단계에서 draft 생성 시 `normalizeEntityName()`(NFKC + 후행 괄호 부기 제거 + 공백 정리, `ingest.ts`)로 표기를 통일해 완전일치 dedup에 흡수시키고, (2) 사후에 `suggest_entity_merges`(commands.rs)가 같은 `entity_type` 안에서 정규화 동일(1.0)·부분포함·편집거리 ≤2 & 유사도 ≥0.7 쌍을 점수화해 추천한다. 이름이 갈린 엔티티는 Graph 화면 `entity` 탭의 "Find duplicates"에서 후보를 확인한 뒤 사용자가 수동 merge(`mergeKnowledgeEntities`)한다. |
| cardinality 충돌과 entity_confirmation | 서로 다른 개념이다. cardinality 충돌은 knowledge.sqlite `assertions.status` 기반이고 review-store를 거치지 않는다. entity_confirmation은 과거에 있었지만 지금은 없다. |
| graph policy 파일 | `src/lib/graph-policy.ts` 소스는 존재하지 않는다. 그래프·relation type 카탈로그는 knowledge.sqlite의 `graphs`/`relation_types` 테이블이며, Graph 화면의 `graphs` 탭에서 직접 관리한다. 저장소에 남아있는 `.llm-wiki/graph-policy.json`은 과거 아키텍처의 잔존 데이터 파일로 현재 코드가 읽지 않는다. 다만 과거 정책의 **그래프 자동 생성 + 이름 규칙**은 `extractKnowledgeAssertionWrites()`의 프롬프트/검증(§6)으로 되살아났다 — 정책 파일이 아니라 ingest 코드에 인라인돼 있다. 과거 정책의 **엔티티 이름 정규화**도 별도 파일이 아니라 `normalizeEntityName()`(ingest.ts)와 `suggest_entity_merges`(commands.rs)로 코드에 인라인돼 있다. |
| entity-dict.json | `src/lib/entity-dict.ts` 소스는 존재하지 않는다. `.llm-wiki/entity-dict.json` 데이터 파일이 프로젝트에 남아있더라도 현재 코드는 읽지 않는다. |
| 파일 write와 DB 커밋의 원자성 | 같은 chunk 안에서는 Rust `commit_ingest_plan`의 journal+트랜잭션으로 원자적이다. 크래시 시 `recoverPendingIngests()`가 프로젝트 오픈 시점에 미완료 journal을 정리한다. |
| chunk 간 page_path 재사용 | 여러 chunk가 같은 `page_path`를 선택할 수 있다 — chunk마다 `dbIndex`를 다시 빌드해 다음 chunk의 decomposition 프롬프트에 넘기기 때문. sectionId 매칭 원칙(§5)을 그대로 따른다. |
| 표시명(title/heading) 생성 시점 | **최초 ingest 때만** 생성된다. modification Approve(`spliceSectionById`)와 `reIngestDocument`/`commitMarkdownV2Page`는 안정 ID·구조를 보존하고 title/heading을 재생성하지 않으므로, 문서 수정으로 표시명이 임의로 바뀌지 않는다. 신규 title은 신규 page가 만들어질 때만 생성된다. |

---

## 12. 관련 코드 위치

| 역할 | 파일 |
|------|------|
| 전체 파이프라인 (decomposition → file write → graph assignment 트리거) | `src/lib/ingest.ts` |
| Decomposition 섹션 파싱 (page_path 포함) | `src/lib/ingest.ts` — `parseDecomposedSections()` |
| File write + 섹션 단위 충돌 판정 | `src/lib/ingest.ts` — `buildFileBlocksFromSections()`, `writeFileBlocks()` |
| Markdown v2 파서·직렬화·충돌 판정 | `src/lib/markdown-v2/` — `parser.ts`, `serializer.ts`, `reconcile.ts`, `validator.ts` |
| Ingest plan 구성·검증·커밋·복구 | `src/lib/ingest-v2/` — `plan.ts`, `hydrate.ts`, `execute.ts`, `validate.ts`, `recovery.ts` |
| Approve 후 페이지만 재커밋 (assertion 없음) | `src/lib/ingest.ts` — `reIngestDocument()` |
| SQLite 원자적 커밋 (journal 기반 크래시 복구) | `src-tauri/src/knowledge/commands.rs` — `commit_ingest_plan` |
| 엔티티 이름 매칭 (exact match만) | `src-tauri/src/knowledge/commands.rs` — `resolve_or_create_ingest_entity`, `create_or_link_entity` |
| 엔티티 이름 정규화 (dedup 입력 통일) | `src/lib/ingest.ts` — `normalizeEntityName()`, graph assignment 프롬프트의 canonical-name 규칙 |
| 엔티티 병합 후보 추천 (사후 fuzzy) | `src-tauri/src/knowledge/commands.rs` — `suggest_entity_merges` / UI: `src/components/entity/entity-view.tsx`의 "Find duplicates" |
| Cardinality 충돌 판정·승인·거부 | `src-tauri/src/knowledge/commands.rs` — `assertion()`, `resolve_cardinality_conflict`, `reject_review_assertion` |
| modification resolve (섹션 스플라이스 포함) | `src/lib/modification-resolve.ts` — `approveModification()`, `spliceSectionById()`(`src/lib/markdown-v2/reconcile.ts`) |
| Review UI (Approve 핸들러) | `src/components/review/review-view.tsx` |
| ModificationProposal 타입 (pageId/sectionId) | `src/stores/review-store.ts` |
| data type 로드 | `src/lib/data-types.ts` |
| injection UI | `src/components/layout/icon-sidebar.tsx` |
