# Ingest 현재 구현: 파이프라인·문서·그래프

raw data ingest 시 파이프라인 전체 흐름, 각 단계 동작, 문서/그래프 생성·배치·충돌 처리를 정리한다.

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
       -> reconcileSections(): 기존 파일을 `## heading` 섹션 단위로 비교
       -> 충돌 섹션 없음 (신규 섹션 자동 병합 포함): 파일 저장
           -> Graph assignment: LLM graph assignment (확정 문서 기반)
               -> syncGraphToBackend()  ← 파일 저장 성공 후 즉시
       -> 충돌 섹션 있음: 충돌 섹션마다 ModificationProposal 생성 (pending/_proposals/)
                          + 충돌 없는 나머지 섹션(신규 섹션 포함)은 같은 트랜잭션에서 즉시 반영
           -> 사용자 Approve → reIngestDocument()로 승인된 최종 파일 내용을 재-decompose
                                → graph assignment → syncGraphToBackend()
           -> 사용자 Reject  → graph assignment 실행 안 함
  -> review items (skipped triples, modification proposals)
  -> ingest cache
  -> git commit
  -> embeddings (설정 시)
```

## 2. Decomposition — 문서 분해

**역할:** source text를 의미 있는 섹션 단위로 쪼개고, 각 섹션의 `page_path`를 결정한다.

관련 코드:
- `src/lib/ingest.ts` — `buildDecompositionPrompt()`, `parseDecomposedSections()`

동작:
- LLM에게 source 문서를 읽고 개념/토픽 단위의 SECTION 블록을 emit하도록 요청한다.
- 각 섹션에 대해 `db/` 아래 저장할 `page_path`도 함께 결정한다 (기존 db/ 인덱스 참고).
- 관계 추출, graph 배정, relation type 결정은 하지 않는다.
- 출력은 JSON이 아니라 delimiter 기반 SECTION 형식이다.

```text
---SECTION: ## 고블린 전사 | db/enemies/goblin-warrior.md---
(source text 원문 그대로)
---END SECTION---
```

opener 형식: `source_range | page_path`. `parseDecomposedSections()`가 ` | db/` 구분자로 두 값을 분리한다. `page_path`가 없거나 안전하지 않은 경로면 해당 섹션이 속한 chunk 전체가 실패로 기록되고 스킵된다 — page_path를 추측해서 채우는 폴백은 없다.

출력 타입:

```ts
interface DecomposedSection {
  source_range: string
  source_text: string
  page_path?: string  // decomposition이 결정; 없으면 이 섹션이 속한 chunk는 실패 처리
}
```

큰 파일은 `chunkSourceContent()`로 나뉘며 chunk별로 decomposition → file write → graph assignment가 반복된다. 어떤 chunk가 decomposition에서 실패하면(모델 호출 실패, 섹션 파싱 실패, page_path 누락 등) 해당 chunk만 review item으로 기록되고 나머지 chunk ingest는 계속된다.

**chunk 간 page_path는 독립적이지 않다.** chunk는 순서대로(직렬로) 처리되며, 각 chunk의 file write가 끝나면 다음 chunk로 넘어가기 전에 `dbIndex`를 다시 빌드해 decomposition 프롬프트에 주입한다 (`ingest.ts` — chunk 루프의 `currentDbIndex = await buildDbIndex(pp)`). 그래서 chunk 2의 decomposition LLM은 chunk 1이 방금 쓴 `db/` 페이지 목록을 보고, 같은 주제라고 판단하면 동일한 `page_path`를 다시 선택할 수 있다. 이때 실제 병합 여부는 §6의 충돌 판정을 그대로 따른다: 새 chunk가 만든 본문이 기존 파일과 동일하면 sources만 병합되고, 본문이 다르면 (내용을 보충하는 것이라도) modification proposal로 처리되어 사용자 승인 없이는 자동으로 합쳐지지 않는다.

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
- 생성된 markdown은 `db/{dataTypeId}/{slugifyForPagePath(fileName)}.md`를 `page_path`로 갖는 단일 SECTION으로 감싸진다. `page_path`가 미리 채워져 있으므로 file write가 곧바로 실행되고, 이 데이터 타입 + 소스 파일 조합에 대해 정확히 하나의 문서만 생성된다. Graph assignment는 이후 이 확정된 섹션에 대해 graph triple만 추출하며 문서 구조(page_path)에는 더 이상 영향을 주지 않는다.

data type id가 있지만 해당 YAML을 찾지 못하면 경고를 남기고 ingest를 중단한다. 기본 decomposition 자유 분해로 폴백하지 않는다.

### Data Type YAML

로드 경로: `{projectPath}/data_types/{id}.yaml` — 프로젝트 공유, git에 커밋된다.

```yaml
name: "패치노트"
fields:
  version: "패치 버전 번호"
  release_date: "패치 적용 날짜"
  balance_changes: "수치 변경 내용"
  bug_fixes: "버그 수정 목록"
