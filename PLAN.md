# PLAN.md — IDEA.md 구현 (Part 1: 2차 가공 산출물 생성)

이 문서는 IDEA.md의 Part 1을 LLM Wiki 코드 위에 얹어 구현하기 위한 계획이다.
원칙은 **재활용 우선**: 기존 모듈을 가능한 한 그대로 호출하고, 신규/수정 코드는
IDEA.md가 LLM Wiki와 다른 지점에만 도입한다.

---

## 0. 범위

**이 문서:** IDEA.md Part 1 — 1차 산출물(raw 파일별 중간 표현)을 schema.md가 정의한
도메인 트리로 분해/재배치하고, 사용자 수정 요청을 처리해 local git 저장소에
커밋하기까지.

**Part 2 (검색 — 질문 유형 기반 정적 배제):** 마지막 §10에 후속 마일스톤 개요만.
Part 1 산출물 형식이 안정되어야 배제 지도가 의미를 가지므로 순서를 분리.

**비범위:**
- 1차 가공(raw → 1차 산출물): IDEA.md가 명시적으로 범위 밖. 본 계획에서도
  `processed_1/`은 passthrough(원본 그대로 markdown화)로만 둔다.
- 검색 탐색 알고리즘: Part 2.
- 기존 LLM Wiki `wiki/` 프로젝트의 자동 마이그레이션.

---

## 1. 한눈에 보는 재활용 매핑

| IDEA Part 1 요구 | LLM Wiki 재활용 (그대로/거의 그대로) | 신규/확장 |
|---|---|---|
| §1.1 raw → 2차 산출물 파이프라인 | [src/lib/ingest.ts](src/lib/ingest.ts), [ingest-queue.ts](src/lib/ingest-queue.ts), [ingest-cache.ts](src/lib/ingest-cache.ts), [project-mutex.ts](src/lib/project-mutex.ts) | 분해/재배치 프롬프트 재작성 |
| §1.2 schema.md 기반 분해 | [src/lib/templates.ts](src/lib/templates.ts), [components/project/template-picker.tsx](src/components/project/template-picker.tsx) | game-dev 템플릿 신규, 자유 디렉토리 트리 |
| §1.3 schema.md의 역할 확장 | 기존 schema.md 컨셉 유지 | "Decomposition Rules", "Source Range Granularity" 섹션을 schema.md에 외부화 |
| §1.4 출처 추적 (raw section 단위) | [src/lib/sources-merge.ts](src/lib/sources-merge.ts) (frontmatter sources 병합) | `SourceRef = { file, range }` 로 확장 |
| §1.5 수정 요청 (허락/병합/거절 + 폐기/보류/반례) | [src/stores/review-store.ts](src/stores/review-store.ts), [src/lib/sweep-reviews.ts](src/lib/sweep-reviews.ts), [src/lib/review-utils.ts](src/lib/review-utils.ts), [components/review/](src/components/review/) | `ReviewItem` 확장 (stage, proposal), `modification-resolve.ts` 신규 |
| §1.6 local git 자동 커밋 | [src-tauri/src/commands/claude_cli.rs](src-tauri/src/commands/claude_cli.rs) — `tokio::process` + `which` subprocess 패턴 | `git_ops.rs` 신규 (git CLI subprocess) |
| §1.6 git 히스토리 / 롤백 UI | [src/components/review/review-view.tsx](src/components/review/review-view.tsx) 패널 골격, [icon-sidebar.tsx](src/components/layout/icon-sidebar.tsx) 진입점 | `git_ops.rs`에 `git_show`/`git_diff`/`git_checkout_path`/`git_revert` 확장 + `history-view.tsx` 신규 |
| §1.7 가공 흐름 = commit 단위 정렬 | [ingest-queue.ts](src/lib/ingest-queue.ts) 직렬 처리, [activity-panel.tsx](src/components/layout/activity-panel.tsx) | 큐 작업 1건 = git commit 1건 |
| 멀티-format raw 추출 | [src-tauri/src/commands/fs.rs](src-tauri/src/commands/fs.rs) (PDF/DOCX/PPTX/XLSX), [extension/](extension/) Chrome 클리퍼 | 그대로 |
| LLM provider 추상화 | [src/lib/llm-providers.ts](src/lib/llm-providers.ts), [llm-client.ts](src/lib/llm-client.ts), [claude-cli-transport.ts](src/lib/claude-cli-transport.ts) | 그대로 |
| 영속화/UI 골격 | [App.tsx](src/App.tsx), [components/layout/](src/components/layout/), Zustand stores, [persist.ts](src/lib/persist.ts) | 사이드바 라벨만 도메인 맞춤 |

