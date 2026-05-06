# fix-develop.md — IDEA.md 정합화 작업 계획

## 목적

IDEA.md Part 2(검색)의 "오답 배제" 철학이 현재 **Search 탭에만** 구현되어 있고, 사용자가 가장 자주 쓰는 **채팅(DB 탭)** 은 일반 RAG로 동작한다. 또 IDEA.md가 정의한 2차 산출물 위치는 `db/`인데 채팅·임베딩·트리·lint는 `wiki/`만 본다. 이 두 갈래를 `db/`로 합치고, 채팅이 IDEA.md 검색 흐름을 타도록 옮긴 뒤, 별도 Search 탭을 제거한다.

## 진행 순서

`Phase B → Phase A → Phase C` 순서이며 각 Phase는 이전 Phase가 통합된 뒤에 시작한다.

- **Phase B**: `wiki/` ↔ `db/` 일원화 (임베딩 포함)
- **Phase A**: 채팅 RAG를 `runExcludeSearch` 기반으로 교체
- **Phase C**: Search 탭 제거 (UI만 — 라이브러리는 채팅이 사용 중이므로 보존)

## 비-목표

- IDEA.md Part 1(2차 가공) 흐름 변경 — ingest는 이미 `db/`로 쓴다. 손대지 않는다.
- 새 임베딩 모델/벡터 DB 도입 — 기존 LanceDB + 사용자 설정 endpoint 그대로 사용.
- `wiki/`를 사용해 만든 기존 프로젝트의 자동 데이터 마이그레이션 — Phase B에서 1회용 변환 스크립트로 분리.

---

# Phase B — `wiki/` ↔ `db/` 일원화

## B-0. 결정사항

- **정본은 `db/`.** `wiki/`는 제거 대상.
- 구조용 페이지(`index.md`, `log.md`, `overview.md`, `purpose.md`, `schema.md`)도 `db/` 루트로 이동. (현재 `wiki/index.md`, `wiki/log.md`, `wiki/overview.md`)
- `purpose.md`는 현재 프로젝트 루트 — 그대로 둔다.
- 벡터스토어 `page_id` 정책 변경: 현재 파일 stem만 사용 → `db/` 기준 상대경로를 `_`로 인코딩한 값.
  - 이유: `db/dungeon_a/rewards.md`와 `db/dungeon_b/rewards.md`가 stem이 같아도 충돌하지 않게.
  - 인코딩: `<rel-without-db-prefix-and-md-ext>`의 `/`를 `_`로 치환. 예) `db/dungeon/dungeon_a/rewards.md` → `dungeon_dungeon_a_rewards`.
  - 기존 `validate_page_id`는 `[A-Za-z0-9._-]`만 허용 — `_` 이미 허용이므로 검증 규칙은 그대로.

## B-1. 신규 프로젝트 생성