```

data type 선택 UI: `src/components/layout/icon-sidebar.tsx` — raw file injection / URL injection 경로에 연결된 다중 선택 체크박스 목록. N개 data type을 선택하면 파일당 N개의 ingest task가 큐에 추가되고(`enqueueIngest`를 data type마다 한 번씩 호출), 각 task가 독립적으로 처리되어 data type마다 별도 문서가 생성된다. 아무 것도 선택하지 않으면 표준(비구조화) decomposition 경로로 1개 task만 추가된다.

---

## 4. Graph Assignment

**역할:** decomposition 섹션을 읽고 `subject → predicate → object` triple을 추출하고, triple 단위로 graph를 배정한다.

관련 코드:
- `src/lib/ingest.ts` — `buildGraphAssignmentScaffold()`, `buildGraphAssignmentPrompt()`, `hydrateGraphAssignments()`, `applyGraphPolicyUpdates()`, `validateGraphAssignments()`
- `src/lib/graph-policy.ts`

동작:
- decomposition의 `DecomposedSection[]`을 scaffold JSON으로 바꿔 LLM에 전달한다.
- LLM은 각 section에 대해 하나 이상의 triple을 생성할 수 있다.
- 같은 section에서 나온 triple이라도 서로 다른 graph에 배정될 수 있다.

출력 타입:

```ts
interface GraphAssignmentTriple {
  source_id?: string
  subject: string
  predicate: string
  object: string
  graph: string
  page_path: string
  new_graph: boolean
  graph_relation_types?: string[]
  source_range?: string
  source_text?: string
}
```

Graph assignment 이후 처리:
- `hydrateGraphAssignments()` — `source_id`를 기준으로 `source_range`, `source_text`를 triple에 붙인다.
- `applyGraphPolicyUpdates()` — 신규 graph나 relation type 확장을 graph policy 파일에 반영한다.
- `validateGraphAssignments()` — 필수 필드 누락, unknown graph, graph당 relation type 4개 초과 등을 검사한다.
- 실패한 triple은 파일에 반영되지 않고 suggestion review item으로 남는다.

### Graph 배정 규칙

- `GraphPolicy`의 `managedGraphs`에서 의미에 맞는 graph 선택.
- relation type은 그래프별 개념이다 — `GraphPolicy.graphRelationTypes`(그래프당 최대 4개)가 유일한 진실 원천이며, 프로젝트 전역 relation type 목록은 존재하지 않는다. `managedGraphs`가 비어 있는 새 프로젝트의 첫 ingest는 정책 블록 없이 graph assignment 기본 지시만으로 동작한다.
- predicate가 graph에 없고 relation type 슬롯(최대 4개)이 남아 있으면 확장.
- 4개가 꽉 찼으면 `new_graph: true`로 새 graph 제안.
- 새 graph 이름은 `{purpose}_{domain-or-action}` snake_case 컨벤션을 따르도록 프롬프트가 유도한다 (예: `casemap_use_item`, `playlog_move_server`). `managedGraphs`에 `_`를 포함한 이름이 이미 있으면 그 prefix 목록을 프롬프트에 노출해 새 prefix를 만들기보다 기존 prefix 재사용을 우선하게 한다 (`buildGraphPolicyPrompt()`, `src/lib/graph-policy.ts`).
- `subject`/`object`는 반드시 개체·개념을 가리키는 명사여야 하며 숫자+단위 같은 bare scalar 값(예: `30초`, `50%`)은 허용되지 않는다 — `validateGraphAssignments()`가 `isBareScalarValue()`로 이를 검사해 실패 처리한다. 수치 정보는 predicate(`HAS_COOLDOWN` 등)로 의미를 옮기고 object는 속성 개념(`쿨타임`)을 가리켜야 하며, 실제 값은 별도로 저장되는 source_text에만 남는다. 숫자를 포함해도 고유 명사(`레벨 10 던전`)는 통과한다.
- 실패 시 suggestion review item 생성. overflow 시 "Create new graph" 액션 제공.

---

## 5. File Write — 파일 생성 (LLM 없음)

**역할:** decomposition 섹션을 받아 `db/` 아래에 쓸 markdown FILE 블록을 만든다.

관련 코드:
- `src/lib/ingest.ts` — `buildFileBlocksFromSections()`, `writeFileBlocks()`

File write는 LLM을 호출하지 않는다. `buildFileBlocksFromSections(DecomposedSection[])`가 유일한 생성 경로다:

- 섹션을 `page_path` 기준으로 그룹화한다.
- `page_path`가 없거나 안전하지 않은 경로(`isSafeIngestPath` 실패)는 건너뛴다 (이 시점에는 이미 chunk 단위로 걸러진 뒤이므로 정상 흐름에서는 발생하지 않는다).
- 같은 `page_path`를 공유하는 섹션은 하나의 FILE 블록으로 병합된다.
- `title`은 `source_range`를, 본문은 각 섹션의 `source_text`를 순서대로 이어붙인다.

graph frontmatter, wiki link, relation 목록은 markdown 파일에 중복 저장하지 않는다.

---

## 6. 문서 저장과 충돌 처리 (`writeFileBlocks`)

### 충돌 판정 — 섹션 단위 (`reconcileSections`)

`db/` 페이지에 한해, 디스크에 이미 파일이 있고 incoming 본문이 다를 때 **`## heading` 섹션 단위**로 비교한다 (`splitIntoSections()` / `reconcileSections()`, `src/lib/ingest.ts`). 페이지는 `# Title` 등 첫 `##` 이전의 leading 텍스트를 `heading: null`인 하나의 섹션으로, 이후 각 `## heading` 블록을 섹션으로 취급한다 (`###` 이하는 부모 섹션에 포함).

