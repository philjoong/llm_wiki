# 앱 시작 ~ 메인 화면 동작 가이드

## 전체 흐름 요약

```
Tauri 백엔드 초기화
  → React 마운트 + 설정 로드
  → ProjectBranchSelector (브랜치 선택 화면)
  → 폴더 피커 (로컬 폴더 연결)
  → 프로젝트 초기화 또는 Remote 동기화
  → 프로젝트 상태 로드
  → AppLayout (메인 화면)
```

---

## 1. Tauri 백엔드 초기화

**진입점:** `src-tauri/src/main.rs` → `llm_wiki_lib::run()`  
**설정:** `src-tauri/src/lib.rs`

- 클립 서버 데몬 백그라운드 시작 (`clip_server::start_clip_server()`)
- Tauri 플러그인 등록: dialog, store, http, opener
- 윈도우 타이틀 설정, CLI 서브프로세스 레지스트리 생성 (Claude, Codex, Gemini)
- Rust 커맨드 등록: 파일 I/O, git 조작, 프로젝트 생성/오픈, 그래프 DB 등
- 윈도우 닫기 이벤트 핸들러: `tauri://close-requested` 이벤트 발행 (macOS는 hide)

---

## 2. React 마운트 + 설정 로드

**파일:** `src/App.tsx`

### 렌더링 조건 분기

```
loading === true              → "Loading..." 표시
loading === false
  selectedBranch === null     → <ProjectBranchSelector />
  selectedBranch !== null
    project === null          → null (폴더 피커 대기 중)
    project !== null          → <AppLayout />
```

### 마운트 시 즉시 실행

1. `setupAutoSave()` — 프로젝트 변경 감지 후 자동 저장
2. `startClipWatcher()` — 클립보드 감시 (웹 클리퍼 연동)
3. `tauri://close-requested` 리스너 등록:
   - 프로젝트가 열려있으면 → `SyncOnExitDialog` 표시
   - 아니면 → 바로 창 종료

### 설정 로드 (app-state.json)

다음 순서로 퍼시스턴스에서 읽어 Zustand 스토어에 적용:

| 키 | 대상 |
|---|---|
| `llmConfig` | LLM 모델/파라미터 설정 |
| `providerConfigs` | 프리셋별 API 키, 엔드포인트 |
| `activePresetId` | 활성 프리셋 (기본값 재계산 후 저장) |
| `embeddingConfig` | RAG 임베딩 설정 |
| `outputLanguage` | 응답 언어 (기본: "auto") |
| `language` | UI 언어 → `i18n.changeLanguage()` 호출 |

로드 완료 후 `loading = false` → 다음 단계로 진행.

---

## 3. ProjectBranchSelector 화면

**파일:** `src/components/project/project-branch-selector.tsx`  
**조건:** `selectedBranch === null`

### 초기 로드

1. `loadGitRemoteUrl()` → 캐시된 Remote URL 복원 (없으면 `VITE_GIT_REPO_URL` env)
2. `fetchAll(remoteUrl)` 실행:
   - `gitLsRemote(repoUrl)` — Remote 브랜치 목록 조회
   - `getRecentProjects()` — 로컬에 열었던 프로젝트 목록 조회
   - Remote에 없는 로컬 프로젝트 → `localOnly: true` 로 분류
   - 결과: Remote 브랜치 + Local Only 항목 합산 표시

### 항목 아이콘

- `GitBranch` — Remote에 존재하는 브랜치
- `HardDrive` — Local Only 프로젝트

### 사용자 액션

| 액션 | 동작 |
|---|---|
| 브랜치 클릭 | `setSelectedBranch(branch)` + `saveSelectedBranch(branch)` |
| 새 브랜치 이름 입력 후 Create | 동일 (브랜치 선택과 같은 경로) |
| Remote URL 입력 후 Refresh | URL 저장 후 목록 재조회 |
| Local Only 항목 Upload | Remote에 push (gitRemoteAdd → gitCreateBranch → gitPush) |
| Local Only 항목 삭제(Trash) | `removeFromRecentProjects(path)` → 목록에서 즉시 제거 |

`selectedBranch`가 세팅되면 `App.tsx`의 useEffect가 트리거됨.

---

## 4. 폴더 자동 연결 (branch-auto-resolve)

**파일:** `src/App.tsx` — `autoResolveFolder()` useEffect  
**조건:** `selectedBranch !== null && project === null`

1. `loadBranchFolderMapping(selectedBranch)` — 이전에 연결한 로컬 폴더 경로 조회
   - 경로 있음 → `openOrSyncFolder(mappedPath, branch)` 시도
   - 실패하면 폴더 피커로 폴더백
2. 매핑 없음 또는 실패 → Tauri 폴더 피커 다이얼로그
   - 사용자가 폴더 선택 → `openOrSyncFolder(selected, branch)`

---

## 5. openOrSyncFolder — 프로젝트 열기/초기화

**파일:** `src/App.tsx` — `openOrSyncFolder(folderPath, branch)`

### Step 1: 기존 프로젝트 오픈 시도

```
openProject(folderPath)  [Tauri 커맨드]
  → .llm-wiki/project.json 검증
  → 마이그레이션 (migrate_raw_sources, idempotent)
  → ensureProjectId()
  → WikiProject 반환
```

성공 → `handleProjectOpened(proj)` 호출 → 완료

### Step 2: Remote URL 확인

```
repoBaseUrl = loadGitRemoteUrl() || env.VITE_GIT_REPO_URL || ""
```

### Step 3a: Local Only 초기화 (Remote URL 없음 또는 브랜치가 Remote에 없음)

