# development-plan.md — PLAN.md 단계별 실행 가이드

PLAN.md를 **수동 검증 가능한 단계**로 재구성한 작업 가이드. 각 단계는
앱을 실행해 직접 확인할 수 있는 완료 조건을 포함한다.

각 단계는 독립적인 PR 단위. 단계 끝에서 앱을 켜고 "수동 검증" 절을 통과해야
다음 단계로 넘어간다.

---

## Stage 0 — 사전 준비 (1회)

### 앱 실행 명령

| 모드 | 명령 | 용도 |
|---|---|---|
| 데스크톱 (권장) | `npm run tauri dev` | 파일시스템/Tauri 커맨드 검증. **모든 단계 검증은 이 모드에서.** |
| 웹 only | `npm run dev` | UI만 빠르게 보고 싶을 때. fs/git 커맨드는 동작 X. |

### 자동 검증 명령

| 명령 | 의미 |
|---|---|
| `npm run typecheck` | 타입 에러 없음 |
| `npm run test:mocks` | LLM 호출 없는 단위 테스트 |
| `npm run test:llm` | 실제 LLM 호출 (API 키 필요, CI에서만) |

### 검증 프로젝트 위치

수동 검증 시 매번 새 프로젝트를 만들어 격리한다. 권장 경로:

```
/tmp/llm-wiki-stage{N}/
```

각 단계 검증 후 다음 단계로 넘어가기 전 새 디렉토리를 사용해 깨끗한 상태에서
다시 시작한다.

---

## Stage 1 — 스키마 picker 기반 프로젝트 생성 (PR-1, M1)

**목표:** "Create New Wiki Project" 다이얼로그를 Template 카드 그리드에서
**스키마 파일 picker + Purpose textarea** 방식으로 전환한다. 사용자는 외부
`.md` 파일을 스키마로 선택하고(필수, skip 불가), purpose는 다이얼로그 내
markdown textarea에 직접 입력한다. 빌트인 템플릿은 모두 제거한다. 도메인
디렉토리는 부트스트랩하지 않으며, ingest 시점에 LLM이 schema.md를 보고
생성한다. 시스템 prefix 4개(`db/`, `processed_1/`, `pending/`,
`counterexamples/`)는 코드가 항상 보장한다. ingest 쓰기 sandbox 허용
prefix를 `wiki/` → 위 4개로 교체한다.

### UX 변경

| 항목 | Before | After |
|---|---|---|
| 스키마 | Template 카드 6개 그리드(빌트인) | "스키마 파일 선택" 버튼 → Tauri file dialog (`.md` 필터, 단일 파일, **필수**) |
| Purpose | 템플릿 본문에 자동 채워짐 | markdown textarea (빈 값 허용) |
| Create 활성화 조건 | name + path | name + path + **schema 파일 선택** |

### 작업 항목

- [x] `src/lib/templates.ts` **삭제 완료**.
  - `WikiTemplate` 타입, `templates` 배열, `getTemplate()` export 모두 제거.
  - 5개 빌트인(research/reading/personal-growth/business/general)도 함께 제거.
- [x] `src/components/project/template-picker.tsx` **삭제 완료**.
- [x] [src/components/project/schema-picker.tsx](src/components/project/schema-picker.tsx) **신규 완료**:
  - "스키마 파일 선택" 버튼 → `@tauri-apps/plugin-dialog` `open({ filters: [{ name: 'Markdown', extensions: ['md'] }], multiple: false })`.
  - 선택 후 절대경로를 `<p>`로 표시.
  - 미리보기는 미구현(추후 필요 시 추가).
- [x] [src/components/project/create-project-dialog.tsx](src/components/project/create-project-dialog.tsx) 재구성 완료:
  - Template 그리드 제거.
  - "스키마" 섹션 — `<SchemaPicker>`.
  - "프로젝트 목적" 섹션 — 인라인 `<textarea>` (별도 Textarea ui 컴포넌트 만들지 않음, codebase 관행).
  - schema 파일 미선택 시 Create 버튼 비활성화 (`canCreate` 가드).
  - 라벨은 한국어 hardcode("스키마", "프로젝트 목적"). i18n key wiring은 **Stage 6에서 통합 처리** (기존 다이얼로그도 영문 hardcode였음 — 부분 wiring하면 codebase 일관성 깨짐).
- [x] [src/lib/project-init.ts](src/lib/project-init.ts) **신규 완료**:
  - 시그니처: `initProject({ projectPath, schemaSourcePath, purposeMarkdown })`
  - 동작 순서:
    1. `db/`, `processed_1/`, `pending/`, `counterexamples/` 4개 디렉토리 + 각 `.gitkeep` 생성 (**항상**).
    2. `schemaSourcePath` 파일을 `copyFile`로 `<projectPath>/schema.md`에 복사.
    3. `purposeMarkdown`을 `<projectPath>/purpose.md`로 작성 (빈 문자열도 허용).
  - 트레일링 슬래시 정규화(`/+$` 제거) 포함.
  - `SYSTEM_PREFIX_DIRS` 상수도 export — Stage 2의 git init이 staging 대상 결정 시 재사용.
  - **git init은 Stage 2에서 추가.**