요지: **약 80%는 호출/약간 수정으로 끝난다.** 신규 코드는 (a) 분해/재배치 프롬프트,
(b) `SourceRef` 확장, (c) modification 워크플로우, (d) git CLI 래퍼,
(e) pending/counterexample 저장소 — 5개 모듈에 집중된다.

---

## 2. 디렉토리 모델 (schema-driven)

LLM Wiki의 고정 카테고리(`wiki/entities/`, `wiki/concepts/`, `wiki/sources/`,
`wiki/queries/`, `wiki/synthesis/`, `wiki/comparisons/`)는 **버린다**. 2차 산출물 트리는
schema.md가 전적으로 결정한다.

```
my-project/
├── purpose.md
├── schema.md               # 디렉토리 트리 + 분해 규칙 + 출처 정책 정의
├── raw/sources/            # 1차 산출물의 원본 (그대로)
├── processed_1/            # 1차 산출물 — passthrough (Part 1 범위 밖)
├── db/                     # 2차 산출물 — schema.md가 정의한 도메인 트리
├── pending/                # 거절 후 보류 (§1.5)
├── counterexamples/        # 거절 후 반례 등록 (§1.5)
├── .git/                   # local git (§1.6)
└── .llm-wiki/              # 앱 설정, 채팅, review 큐 (그대로)
```