| 상황 | 동작 |
|------|------|
| 파일 없음 | 신규 생성 |
| 파일 있음 + 본문 동일 (섹션 전체 일치) | sources frontmatter 병합 후 덮어쓰기 |
| heading이 incoming에만 있음 (신규 섹션) | 충돌 아님 — 기존 파일에 즉시 append |
| heading이 양쪽에 있고 본문(trim) 동일 | 충돌 아님 |
| heading이 양쪽에 있고 본문이 다름 | **그 섹션만** modification proposal — 기존 섹션 유지, 섹션 draft는 `pending/_proposals/`에 park |

한 페이지에 신규 섹션과 충돌 섹션이 동시에 있으면(혼합 케이스), 신규 섹션은 즉시 파일에 반영되고 충돌 섹션만 proposal로 분리된다 — 같은 저장 호출 안에서 원자적으로 처리된다.

| 경로 패턴 | 동작 |
|-----------|------|
| `*/log.md` | 기존 내용 append |
| `*/index.md`, `*/overview.md` | 무조건 덮어쓰기 (충돌 검사 없음) |
| `db/*.md` (일반) | 위 섹션 단위 충돌 규칙 적용 |
| `db/` 외 prefix | sources merge 후 덮어쓰기 |

### Modification proposal 흐름

