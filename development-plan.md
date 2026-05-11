# development-plan.md — 개발 이력

이 문서는 llm_wiki 프로젝트가 거쳐온 세 라운드의 작업을 시간순으로 압축한 기록이다.
세부 검증 절차·테스트 케이스 수 같은 자질구레한 항목은 제외하고, 각 라운드의 **목표와 핵심 결정**만 남겼다.

- Round 1 — 초기 7-Stage 개발 (PR-1 ~ PR-7)
- Round 2 — `wiki/` → `db/` 일원화 + 채팅 RAG 교체
- Round 3 — Windows CLI spawn 버그 + `raw/sources/` 1차 가공 통합

---

## Round 1 — 초기 7-Stage 개발

PLAN.md를 수동 검증 가능한 단계로 재구성해 PR 단위로 진행했다.
공통 검증 모드는 `npm run tauri dev` (데스크톱), 자동 검증은 `npm run typecheck` / `npm run test:mocks`.

### Stage 1 — 스키마 picker 기반 프로젝트 생성 (M1)

- 빌트인 Template 카드 그리드 제거 → **외부 `.md` 스키마 파일 picker + Purpose textarea**.
- 시스템 prefix 4개(`db/`, `processed_1/`, `pending/`, `counterexamples/`)는 코드가 항상 보장.
- `templates.ts` / `template-picker.tsx` 삭제, `schema-picker.tsx` 신규.
- `project-init.ts`: 시스템 prefix 디렉토리 + `.gitkeep` 생성, schema 파일 복사, `purpose.md` 작성.
- ingest sandbox 허용 prefix를 `wiki/` → 위 4개로 교체 (`wiki/`는 Stage 3까지 한시 유지).

### Stage 2 — local git 자동 커밋 (M4)

- Tauri 백엔드에 `git_init` / `git_commit` / `git_status` / `git_log` 추가 (`tokio::process::Command` 비동기, `which::which("git")` 실패 시 한국어 에러).
- Frontend `auto-commit.ts`: ingest / modification 결과를 표준 메시지 포맷으로 commit.
- `project-mutex`로 git 호출까지 같은 큐에 직렬화.
- 프로젝트 부트스트랩 마지막에 `gitInit` 호출 — initial commit 1건 생성.

### Stage 3 — 분해/재배치 ingest 프롬프트 + SourceRef (M2)

- `source-ref.ts` 신규 — `{ file, range }` 객체 + parse/serialize/dedup 키.
- `sources-merge.ts` 확장 — frontmatter `sources` multi-line object form 지원, `file+range` dedup.
- `processed1.ts` 신규 — raw 입력을 `processed_1/<basename>.md`로 verbatim passthrough (Round 3에서 제거됨).
- ingest 프롬프트 재작성: entities/concepts/queries 섹션 폐기, "schema가 정의한 db/ 경로로 어떻게 분해되는가" 프레이밍, FILE 경로는 `db/`로 시작 강제.
- ingest 1회 = git commit 1건.

### Stage 4 — modification 워크플로우 (M3)

- 같은 의미 단위가 v2로 다시 들어올 때 자동 덮어쓰기 금지.
- 신규 콘텐츠는 `pending/_proposals/<runStamp>-<idx>-<slug>.md`로 park.
- review 카드 2단계 트리: **Approve / Merge / Reject** → Reject 시 **Discard / Pending / Counterexample**.
- `modification-resolve.ts`: 각 액션이 draft 처리 + 표준 commit 메시지 발행. Merge는 UI-only(에디터 hand-edit 후 Approve 재실행).

### Stage 5 — pending / counterexamples 컨텍스트 주입 (M5)

- `counterexample-index.ts`: `counterexamples/*.md` + `.llm-wiki/rejection-log.jsonl` 로드 → 현재 ingest 파일에 매칭되는 항목만 prompt에 주입.
- 프롬프트 지시: "같은 raw section이 매핑되면 새 페이지를 제안하지 말고 `## Skipped (prior dismissal)` 섹션에 사유와 함께 기재".
- **`pending/`은 의도적으로 미주입** — 인간 검토 대기 상태이므로 모델 결정에 편향 X.
- `pending-resolve.ts` + `pending-view.tsx`: 카드 액션 [Re-review / Promote to db/ / Discard].

