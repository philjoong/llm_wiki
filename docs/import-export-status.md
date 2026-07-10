# Import/Export Status

작성일: 2026-06-18

## 결론

`./schema/data_types`와 `./schema/question_types`는 현재 구현상 모든 프로젝트가 런타임에 직접 공유하는 전역 설정이라기보다는, 새 프로젝트 또는 일부 기존 프로젝트를 열 때 각 프로젝트 폴더로 복사되는 번들 기본 템플릿이다.

프로젝트 단위 import/export 관점에서 더 중요한 실제 설정 위치는 다음이다.

- `{projectPath}/question_types/`
- `{projectPath}/data_types/`

현재 export는 위 경로 중 `question_types/`, `data_types/`, `.llm-wiki/`를 프로젝트 zip에 포함한다. 따라서 이미 프로젝트 폴더 안에 복사된 schema 파일은 프로젝트 단위로 export/import된다.

다만 주의할 점이 있다. `openProject()`가 기존 프로젝트를 열 때 `seedDataTypes()`만 best-effort로 호출하고, `seedQuestionTypes()`는 호출하지 않는다. 즉 import 후 `openProject()` 단계에서 `data_types/`는 앱 번들 기본값으로 보강될 수 있지만, `question_types/`는 보강되지 않는다. 또한 export가 `.llm-wiki/` 전체를 포함하므로 앱 내부 상태까지 함께 이동할 수 있다.

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

따라서 `./schema/...`는 공통 기본값의 원본이고, 프로젝트별 실제 설정은 프로젝트 폴더 내부에 복제된 파일이다.

## 프로젝트 초기화 흐름

관련 파일:

- `src/lib/project-init.ts`
- `src/commands/fs.ts`
- `src-tauri/src/commands/project.rs`
- `src-tauri/src/commands/fs.rs`

흐름:

1. 새 프로젝트 폴더를 만든다.
2. 아래 시스템 디렉터리를 만든다.
   - `db/`
   - `pending/`
   - `counterexamples/`
   - `question_types/`
   - `data_types/`
3. 각 디렉터리에 `.gitkeep`을 만든다.
4. `seedQuestionTypes(projectPath)`를 호출해 `schema/question_types/*.yaml`을 `{projectPath}/question_types/`로 복사한다.
5. `seedDataTypes(projectPath)`를 호출해 `schema/data_types/*.yaml`을 `{projectPath}/data_types/`로 복사한다.
6. `.llm-wiki/graph-policy.json`에 기본 graph policy를 저장한다.
7. originals 관련 `.gitignore` 규칙을 준비한다.
8. `git init`을 수행한다.

이 경로로 생성된 프로젝트는 `question_types/`와 `data_types/`를 프로젝트 내부에 가진다.

## 프로젝트 열기 흐름

관련 파일:

- `src/commands/fs.ts`
- `src/App.tsx`

흐름:

1. Rust `open_project`가 대상 폴더가 존재하고 `db/`를 가진 프로젝트인지 검사한다.
2. `migrate_raw_sources(projectPath)`를 best-effort로 실행한다.
3. `seedDataTypes(projectPath)`를 best-effort로 실행한다.
4. 프로젝트 ID를 보장하고 recent project 정보를 갱신한다.
5. 앱 상태를 초기화하고 프로젝트 트리, review, chat, VC DB 등을 불러온다.

중요한 차이:

- 새 프로젝트 초기화는 `seedQuestionTypes`와 `seedDataTypes`를 모두 호출한다.
- 기존 프로젝트 열기는 현재 `seedDataTypes`만 호출한다.

그래서 오래된 프로젝트나 import된 zip에 `question_types/`가 없으면 자동 보강되지 않을 수 있다.

## question_types 로딩 방식

관련 파일:

- `src/lib/question-types.ts`

로드 경로: `{projectPath}/question_types/`

동작:

- `.yaml`, `.yml`, `.md`를 지원한다.
- 하드코딩된 question type 기본값은 없다.

즉 질문 유형은 현재 프로젝트 경로를 기준으로 읽는다. `./schema/question_types`를 직접 읽지는 않는다.

## data_types 로딩 방식

관련 파일:

- `src/lib/data-types.ts`

로드 경로: `{projectPath}/data_types/`

동작:

- `.yaml`, `.yml`를 지원한다.

data type도 현재 프로젝트 경로를 기준으로 읽는다. `./schema/data_types`를 직접 읽지는 않는다.

## Export 흐름

관련 파일:

- `src/commands/project-transfer.ts`
- `src-tauri/src/commands/fs.rs`

프론트엔드 흐름:

1. 사용자가 `.llmwiki` 저장 경로를 선택한다.
2. `loadGraphPolicy(projectPath)`로 프로젝트의 managed graph 목록을 읽는다.
3. `getGraphBackend(projectPath)`로 SQLite graph backend를 가져온다.
4. graph policy의 `managedGraphs`를 순회하며 각 graph snapshot을 export한다.
5. `{projectPath}/graphs.json`을 임시로 쓴다.
6. Rust `project_export(projectPath, destZipPath)`를 호출한다.
7. 성공/실패와 무관하게 임시 `graphs.json` 삭제를 시도한다.