- [x] [src/lib/ingest.ts:66](src/lib/ingest.ts#L66) `isSafeIngestPath()` 갱신 완료:
  - 허용 prefix `SAFE_INGEST_PREFIXES` 상수로 추출, 4개 시스템 prefix 추가.
  - `wiki/`는 **Stage 3까지 한시적으로 유지** — `// TODO Stage 3: drop "wiki/" once the ingest pipeline writes to db/` 주석.
  - 거부 메시지도 새 prefix 목록 반영("must be under db/, processed_1/, pending/, counterexamples/, or wiki/").
- [x] i18n 부분 갱신 완료 ([src/i18n/en.json](src/i18n/en.json), [src/i18n/zh.json](src/i18n/zh.json)):
  - dead `project.template` 키 제거 (다이얼로그가 wiring돼있지 않아 사용처 없음).
  - 신규 키 추가는 **Stage 6에서 일괄** 처리(다이얼로그 i18n wiring과 같이).
- [x] [schema/game-dev-example.md](schema/game-dev-example.md) §0 갱신 완료:
  - 사라진 [src/lib/templates.ts](src/lib/templates.ts) 참조 제거.
  - "스키마 picker로 직접 선택해 schema.md로 복사 가능" 안내로 교체.

### 자동 검증

```bash
npm run typecheck
npm run test:mocks
```

- [x] [src/lib/__tests__/project-init.test.ts](src/lib/__tests__/project-init.test.ts) **신규 완료** — 5개 케이스:
  - 4개 시스템 prefix 디렉토리 + `.gitkeep` 생성.
  - `copyFile(schemaSourcePath, <projectPath>/schema.md)` 호출 검증.
  - `purposeMarkdown` 입력값이 `purpose.md`에 그대로 쓰임 (한글 markdown 포함).
  - 빈 `purposeMarkdown` 케이스.
  - `projectPath` 트레일링 슬래시 정규화.
- ingest 기존 테스트는 변경 불필요 — transitional sandbox가 `wiki/`를 계속 허용하므로 `ingest-parse.test.ts` 등 모두 통과.

**자동 검증 결과:** 46 files / 710 tests 통과 (이전 45/705 → +1 file/+5 tests).

### 수동 검증 (앱 실행)

1. `npm run tauri dev` 실행.
2. 좌측 사이드바 "+" 또는 "New Project" 클릭.
3. **확인:** 다이얼로그에 Template 카드 그리드가 **사라짐**. "스키마" 섹션과 "프로젝트 목적" textarea가 보임.
4. **확인:** schema 파일을 선택하지 않은 상태에서 Create 버튼 **비활성화**.
5. "스키마 파일 선택" 클릭 → file dialog → `/Users/muktop/Documents/llm_wiki/schema/game-dev-example.md` 선택.
6. **확인:** 선택된 파일 경로가 표시됨. Create 버튼이 활성화됨.
7. Purpose textarea에 임의 markdown 작성 (예: `# 게임 개발 위키\n\n인스턴스 서버 자료 정리`).
8. 프로젝트 경로 `/tmp/llm-wiki-stage1/` 입력 → Create.
9. 새 터미널에서:
   ```bash
   ls -la /tmp/llm-wiki-stage1/
   ```
   **확인:** `schema.md`, `purpose.md`, `db/`, `processed_1/`, `pending/`, `counterexamples/`, `.llm-wiki/` 모두 존재.
10. ```bash
    diff /Users/muktop/Documents/llm_wiki/schema/game-dev-example.md /tmp/llm-wiki-stage1/schema.md
    ```
    **확인:** 두 파일 내용 동일 (단순 복사).
11. ```bash
    cat /tmp/llm-wiki-stage1/purpose.md
    ```
    **확인:** 7번에서 입력한 markdown이 그대로 들어있음.
12. ```bash
    ls -la /tmp/llm-wiki-stage1/db/ /tmp/llm-wiki-stage1/processed_1/ /tmp/llm-wiki-stage1/pending/ /tmp/llm-wiki-stage1/counterexamples/
    ```
    **확인:** 각 디렉토리에 `.gitkeep` 1개만 존재 (도메인 서브디렉토리는 ingest 시점에 LLM이 schema.md 보고 생성).
13. **회귀:** Purpose를 빈 문자열로 두고 별도 프로젝트 생성해도 `purpose.md`(0 byte)가 정상 생성되고 다이얼로그가 에러 없이 닫히는지 확인.

### 완료 조건

위 1~13 모두 통과 + `npm run typecheck` 통과.

---

## Stage 2 — local git 자동 커밋 (PR-2, M4)

**목표:** Tauri 백엔드에 git CLI subprocess 래퍼를 추가하고,
프로젝트 생성/수정 시 자동 commit이 발생한다. 이 단계에서는 ingest는 아직
prompt 변경 전이므로, 검증은 **프로젝트 생성 시 initial commit**과
**수동 trigger commit**으로 한다.

### 작업 항목

- [x] [src-tauri/src/commands/git_ops.rs](src-tauri/src/commands/git_ops.rs) **신규 완료**:
  - `git_init(project_path)` — `.git` 없으면 `init -c init.defaultBranch=main` + 글로벌 user.name/email 미설정 시 local fallback 설정 + `git add -A` + initial commit (`init: bootstrap project`). 이미 `.git`이 존재하면 idempotent no-op.
  - `git_commit(project_path, message, paths)` — `git add -- <paths>` → `git diff --cached --quiet`로 변경 없으면 `{ committed: false }`로 short-circuit, 변경 있으면 commit + `git rev-parse HEAD`로 hash 회수. `--allow-empty` 사용 X.
  - `git_status(project_path)` — porcelain v2 `-z` 파싱 (1/2/?/!/u 레코드 타입 처리, rename 시 origPath 토큰 소비).
  - `git_log(project_path, limit)` — `--pretty=format:%H%x09%an%x09%aI%x09%s` tab-delimited 파싱. 빈 repo("does not have any commits yet" 등)는 빈 배열 반환.
  - `which::which("git")` 실패 시 한국어 에러: "git이 설치되어 있지 않습니다. https://git-scm.com 에서 설치하세요." (`GIT_NOT_INSTALLED` 상수).
  - 모든 함수 `tokio::process::Command` 비동기.
- [x] [src-tauri/src/commands/mod.rs](src-tauri/src/commands/mod.rs) — `pub mod git_ops;` 추가 완료.
- [x] [src-tauri/src/lib.rs](src-tauri/src/lib.rs) `invoke_handler` — 4개 신규 커맨드 등록 완료.
- [x] [src-tauri/capabilities/default.json](src-tauri/capabilities/default.json) — 검토 결과 추가 권한 불필요 (claude_cli와 동일하게 `#[tauri::command]` + `tokio::process::Command` 직접 호출 패턴, 셸 플러그인 미경유).
- [x] [src/commands/git.ts](src/commands/git.ts) **신규 완료** — frontend 래퍼 (`gitInit`, `gitCommit`, `gitStatus`, `gitLog`) + `CommitResult` / `StatusEntry` / `CommitInfo` 타입 export.
- [x] [src/lib/auto-commit.ts](src/lib/auto-commit.ts) **신규 완료**:
  - `commitIngest(projectPath, sourceFile, writtenPaths)` → 메시지 포맷
    ```
    ingest: <sourceFile> → N pages

    - <path1> (new)
    - <path2> (new)

    Source: <sourceFile>
    ```
  - `commitModification(projectPath, action, targetPath, sourceRef)` → 메시지 포맷
    ```
    modification: <action> <targetPath>

    Source: <sourceRef.file>:<sourceRef.range>
    Resolved-by: <action>
    ```
  - 빈 `writtenPaths` → gitCommit 호출 X (`{ committed: false, commitHash: null }` 즉시 반환).
  - `formatIngestMessage` / `formatModificationMessage`도 export — 테스트와 향후 미리보기에서 재사용.
  - `SourceRefLite = { file: string; range?: string }` 자체 타입 정의(`source-ref.ts`는 Stage 3에서 생성).
- [x] [src/lib/project-init.ts](src/lib/project-init.ts) 수정 완료 — bootstrap 끝에 `gitInit(pp)` 호출 (정규화된 경로 사용).
- [x] [src/lib/project-mutex.ts](src/lib/project-mutex.ts) — `commitIngest` / `commitModification` 모두 `withProjectLock(projectPath, ...)`로 감싸 ingest와 동일 락에 직렬화 (실제 git 호출은 같은 큐 안에서 진행).

### 자동 검증

```bash
npm run typecheck
npm run test:mocks -- auto-commit
```

- [x] [src/lib/__tests__/auto-commit.test.ts](src/lib/__tests__/auto-commit.test.ts) **신규 완료** — 7 케이스:
  - 빈 `writtenPaths` → `gitCommit` 호출 X.
  - 다중 페이지 ingest 메시지 포맷 (subject / `(new)` 불릿 / `Source:` 트레일러 / 경로 인자 정합성).
  - `commitModification` approve + range 포함 메시지 (Korean range 포함).
  - `commitModification` discard + range 없을 때 콜론 미포함.
  - `formatIngestMessage` / `formatModificationMessage` (range 있/없) 순수함수 shape 3개.
- [x] [src/lib/__tests__/project-init.test.ts](src/lib/__tests__/project-init.test.ts) 갱신 완료 — `gitInit` mock 추가, 트레일링 슬래시 정규화 후 `gitInit("/tmp/proj")` 호출 + 호출 순서(write/copy 후에 gitInit) 검증 케이스 추가.

Rust 통합 테스트 ([src-tauri/src/commands/git_ops.rs](src-tauri/src/commands/git_ops.rs) 내부 `#[cfg(test)]`) — 3 케이스 통과:
- `init_commit_log_cycle` — bootstrap files → `git_init` → `git_log`로 initial commit 확인 → `git_commit` 1건 추가 → no-op commit (`committed: false`) → `git_status` clean/dirty 확인.
- `commit_with_empty_paths_is_noop` — 빈 paths short-circuit.
- `init_is_idempotent` — 두 번째 `git_init`은 새 commit 만들지 않음.

**자동 검증 결과:**
- TypeScript: `npm run typecheck` 통과.
- 단위 테스트: 47 files / 718 tests 통과 (Stage 1 → +1 file/+8 tests).
- Rust: `cargo test --lib commands::git_ops` 3 passed / 0 failed.

### 수동 검증 (앱 실행)

1. `npm run tauri dev` 실행.
2. 새 프로젝트 생성 — 스키마는 [schema/game-dev-example.md](schema/game-dev-example.md) 선택, purpose는 임의로 입력, 경로는 `/tmp/llm-wiki-stage2/`.
3. 터미널:
   ```bash
   cd /tmp/llm-wiki-stage2 && git log --oneline
   ```
   **확인:** initial commit 1건 존재 (`schema.md`, `purpose.md`, 4개 prefix `.gitkeep` 포함).
4. ```bash
   git show --stat HEAD
   ```
   **확인:** 4개 prefix 디렉토리의 `.gitkeep` + schema.md + purpose.md가 staged.
5. **에러 케이스:** PATH에서 git을 일시적으로 제거하거나 `which git`이 실패하는 환경 가정 → 앱이 한국어 에러 메시지를 표시하는지 확인 (수동 시뮬레이션 어려우면 코드 리뷰로 대체).
6. (회귀) Stage 1의 부트스트랩 결과(시스템 prefix 4개 + schema.md + purpose.md)가 그대로 생성되는지 확인.

### 완료 조건

`/tmp/llm-wiki-stage2/.git/`이 존재하고 initial commit 1건 + 모든 부트스트랩 파일이 staged.

---

## Stage 3 — 분해/재배치 ingest 프롬프트 + SourceRef (PR-3, M2)

**목표:** raw 파일 업로드 시 schema.md 기반 path에 분해된 페이지가 생성되고,
각 페이지 frontmatter `sources`에 `file`+`range`가 들어간다. ingest 1회 = git
commit 1건이 발생.

### 작업 항목

- [x] [src/lib/source-ref.ts](src/lib/source-ref.ts) **신규 완료**:
  - `SourceRef` 타입 (`{ file: string; range?: string }`).
  - `parseSourceRef(input)` — string 또는 `{file, range}` object 모두 수용. 빈 string·범위 trim 처리. 잘못된 입력은 `null`.
  - `serializeSourceRef(ref)` — `<file>` 또는 `<file>:<range>` (`auto-commit`이 commit trailer에서 쓰는 포맷과 일치).
  - `sourceRefKey(ref)` — case-insensitive `file|range` 키 (merge dedup용).
- [x] [src/lib/sources-merge.ts](src/lib/sources-merge.ts) 확장 완료 (additive — 기존 string-기반 API 그대로):
  - 신규 `parseSourceRefs` — inline string array / multi-line string list / **multi-line object list** (Stage 3 형식) 모두 파싱.
  - 신규 `writeSourceRefs` — multi-line object form 출력. range는 `quoteForYaml`로 escape.
  - 신규 `mergeSourceRefsLists` — `file+range` 키 dedup, 같은 파일 다른 range는 별개 엔트리로 보존.
  - 신규 `mergeSourceRefsIntoContent` — db/ 페이지 재-ingest 시 range 보존.
  - 기존 `parseSources(content): string[]` 는 내부적으로 `parseSourceRefs`에 위임 → object form 페이지에서도 file 만 뽑아 반환 (sources-view 등 legacy 호출자 무변경).
- [x] [src/lib/processed1.ts](src/lib/processed1.ts) **신규 완료** (passthrough):
  - `runProcessed1(projectPath, sourcePath, rawContent)` → `processed_1/<basename>.md`에 verbatim 기록. `.pdf/.docx/.xlsx` 등은 `.md`로 정규화.
  - `rawFileName`은 원본 확장자 유지 (frontmatter SourceRef가 가리키는 이름).
  - `// TODO Part 1.5: structured 1차 가공` 주석 포함.
- [x] [src/lib/ingest.ts:727](src/lib/ingest.ts#L727) `buildAnalysisPrompt(schema, purpose, dbIndex, sourceContent)` 재작성:
  - entities/concepts/queries 섹션 **삭제**.
  - 새 task framing — "schema가 정의한 db/ 경로로 어떻게 분해되는가". path + summary + range + existing? 출력 지시.
  - schema 전문, purpose, db/ 인덱스 (Tauri `listDirectory` 기반 트리) 주입.
- [x] [src/lib/ingest.ts:791](src/lib/ingest.ts#L791) `buildGenerationPrompt(schema, purpose, dbIndex, sourceFileName, sourceContent)` 재작성:
  - 모든 FILE 경로는 `db/`로 시작 강제.
  - frontmatter `sources` 는 multi-line object form 명시 (inline string form 명시적으로 금지).
  - index/overview/log 페이지 생성 금지.
  - REVIEW block은 옵션 (`missing-page`, `suggestion`만 허용). 일반 분해 결정은 Stage 4 modification flow로 보냄.
- [x] [src/lib/ingest.ts](src/lib/ingest.ts) `autoIngestImpl` 수정 완료:
  - Step 0: `runProcessed1` 호출 → `processed_1/<basename>.md`.
  - schema/purpose 읽기, `buildDbIndex` 헬퍼로 db/ 트리 빌드.
  - Step 1/2 prompts에 새 시그니처 적용.
  - `writeFileBlocks`에서 db/ 페이지는 `mergeSourceRefsIntoContent`로 (range 보존), wiki/ 페이지는 기존 string-based merge.
  - Step 6: `formatIngestMessage` + `gitCommit` 직접 호출 (이미 보유한 project lock 안에서 실행 — `commitIngest` 재진입 deadlock 회피).
  - `wiki/sources/<>.md` fallback 삭제 (processed_1이 그 역할 대체).
  - `wiki/index.md`/`wiki/overview.md`/`wiki/log.md` 읽기·생성 지시 모두 제거.

### 자동 검증

```bash
npm run typecheck
npm run test:mocks
```

- [x] [src/lib/__tests__/source-ref.test.ts](src/lib/__tests__/source-ref.test.ts) **신규 완료** — 18 케이스: parseSourceRef (string/object/empty/null), serializeSourceRef (file·range 포맷 일치), sourceRefKey (case-insensitive, file-only vs ranged 구분).
- [x] [src/lib/__tests__/processed1.test.ts](src/lib/__tests__/processed1.test.ts) **신규 완료** — 5 케이스: passthrough write, .md 정규화, 확장자 없는 입력, rawFileName 보존, 콘텐츠 transformation 없음 검증.
- [x] [src/lib/sources-merge.test.ts](src/lib/sources-merge.test.ts) 확장 — SourceRef round-trip 22+ 케이스: parseSourceRefs (legacy/object form), writeSourceRefs (object form output, escape 처리), mergeSourceRefsLists (range 보존, file-only vs ranged 구분), mergeSourceRefsIntoContent (legacy → object 업그레이드 등).
- [x] [src/lib/ingest.prompt.test.ts](src/lib/ingest.prompt.test.ts) 갱신 — 새 시그니처에 맞춰 호출, 새 프롬프트 검증 (decomposer framing, db/ FILE format, multi-line object form 강제, inline form 금지 안내).
- [x] [src/test-helpers/scenarios/ingest-scenarios.ts](src/test-helpers/scenarios/ingest-scenarios.ts) 확장 — `game-dev/instance-server` 시나리오 추가:
  - 가짜 `instance_server_design.md` (4개 의미 단위) 입력.
  - 4개 FILE block 출력: `db/systems/instance_server/server_structure.md`, `db/content/dungeons/dungeon_a/entry_rules.md`, `db/content/dungeons/dungeon_a/rewards.md`, `db/content/dungeons/dungeon_b/spawn_rules.md`.
  - 각 frontmatter `sources`에 `file: instance_server_design.md` + `range: ## ...` 검증.
  - `processed_1/instance_server_design.md` passthrough 검증.
- [x] [src/lib/ingest.scenarios.test.ts](src/lib/ingest.scenarios.test.ts) — `vi.mock("@/commands/git", ...)` 추가 (테스트 환경에 Tauri host 없어 invoke가 hang하는 것 방지).

**자동 검증 결과:**
- TypeScript: `npm run typecheck` 통과.
- 단위 테스트: 49 files / 765 tests 통과 (Stage 2 → +2 file/+47 tests).

### 수동 검증 (앱 실행)

검증용 가짜 raw 파일 준비:

```bash
mkdir -p /tmp/stage3-raw
cat > /tmp/stage3-raw/instance_server_design.md <<'EOF'
# 인스턴스 서버 설계

## 1. 서버 구조
- 인스턴스 서버는 채널마다 별도 프로세스로 동작.
- 메인 서버와 gRPC로 통신.

## 2. 던전 A — 입장 규칙
- 레벨 50 이상 입장 가능.
- 파티 4인 필수.

## 3. 던전 A — 보상
- 클리어 시 골드 1000 + 장비 박스 1개.
- 주간 1회 추가 보상.

## 4. 던전 B — 스폰 규칙
- 보스는 60초 간격으로 스폰.
- 스폰 위치는 5곳 랜덤.
EOF
```

1. `npm run tauri dev` 실행.
2. 새 프로젝트 game-dev 템플릿으로 `/tmp/llm-wiki-stage3/` 생성 → initial commit.
3. 사이드바 Raw(또는 Sources) → "파일 추가" → `/tmp/stage3-raw/instance_server_design.md` 업로드.
4. ingest 큐가 처리되기를 기다림 (활동 패널에서 진행 상황 확인).
5. 처리 완료 후 터미널:
   ```bash
   ls /tmp/llm-wiki-stage3/processed_1/
   ```
   **확인:** `instance_server_design.md` 존재 (passthrough).
6. ```bash
   find /tmp/llm-wiki-stage3/db -name "*.md" -not -name ".gitkeep"
   ```
   **확인:** 약 4개 페이지가 `db/systems/instance_server/`, `db/content/dungeons/dungeon_a/`, `db/content/dungeons/dungeon_b/` 아래에 분배되어 생성됨.
7. ```bash
   head -20 /tmp/llm-wiki-stage3/db/content/dungeons/dungeon_a/rewards.md
   ```
   **확인:** frontmatter `sources`에 `file: instance_server_design.md`와 `range: ## 3. 던전 A — 보상` (또는 유사) 들어감.
8. ```bash
   cd /tmp/llm-wiki-stage3 && git log --oneline
   ```
   **확인:** initial commit + ingest commit 1건. 메시지: `ingest: instance_server_design.md → 4 pages`.
9. ```bash
   git show --stat HEAD
   ```
   **확인:** `processed_1/...` + 4개 `db/...` 페이지가 한 commit에 묶임.

### 완료 조건

위 1~9 통과. **schema.md가 정의한 path와 LLM 출력 path가 정확히 일치할 필요는 없음** — game-dev 도메인 축에 맞게 합리적으로 분배되면 OK. (정확한 path 매칭은 prompt 튜닝 영역)

---

## Stage 4 — modification 워크플로우 (PR-4, M3)

**목표:** 같은 의미 단위가 v2로 다시 들어올 때 자동 덮어쓰기 X. review 카드에서
Approve/Merge/Reject 3-옵션 → Reject 시 Discard/Pending/Counterexample 3-옵션
2단계 트리 동작.

### 작업 항목

- [x] [src/stores/review-store.ts](src/stores/review-store.ts) `ReviewItem` 확장 완료:
  - `type` union에 `"modification"` 추가.
  - `stage?: "primary" | "rejection-handling"` 추가 (modification 전용, 다른 type은 미사용).
  - `proposal?: ModificationProposal` 추가 — `targetPath` / `existingExcerpt` / `incomingExcerpt` / `incomingDraftPath` / `sourceRefs[]`.
  - `addItems`에서 modification은 dedupe 경로를 우회 (parked draft가 distinct하므로 무조건 append). 비-modification은 기존 dedupe 그대로.
  - 신규 액션 `transitionToRejectionHandling(id)` — pending modification만 stage flip, 다른 케이스(resolved / 다른 type)는 no-op.
- [x] [src/lib/ingest.ts](src/lib/ingest.ts) `writeFileBlocks` 갱신 완료:
  - db/ 페이지에 한해 conflict 검출. 기존 파일 body(frontmatter 제거 후)와 신규 content body가 다르면 자동 덮어쓰기 금지.
  - 신규 콘텐츠 → `pending/_proposals/<runStamp>-<idx>-<slug>.md`로 park (writeFile 자동 mkdir).
  - 신규 `proposals: ModificationProposal[]` 반환. 같은 body는 기존 source-merge 경로 그대로.
  - `autoIngestImpl`에서 proposals를 `modification` review item으로 변환해 store에 큐잉.
- [x] [src/lib/sweep-reviews.ts](src/lib/sweep-reviews.ts) — `modification` type은 pending 필터에서 제외 → rule 단계도 LLM judge 단계도 건드리지 않음.
- [x] [src/lib/modification-resolve.ts](src/lib/modification-resolve.ts) **신규 완료**:
  - `approveModification(pp, proposal)` — draft 읽고 기존 target과 `mergeSourceRefsIntoContent`로 sources 병합 → target 갱신, draft 삭제, `commitModification("approve", ...)`.
  - `discardModification(pp, proposal, reason?)` — `.llm-wiki/rejection-log.jsonl`에 JSONL 한 줄 append, draft 삭제(있을 때만), `commitModification("discard", ...)`.
  - `pendingModification(pp, proposal)` — draft → `pending/<slug>.md` 이동, `commitModification("pending", ...)`.
  - `counterexampleModification(pp, proposal)` — draft → `counterexamples/<slug>.md` 이동, `commitModification("counterexample", ...)`.
  - Merge는 UI-only — review-view에서 draft 파일을 에디터에 띄우고 사용자가 hand-edit 후 Approve를 다시 누르도록 했다.
  - `pathToSlug` 헬퍼 export — `db/content/dungeons/dungeon_a/rewards.md` → `content_dungeons_dungeon_a_rewards`.
- [x] [src/components/review/review-view.tsx](src/components/review/review-view.tsx) 갱신 완료:
  - `typeConfig`에 `modification` 항목 추가 (GitMerge 아이콘, 오렌지).
  - `ModificationDiff` — existing vs incoming 2-pane 미리보기 (truncate 600자) + draft path 표기.
  - `ModificationActions` — `stage === "primary"` 시 [Approve, Merge, Reject], `"rejection-handling"` 시 [Discard, Pending, Counterexample].
  - `handleResolve` modification 분기 — `modification:approve|merge|reject|discard|pending|counterexample` 액션 분기 후 file tree refresh.

### 자동 검증

```bash
npm run typecheck
npm run test:mocks
```

- [x] [src/stores/review-store.test.ts](src/stores/review-store.test.ts) 확장 완료 — modification stage 4 케이스: 신규 추가 시 `stage='primary'`, `transitionToRejectionHandling` flip, resolved/non-modification 케이스 no-op, 같은 target path 두 modification 입력 시 dedupe 안 됨.
- [x] [src/lib/__tests__/modification-resolve.test.ts](src/lib/__tests__/modification-resolve.test.ts) **신규 완료** — 9 케이스: `pathToSlug` 2건, `approveModification` 2건 (existing/없음), `discardModification` 2건 (기존 로그 있음/없음), `pendingModification` 1건, `counterexampleModification` 1건, plus shape 검증.
- [x] [src/lib/sweep-reviews.modification.test.ts](src/lib/sweep-reviews.modification.test.ts) **신규 완료** — 2 케이스: missing-page와 modification 혼합 시 modification만 unresolved 유지, modification 단독 시 sweep return 0.

**자동 검증 결과:**
- TypeScript: `npm run typecheck` 통과.
- 단위 테스트: 51 files / 779 tests 통과 (Stage 3 → +2 file/+14 tests).

### 수동 검증 (앱 실행)

1. Stage 3의 검증을 그대로 통과한 `/tmp/llm-wiki-stage3/`를 `/tmp/llm-wiki-stage4/`로 복사하거나, 새 프로젝트로 Stage 3 절차 다시 실행 후 시작.
2. v2 raw 파일 준비:
   ```bash
   cat > /tmp/stage3-raw/instance_server_design_v2.md <<'EOF'
   # 인스턴스 서버 설계 v2

   ## 던전 A — 보상 (변경)
   - 클리어 시 골드 1500 + 장비 박스 2개.
   - 주간 2회 추가 보상.
   EOF
   ```
3. v2 파일 업로드 → ingest 처리.
4. **확인:** review 패널에 `modification` 카드 1건 등장. 카드에:
   - 좌: 기존 `db/content/dungeons/dungeon_a/rewards.md` 내용
   - 우: `pending/_proposals/<id>.md` 신규 내용
   - 버튼 [Approve][Merge][Reject]
5. **Approve 분기:** Approve 클릭 →
   - 파일 갱신 확인: `cat .../rewards.md` (골드 1500으로 변경됨)
   - `git log --oneline` → `modification: approve db/content/dungeons/dungeon_a/rewards.md` commit 1건.
6. (테스트 격리 위해 다시 Stage 3 상태로 reset 후) **Reject 분기:**
   - Reject 클릭 → 같은 카드 버튼이 [Discard][Pending][Counterexample]로 전환.
   - **Discard 클릭** → `pending/_proposals/<id>.md` 삭제, `.llm-wiki/rejection-log.jsonl` 1줄 추가.
   - 또는 **Pending 클릭** → `pending/dungeon_a_rewards.md` 파일 존재.
   - 또는 **Counterexample 클릭** → `counterexamples/dungeon_a_rewards.md` 파일 존재.
7. 모든 액션 후 `git log` → 액션마다 commit 1건씩.

### 완료 조건

5번(Approve), 6번(Reject 후 3-옵션 모두) 모두 한 번씩 통과. v2 업로드 시 기존 파일이 자동 덮어써지지 **않음**을 명시적으로 확인.

---

## Stage 5 — pending / counterexamples 컨텍스트 주입 (PR-5, M5)

**목표:** counterexample이나 거절 기록이 있는 raw range가 다시 들어올 때
LLM 컨텍스트에 반례가 주입되어 같은 신규 내용이 review로 다시 올라오지 않거나
자동 dismiss된다.

### 작업 항목

- [x] [src/lib/counterexample-index.ts](src/lib/counterexample-index.ts) **신규 완료**:
  - `loadCounterexamples(projectPath)` — `counterexamples/*.md`를 스캔, frontmatter `title`/`sources` + 본문 excerpt 추출.
  - `findRelatedCounterexamples(entries, ref)` — file 기반 case-insensitive 매칭. range가 주어진 경우 같은 range 또는 range-less만 통과 (broader entry 보존). (임베딩은 Part 2)
  - `loadRejectionLog(projectPath, limit)` — `.llm-wiki/rejection-log.jsonl` JSONL 파싱, malformed 라인 skip, 최신 N개 newest-first.
  - `findRelatedRejections(entries, sourceFile)` — sourceFile case-insensitive 매칭.
  - `formatDismissalContext(counterexamples, rejections)` — 두 입력을 prompt 친화적 markdown 섹션으로 직렬화. 둘 다 비면 `""` 반환.
- [x] [src/lib/ingest.ts](src/lib/ingest.ts) `buildAnalysisPrompt()` 확장 완료:
  - 시그니처에 5번째 optional 파라미터 `dismissalContext` 추가 (기존 호출자/테스트는 영향 없음 — Stage 6에서 변경 없는 default 동작).
  - `autoIngestImpl`에서 `loadCounterexamples` + `loadRejectionLog` 호출 → `findRelatedRejections(rejectionLog, fileName)`로 현재 ingest 파일에 한정한 뒤 `formatDismissalContext`로 prompt 섹션 생성.
  - 프롬프트 텍스트는 "Prior dismissals (apply before proposing pages) ... 같은 raw section이 매핑되면 새 페이지를 제안하지 말고 '## Skipped (prior dismissal)' 섹션에 한 줄 사유와 함께 기재하라" 지시.
  - **`pending/`은 의도적으로 주입하지 않음** — 인간 검토 대기 상태이므로 모델 결정에 편향을 주지 않는다.
- [x] [src/lib/pending-resolve.ts](src/lib/pending-resolve.ts) **신규 완료**:
  - `loadPendingItems(projectPath)` — `pending/<slug>.md` (top-level only, `pending/_proposals/` 제외) 열거. 각 항목에서 frontmatter title을 뽑고, db/ 트리에서 `pathToSlug` round-trip으로 정확한 target을 복구 (target이 삭제된 경우 `db/<slug-with-underscores-as-slashes>.md` 휴리스틱 fallback + `targetExists: false`).
  - `discardPending(pp, item, reason?)` — `.llm-wiki/rejection-log.jsonl`에 항목 append, 파일 삭제, `formatModificationMessage("discard-pending", ...)`로 commit (paths: `[pending file, rejection log]`).
  - `promotePending(pp, item)` — `mergeSourceRefsIntoContent`로 sources 병합 후 target에 write, pending 파일 삭제, commit (paths: `[targetPath, pending file]`).
  - `reReviewPending(pp, item)` — pending → `pending/_proposals/<runStamp>-rerev-<slug>.md` 이동, 새 `modification` review item을 store에 큐잉. commit은 별도로 발생시키지 않음 (다음 사용자 액션이 결과를 기록).
- [x] [src/components/review/pending-view.tsx](src/components/review/pending-view.tsx) **신규 완료**:
  - `loadPendingItems` 호출 → 카드 리스트.
  - 각 카드: 타이틀 + `pending/...` → `db/...` 경로 + 액션 [Re-review] / [Promote to db/] / [Discard].
  - target 미존재 시 "(target not found)" 라벨 표기.
  - 액션 후 file tree refresh + `bumpDataVersion()`.
- [x] [src/components/review/review-view.tsx](src/components/review/review-view.tsx) — 헤더에 [Review | Pending] 탭 토글 추가, Pending 탭 시 `<PendingView />` 렌더 (별도 사이드바 아이콘 추가하지 않음 — 라벨 변경은 Stage 6에서 i18n과 함께 일괄 처리).

### 자동 검증

```bash
npm run typecheck
npm run test:mocks
```

- [x] [src/lib/__tests__/counterexample-index.test.ts](src/lib/__tests__/counterexample-index.test.ts) **신규 완료** — 11 케이스: `loadCounterexamples` (없음/Stage-3 object form/dotfile·디렉토리 skip/title fallback), `findRelatedCounterexamples` (case-insensitive file/scoped range/broader entry 보존), `loadRejectionLog` (없음/JSONL parse + malformed skip + newest-first), `findRelatedRejections` (case-insensitive sourceFile), `formatDismissalContext` (empty/both sections/discards 없을 때).
- [x] [src/lib/ingest.dismissal-context.test.ts](src/lib/ingest.dismissal-context.test.ts) **신규 완료** — `streamChat`에 전달되는 system prompt를 캡처해 검증:
  - counterexample + rejection log가 있으면 `"Prior dismissals"` / `"Counterexamples"` / `"Discards"` 섹션 + 실제 title·source ref·reason이 모두 prompt에 포함됨.
  - 둘 다 비어 있으면 `"Prior dismissals"` 섹션 자체가 prompt에서 누락됨.
- [x] [src/test-helpers/fs-temp.ts](src/test-helpers/fs-temp.ts) `realFs`에 `fileExists` 추가 — Stage 5에서 `counterexample-index`가 `fileExists`를 호출하므로 scenario 테스트들이 모킹 export에 fall-through하도록 보강.

**자동 검증 결과:**
- TypeScript: `npm run typecheck` 통과.
- 단위 테스트: 53 files / 794 tests 통과 (Stage 4 → +2 files/+15 tests).

### 수동 검증 (앱 실행)

1. Stage 4의 Reject → Counterexample 분기를 통과한 프로젝트(`/tmp/llm-wiki-stage4/`) 또는 깨끗한 프로젝트에서 Stage 3 → Stage 4 Counterexample 등록까지 재현.
2. **확인:** `counterexamples/dungeon_a_rewards.md` 존재 + 메타에 "기존이 맞음, 신규는 반례" 기록.
3. 같은 v2 raw 파일을 다시 업로드.
4. ingest 처리.
5. **확인 A (자동 dismiss):** review 패널에 `modification` 카드가 새로 생기지 **않거나**, 생기더라도 즉시 자동 dismiss됨.
6. ```bash
   git log --oneline
   ```
   **확인:** Counterexample 등록 commit 이후 ingest commit이 추가로 생기지 않거나, 생기더라도 dismiss 사유가 메시지에 기록됨.
7. **Pending 검증:**
   - Stage 4 Pending 분기를 한 번 통과시키고, 사이드바 pending-view에 항목이 1건 보이는지 확인.
   - [Re-review] 클릭 → 항목이 다시 review 큐로 돌아옴.

### 완료 조건

5, 6, 7 통과. **컨텍스트 주입 효과는 LLM 비결정성으로 100% 보장 어려움** — 프롬프트에 counterexample 텍스트가 들어가는지 로그로 1회 확인하면 OK.

---

## Stage 6 — UI 라벨 + 한국어 번역 (PR-6)

**목표:** 사이드바 라벨을 게임 도메인에 맞게 변경하고, 한국어 i18n을 추가한다.
다른 단계와 의존 없음 — 어느 시점에 해도 무방하지만, UI 변경이 다른 단계의
검증을 헷갈리게 할 수 있어 마지막에 둔다.

### 작업 항목

- [x] [src/i18n/ko.json](src/i18n/ko.json) **신규 완료** — `en.json` 키 그대로 한국어 번역.
- [x] [src/i18n/index.ts](src/i18n/index.ts) — ko 등록 완료.
- [x] [src/components/project/create-project-dialog.tsx](src/components/project/create-project-dialog.tsx) i18n wiring 완료:
  - `useTranslation()` wiring + 신규 키: `project.schema.label/button/changeButton/dialogTitle`, `project.purpose.label/placeholder`, `project.error.nameAndPath/schemaRequired`.
  - 기존 영문 hardcode("Create New Wiki Project", "Project Name", "Parent Directory", "Cancel", "Create", "Creating...", placeholder)도 함께 wiring.
  - [src/components/project/schema-picker.tsx](src/components/project/schema-picker.tsx)도 함께 wiring.
- [x] [src/components/layout/icon-sidebar.tsx](src/components/layout/icon-sidebar.tsx) 라벨 매핑 — Graph 아이콘 사이드바에서 제거, history 아이콘 추가. en/zh/ko의 `nav.wiki/sources/review`를 DB / Raw / Modifications(수정 요청 / 修改请求) 로 갱신.
- [x] [src/i18n/en.json](src/i18n/en.json), [src/i18n/zh.json](src/i18n/zh.json) — 동일 키 추가/변경 완료 (`nav.history`, `history.*`, `project.schema.*`, `project.purpose.*`, `project.error.*`).
- [x] [src/i18n/i18n-parity.test.ts](src/i18n/i18n-parity.test.ts) 통과 (3개 언어 키 일치) — ko 번들 검증 추가, 6 케이스 통과.
- [x] [src/components/settings/sections/interface-section.tsx](src/components/settings/sections/interface-section.tsx) — `한국어 (ko)` 옵션 추가.

### 자동 검증

```bash
npm run typecheck
npm run test:mocks -- i18n
```

**자동 검증 결과:**
- TypeScript: `npm run typecheck` 통과.
- 단위 테스트: 54 files / 805 tests 통과 (Stage 5 → +1 file/+11 tests; +11은 Stage 7 git-history.test.ts의 11 케이스).
- i18n parity: 3-언어 6 케이스 통과.

### 수동 검증 (앱 실행)

1. `npm run tauri dev`.
2. 설정에서 언어 → 한국어 선택.
3. **확인:** 사이드바 라벨이 "DB / Raw / 수정 요청 / Lint" 로 표시.
4. **확인:** Graph 아이콘이 사이드바에 보이지 않음.
5. 영어로 전환 → 라벨이 영문으로 정상 전환.
6. 중국어로 전환 → 같은 키가 중국어로 전환.

### 완료 조건

3, 4, 5, 6 통과 + i18n parity 테스트 통과.

---

## Stage 7 — git 히스토리 뷰어 + 롤백 UI (PR-7, M6)

**목표:** Stage 2에서 백엔드에 들어온 git 인프라를 사용자가 앱 안에서 직접
사용할 수 있게 한다. 사이드바에서 history 패널을 열어 commit 목록과 변경
파일/diff를 볼 수 있고, 특정 페이지를 직전 버전으로 복원하거나 commit 단위
revert를 할 수 있다.

**왜 별도 Stage인가:** Stage 2 시점부터 `gitLog` / `gitStatus`가 [src/commands/git.ts](src/commands/git.ts)에
정의되어 있지만, frontend 어디에서도 호출되지 않는다. 사용자가 history를 보거나
이전 시점으로 돌아가려면 터미널을 열어 `git log` / `git checkout` / `git revert`를
수동으로 실행해야 한다. 이 Stage는 그 갭을 닫는다.

**의존성:** Stage 2(git_ops.rs 백엔드). Stage 3~6의 흐름과는 독립적 — 어떤
프로젝트라도 git이 초기화되어 있으면 동작한다. UI 변경이 다른 단계의 검증에
영향을 주지 않으므로 Stage 6(i18n) 다음 마지막 단계로 둔다.

### 작업 항목

- [x] [src-tauri/src/commands/git_ops.rs](src-tauri/src/commands/git_ops.rs) 확장 완료 — 4개 신규 명령:
  - `git_show(project_path, hash)` — 단일 commit metadata + `FileChange[]` (`path`, `status` (A/M/D/R/C/T), `additions`, `deletions`). 3-pass 파싱: `-s --format=%H%x09%an%x09%aI%x09%B` (메타) + `--numstat` (라인 수) + `--name-status` (상태 코드). rename은 새 path를 키로 사용.
  - `git_diff(project_path, ref_a, ref_b, path?)` — `git diff <ref_a> <ref_b> [-- <path>]` raw 텍스트.
  - `git_checkout_path(project_path, hash, paths)` — `git checkout <hash> -- <paths>`. working tree만 갱신, 새 commit은 frontend가 별도 호출.
  - `git_revert(project_path, hash)` — `git revert --no-edit <hash>`. 충돌 시 porcelain v2 status로 unmerged path 추출 → `RevertResult { committed: false, conflicts }` 반환. 자동 resolve / abort 없음.
  - 모든 명령 `tokio::process::Command` 비동기, `which::which("git")` 실패 시 Stage 2의 한국어 에러.
- [x] [src-tauri/src/commands/mod.rs](src-tauri/src/commands/mod.rs)는 변경 불필요 (이미 `pub mod git_ops`), [src-tauri/src/lib.rs](src-tauri/src/lib.rs) `invoke_handler` — 4개 신규 커맨드 등록 완료.
- [x] [src/commands/git.ts](src/commands/git.ts) — frontend 래퍼 4개 (`gitShow`, `gitDiff`, `gitCheckoutPath`, `gitRevert`) + 응답 타입(`CommitDetail`, `FileChange`, `RevertResult`) 추가 완료.
- [x] [src/lib/git-history.ts](src/lib/git-history.ts) **신규 완료**:
  - `HISTORY_PAGE_SIZE = 50` 상수 export.
  - `loadCommitPage(projectPath, cursor, limit?)` — cursor가 null이면 `gitLog(limit)` 위임, 있으면 `limit*4` 버퍼를 가져와 cursor 다음부터 `limit`개 슬라이스 (작은 프로젝트 가정).
  - `loadCommitDetail(projectPath, hash)` — `gitShow` 위임.
  - `loadFileDiff(projectPath, hash, path)` — `<hash>^..<hash>` 우선, 부모 없는 initial commit이면 git의 빈 트리 SHA(`4b825dc...`)로 fallback.
  - `restoreFileFromCommit(projectPath, hash, path)` — `gitCheckoutPath` → `gitCommit("revert: restore <path> to <shortHash>", [path])`. 한 번에 1 페이지.
  - `revertCommit(projectPath, hash)` — `gitRevert` wrapper, conflict는 그대로 반환.
- [x] [src/components/history/history-view.tsx](src/components/history/history-view.tsx) **신규 완료** — 3-pane split:
  - **좌(w-72):** commit 카드 — subject(line-clamp-2) + author + 상대 시간 + 7-char short hash. "Load more" 버튼.
  - **중앙(w-72):** 선택 commit의 full message + ISO date + full hash + `FileChange[]` 리스트 (status badge + +add/−del + "이 버전으로 복원" 버튼).
  - **우(flex-1):** 선택 파일의 diff (whitespace-pre-wrap mono).
  - **commit 헤더:** "이 커밋 되돌리기" 버튼 — 충돌 시 alert에 conflict 파일 목록 표기.
  - 액션 후 `loadCommitPage(null)` 재로드 + `listDirectory`로 file tree refresh + `bumpDataVersion()`.
- [x] [src/components/layout/icon-sidebar.tsx](src/components/layout/icon-sidebar.tsx) — `History` 아이콘 + `nav.history` 라벨 추가, Graph 아이콘 제거 (Stage 6 동일 시점에 처리).
- [x] [src/components/layout/content-area.tsx](src/components/layout/content-area.tsx) — `case "history": return <HistoryView />` 분기 추가.
- [x] [src/stores/wiki-store.ts](src/stores/wiki-store.ts) — `activeView` union에 `"history"` 추가.
- [x] [src/i18n/en.json](src/i18n/en.json), [src/i18n/zh.json](src/i18n/zh.json), [src/i18n/ko.json](src/i18n/ko.json) — `nav.history` + `history.*` 키 (`title`, `empty`, `loading`, `loadMore`, `selectCommit`, `filesChanged`, `noFileSelected`, `restoreFile`/`restoring`/`restored`, `revertCommit`/`reverting`/`reverted`, `conflictTitle`/`conflictBody`, `actionFailed`) 모두 동시 갱신.

### 자동 검증

```bash
npm run typecheck
npm run test:mocks
cargo test --lib commands::git_ops
```

**자동 검증 결과:**
- TypeScript: `npm run typecheck` 통과.
- 단위 테스트: 54 files / 805 tests 통과 (Stage 5 → +1 file/+11 tests).
- Rust: `cargo test --lib commands::git_ops` 7 passed / 0 failed (Stage 2의 3 케이스 + Stage 7 신규 4 케이스).


- [x] [src-tauri/src/commands/git_ops.rs](src-tauri/src/commands/git_ops.rs) 통합 테스트 4개 추가 완료:
  - `git_show_returns_commit_metadata_and_files` — 2-commit repo에서 HEAD `git_show` → message / files / additions/deletions / `A`+`M` 코드 검증.
  - `git_diff_between_refs` — `HEAD~1..HEAD` diff에 `+beta`/파일명 포함, path-scoped diff도 검증.
  - `git_checkout_path_restores_old_version` — `v2` 커밋 후 `HEAD~1`로 checkout하면 working tree가 `v1`로 돌아오고 새 commit은 만들지 않음.
  - `git_revert_creates_new_revert_commit` — `git_revert(HEAD)` → log에 "Revert ..." 메시지 + 3번째 commit 추가 + working tree가 v1으로 복귀.
- [x] [src/lib/__tests__/git-history.test.ts](src/lib/__tests__/git-history.test.ts) **신규 완료** — 11 케이스: `loadCommitPage` (no cursor / cursor trim / cursor missing) 3건, `loadCommitDetail` 위임 1건, `loadFileDiff` (parent ref 우선 / 부모 없을 때 empty-tree fallback) 2건, `restoreFileFromCommit` 메시지 포맷 + 인자 1건, `revertCommit` (conflict pass-through / clean revert hash) 2건, plus shape 검증.
- 참고: `src/components/history/__tests__/history-view.test.tsx`는 **생략** — 레포에 jsdom / @testing-library 인프라가 없고 다른 `.tsx` 테스트가 0개라, RTL 도입은 본 plan 범위를 넘어선다. cargo + git-history.test.ts 조합으로 핵심 동작은 커버됨.

### 수동 검증 (앱 실행)

전제: Stage 3 검증을 통과한 `/tmp/llm-wiki-stage3/` (또는 새 프로젝트로
Stage 3 흐름 1회 통과).

1. `npm run tauri dev` 실행.
2. 사이드바에서 history 아이콘 클릭.
3. **확인:** commit 목록이 시간순으로 표시 — `init: bootstrap project` (initial)
   + `ingest: instance_server_design.md → 4 pages` 1건. 메시지·hash·author·date
   모두 노출.
4. ingest commit을 클릭 → 우측 패널에:
   - **확인:** message 본문(불릿 포함)이 그대로 보임.
   - **확인:** 변경 파일 5개(`processed_1/...` + 4 db/ 페이지) 리스트.
   - 한 파일 클릭 → diff 영역에 해당 파일의 추가 라인이 `+ ...` 형식으로 표시.
5. **파일 단위 복원:** 임의 db/ 페이지를 에디터에서 직접 수정해 `git_commit`을
   한 번 발생시킨 뒤(예: 사이드바에서 페이지 편집 → 저장 → 자동/수동 commit),
   history에서 직전 commit의 그 파일 카드에서 **"이 버전으로 복원"** 클릭.
   - **확인:** 파일 내용이 직전 버전으로 돌아옴 (`cat .../page.md`로 확인).
   - **확인:** `git log --oneline`에 `revert: restore <path> to <hash>` commit
     1건 추가.
6. **commit 단위 revert:** 위에서 생성한 "복원" commit을 history에서 선택 →
   **"이 커밋 되돌리기"** 클릭.
   - **확인:** `git log` 맨 위에 `Revert "revert: restore ..."` commit 추가.
   - **확인:** 파일이 다시 5번 직전 상태로 돌아옴.
7. **충돌 케이스:** 두 commit에서 같은 라인을 수정해 revert 시 충돌이 나도록
   유도 → "이 커밋 되돌리기" 클릭 → conflict alert가 충돌 파일 경로를 정확히
   안내. (수동 시뮬레이션이 어려우면 코드 리뷰 + Rust 통합 테스트로 대체)

### 완료 조건

3, 4, 5, 6 모두 통과 + `cargo test --lib commands::git_ops` 신규 4 케이스 통과.
충돌 케이스(7)는 best-effort.

---

## 부록 A — 단계별 git commit 권장

각 Stage 끝, 수동 검증을 통과하면 코드 변경을 commit한다. 메시지 컨벤션:

```
feat(stage{N}): <한 줄 요약>

PLAN.md 마일스톤 M{N} 구현. 자세한 작업 항목은 development-plan.md 참조.

Manual verification: development-plan.md Stage {N} 수동 검증 절차 통과.
```

## 부록 B — 디버깅 / 롤백

각 Stage는 독립적인 디렉토리(`/tmp/llm-wiki-stage{N}`)에서 검증하므로 검증 디렉토리는 언제든 `rm -rf` 가능.

코드 변경 롤백은 git branch 단위 권장 — Stage마다 `feat/stage-{N}` 브랜치를 따고, 통과 후 main에 merge.

**프로젝트 데이터 롤백:**
- Stage 7 이후: 사이드바 history 패널에서 페이지/커밋 단위로 직접 롤백.
- Stage 7 이전(또는 history 패널이 충분치 않을 때): 프로젝트 디렉토리에서 직접
  `git log` / `git checkout <hash> -- <path>` / `git revert <hash>`. 모든 ingest /
  modification 결과는 Stage 2부터 commit으로 저장돼 있으므로 데이터 손실은 없다.

## 부록 C — Part 2 진입 조건

Stage 7까지 통과하면 PLAN.md §10에 명시된 Part 2 (검색 — 질문 유형 기반 정적 배제)로 넘어갈 수 있다. Part 2는 별도 IDEA Part 2 / PLAN Part 2 문서를 따로 작성한 뒤 진행한다.

(Stage 6과 Stage 7은 다른 단계와 의존성이 없어 순서를 바꿔도 무방하지만, history UI는 Stage 3~5 검증 동안 "이 commit 봐도 돼?" 같은 부수적 확인을 도와주므로 일찍 들어와도 손해는 없다. 다만 plan 작성 시점에는 검증의 단순성을 위해 마지막에 두었다.)