### Stage 6 — UI 라벨 + 한국어 번역

- `i18n/ko.json` 신규 + `index.ts` 등록, 설정에 한국어 옵션.
- 사이드바 라벨: DB / Raw / 수정 요청(Modifications) / Lint. Graph 아이콘 제거, History 아이콘 추가.
- `i18n-parity.test.ts`로 EN/ZH/KO 키 일치 검증.

### Stage 7 — git 히스토리 뷰어 + 롤백 UI (M6)

- 백엔드 4개 신규 명령: `git_show`, `git_diff`, `git_checkout_path`, `git_revert` (충돌 시 unmerged path 추출 → `RevertResult { committed: false, conflicts }`).
- `history-view.tsx` 3-pane: commit 목록 / 선택 commit의 파일 변경 / 파일 diff.
- 액션: **이 버전으로 복원** (파일 단위 → `revert: restore <path> to <hash>` commit) / **이 커밋 되돌리기** (`git revert`).
- 충돌 시 alert에 충돌 파일 목록 표시.

---

## Round 2 — `wiki/` → `db/` 일원화 + 채팅 RAG 교체

**문제의식.** IDEA.md Part 2(검색)의 "오답 배제" 철학이 Search 탭에만 구현되어 있고 채팅(DB 탭)은 일반 RAG로 동작했다.
또 IDEA.md가 정의한 2차 산출물 위치는 `db/`인데 채팅·임베딩·트리·lint는 `wiki/`만 봤다.
진행 순서: **Phase B → A → C**.

### Phase B — `wiki/` ↔ `db/` 일원화

- 정본은 `db/`. `wiki/` 제거. 구조 페이지(`index.md` / `log.md` / `overview.md`)도 `db/` 루트로 이동. `purpose.md`는 프로젝트 루트 유지.
- **벡터스토어 `page_id` 정책 변경**: 파일 stem → `db/` 기준 상대경로의 `/`를 `_`로 인코딩 (`db/dungeon/dungeon_a/rewards.md` → `dungeon_dungeon_a_rewards`). stem 충돌 방지.
- 신규 프로젝트 생성: `wiki/*` 디렉토리 부트스트랩 → `db/` 단일 폴더 (하위 카테고리 폴더 X — schema.md가 외부화).
- 임베딩·채팅·검색·lint·트리·graph·history·review의 `wiki/` 하드코딩을 일괄 `db/`로 교체.
- `SAFE_INGEST_PREFIXES`에서 `"wiki/"` 항목 제거 — LLM이 `wiki/...`를 제안해도 거부.
- **마이그레이션**: `migrate_wiki_to_db` 명령 — `wiki/` 존재 + `db/` 비어있을 때 `fs::rename`으로 이동, LanceDB 인덱스 drop 후 재인덱싱. `migrated_to_db_at` 스탬프로 멱등 보장. 자동 삭제는 절대 X.

### Phase A — 채팅 RAG를 `runExcludeSearch` 기반으로 교체

- `exclude-search.ts` / `exclusions.ts` / `question-types.ts` / `classify-question.ts`는 위치 유지, `exclusion-trace.tsx`만 `chat/`(또는 `common/`)으로 이동.
- `runExcludeSearch` 내부 `searchPaths`에 벡터 검색 결합 — `kept` 집합에 한정해 RRF 융합. 벡터 인덱스 비활성/빈 상태면 토큰 단독 fallback.
- 채팅 retrieval: `질문 → runExcludeSearch (분류 + 배제 + 잔존 위 hybrid) → graph 1-level 확장(잔존 안에서만) → context budget 채우기 → trace 메타 보존`.
- 어시스턴트 메시지에 trace badge 노출. **잔존 0** 케이스는 LLM 호출하지 않거나 `zeroResidueMeaning`만 자연어로 풀어 답하도록 제한 (IDEA.md §2.10).
- system prompt에 "이 페이지들은 사전 배제 후 잔존" 메타 주입 + `## Sources` 섹션 강제.