충돌 섹션마다:
1. 그 섹션의 incoming 본문만 `pending/_proposals/{timestamp}-{idx}-{slug}.md`에 저장 (페이지 전체가 아님)
2. `ModificationProposal` 생성 — `existingExcerpt`/`incomingExcerpt`는 **그 섹션의 본문만**, `sectionHeading`(충돌난 `## heading` 텍스트, leading 섹션이면 `null`)
3. Review 탭에 `modification` 카드 표시 (`## heading` 섹션명이 카드 설명·diff 영역에 노출됨)

사용자 선택 (`src/lib/modification-resolve.ts`, `src/components/review/review-view.tsx`):

| 버튼 | 동작 |
|------|------|
| **Approve** | `sectionHeading`이 있으면 `replaceSection()`으로 그 섹션만 현재 target 파일에 스플라이스(나머지 섹션은 그대로 보존); 이후 `reIngestDocument()`로 **승인된 최종 파일 내용**을 재-decompose → graph assignment → graph sync. `sectionHeading`이 없는 레거시 proposal은 draft 전체로 target을 덮어쓰기 |
| **Merge** | draft(섹션 draft 또는 레거시 전체 draft)를 에디터에서 열기 (수동 편집 후 Approve) |
| **Reject → Discard** | 기존 유지, draft 삭제; graph sync 없음 |
| **Reject → Pending** | `pending/{slug}.md`로 이동; graph sync 없음 |
| **Reject → Counterexample** | `counterexamples/{slug}.md`로 이동; graph sync 없음 |

Merge를 거쳐 draft를 수동으로 고친 뒤 Approve해도, graph assignment는 `reIngestDocument()`가 **저장된 최종 파일 내용을 다시 읽어** 처음부터 재실행하므로 수동 편집 내용이 그대로 반영된다 — 충돌 당시의 decomposition 결과를 재사용하지 않는다.

### 현재 한계

| 한계 | 설명 |
|------|------|
| 경로·엔티티 매칭 없음 | `page_path`가 다르면 같은 주제여도 별도 파일 생성 |
| graph 연동 | 충돌 없는 경우 graph assignment → sync 즉시. 충돌 있을 때 Approve 시 `reIngestDocument()`로 graph assignment 실행, Reject 시 실행 안 함 |
| 섹션별 개별 Approve/Reject UI 없음 | 페이지에 충돌 섹션이 여러 개면 proposal 카드가 섹션별로 여러 개 생기지만, 카드 자체는 섹션 단위 승인/거부만 지원 — 한 카드에서 여러 섹션을 동시에 다루는 UI는 없음 |
| heading 텍스트 변경 시 매칭 실패 | 섹션 매칭은 `## heading` 문자열의 정확한 일치로 판단한다. incoming이 heading 텍스트 자체를 바꾸면(예: `## 보상` → `## 획득 보상`) 기존 매칭이 끊겨 신규 섹션으로 취급된다 |

---

## 7. Graph 저장·충돌 처리 (sync)

### sync 시점

chunk마다 파일 write 직후 `syncGraphToBackend()` 호출 (`src/lib/graph-sync.ts`).

- markdown 파일을 다시 읽지 않는다.
- **graph assignment validation 통과 triple**이 유일한 입력이다.
- 충돌 없는 경우: file write 직후 즉시 실행. 충돌 있는 경우: 사용자 Approve 후 실행 (Reject 시 실행 안 함).

### Backend 선택

`getGraphBackend(projectPath)`는 항상 embedded SQLite backend(`.llm-wiki/graph.sqlite`)를 반환한다. FalkorDB backend는 제거되었다 — `syncGraphToBackend()`라는 이름 자체가 이 정리를 반영한 것이다 (과거 `syncGraphToFalkorDb()`에서 리네이밍됨).

### Upsert 동작 (SQLite 기준)

`src-tauri/src/commands/graph_sqlite.rs` — `graph_sqlite_upsert_triples`:

edge unique key: `(graph_id, source_node_id, target_node_id, relation_type)`

| 상황 | 현재 동작 |
|------|-----------|
| 완전히 새 triple | edge 추가 |
| 동일 graph + subject + object + predicate | `properties_json` 덮어쓰기 (silent) |
| 동일 graph + subject + **다른 object** + 동일 predicate | 별도 edge 추가 (target node가 다름) |
| 동일 subject·predicate인데 object 값만 바뀐 경우 | 기존 edge 대체 아님 — **새 edge가 추가**될 수 있음 |

