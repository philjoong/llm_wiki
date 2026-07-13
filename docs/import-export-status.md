# Import/Export Status

작성일: 2026-06-18
갱신일: 2026-07-13 (v2 프로젝트 포맷 반영)

## 결론

`./schema/data_types`와 `./schema/question_types`는 새 프로젝트를 만들 때만 각 프로젝트 폴더로 복사되는 번들 기본 템플릿이다. 기존 프로젝트를 열거나(`openProject`) import할 때는 더 이상 자동으로 seed되지 않는다.

프로젝트는 이제 `.llm-wiki/knowledge.sqlite`(지식 DB, authoritative)와 `.llm-wiki/tag-schema.yaml`을 핵심 상태로 하는 "v2" 포맷이다. Export/import는 이 v2 계약을 명시적으로 검증한다: 매니페스트 기반 체크섬 검증, 스키마 버전 검증, path traversal 방어, 원자적(staging → rename) import를 수행한다.

프로젝트 단위 import/export 관점에서 실제 설정 위치는 다음이다.

- `{projectPath}/question_types/`
- `{projectPath}/data_types/`
- `{projectPath}/db/`
- `{projectPath}/.llm-wiki/knowledge.sqlite`
- `{projectPath}/.llm-wiki/tag-schema.yaml`
- `{projectPath}/.llm-wiki/project.json`

Export는 위 항목만 zip에 포함한다. `.llm-wiki/` 전체가 아니라 `knowledge.sqlite`, `tag-schema.yaml`, `project.json` 세 파일만 명시적으로 포함하므로, queue나 UI 상태 같은 다른 `.llm-wiki/` 내부 파일은 함께 이동하지 않는다.

## schema 디렉터리의 역할

번들 리소스 설정:

- `src-tauri/tauri.windows.conf.json`
  - `../schema/question_types` -> `schema/question_types`
  - `../schema/data_types` -> `schema/data_types`

시드 명령:

- `src-tauri/src/commands/fs.rs`
  - `seed_question_types(project_path)`
  - `seed_data_types(project_path)`

동작:

1. 앱 리소스 디렉터리, 실행 파일 주변, 현재 작업 디렉터리에서 `schema/question_types` 또는 `schema/data_types`를 찾는다.
2. 대상 프로젝트의 `question_types/` 또는 `data_types/` 디렉터리를 만든다.
3. `.yaml`, `.yml` 파일만 복사한다.
4. 대상 파일이 이미 있으면 덮어쓰지 않는다.

호출 지점은 `src/lib/project-init.ts`의 `initProject()` 한 곳뿐이다. 즉 새 프로젝트 생성 시에만 실행되며, 프로젝트 열기(`openProject`)나 import 흐름에서는 호출되지 않는다.

따라서 `./schema/...`는 새 프로젝트 생성 시 공통 기본값의 원본이고, 프로젝트별 실제 설정은 프로젝트 폴더 내부에 복제된 파일이다.

## 프로젝트 초기화 흐름

관련 파일:

- `src/lib/project-init.ts`
- `src/commands/fs.ts`
- `src-tauri/src/commands/project.rs`
- `src-tauri/src/commands/fs.rs`

흐름 (`initProject`):

1. `recoverPendingIngests(projectPath)`로 남아있는 pending ingest를 복구한다.
2. 아래 시스템 디렉터리를 만든다.
   - `db/`
   - `pending/`
   - `question_types/`
   - `data_types/`
3. 각 디렉터리에 `.gitkeep`을 만든다.
4. `seedQuestionTypes(projectPath)`를 호출해 `schema/question_types/*.yaml`을 `{projectPath}/question_types/`로 복사한다.
5. `seedDataTypes(projectPath)`를 호출해 `schema/data_types/*.yaml`을 `{projectPath}/data_types/`로 복사한다.
6. `bootstrapKnowledgeDb(projectPath)`로 `.llm-wiki/knowledge.sqlite`를 생성한다.
7. 등록된 그래프가 없으면 기본 그래프(`main`)를 하나 등록한다.
8. `.llm-wiki/tag-schema.yaml`이 없으면 빈 namespace로 만든다.
9. originals 관련 `.gitignore` 규칙을 준비한다(`ensureOriginalsGitignore`).
10. `git init`을 수행한다.

`createProject`(Rust `create_project` + TS 래퍼)는 이보다 앞서 프로젝트 디렉터리와 `.llm-wiki/project.json`(project id)만 만든다. `initProject`는 그다음에 호출된다.