### Phase C — Search 탭 제거 (UI 셸만)

- `NAV_ITEMS` / `content-area` / `WikiState["activeView"]`에서 `"search"` 제거.
- `search-view.tsx` 삭제. 라이브러리는 채팅이 사용 중이므로 보존.
- `nav.search` / `search.*` i18n 키 정리, trace 관련 키는 `chat.trace.*` 등으로 이동.

### 위험 요소

- **page_id 인코딩 변경 → 기존 LanceDB 인덱스 무효화.** drop + 재인덱싱 필수, 진행률 UI 필요.
- **분류 LLM 호출이 채팅 latency 추가.** conversation 단위 캐시로 완화.

---

## Round 3 — Windows CLI 버그 + `raw/sources/` 1차 가공 통합

### 3-1. CLI provider Windows spawn 버그

- **증상**: `claude.cmd`가 PATH에 있고 `--version`도 동작하는데 ingest 시 `Claude Code CLI not found`.
- **원인**: detect는 `which::which("claude")`로 풀 경로를 얻지만 spawn은 `Command::new("claude")` bare name 사용 → Windows `CreateProcess`는 `.exe`만 시도해 `.cmd`를 못 찾음.
- **수정 패턴** (claude/codex/gemini 동일):
  ```rust
  let cli_path = which::which("<binary>").map_err(|_| "...")?;
  let mut cmd = Command::new(&cli_path);
  ```
- codex/gemini는 npm 패키지 → Windows에서 `.cmd`로 설치되므로 발생 확정.

### 3-2. `raw/sources/`에 1차 가공 markdown만 저장

**현재 → 목표.** 원본 PDF/docx를 `raw/sources/`에 복사하고 별도로 `processed_1/`에 추출 텍스트를 저장하던 흐름을, **import 시점에 즉시 텍스트 추출 → markdown 정규화 → `raw/sources/<name>.md` 단일 저장**으로 단순화.

**확정 결정**

- **D1**: 원본 파일은 보관하지 않음 — 1차 가공 markdown만 유지, 원본은 폐기.
- **D2**: 출력은 모두 `.md` 확장자. PDF는 plain text(페이지 줄바꿈), docx/pptx/xlsx 등은 markdown(heading/bold/list/table). plain text도 valid markdown이므로 통일 가능.
- **D3**: `processed_1/` 폐지 — 현재 `runProcessed1`은 passthrough라 의미 없음. 향후 진짜 2차 가공이 필요하면 그때 새 폴더 도입.
- **D4**: import UX는 "1차 가공 중..." 상태 표시 → 완료 시 `raw/sources/<name>.md` 노출. 실패 시 명확한 에러 (기존 silent catch 제거).

**주요 변경**

- `preprocess_file` (Rust): 비-office/비-pdf 입력은 read해 그대로 반환. 캐시 확장자 `.txt` 정리.
- `preprocessFile` (TS): 모든 입력에 대해 markdown 텍스트 반환 (현 placeholder `"no preprocessing needed"` 동작 변경).
- `sources-view.tsx`: `copyFile` 원본 복사 제거 → `preprocessFile` 결과를 `writeFile`로 `raw/sources/<basename>.md` 저장.
- `processed1.ts` / 테스트 / `project-init`의 `processed_1` 디렉토리 생성 / `SAFE_INGEST_PREFIXES`의 `processed_1/` / ingest의 `processed1.writtenPath` 합치기 — 일괄 제거.
- `clip-watcher.ts`도 동일 import 흐름 적용.

**마이그레이션** (`open_project` 콜체인에 추가, `migrate_wiki_to_db`와 같은 형태)

1. `raw/sources/` 정리 — `.md`/`.txt`은 보존, binary는 1차 가공 → `<basename>.md` 저장 → 원본 binary 삭제 (D1).
2. `processed_1/` 폴더 통째로 삭제 (D3).
3. `.llm-wiki/project.json`에 마이그레이션 스탬프 기록 (멱등).
4. 진행률 UI 표시.

**위험 요소**