ingest 쓰기 sandbox는 `wiki/` 하드코딩을 풀고 `db/` / `pending/` /
`counterexamples/` / `processed_1/` 4개 prefix만 허용한다 ([ingest.ts:66](src/lib/ingest.ts#L66) `isSafeIngestPath`).

---

## 3. 게임 개발 예시 schema.md (M1에서 추가)

본문은 별도 파일로 분리되어 있다. **소스 오브 트루스:**
[schema/game-dev-example.md](schema/game-dev-example.md)

[src/lib/templates.ts](src/lib/templates.ts)에 `gameDevTemplate: WikiTemplate`을 추가하고
프로젝트 생성 시 default로 노출한다. `gameDevTemplate.schema` 본문은 위 파일의
§1~§10을 그대로 임베드한다(파일 변경 시 두 곳 동기화 — schema 파일 §11
체크리스트 참조).

요지:

- **11개 1단 디렉토리**: `game/`, `systems/`, `content/`, `world/`, `pvp/`,
  `policies/`, `balance/`, `ui_ux/`, `audio/`, `network/`, `data/`, `liveops/`,
  `qa/`, `build/`, `localization/`. 단순 카테고리(entity/concept)가 아닌
  **게임 개발 실무 도메인 축**.
- **분해 규칙 30+ 항목**: "스킬 1개 정의 → `db/content/skills/{skill_id}.md`",
  "스킬 시전 시스템 → `db/systems/skill/cast_system.md`" 같이 **시스템 룰 vs
  콘텐츠 인스턴스**를 분리.
- **Cross-cutting 규칙 (§3)**: 한 의미 단위가 여러 곳에 걸치면 primary 1개에만
  본문 + 다른 곳은 wikilink. 법적/규제 영향 시 `policies/`가 primary.
- **Frontmatter 필드**: `status` (draft/review/approved/deprecated), `owner`,
  `last_validated_at` (Part 2 신선도용), `sources[].confidence` (high/medium/low).
- **Source range 표기 9종**: DOCX/PDF section path, XLSX `Sheet!Range`, Confluence
  URL+anchor, 회의록 `날짜 > 안건`, Slack `채널 > 시각`, Jira `티켓 > comment#N`,
  Figma `frame=`, 음성 회의 `MM:SS-MM:SS` 등.
- **Update conflict policy**: 자동 덮어쓰기 금지 항목 8종, 자동 append 허용 항목
  5종을 명시 — modification review 발생 조건이 schema에 외부화됨.
- **명명 규칙**: 패치 id, 시즌 id, 보스 id, 스킬 id, 아이템 id의 식별자 컨벤션.

---

## 4. 마일스톤

각 마일스톤은 (a) 재활용 / (b) 수정 / (c) 신규 / (d) 검증의 4섹션으로 정리한다.
큐 1작업 = git commit 1건이 되도록 정렬한다.

### M1. schema-driven 디렉토리 모델 + game-dev 템플릿

(a) **재활용**
- [src/lib/templates.ts](src/lib/templates.ts) `WikiTemplate` 인터페이스, `extraDirs` 부트스트랩 패턴.
- [src/components/project/template-picker.tsx](src/components/project/template-picker.tsx), [create-project-dialog.tsx](src/components/project/create-project-dialog.tsx) — 신규 템플릿 자동 노출.
- [src/lib/project-store.ts](src/lib/project-store.ts), [project-identity.ts](src/lib/project-identity.ts).

(b) **수정**
- [src/lib/ingest.ts:66](src/lib/ingest.ts#L66) `isSafeIngestPath()` — `wiki/` 하드코딩 제거,
  허용 prefix를 `db/` / `processed_1/` / `pending/` / `counterexamples/` 로 교체.
- [src/lib/templates.ts](src/lib/templates.ts) — game-dev를 default 시나리오로 우선순위 변경.

(c) **신규**
- [src/lib/templates.ts](src/lib/templates.ts) — `gameDevTemplate: WikiTemplate`. `schema` 필드는 [schema/game-dev-example.md](schema/game-dev-example.md) §1~§10을 임베드. `extraDirs`는 같은 파일 §1 디렉토리 트리 1단/2단을 부트스트랩.
- `src/lib/project-init.ts` — 프로젝트 생성 시 `processed_1/`, `db/`, `pending/`, `counterexamples/` 디렉토리 생성 + `git init` (M4 의존). [src/lib/templates.ts](src/lib/templates.ts) `extraDirs` 부트스트랩 흐름을 그대로 따라간다.

(d) **검증**
- `templates.test.ts`에 game-dev 템플릿이 위 디렉토리 트리/분해 규칙/frontmatter 섹션을 포함하는지 확인하는 케이스 추가.
- 신규 프로젝트 생성 시 `db/`가 비어 있고 `schema.md`가 game-dev 본문으로 채워지는지 수동 확인.

### M2. 분해/재배치 ingest 프롬프트 재작성 + SourceRef

(a) **재활용**
- [src/lib/ingest-queue.ts](src/lib/ingest-queue.ts), [ingest-cache.ts](src/lib/ingest-cache.ts), [project-mutex.ts](src/lib/project-mutex.ts) — 큐/SHA256 캐시/락 그대로.
- [src/lib/ingest.ts:111](src/lib/ingest.ts#L111) `parseFileBlocks()` — FILE block 파서 그대로 (CRLF/fence/path-traversal 방어 무료로 얻음).
- [src/lib/sources-merge.ts](src/lib/sources-merge.ts) — `mergeSourcesIntoContent` 진입점 유지하고 내부만 SourceRef로 교체.
- [src/commands/fs.ts](src/commands/fs.ts), [src-tauri/src/commands/fs.rs](src-tauri/src/commands/fs.rs) — 멀티 포맷 추출 그대로.

(b) **수정**
- [src/lib/ingest.ts:678](src/lib/ingest.ts#L678) `buildAnalysisPrompt()` / [ingest.ts:728](src/lib/ingest.ts#L728) `buildGenerationPrompt()`:
  - entities/concepts/queries 출력 지침 제거.
  - analysis 단계 출력: "이 raw 파일은 schema.md의 어느 단위로 분해되는가" 목록 (제안 path + 의미 요약 + raw range).
  - generation 단계 출력: `---FILE: db/.../foo.md---` ~ `---END FILE---` 블록. 각 페이지 frontmatter `sources`에 `file` + `range` 필수.
  - schema.md 전문을 컨텍스트로 주입(현재는 부분만 주입됨).
- [src/lib/sources-merge.ts](src/lib/sources-merge.ts) `parseSources` / `writeSources` / `mergeSourcesLists` — 시그니처를 `string[]` → `SourceRef[]`로 확장.
  ```ts
  type SourceRef = { file: string; range?: string }
  ```
  기존 `["filename.md"]` 입력은 `[{ file: "filename.md" }]`로 받아주는 마이그레이션 보조.

(c) **신규**
- `src/lib/processed1.ts` — passthrough만: raw 파일을 fs.rs 추출 결과 텍스트로 `processed_1/<original_name>.md`에 떨어뜨림. 1차 가공 알고리즘이 들어올 자리를 코드에 명시적으로 비워둔다.
- `src/lib/source-ref.ts` — `SourceRef` 타입 + 직렬화/역직렬화 (`file: a.docx > section 3.2` 형태와 YAML list 형태 둘 다 지원).

(d) **검증**
- [src/lib/ingest.scenarios.test.ts](src/lib/ingest.scenarios.test.ts)에 game-dev 시나리오 추가: 가짜 `instance_server_design.md`(4개 의미 단위 섞임) → 4개 FILE block(server_structure, dungeon_a/entry_rules, dungeon_a/rewards, dungeon_b/spawn_rules) 출력 검증.
- `sources-merge.test.ts`에 `SourceRef` round-trip + 구버전 호환 케이스 추가.
- `ingest.gamedev.real-llm.test.ts` — 실제 LLM 호출 시나리오 ([ingest.real-llm.test.ts](src/lib/ingest.real-llm.test.ts) 패턴).

### M3. 수정 요청 워크플로우 확장 (허락/병합/거절 + 폐기/보류/반례)

(a) **재활용**
- [src/stores/review-store.ts:51](src/stores/review-store.ts#L51) `addItems` dedup/merge 로직 — 그대로.
- [src/lib/sweep-reviews.ts](src/lib/sweep-reviews.ts) — 자동 해결 sweep 골격 그대로. `modification` type만 자동 해결 대상에서 제외.
- [src/components/review/review-view.tsx](src/components/review/review-view.tsx) — 카드 UI 골격 재활용.
- [review-utils.ts](src/lib/review-utils.ts) `normalizeReviewTitle()` 그대로.

(b) **수정**
- [src/stores/review-store.ts:9](src/stores/review-store.ts#L9) `ReviewItem` 확장:
  ```ts
  type: "contradiction" | "duplicate" | "missing-page" | "confirm" | "suggestion"
      | "modification"   // §1.5 핵심 — 기존 vs 신규 충돌
  stage: "primary" | "rejection-handling"  // 거절 후 2단계 트리
  proposal?: {
    targetPath: string
    existingExcerpt: string
    incomingExcerpt: string
    incomingDraftPath: string  // pending/_proposals/<id>.md
    sourceRefs: SourceRef[]
  }
  // options: primary 단계 = ["Approve","Merge","Reject"]
  //          rejection-handling 단계 = ["Discard","Pending","Counterexample"]
  ```
- [src/lib/ingest.ts](src/lib/ingest.ts) — 분해 결과가 기존 파일과 충돌하면 자동 덮어쓰기 금지. 신규 콘텐츠를 `pending/_proposals/<id>.md`에 저장하고 `modification` review item 큐잉.
- [src/lib/sweep-reviews.ts](src/lib/sweep-reviews.ts) — `modification` type은 자동 해결 시도 X.
- [src/components/review/review-view.tsx](src/components/review/review-view.tsx) — `modification` 카드에 diff view 컴포넌트, primary 3-옵션, Reject 클릭 시 같은 카드에서 stage 전환 후 3-옵션 노출.

(c) **신규**
- `src/lib/modification-resolve.ts` — 액션별 효과:
  - `Approve` → `pending/_proposals/<id>.md` 내용을 `db/.../target.md`로 교체 + `mergeSourcesIntoContent` 호출 + git commit (M4).
  - `Merge` → 임시 머지 파일을 에디터에서 열기. 저장 시 commit.
  - `Reject` → review의 stage를 `rejection-handling`로 전환 (파일 변경 X).
  - `Discard` → `pending/_proposals/<id>.md` 삭제 + 거절 사유를 `.llm-wiki/rejection-log.jsonl`에 append. 다음 ingest에서 같은 raw range가 다시 들어와도 같은 결정이 반복되지 않도록 컨텍스트로 주입.
  - `Pending` → `pending/_proposals/<id>.md` → `pending/<targetPath_slug>.md` 이동.
  - `Counterexample` → `counterexamples/<targetPath_slug>.md` 이동 + 메타에 "기존이 맞음, 신규는 반례" 기록.
- 모든 액션은 git commit 트리거.

(d) **검증**
- [review-store.test.ts](src/stores/review-store.test.ts) 확장: stage 전환, options 시나리오.
- `modification-resolve.test.ts` — 6개 액션 각각의 파일/git 부수효과.
- [sweep-reviews.scenarios.test.ts](src/lib/sweep-reviews.scenarios.test.ts) — modification은 자동 해결 안 함 시나리오.

### M4. local git 자동 커밋 (CLI subprocess)

(a) **재활용**
- [src-tauri/src/commands/claude_cli.rs](src-tauri/src/commands/claude_cli.rs) — `tokio::process::Command` + `which::which("claude")` + 에러 핸들링 패턴을 거의 그대로 복제 ("claude" → "git").
- [src/lib/project-mutex.ts](src/lib/project-mutex.ts) — git 작업도 같은 락 안에서 직렬화.
- `Cargo.toml`의 `tokio`/`which` 의존성 — 이미 있음, 추가 X.

(b) **수정**
- [src-tauri/src/commands/mod.rs](src-tauri/src/commands/mod.rs), [src-tauri/src/lib.rs](src-tauri/src/lib.rs) — 신규 git 커맨드 등록.
- [src-tauri/capabilities/default.json](src-tauri/capabilities/default.json) — claude_cli와 동일 패턴이라 추가 권한 거의 불필요(검토만).

(c) **신규**
- `src-tauri/src/commands/git_ops.rs` — Tauri command:
  - `git_init(project_path)` — `.git`이 없으면 `git init` + 초기 commit (`schema.md`, `purpose.md`, 빈 `db/.gitkeep`).
  - `git_commit(project_path, message, paths)` — `git add <paths> && git commit -m <msg>`. 변경 없으면 no-op (`--allow-empty` 사용 X).
  - `git_status(project_path)` — porcelain v2 파싱.
  - `git_log(project_path, limit)` — UI history 패널용.
  - `which("git")` 실패 시 user-friendly 에러 (claude_cli.rs 메시지 톤 그대로).
- `src/commands/git.ts` — frontend 래퍼.
- `src/lib/auto-commit.ts` — ingest/modification 단위에서 호출하는 helper. Commit message 포맷:
  ```
  ingest: <source_filename> → 4 pages

  - db/systems/instance_server/server_structure.md (new)
  - db/systems/instance_server/dungeon/dungeon_a/entry_rules.md (new)
  - ...

  Source: instance_server_design.docx
  ```
  modification:
  ```
  modification: approve <targetPath>

  Source: <raw>:<range>
  Resolved-by: <action>
  ```

(d) **검증**
- 통합 테스트: tmp 디렉토리에서 init → 파일 생성 → commit → log 한 사이클.
- `auto-commit.test.ts`: ingest writtenPaths가 비어 있으면 commit 호출 X.
- 수동: 가공 1회 후 `git log` / `git diff HEAD~1`로 IDEA §1.6의 "익숙한 git 도구로 검토" 흐름 동작.

### M5. pending / counterexamples 저장소 + 컨텍스트 주입

(a) **재활용**
- [src/lib/ingest.ts](src/lib/ingest.ts) `buildAnalysisPrompt`의 컨텍스트 주입 패턴 (purpose, index).
- [src/lib/wiki-graph.ts](src/lib/wiki-graph.ts) 트리 walk — counterexample 인덱싱에 재활용 가능.

(b) **수정**
- `buildAnalysisPrompt()` — schema.md, purpose.md 외에 `counterexamples/` 인덱스 + `.llm-wiki/rejection-log.jsonl` 요약을 컨텍스트로 추가. 지시: "다음 신규 내용이 들어오면 반례/거절 기록을 우선 적용하라."
- `pending/`은 LLM 컨텍스트에 넣지 않는다(사람 검토 대기 상태). 사이드바에서만 표시.

(c) **신규**
- `src/components/review/pending-view.tsx` — `pending/` 디렉토리 리스트, `Re-review` 액션, 만료 정책 UI.
- `src/lib/counterexample-index.ts` — `counterexamples/` 메타 인덱싱 + 유사도 매칭 (단순 파일명/타이틀 기반으로 시작, 임베딩 강화는 Part 2에서).

(d) **검증**
- 시나리오 테스트: 거절-반례 등록된 항목이 다음 ingest에서 동일 raw range 입력 시 LLM 컨텍스트에 반례가 주입되어, 같은 신규 내용이 review로 다시 올라오지 않거나 자동 dismiss.

### M6. git 히스토리 뷰어 + 페이지/커밋 단위 롤백 UI

IDEA §1.6의 "익숙한 git 도구로 검토" 흐름을 앱 안에서도 직접 지원한다. M4에서
`git_log` / `git_status`는 백엔드에 들어와 있지만 frontend에서는 호출되지 않는다 —
사용자가 commit 히스토리를 보거나 특정 시점으로 되돌리려면 터미널을 열어야
한다. M6은 그 갭을 메운다.

(a) **재활용**
- [src-tauri/src/commands/git_ops.rs](src-tauri/src/commands/git_ops.rs) — M4의
  `git_log` / `git_status` 그대로. 신규 명령은 같은 `tokio::process` 패턴으로 추가.
- [src/components/review/review-view.tsx](src/components/review/review-view.tsx) /
  [activity-panel.tsx](src/components/layout/activity-panel.tsx) — 패널 레이아웃과
  목록/상세 분리 패턴.
- [src/components/layout/icon-sidebar.tsx](src/components/layout/icon-sidebar.tsx) —
  사이드바 아이콘 + `setActiveView` 진입 패턴.
- [src/i18n/](src/i18n/) — 라벨은 i18n key로.

(b) **수정**
- [src-tauri/src/commands/git_ops.rs](src-tauri/src/commands/git_ops.rs) 확장:
  - `git_show(project_path, hash)` — `git show --stat --format=...` 파싱해서
    `{hash, author, date, message, files[{path, status, additions, deletions}]}` 반환.
  - `git_diff(project_path, ref_a, ref_b, path?)` — 두 ref 사이 unified diff
    텍스트 (특정 파일만 또는 전체). UI는 이 텍스트를 split-view로 렌더.
  - `git_checkout_path(project_path, hash, paths[])` — `git checkout <hash> -- <paths>`.
    파일 단위 "이 시점으로 복원" 액션의 백엔드. working tree만 갱신; 새 commit은
    M4의 `git_commit`을 frontend에서 별도 호출해 만든다.
  - `git_revert(project_path, hash)` — `git revert --no-edit <hash>`.
    충돌 발생 시 conflict 상태를 그대로 반환해 UI가 사용자에게 알려주도록.
- [src/commands/git.ts](src/commands/git.ts) — frontend 래퍼 4개 추가.
- [src/components/layout/icon-sidebar.tsx](src/components/layout/icon-sidebar.tsx) —
  history 아이콘 추가 (예: `Clock` / `History`).
- [src/i18n/en.json](src/i18n/en.json), [zh.json](src/i18n/zh.json) — `history.*` 키 추가
  (Stage 6 이후 진행이므로 `ko.json`도 동시 갱신).

(c) **신규**
- `src/components/history/history-view.tsx` — 우측 패널.
  - 좌: commit 목록 (시간순, 페이지네이션). 각 항목 = subject + author + relative date.
  - 우: 선택된 commit의 metadata + 변경 파일 목록 + 파일 클릭 시 diff.
  - 페이지(파일) 카드의 액션: **"이 버전으로 복원"** → `git_checkout_path` 후
    `git_commit`("revert: restore <path> to <hash>") 1건 자동 발생.
  - commit 카드의 액션: **"이 커밋 되돌리기"** → `git_revert`. 충돌 시 alert.
- `src/lib/git-history.ts` — 페이지네이션, diff 캐싱, 액션 commit 메시지 포맷
  같은 history 뷰 전용 비동기 헬퍼.

(d) **검증**
- Rust 통합 테스트 ([git_ops.rs](src-tauri/src/commands/git_ops.rs)): tmp repo에서
  init → 2개 commit → `git_show`(HEAD) 응답 shape, `git_diff`(HEAD~1..HEAD) 텍스트
  포함, `git_checkout_path`로 직전 버전 복원, `git_revert`로 새 revert commit 생성.
- 시나리오: ingest 1회 → history 패널에 ingest commit 1건 + initial commit 1건.
  특정 db/ 페이지 "복원" → 파일 내용이 직전 버전으로 돌아오고 새 revert commit 1건.
- 수동: 게임 도메인 시나리오에서 dungeon_a 보상 변경 → modification approve 후
  결과가 마음에 안 들면 history에서 직전 commit으로 "되돌리기" → 파일이 원래대로.

---

## 5. UI 라벨 매핑 (작업량 적음)

[src/components/layout/icon-sidebar.tsx](src/components/layout/icon-sidebar.tsx), [src/i18n/en.json](src/i18n/en.json) + 한국어 i18n 신규:

| 기존 | 변경 |
|---|---|
| Wiki | DB |
| Sources | Raw |
| Review | 수정 요청 |
| Lint | 그대로 (Part 2에서 신선도와 결합) |
| Graph | Part 1에서 숨김. Part 2에서 부활. |

`src/i18n/ko.json` 신규 추가 (현재 en/zh만).

---

## 6. 의도적으로 안 하는 것 (Part 1)

- 1차 가공 알고리즘 — `processed1.ts`는 passthrough만.
- 검색 — Part 2.
- Knowledge Graph 시각화 — Part 1 산출물 안정화 후.
- 임베딩 — Part 2 RRF에서 다시 등장.
- Deep Research — Part 1 끝난 뒤 게임 도메인 필요성 재평가.
- 기존 LLM Wiki entities/concepts/queries 페이지 타입을 게임 도메인에 억지 매핑.

---

## 7. 마이그레이션 / 호환성

기존 LLM Wiki `wiki/` 트리 프로젝트는 **마이그레이션하지 않는다** (이 fork의 첫
릴리스 기준). game-dev 템플릿으로 새 프로젝트를 만드는 흐름이 1순위. 기존
5개 템플릿(research/reading/personal-growth/business/general)은 코드에 남기되
default가 game-dev가 되도록 우선순위만 변경.

---

## 8. PR 단위 작업 순서

| PR | 마일스톤 | 의존 | 규모 |
|---|---|---|---|
| PR-1 | M1 (schema-driven + game-dev 템플릿) | 없음 | S |
| PR-2 | M4 git CLI 백엔드만 (UI 미연결) | M1 | M |
| PR-3 | M2 분해/재배치 프롬프트 + SourceRef | M1 | L |
| PR-4 | M3 ReviewItem 확장 + modification-resolve | M2, M4 | L |
| PR-5 | M5 pending/counterexample + 컨텍스트 주입 | M3 | M |
| PR-6 | UI 라벨 + ko 번역 | 무관 (병행 가능) | S |
| PR-7 | M6 git 히스토리 뷰어 + 롤백 UI | M4 (백엔드 명령 확장) | M |

PR-2를 PR-3보다 먼저 두는 이유: M3에서 modification 액션마다 git commit을
호출하므로 git 기반이 먼저 안정되어 있어야 한다.

PR-7(M6)을 마지막에 두는 이유: history 뷰어는 다른 단계의 기능을 수정하지 않고
**조회/복원** 기능만 추가하므로 의존성이 없는 마지막 단계가 자연스럽다. M3의
modification 흐름 또한 history 뷰어 없이 동작하며 (사용자가 commit한 결과를 본인의
git 도구로 검토 가능), M6은 그 검토를 앱 내장으로 끌어오는 사용성 보강 단계다.

---

## 9. Part 1 완료 정의 (수동 시나리오)

다음 흐름이 한 번에 돌면 Part 1 완료:

1. game-dev 템플릿으로 새 프로젝트 생성 → `git init` 자동 + initial commit.
2. `instance_server_design.md` (4개 의미 단위 섞인 가짜 raw) 업로드.
3. ingest 큐가 raw → processed_1 → 4개 FILE block을 schema.md가 정의한 path에 작성.
4. 각 페이지 frontmatter `sources`에 `file:..., range:...` 들어감.
5. 자동 commit 1건 발생 (`git log` 확인).
6. dungeon_a 보상 변경된 v2 업로드 → `modification` review 1건 발생.
7. UI에서 Approve → 파일 갱신 + commit. Reject → Discard/Pending/Counterexample 3-옵션 노출.
8. Counterexample 등록 후 동일 v2 재업로드 → review 자동 억제(또는 LLM이 dismiss).
9. 사이드바 history 패널 진입 → ingest commit + modification commit 목록이 시간순으로 보임. 특정 db/ 페이지 카드에서 "이 버전으로 복원" → 파일이 직전 commit 시점으로 돌아오고 새 revert commit 1건 자동 발생. 결과가 의도치 않으면 동일하게 한 번 더 복원해 원상복귀.

---

## 10. Part 2 후속 마일스톤 개요 (메모, 비범위)

Part 2(검색 — 질문 유형 기반 정적 배제) 시 재활용 지도:

- §2.1~2.2 검색 기본 모델: 신규 `src/lib/exclude-search.ts` (진입점만 새로 짜고,
  후보 좁힌 뒤의 탐색은 [search.ts](src/lib/search.ts) RRF + [embedding.ts](src/lib/embedding.ts) vector + [graph-relevance.ts](src/lib/graph-relevance.ts) 2-hop을 그대로 호출).
- §2.3 question_types: schema.md 옆 `question_types/<type>.md`. [templates.ts](src/lib/templates.ts) 패턴으로 game-dev 기본 12개 유형 부트스트랩.
- §2.4~2.7 정적 배제 지도: `exclusions/by_question_type/<type>.md`, `exclusions/axioms/`, `exclusions/instances/`. glob 매칭은 [path-utils.ts](src/lib/path-utils.ts) 재활용.
- §2.6 Level 1→2→3 승격: [review-store](src/stores/review-store.ts) dedup/merge + [sweep-reviews](src/lib/sweep-reviews.ts) 자동 분류 패턴 재활용. 승격은 자동 X — 사람 승인 review item.
- §2.8 신선도/무효화: [lint.ts](src/lib/lint.ts) 확장. `last_validated_at` 필드 lint 룰 추가.
- §2.9 배제 추적 출력: [chat-message.tsx](src/components/chat/chat-message.tsx)의 think/citation collapsible 패턴 재활용 — "47개 중 21개 배제 근거"를 collapsible로 노출.
- 모든 배제 지도/유형 파일은 git 안 — Part 1 auto-commit 흐름 그대로 활용.