Rust zip 포함 대상:

- `db/`
- `question_types/`
- `data_types/`
- `.llm-wiki/`
- `graphs.json`이 존재하면 추가 포함

포함되지 않는 대표 항목:

- 프로젝트 루트의 임의 파일
- `pending/`
- `counterexamples/`
- `raw/`, originals 계열이 `.llm-wiki/` 바깥에 있다면 해당 내용
- `.git/`
- `graph.json`

따라서 export는 프로젝트 전체 백업이라기보다는, 현재 Rust 함수가 명시한 일부 디렉터리와 graph snapshot을 담는 전송 포맷이다.

## Import 흐름

관련 파일:

- `src/commands/project-transfer.ts`
- `src-tauri/src/commands/fs.rs`
- `src/components/project/project-branch-selector.tsx`

프론트엔드 흐름:

1. 사용자가 `.llmwiki` 파일을 선택한다.
2. 사용자가 압축을 풀 대상 상위 폴더를 선택한다.
3. UI의 새 프로젝트 이름 입력값으로 `projectPath = {destFolder}/{newProjectName}`를 만든다.
4. Rust `project_import(zipPath, destFolder: projectPath)`를 호출한다.
5. `{projectPath}/graphs.json`을 읽어 graph snapshots를 복원한다.
6. 이미 같은 graph가 있으면 import를 건너뛴다.
7. import 함수는 새 프로젝트 경로를 반환한다.
8. 호출부가 `openProject(projectPath)`를 호출한다.

Rust import 동작:

- 대상 폴더를 만든다.
- zip entry를 순회하며 entry 이름 그대로 대상 폴더 아래에 파일/디렉터리를 생성한다.
- 기존 파일이 있으면 덮어쓴다.

주의:

- import 단계 자체는 프로젝트명과 내부 메타데이터를 재작성하지 않는다.
- `graphs.json`은 import 후 삭제하지 않는다.
- 이후 `openProject()`가 실행되므로 `data_types/`는 현재 앱 번들 기본값으로 보강될 수 있다.
- `question_types/`는 현재 `openProject()`에서 보강되지 않는다.

## 현재 우려점

1. `schema/...`는 전역 런타임 설정은 아니지만, 프로젝트 열기 시 `data_types`를 보강하므로 앱 버전에 따라 프로젝트에 새 기본 data type이 추가될 수 있다.
2. `question_types`와 `data_types`의 seed 정책이 다르다. 새 프로젝트는 둘 다 seed하지만, 기존 프로젝트 open은 `data_types`만 seed한다.
3. export가 `.llm-wiki/` 전체를 포함한다. 이 디렉터리에 queue, chat/review 상태, local-only 설정이 있으면 프로젝트 전송 파일에 같이 들어갈 수 있다.
4. import zip extraction은 entry 이름을 그대로 `dest.join(entry.name())`에 사용한다. 신뢰하지 않는 zip을 받을 가능성이 있다면 path traversal 방어가 필요하다.
5. export 대상이 명시 디렉터리로 제한되어 있어 프로젝트 폴더 전체를 기대하면 누락이 생길 수 있다.
6. import 후 graph 복원은 `graphs.json`이 없거나 파싱 실패하면 조용히 건너뛴다.
7. import 후 `graphs.json`이 프로젝트 루트에 남는다. export 때는 임시 파일로 삭제하지만 import 때는 삭제하지 않는다.

## 프로젝트 단위 import/export 기준의 판단

현재 구조는 "프로젝트 내부의 `question_types/`, `data_types/`를 export/import한다"는 점에서는 프로젝트 단위 요구에 맞는다.

하지만 "전역 기본 schema가 import된 프로젝트에 영향을 주면 안 된다"는 기준까지 엄격히 적용하면, 현재 `openProject()`의 `seedDataTypes()` 자동 실행은 재검토 대상이다. import된 zip에 `data_types/`가 없거나 일부 파일이 빠져 있으면 현재 앱 번들의 `schema/data_types`가 프로젝트에 추가될 수 있기 때문이다.

권장 방향:

- import/export의 authoritative source는 항상 프로젝트 내부 `question_types/`, `data_types/`로 둔다.
- `schema/...`는 새 프로젝트 생성 시에만 사용하는 기본 템플릿으로 제한한다.
- 기존 프로젝트 open 시 자동 seed가 필요하다면 `question_types`와 `data_types`를 같은 정책으로 맞추고, migration/upgrade 의도를 문서화하거나 사용자 확인을 받는다.
- `.llm-wiki/` 전체 export가 맞는지 검토하고, 전송해야 할 project-shared 파일과 앱 내부 상태를 분리한다.