- 마이그레이션 중 크래시 시 부분 상태 — 트랜잭션처럼 처리하거나 idempotent 재실행 보장.
- PDF 추출 품질이 곧 db/ 페이지 품질 — 향후 PDF 추출 개선 별도 과제.
- 사용자가 직접 추가한 `raw/sources/*.md`는 마이그레이션이 건드리지 않도록 확장자 검사로 binary만 변환.

---

## Round 4 — IDEA Part 2 검색 배제 맵 구현 완료

`second-development-plan.md`의 Stage 8~15 구현 상태를 실제 코드 기준으로 재검토했다.
세부 계획서는 제거하고, context 관리용으로 완료 상태만 남긴다.

- 새 프로젝트 bootstrap은 `question_types/`와 `exclusions/{by_question_type,axioms,instances}/`,
  `exclusions/exclusion_schema.md`, `exclusions/promotion_rules.md`를 생성한다.
- 질문 유형 로더, exclusion 로더/glob matcher, LLM question classifier,
  `runExcludeSearch` 검색 파이프라인, chat trace UI, residue 0 처리까지 연결됨.
- 검색 instance 로그(Level 1), promotion 후보 분석과 pattern/axiom 승격(Level 2/3),
  dismiss 기록, promotion sidebar UI가 구현됨.
- 자기 보정(Stage 14)도 구현됨: source freshness `needs_review`, stale axiom,
  counterexample marking, archive/restore, mark validated, 관련 i18n/UI/test 포함.
- 통합 시나리오(Stage 15): `schema/question_types/` 예시, `USAGE.md` 가이드,
  exclude-search scenario test가 추가됨.

검증 결과: `npm.cmd run typecheck` 통과. Part 2 관련 테스트 72개 통과
(`question-types`, `exclusions`, `classify-question`, `exclude-search`, `instance-log`,
`promotion`, `exclusion-validity`, `exclude-search.scenarios`, `i18n-parity`).
전체 `npm.cmd run test:mocks`는 895개 중 894개 통과, 실패 1개는
`src/lib/ingest-queue.integration.test.ts`의 Unicode queue persistence 케이스로
Part 2 변경 범위와 직접 관련 없는 별도 잔여 이슈로 보인다.

---

## 다음 단계 — 멀티모달 1차 가공 보강 (계획)

**문제의식.** 1차 가공(`preprocess_file`)은 텍스트 추출만 한다. PDF/DOCX/PPTX의
임베디드 이미지·차트·다이어그램·SmartArt·OLE 객체는 모두 묵시적으로 드롭된다
(DOCX는 `extract_docx_with_library`의 `_ => {}` 분기, PPTX는 `<a:t>` 텍스트
런만 추출, PDF는 `page.text().all()`만). 핵심 정보가 도표에 담긴 게임기획서·
스펙 문서는 2차 가공 LLM이 그 정보를 알 방법이 없어 db/ 페이지가 누락 상태로
굳는다.

**선행 작업** (Round 3 직후 추가, 완료): `raw/originals/` 폴더에 원본 바이너리
복사 + 1차 가공 markdown frontmatter에 `original:` 링크 + `.gitignore` 자동
추가. 멀티모달 파이프라인의 입력 진입점이 이 프론트매터 링크다.

**확정 결정 후보**

- **D1**: 1차 가공 단계에서 임베디드 이미지를 별도 파일로 추출. DOCX는 zip
  내부 `word/media/image*`, PPTX는 `ppt/media/`, PDF는 pdfium 페이지 비트맵
  렌더. 추출 결과는 `raw/originals/.cache/images/<source>/<idx>.<ext>` —
  gitignore 트리 안이라 git 영향 없음.
- **D2**: 본문 내 위치(단락 인덱스 / 슬라이드 번호 / 페이지+bbox)를 같이
  기록하고 1차 가공 markdown에 placeholder(`<<IMAGE:idx>>`)를 남긴다. 위치를
  잃으면 LLM 설명을 엉뚱한 자리에 박게 됨.