Remote URL이 없거나, URL이 있어도 `gitLsRemote`로 조회한 결과 해당 브랜치가 remote에 존재하지 않으면 로컬 초기화로 진행한다.

```
initProject({ projectPath })  [src/lib/project-init.ts]
  → db/, pending/, counterexamples/, question_types/ 디렉토리 생성
  → 각 디렉토리에 .gitkeep
  → saveGraphPolicy(path, DEFAULT_POLICY)
  → ensureOriginalsGitignore(path)
  → gitInit(path)  ← git 저장소 초기화

  → openProject(path)
  → handleProjectOpened(proj)
```

### Step 3b: Remote 동기화 (Remote URL 있고 브랜치가 Remote에 존재)

```
gitLsRemote(remoteUrl)  ← 브랜치 존재 여부 확인
gitSetupFromRemote(folderPath, remoteUrl, branch)  [Tauri 커맨드]
  → git init (기본 브랜치 main)
  → git remote add origin <url>
  → git fetch origin <branch>
  → git checkout -b <branch> origin/<branch>

  → openProject(path)
  → handleProjectOpened(proj)
```

실패 시 `window.alert`으로 에러 표시, `false` 반환.

---

## 6. handleProjectOpened — 프로젝트 상태 로드

**파일:** `src/App.tsx` — `handleProjectOpened(proj)`

순서대로 실행 (모두 await):

1. **상태 초기화** `resetProjectState()`:
   - 채팅/리뷰/액티비티 스토어 클리어
   - Ingest 큐 일시 정지 + 디스크 플러시
   - 그래프 캐시 클리어

2. **프로젝트 상태 세팅**:
   - `setProject(proj)` / `setSelectedFile(null)` / `setActiveView("wiki")`
   - `setIsLocalOnly(!remoteUrl)`
   - `bumpDataVersion()` — 캐시 무효화
   - `saveLastProject(proj)` / `saveBranchFolderMapping(branch, path)`

3. **Ingest 큐 복원** `restoreQueue(proj.id, proj.path)`:
   - 중단된 인제스트 작업 재개 (비동기, fire-and-forget)

4. **클립 서버 알림**:
   - `POST http://127.0.0.1:19827/project` — 현재 프로젝트 경로 전달
   - `POST http://127.0.0.1:19827/projects` — 전체 프로젝트 목록 전달

5. **파일 트리 로드** `listDirectory(proj.path)`:
   - 프로젝트 폴더 재귀 탐색 → `setFileTree(tree)`

6. **버전 관리 초기화**:
   - `vcDbInit(proj.path)` — SQLite 스냅샷 DB 초기화
   - `gitRemoteAdd(path, "origin", remoteUrl)` — idempotent
   - `gitPull(path, "origin", branch)` — 최신 변경사항 pull (Local Only면 무시)

7. **리뷰 데이터 복원** `loadReviewItems(proj.path)` → 리뷰 스토어

8. **채팅 히스토리 복원** `loadChatHistory(proj.path)`:
   - 대화 목록 + 메시지 로드
   - 가장 최근 대화를 활성으로 설정

완료 → `project !== null` → `AppLayout` 렌더링

---

## 7. AppLayout — 메인 화면

**파일:** `src/components/layout/app-layout.tsx`

```
<div className="flex h-screen">
  ├── <IconSidebar />          사이드바 (뷰 전환, 설정, 프로젝트 전환)
  └── <div className="flex-1">
        <ErrorBoundary>
          <ContentArea />      메인 콘텐츠 (뷰 라우터)
        </ErrorBoundary>
        <ActivityPanel />      하단 플로팅 패널
```

### ContentArea 뷰 라우팅

`activeView` 값에 따라 전환 (`src/components/layout/content-area.tsx`):

| activeView | 컴포넌트 |
|---|---|
| `"wiki"` (기본) | `<ChatPanel />` |
| `"graph"` | `<GraphView />` |
| `"review"` | `<ReviewView />` |
| `"history"` | `<HistoryView />` |
| `"settings"` | `<SettingsView />` |

---

## 8. 프로젝트 전환 및 종료

### 프로젝트 전환

`handleSwitchProject()`:
1. `resetProjectState()` — 모든 프로젝트 상태 초기화
2. `setProject(null)` / `setFileTree([])` / `setSelectedFile(null)`
3. 렌더링 조건: `project === null` → `ProjectBranchSelector` 표시

### 앱 종료 (프로젝트 열려있는 경우)

`SyncOnExitDialog` → 사용자 선택:
- **Sync & Exit**: `handleSync()` 실행
  1. 그래프 DB를 JSON으로 내보내기
  2. `graph.json` 파일 작성
  3. git commit
  4. SQLite 스냅샷 저장
  5. `gitPush(path, "origin", branch)`
  6. 창 종료
- **Exit without sync**: 바로 창 종료

---

## 퍼시스턴스 키 목록 (app-state.json)

| 키 | 용도 |
|---|---|
| `lastProject` | 마지막으로 연 프로젝트 |
| `recentProjects` | 최근 프로젝트 목록 (최대 10개) |
| `selectedBranch` | 선택된 브랜치 |
| `branchFolderMap` | 브랜치 → 로컬 폴더 경로 매핑 |
| `gitRemoteUrl` | Remote Git URL |
| `llmConfig` | LLM 설정 |
| `providerConfigs` | 프리셋별 프로바이더 설정 |
| `activePresetId` | 활성 프리셋 ID |
| `embeddingConfig` | 임베딩 설정 |
| `outputLanguage` | 응답 언어 |
| `language` | UI 언어 |
| `falkordbUrl` | FalkorDB 연결 URL |
| `updateCheckState` | 업데이트 확인 캐시 |