### Graph 충돌 — 현재 사용자 개입 없음

현재 구현에는 graph용 modification proposal이나 reconcile review가 **없다**.

- contradictory fact (같은 주제·같은 predicate·다른 값)가 생겨도 사용자에게 묻지 않는다.
- 모두 upsert로 즉시 반영되거나 병렬 edge로 남는다.
- 문서 충돌 시 Reject하면 graph assignment가 실행되지 않아 graph에 반영되지 않는다.

### page ↔ graph 인덱스

sync 후 `.llm-wiki/page-graph-index.json`에 `page_path → graph[]` 매핑을 upsert한다 (`src/lib/page-graph-index.ts`).

- 방향: `page_path → graph[]` 단방향. 역방향(`graph → page_path[]`) 인덱스는 없다.
- 하나의 `page_path`는 여러 graph와, 하나의 graph도 여러 `page_path`와 연결될 수 있다 (N:N).
- `page-graph-index.json`이 문서↔graph 연결의 유일한 출처다.
- 프로젝트 오픈 시 `rebuildPageGraphIndex(projectName, projectPath)`가 SQLite 노드의 `page_path`를 기준으로 인덱스 전체를 재생성해 수동 편집으로 인한 드리프트를 복구한다 (`src/App.tsx` — `handleProjectOpened()`).
- graph 삭제 시 `removeGraphFromIndex(projectPath, graphName)`이 해당 graphName을 모든 페이지 항목에서 즉시 제거한다 (`src/components/layout/graphs-tab.tsx` — `handleDeleteGraph()`).

### 엔티티 사전 연동 (entity-dict)

`syncGraphToBackend()`는 triple upsert 직후 `syncEntityDict()`를 호출해 `.llm-wiki/entity-dict.json`도 함께 갱신한다 (`src/lib/graph-sync.ts`).

- triple의 `subject`/`object` 이름마다 방금 upsert된 graph snapshot에서 stable_key 기준 정확히 일치하는 nodeId를 찾는다.
- 사전에 이름이 **정확히** 일치하는 엔티티가 있으면 그 엔티티에 `linkGraphNode()` + `addEntityPagePath()`로 연결한다.
- 정확히 일치하는 엔티티가 없으면 새 `EntityEntry`를 만든다. **fuzzy 일치(유사하지만 다른 이름)는 여기서 처리하지 않는다** — 그 판단은 sync 이전, graph assignment 직후 `checkEntityConflicts()`가 이미 걸러낸 뒤이기 때문이다.

Graph assignment 프롬프트에도 사전이 주입된다: `runGraphAssignment()`가 `buildEntityHintsForPrompt(await loadEntityDict(projectPath))`로 canonicalName + alias 목록(상위 200개)을 만들어 `buildGraphAssignmentPrompt(graphPolicyPrompt, entityHints)`에 전달한다. LLM이 기존 이름을 우선 재사용하도록 유도하는 1차 방어선이다.

Graph assignment 결과가 나온 뒤, sync 직전에 `checkEntityConflicts(triples, projectPath)`가 2차 방어선으로 동작한다 (`src/lib/ingest.ts`):

- triple의 `subject`/`object` 이름이 사전과 **fuzzy(유사)** 일치만 하고 exact 일치가 없으면 충돌로 분류한다.
- 충돌 없는 triple(`clean`)은 즉시 `syncGraphToBackend()`로 sync된다.
- 충돌 있는 triple은 `entity_confirmation` review item으로 대기하고, 해당 triple만 블로킹된다 — 나머지 clean triple의 sync를 막지 않는다.
- 이 호출은 confirmed-path와 `reIngestDocument()`(Approve 후 재-decompose 경로) 2곳에 있다.

`entity_confirmation` review item 처리 (`src/components/review/review-view.tsx`):