- **D3**: 추출 이미지마다 멀티모달 LLM 호출 — Claude Vision / GPT-4o /
  Gemini 중 사용자 설정 provider. 프롬프트는 "이 이미지가 무엇이며, 도표면
  데이터를 표로, UI면 요소 목록을, 다이어그램이면 노드+엣지를 텍스트로 옮겨라".
  응답은 캐시(이미지 hash + provider + model 키, `.llm-wiki/
  image-describe-cache.json`).
- **D4**: 1차 가공 markdown의 placeholder를 다음 형태로 inline 치환:
  ```markdown
  ![원본 alt](raw/originals/.cache/images/foo.docx/3.png)
  > **[그림 설명]** 던전 입장 흐름도. 1) 파티 모집 → 2) NPC 대화 → 3) 입장
  > 확정. 분기는 ...
  ```
  이미지 참조와 LLM 설명을 같이 둬서 사용자(원본 회람)와 2차 가공 LLM(텍스트
  설명 활용) 양쪽 다 활용.
- **D5**: 비용 절감 — 텍스트 위주 이미지(스크린샷/스캔본)는 OCR(Tesseract
  등) 1차 시도, 의미 해석이 필요한 그림(다이어그램/차트/UI)만 멀티모달 LLM.
  이미지 분류는 가벼운 휴리스틱(해상도·색 분산·OCR 신뢰도) 또는 1회 vision
  분류 호출로 결정.

**주요 변경 (예정)**

- Rust 추출기 3종 (`extract_docx_with_library` / `extract_pptx_markdown` /
  `extract_pdf_text`): 이미지 객체 수집 → 캐시 디렉토리에 쓰고 본문에
  `<<IMAGE:idx>>` placeholder 삽입. 현재 `_ => {}`로 무시하던 자식들이 출발점.
- TS 신규 모듈 `image-describe.ts`: placeholder 스캔 → 이미지별 멀티모달 호출
  (또는 OCR fallback) → placeholder를 LLM 설명으로 치환. 캐시 layer는
  `ingest-cache.ts`와 동형.
- `sources-view.tsx` 단일/폴더 import 흐름: `preprocessFile` 직후,
  `injectOriginalRef` 바로 이전에 `describeImages(markdown, projectPath,
  llmConfig)` 삽입. 실패는 warn 후 placeholder만 남기고 진행 (markdown은 primary).
- `LlmConfig`에 `multimodalProvider` 필드 추가 (텍스트 LLM과 다른 provider도
  허용 — 같은 키도 가능). Settings에 별도 섹션.
- 비용 가시화: 활동 패널에 "이미지 N개 설명 중 · LLM 호출 N회 · 캐시 적중 M회"
  표시. import 직전 예상 호출 수 confirm 다이얼로그.

**위험 요소**

- **비용 폭증.** 게임기획서 한 docx에 도표 100개면 호출 100번. D5 OCR 사전
  필터링과 캐시가 1차 방어선. 캐시 키는 이미지 hash이므로 같은 이미지 재이용
  시 무료.
- **위치 손실.** docx-rs의 `Drawing` 자식이 paragraph 순서대로 들어오므로
  순서만 유지하면 됨. PDF는 페이지+y좌표 정렬 필요. PPTX는 슬라이드 단위라
  거의 문제없음.
- **품질 편차.** 추상 다이어그램·UI 목업은 모델 성능 따라 차이가 큼. D4에서
  이미지 참조 자체를 항상 유지해 사용자가 LLM 설명을 못 믿을 때 원본 회람
  가능하게.
- **캐시 누적.** `raw/originals/.cache/images/`는 gitignore 안이라 원격 영향
  은 없지만 디스크 점유. GC 액션(고아 이미지 제거: 어떤 1차 가공 markdown에서
  도 참조되지 않는 캐시 파일) 또는 TTL 제공.

---

## 부록 — 운영 메모

- 각 라운드의 변경은 PR/커밋 단위로 분리. Round 2/3의 마이그레이션은 모두 멱등하게 설계해 재실행 안전.
- 프로젝트 데이터 롤백은 사이드바 history 패널(Stage 7)에서 페이지/커밋 단위로 처리. 모든 ingest/modification 결과가 Stage 2부터 commit으로 저장되므로 데이터 손실은 없다.