이 경로로 생성된 프로젝트는 `question_types/`, `data_types/`, `.llm-wiki/knowledge.sqlite`, `.llm-wiki/tag-schema.yaml`, `.llm-wiki/project.json`을 모두 프로젝트 내부에 가진다.

## 프로젝트 열기 흐름

관련 파일:

- `src/commands/fs.ts` (`openProject`)
- `src-tauri/src/commands/project.rs` (`open_project`)

Rust `open_project` 검증:

1. 대상 폴더가 존재하고 디렉터리인지 확인한다.
2. `db/` 디렉터리가 있는지 확인한다.
3. `.llm-wiki/knowledge.sqlite`가 파일로 존재하는지 확인한다. 없으면 `.llm-wiki/graph.sqlite`(legacy) 존재 여부로 이유를 구분해 v2 export를 복원하라는 에러를 낸다. 즉 legacy 프로젝트는 자동 업그레이드되지 않고 열기 자체가 거부된다.
4. `.llm-wiki/tag-schema.yaml`이 파일로 존재하는지 확인한다.

TS `openProject`(위 Rust 호출 이후):

5. `getKnowledgeDbStatus(projectPath)`를 호출한다.
6. `runKnowledgeIntegrityCheck(projectPath)`를 호출한다. integrity issue가 있으면 에러를 던지고 프로젝트를 열지 않는다.
7. `.llm-wiki/project.json`을 읽어 project id를 확인한다. 없거나 파싱 실패 시 "v2 project" 에러를 던진다.
8. `upsertProjectInfo(id, path, name)`으로 recent project 정보를 갱신한다.

중요한 변화 (이전 문서 대비):

- `openProject`는 더 이상 `seedDataTypes`나 `seedQuestionTypes`를 호출하지 않는다. 즉 기존 프로젝트를 열어도 번들 기본 data type/question type이 자동으로 추가되지 않는다.
- `migrate_raw_sources` best-effort 호출도 더 이상 열기 흐름에 없다. 이 커맨드는 `src-tauri/src/commands/migrate.rs`에 등록되어 있지만 TS 쪽 어디서도 호출하지 않는다(dead from the frontend).
- 대신 knowledge DB integrity check가 열기 시점의 게이트가 되었다.

그래서 오래된 프로젝트나 import된 zip에 `question_types/`, `data_types/`가 없어도 열기 시점에 자동 보강되지 않는다. 두 디렉터리 모두 없으면 그냥 빈 목록으로 로드된다(§ "question_types 로딩 방식", "data_types 로딩 방식" 참고).

## question_types 로딩 방식

관련 파일:

- `src/lib/question-types.ts`

로드 경로: `{projectPath}/question_types/`

동작:

- `.yaml`, `.yml`, `.md`를 지원한다.
- 하드코딩된 question type 기본값은 없다.
- 디렉터리가 없으면 빈 배열을 반환한다(예외를 삼킨다).

즉 질문 유형은 현재 프로젝트 경로를 기준으로 읽는다. `./schema/question_types`를 직접 읽지는 않는다.

## data_types 로딩 방식

관련 파일:

- `src/lib/data-types.ts`

로드 경로: `{projectPath}/data_types/`

동작:

- `.yaml`, `.yml`를 지원한다.
- 디렉터리가 없으면 빈 배열을 반환한다(예외를 삼킨다).

data type도 현재 프로젝트 경로를 기준으로 읽는다. `./schema/data_types`를 직접 읽지는 않는다.

## Export 흐름

관련 파일:

- `src/commands/project-transfer.ts` (`exportProject`)
- `src-tauri/src/commands/fs.rs` (`project_export`)

프론트엔드 흐름:

1. 사용자가 `.llmwiki` 저장 경로를 선택한다(`save()` 다이얼로그).
2. Rust `project_export(projectPath, destZipPath)`를 호출한다.

더 이상 graph policy/snapshot을 읽거나 임시 `graphs.json`을 쓰지 않는다. 프론트엔드는 저장 경로만 고르고 나머지는 전부 Rust 쪽에서 처리한다.

Rust `project_export` 사전 검증 (하나라도 실패하면 export 자체를 거부):

1. `.llm-wiki/knowledge.sqlite`가 없으면 에러.
2. `.llm-wiki/tag-schema.yaml`이 없으면 에러.
3. `.llm-wiki/transactions/`에 대기 중인 recovery 파일이 있으면 에러("recovery operations are pending").
4. `knowledge::db::open_project`로 DB를 열어 유효성(legacy 아님)을 검증한다.
5. `PRAGMA wal_checkpoint(FULL)` 후 `BEGIN IMMEDIATE`로 쓰기 락을 잡아, 파일 수집 중 다른 writer가 끼어들지 못하게 한다.
6. `knowledge::integrity::run`으로 무결성 검사를 수행한다. issue가 하나라도 있으면 export를 거부한다.