| 액션 | 동작 |
|------|------|
| `entity:same:{targetId}` | `incomingName`을 대상 엔티티의 alias로 추가, 대기 중인 triple의 subject/object를 대상 엔티티의 canonicalName으로 치환 후 sync |
| `entity:new` | 사전에 `incomingName`으로 신규 엔티티 생성 후 원본 이름 그대로 sync |
| `entity:ignore` | 사전 변경 없이 원본 이름 그대로 sync — `syncGraphToBackend()`의 `syncEntityDict()`가 신규 이름으로 자동 등록 |

---

## 8. 문서 vs Graph — 개념 대응

| 개념 | 문서 (wiki page) | Graph |
|------|------------------|-------|
| **주제 단위** | `page_path` (파일 하나) | `graph` 이름 (managed graph 하나) |
| **내용 단위** | frontmatter 제외 본문 전체 | edge: `subject → predicate → object` |
| **배치 결정** | decomposition의 `page_path` | graph assignment의 `graph` |
| **보충** | 자동 없음 (본문 같으면 sources만 merge) | 새 edge add |
| **상충** | modification review (파일 단위) | 없음 — 병렬 edge 또는 silent update |
| **진실 원천** | `db/*.md` (편집·검색용) | graph assignment triple (graph sync 원천) |
| **상대방 참조** | `page-graph-index.json`에 `page_path → graph[]` | triple이 `page_path` 필드를 가짐 |

충돌(modification proposal) 발생 시 graph sync가 Approve 후로 미뤄져 문서와 graph 일관성이 높아진다.

---

## 9. 후처리

ingest loop가 끝난 뒤 다음 처리가 이어진다.

- skipped chunk가 있으면 review item 생성
- modification proposal이 있으면 review item 생성
- 성공적으로 쓴 파일이 있고 hard failure / skipped chunk가 없으면 ingest cache 저장
- 쓴 파일이 있으면 git commit 시도
- embedding 설정이 켜져 있으면 `db/` 페이지를 embedding index에 반영
- file tree와 data version 갱신

### Review item 종류 (ingest 관련)

| type | 발생 시점 | 내용 |
|------|-----------|------|
| `suggestion` | graph assignment validation 실패, chunk 스킵(decomposition 실패·page_path 누락 포함) | 실패한 concept·graph·이유. overflow 시 "Create new graph" 액션 |
| `modification` | `writeFileBlocks` 섹션 단위 충돌 | 충돌난 `## heading` 섹션의 existing vs incoming diff (`sectionHeading` 필드로 어느 섹션인지 표시) |
| `entity_confirmation` | `checkEntityConflicts()`가 사전과 fuzzy 일치(exact 없음)를 감지 | incoming 이름, 후보 엔티티 목록, 관련 triple·page_path. "같은 엔티티"/"새 엔티티"/"무시" 액션 |

graph contradictory fact(같은 predicate·다른 값)에 대한 전용 review type은 현재 없음 — entity_confirmation은 이름 중복만 다룬다.

---

## 10. 헷갈리기 쉬운 점