- `src-tauri/src/commands/project.rs:25-30`의 `wiki/*` 디렉토리를 `db/` 한 폴더로 변경. 하위 카테고리 폴더는 만들지 않는다 — IDEA.md는 폴더 구조를 schema.md에 외부화하므로 빈 `db/`가 맞다.
- `src-tauri/src/commands/project.rs:167-192`의 `wiki/index.md`, `wiki/log.md`, `wiki/overview.md` 초기 쓰기 → `db/index.md`, `db/log.md`, `db/overview.md`.
- `wiki/` 디렉토리 부재 검사([project.rs:260](src-tauri/src/commands/project.rs#L260)) → `db/` 부재 검사로 교체.

## B-2. 임베딩이 `db/`를 인덱싱

- [embedding.ts:332](src/lib/embedding.ts#L332)의 `listDirectory(`${pp}/wiki`)` → `${pp}/db`.
- [embedding.ts:344](src/lib/embedding.ts#L344) 제외 목록 `["index","log","overview","purpose","schema"]` 유지 — 구조 페이지는 인덱싱 대상 아님.
- `embedPage` 시그니처에 `pagePath`(상대경로) 추가. 호출자가 stem 대신 인코딩된 page_id를 만들도록:
  ```ts
  const pageId = relPath.replace(/^db\//, "").replace(/\.md$/, "").replace(/\//g, "_")
  ```
- ingest의 임베딩 호출부 [ingest.ts:503-515](src/lib/ingest.ts#L503-L515) 동일 수정 — `wpath.split("/").pop()` 대신 위 인코딩 사용. `index/log/overview` 스킵 유지.
- 검색 측 [search.ts:232-258](src/lib/search.ts#L232-L258)의 디렉토리 fallback 루프(`["entities","concepts","sources","synthesis","comparison","queries"]`) 제거 — 인코딩된 page_id에서 역으로 경로 복원 가능하므로 디렉토리 시도 루프 불필요.

## B-3. 채팅·검색·lint 디렉토리 변경 (UI 그대로 유지)

| 위치 | 현재 | 변경 |
|---|---|---|
| [chat-panel.tsx:204](src/components/chat/chat-panel.tsx#L204) | `wiki/index.md` | `db/index.md` |
| [search.ts:180](src/lib/search.ts#L180) | `${pp}/wiki` 트리 | `${pp}/db` 트리 |
| [search.ts:189](src/lib/search.ts#L189) | `${pp}/raw/sources` 그대로 | 변경 없음 |
| [knowledge-tree.tsx:43](src/components/layout/knowledge-tree.tsx#L43) | `${pp}/wiki` | `${pp}/db` |
| [file-tree.tsx](src/components/layout/file-tree.tsx) | `fileTree` store가 `wiki/` 기준 | store 빌더가 `db/` 기준으로 |
| [lint.ts](src/lib/lint.ts), [lint-view.tsx:70-71](src/components/lint/lint-view.tsx#L70-L71) | `wiki/<page>` 경로 후보 | `db/<page>` |
| [enrich-wikilinks.ts](src/lib/enrich-wikilinks.ts) | `wiki/` 검사 | `db/` |
| [graph-view.tsx](src/components/graph/graph-view.tsx) | wiki 트리 노드 | db 트리 노드 |
| [history-view.tsx](src/components/history/history-view.tsx) | wiki 경로 표시 | db |
| [review-view.tsx](src/components/review/review-view.tsx) | targetPath가 `wiki/...`일 수 있는 경로 | `db/...` 가정 |

`wiki/log.md`, `wiki/index.md`, `wiki/overview.md` 류의 하드코딩 경로를 일괄 grep해 `db/`로 교체. ingest.ts 내부에는 이미 `db/`/`wiki/` 분기가 있으므로([ingest.ts:684-710](src/lib/ingest.ts#L684-L710)) `wiki/` 분기를 제거하고 `db/` 단일 흐름으로 정리.

## B-4. SAFE_INGEST_PREFIXES 정리

- [ingest.ts:80-88](src/lib/ingest.ts#L80-L88)에서 `"wiki/"` 항목 제거. 주석 `// TODO Stage 3: drop "wiki/"` 도 함께 제거.
- 이로써 LLM이 `wiki/...` 경로를 제안해도 거부.

## B-5. 기존 프로젝트 마이그레이션 (1회용)

- 새 명령 `migrate_wiki_to_db`를 Tauri 측에 추가.
- 동작: 프로젝트에 `wiki/`가 있고 `db/`가 비어있으면, `wiki/*` → `db/*`로 이동(`fs::rename`), 기존 LanceDB 인덱스는 무효화(테이블 drop) 후 재인덱싱 안내.
- 앱 시작 시 프로젝트 열기 단계에서 자동 호출. 단 한 번 실행되도록 프로젝트 메타에 `migrated_to_db_at` 타임스탬프 기록.
- LanceDB는 `vector_drop_legacy`([lib.rs:69](src-tauri/src/lib.rs#L69)) 패턴이 이미 있으므로 동일 패턴 사용.
- 실패시 사용자에게 다이얼로그 — 자동으로 wiki/를 절대 삭제하지 않는다.

## B-6. 테스트

- `ingest.prompt.test.ts`, `ingest-parse.test.ts` — `wiki/` 출력 fixture를 `db/`로 갱신.
- `embedding.test.ts` — `db/` 트리 지원 검증.
- 신규: `migrate-wiki-to-db.test.ts` — 빈 db, 비어있지 않은 db, wiki 부재 등 분기.
- `i18n-parity.test.ts` — `nav.wiki` 라벨 변경 시 EN/KO/ZH parity.

## B-7. UX 라벨

- `nav.wiki`의 한국어 라벨이 현재 "DB"이므로([ko.json:7](src/i18n/ko.json#L7)) 한국어 사용자에게는 변경 없음.
- 영문/중문은 기존 "Wiki"/"维基" 유지하거나 "DB"/"知识库"로 변경 — 결정 후 파일 일괄 수정.

---

# Phase A — 채팅 RAG를 `runExcludeSearch` 기반으로 교체

Phase B 완료가 전제. 이 시점에는 모든 인덱싱 대상이 `db/` 단일 디렉토리이고 임베딩도 `db/`에서 돌아간다.

## A-1. 라이브러리 위치 이동

- `src/lib/exclude-search.ts`, `src/lib/exclusions.ts`, `src/lib/question-types.ts`, `src/lib/classify-question.ts` — 그대로 유지. 채팅이 import해 쓴다.
- `src/components/search/exclusion-trace.tsx` — 채팅 메시지에서 재사용하므로 `src/components/chat/exclusion-trace.tsx`로 이동(또는 `src/components/common/`).

## A-2. `runExcludeSearch`에 벡터 결합

현재 `runExcludeSearch` → `searchPaths`는 토큰 매칭만 한다([search.ts:307-338](src/lib/search.ts#L307-L338)).

- `searchPaths` 내부에서 `embeddingConfig.enabled` 인 경우 `searchByEmbedding(pp, query, cfg, K)` 호출 후 `kept` 집합에 한정해 RRF 융합.
  - 벡터 결과는 page_id로 오므로, `kept` paths를 page_id로 변환해 교집합.
- 벡터-토큰 RRF 로직은 [search.ts:269-290](src/lib/search.ts#L269-L290)을 헬퍼로 추출해 재사용.
- 벡터 인덱스가 비어있거나 비활성이면 토큰 단독으로 fallback (현재와 동일).

이 단계는 **IDEA.md §2.5** "줄어든 후보 공간이 검색의 시작 상태가 된다"의 후속으로 정당하다. 배제는 사전 적용, 탐색 알고리즘만 강화.

## A-3. 채팅 retrieval 경로 교체

[chat-panel.tsx:209-260](src/components/chat/chat-panel.tsx#L209-L260) 흐름 재구성:

```
질문 → runExcludeSearch (분류 + 배제 + 잔존 위 hybrid 검색)
     → graph 1-level 확장 (잔존 후보 안에서만)
     → context budget 내 페이지 본문 채우기
     → trace를 메시지 메타로 보존
```

- `searchWiki` 직접 호출 제거. (다른 호출처가 있으면 그것도 정리)
- graph 확장 [chat-panel.tsx:243-260](src/components/chat/chat-panel.tsx#L243-L260)은 잔존 페이지 집합으로 제한 — 배제된 페이지를 graph로 끌어오면 IDEA.md 위반.
- 그리팅 short-circuit([chat-panel.tsx:176-189](src/components/chat/chat-panel.tsx#L176-L189))은 그대로.

## A-4. 트레이스를 채팅에 노출

IDEA.md §2.9가 요구하는 "무엇이 왜 배제되었는가"를 채팅 응답에 표시:

- chat-store의 `Message`에 `trace?: SearchTrace` 필드 추가.
- 어시스턴트 응답 메시지 위에 접힌 형태의 trace badge — 클릭 시 펼침.
- 잔존 0(§2.10)이면 응답 본문 대신 `zeroResidueMeaning`을 우선 안내. LLM은 호출하지 않거나, "잔존 0의 의미"를 system context로 받아 그 의미만 자연어로 풀어 답하도록 한정.

## A-5. system prompt 변경

- 현재 system prompt가 사용하는 페이지 목록은 RAG 결과의 본문이다. Phase A 후에는 "이 페이지들은 질문 유형 T에 대해 사전 배제 후 남은 잔존이다"는 메타를 system 측에 함께 넣어, 모델이 무리한 추론으로 배제된 영역을 끌어쓰지 않도록 가드한다.
- 출처 추적(IDEA.md §1.4) 출력 강제: 답변에 `## Sources` 섹션이 포함되도록 instruction 추가.

## A-6. 테스트

- `chat-panel.test.ts`(신규 또는 확장) — 분류 → 배제 → 잔존 흐름 mock으로 검증.
- 잔존 0 케이스에서 LLM 호출이 일어나지 않거나 zeroResidueMeaning이 답변에 들어가는지 검증.
- 그리팅에서는 분류·배제가 호출되지 않는지 검증.

---

# Phase C — Search 탭 제거 (UI 셸만)

Phase A 통합·검증 후 진행.

## C-1. 라우팅·네비

- [icon-sidebar.tsx:19](src/components/layout/icon-sidebar.tsx#L19) `NAV_ITEMS`에서 `{ view: "search", ... }` 제거.
- [content-area.tsx:23](src/components/layout/content-area.tsx#L23) `case "search"` 제거.
- [wiki-store.ts](src/stores/wiki-store.ts) `WikiState["activeView"]` 유니온에서 `"search"` 제거. 영향받는 모든 setActiveView 호출 grep.

## C-2. 컴포넌트 삭제

- `src/components/search/search-view.tsx` 삭제.
- `src/components/search/exclusion-trace.tsx` 삭제 — 단, A-1에서 `src/components/chat/`(또는 `common/`)으로 이동했다면 그쪽만 보존.
- `src/components/search/` 디렉토리 비어 있으면 함께 삭제.

## C-3. i18n

- `nav.search` 키 삭제(en/ko/zh).
- `search.*` 트리 삭제 — exclusion-trace 컴포넌트가 쓰던 `search.trace.*`, `search.zeroResidue.*`는 trace 컴포넌트와 함께 다른 이름으로(예: `chat.trace.*`) 옮긴다.

## C-4. 테스트

- `i18n-parity.test.ts` 통과 확인.
- `exclude-search.test.ts` 등 라이브러리 테스트는 그대로 — 기능은 채팅이 호출.

---

# 위험·롤백

- **B의 page_id 인코딩 변경은 기존 LanceDB 인덱스를 무효화**한다. 마이그레이션 시 테이블 drop + 재인덱싱이 필수. 진행 중 중단되면 검색이 빈 결과를 낸다 — 사용자에게 진행률·재시도 UI 노출 필요.
- **A의 분류 LLM 호출은 채팅 latency를 추가**한다. 분류 결과는 conversation 단위로 캐시(같은 대화 내 후속 질문이 유형이 다를 가능성을 인정해 메시지 단위 invalidate)하면 완화 가능.
- **C 후 IDEA.md 검색 트레이스를 보고 싶은 사용자**는 채팅 메시지의 trace badge로만 접근 — UX 확인 후 제거.
- 롤백 단위: B / A / C 각각 별도 커밋·PR. 각 단계가 자체 완결되도록.

# 작업 순서 체크리스트

- [ ] B-1 ~ B-7
- [ ] B 통합·릴리즈 (사용자 검증)
- [ ] A-1 ~ A-6
- [ ] A 통합·릴리즈
- [ ] C-1 ~ C-4