zip 포함 대상:

- `db/`, `question_types/`, `data_types/` 디렉터리 전체(하위 트리 포함)
- `.llm-wiki/knowledge.sqlite`
- `.llm-wiki/tag-schema.yaml`
- `.llm-wiki/project.json`
- `.llm-wiki/export-manifest.json` (export 시 새로 생성 — `format: "llm-wiki-v2"`, `schema_version`(`PRAGMA user_version`), 각 파일의 sha256 체크섬을 담는다)

포함되지 않는 대표 항목:

- 프로젝트 루트의 임의 파일
- `pending/`
- `.llm-wiki/` 안의 다른 파일(예: transactions, 캐시, 프로젝트 로컬 상태) — `knowledge.sqlite`, `tag-schema.yaml`, `project.json`만 명시적으로 포함되고 디렉터리 전체는 더 이상 포함되지 않는다
- `.git/`

symlink는 export 도중 발견되면 에러로 거부한다.

## Import 흐름

관련 파일:

- `src/commands/project-transfer.ts` (`importProject`)
- `src-tauri/src/commands/fs.rs` (`project_import`)
- `src/components/project/project-branch-selector.tsx`

프론트엔드 흐름:

1. 사용자가 `.llmwiki` 파일을 선택한다.
2. 사용자가 압축을 풀 대상 상위 폴더를 선택한다.
3. UI의 새 프로젝트 이름 입력값으로 `projectPath = {destFolder}/{newProjectName}`를 만든다.
4. Rust `project_import(zipPath, destFolder: projectPath)`를 호출한다.
5. 성공 시 새 프로젝트 경로를 반환한다.
6. 호출부(`project-branch-selector.tsx`)가 곧바로 `openProject(projectPath)`를 호출한다.

더 이상 `graphs.json` 복원 단계나 "이미 같은 graph면 건너뛴다" 로직이 없다. graph 상태는 `knowledge.sqlite` 안에 이미 들어있으므로 별도 복원이 필요 없다.

Rust `project_import` 동작:

1. `dest_folder`가 이미 존재하면 에러(덮어쓰지 않음).
2. `dest.with_extension("import-{uuid}")` 형태의 staging 디렉터리에 먼저 압축을 푼다.
3. zip entry 이름을 화이트리스트로 검증한다. 허용 목록: `.llm-wiki/export-manifest.json`, `.llm-wiki/`, `.llm-wiki/knowledge.sqlite`, `.llm-wiki/tag-schema.yaml`, `.llm-wiki/project.json`, 그리고 `db/`, `question_types/`, `data_types/` 하위 전부. 그 외 이름은 즉시 에러("Unsupported archive entry").
4. `entry.enclosed_name()`으로 경로를 정규화하고, 얻지 못하면("Unsafe archive entry") 에러. symlink entry도 거부.
5. 같은 이름의 entry가 중복되면 에러("Duplicate archive entry").
6. 압축 해제 후 `export-manifest.json`이 없으면 에러. `format`이 `"llm-wiki-v2"`가 아니면 에러.
7. manifest에 기록된 파일 개수/이름/sha256 체크섬이 실제 추출된 파일과 정확히 일치하는지 검증한다. 불일치 시 "checksum validation failed" 에러.
8. `.llm-wiki/knowledge.sqlite`, `.llm-wiki/tag-schema.yaml`이 없으면 각각 에러.
9. staging 안의 knowledge DB를 `knowledge::db::open_project`로 열어 유효성(legacy 아님)을 검증하고, `PRAGMA user_version`이 manifest의 `schema_version`과 일치하는지 확인한다.
10. 위 검증 중 하나라도 실패하면 staging 디렉터리를 삭제하고 에러를 반환한다. `dest_folder`는 생성되지 않는다.
11. 모두 성공하면 `fs::rename(staging, dest)`로 원자적으로 최종 위치에 설치한다.

주의:

- import 단계 자체는 프로젝트명과 내부 메타데이터(`project.json`)를 재작성하지 않는다. zip 안에 있던 `project.json`(원본 project id 포함)이 그대로 들어간다.
- import 후 `question_types/`, `data_types/`는 seed되지 않는다. zip에 들어있던 내용이 그대로 프로젝트의 전부다.
- import 실패 시 부분적으로 압축 해제된 상태가 최종 경로에 남지 않는다(staging에서만 실패하고 정리됨).