| 항목 | 현재 구현 |
|------|-----------|
| File write 함수 | `buildFileBlocksFromSections()` 하나뿐이다. `buildGenerationPrompt()`는 코드에 남아 있지만 현재 ingest pipeline에서 호출되지 않는다. |
| Decomposition page_path 파싱 | `parseDecomposedSections()`가 opener 문자열에서 ` | db/` 구분자를 찾아 `source_range`와 `page_path`를 분리한다. ` | db/`가 없으면 `page_path`는 `undefined`이며, 그 섹션이 속한 chunk는 실패로 기록되고 스킵된다 — page_path를 대신 결정해주는 경로는 없다. |
| graph sync 함수 이름 | `syncGraphToBackend()` — 과거 `syncGraphToFalkorDb()`에서 리네이밍됨 (FalkorDB backend 제거에 맞춰 이름을 실제 동작과 일치시킴). 내부에서는 여전히 `getGraphBackend()`를 사용해 항상 SQLite backend로 동작한다. |
| graph sync 타이밍 | 충돌 없음: file write 직후, `checkEntityConflicts()` 통과한 clean triple만 즉시. 충돌 있음: 사용자 Approve 후 `reIngestDocument()` 호출로 실행. Reject 시 실행 안 함. |
| entity_confirmation과 graph sync의 관계 | `checkEntityConflicts()`가 걸러낸 충돌 triple은 별도 review item으로만 대기하고, 같은 배치의 나머지 clean triple은 블로킹 없이 즉시 sync된다. 문서 저장(modification proposal)과는 독립적인 별도의 대기열이다. |
| chunk 간 page_path 재사용 | 여러 chunk가 같은 `page_path`를 선택할 수 있다 — chunk마다 `dbIndex`를 다시 빌드해 다음 chunk의 decomposition 프롬프트에 넘기기 때문. 섹션 단위로 비교되므로, 신규 `## heading`을 보충하는 것이라면 자동 병합되고, 기존 heading의 본문이 달라지는 경우만 modification proposal로 간다. |
| Approve 시 graph assignment | `reIngestDocument()` (`src/lib/ingest.ts`) — ReviewView Approve 핸들러에서 호출. 승인된 최종 파일 내용을 다시 읽어 decomposition부터 재실행한다. 과거의 `runGraphAssignmentForApprovedDoc()` + `pendingSections` 방식은 제거됨. |
| `cleanupOrphanGraphs()` | `src/lib/graph-sync.ts`에 구현되어 있지만 현재 어디서도 호출되지 않는다. |
| markdown 파일과 graph | markdown 파일은 편집·검색용 산출물이고, graph의 진실 원천은 graph assignment triple이다. |
| entity-dict과 markdown 파일 | `.llm-wiki/entity-dict.json`은 그래프 노드의 전역 별칭/canonicalName 사전이며 `db/*.md` 문서 본문과는 독립적이다. 문서 본문은 canonicalName 변경/병합의 갱신 대상이 아니다 (`docs/entity-develop.md` 참조). |

---

## 11. 관련 코드 위치

| 역할 | 파일 |
|------|------|
| 전체 파이프라인 (decomposition → file write → graph assignment) | `src/lib/ingest.ts` |
| Decomposition 섹션 파싱 (page_path 포함) | `src/lib/ingest.ts` — `parseDecomposedSections()` |
| File write + 섹션 단위 충돌 판정 | `src/lib/ingest.ts` — `buildFileBlocksFromSections()`, `writeFileBlocks()`, `splitIntoSections()`, `reconcileSections()` |
| Approve 후 재-decompose + graph assignment 실행 | `src/lib/ingest.ts` — `reIngestDocument()` |
| graph policy | `src/lib/graph-policy.ts` |
| graph sync + entity-dict 연동 | `src/lib/graph-sync.ts` — `syncGraphToBackend()`, `syncEntityDict()` |
| SQLite graph upsert | `src-tauri/src/commands/graph_sqlite.rs` |
| page-graph index | `src/lib/page-graph-index.ts` — `upsertPageGraphIndex()`, `rebuildPageGraphIndex()`, `removeGraphFromIndex()` |
| 엔티티 사전 | `src/lib/entity-dict.ts` — `buildEntityHintsForPrompt()`, `findCandidates()` 등. 저장 경로 `.llm-wiki/entity-dict.json` (상세 설계는 `docs/entity-develop.md`) |
| ingest 엔티티 충돌 검사 | `src/lib/ingest.ts` — `checkEntityConflicts()` |
| entity_confirmation UI 처리 | `src/components/review/review-view.tsx` — `handleResolve()`의 `entity:same:` / `entity:new` / `entity:ignore` 분기 |
| modification resolve (섹션 스플라이스 포함) | `src/lib/modification-resolve.ts` — `approveModification()`, `replaceSection()`(`src/lib/ingest.ts`) |
| Review UI (Approve 핸들러) | `src/components/review/review-view.tsx` |
| ModificationProposal 타입 (sectionHeading) | `src/stores/review-store.ts` |
| data type 로드 | `src/lib/data-types.ts` |
| injection UI | `src/components/layout/icon-sidebar.tsx` |
