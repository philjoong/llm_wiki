# Git 연동 및 History 탭 가이드

## 개요

llm_wiki는 프로젝트 디렉토리를 **git 저장소로 직접 관리**한다. 앱 사용 중에는 자동 커밋이 발생하지 않으며, 사용자가 직접 문서·그래프를 자유롭게 수정하다가 "Sync to Remote"를 실행하면 그 시점의 상태 전체가 커밋·push된다.

여러 사용자가 같은 remote를 공유하는 환경을 지원한다. Sync 시 `git pull --rebase`로 remote 변경을 먼저 통합한 뒤 push한다.

git 조작은 libgit2가 아닌 **git CLI를 subprocess로 호출**하는 방식으로 구현되어 있다 ([src-tauri/src/commands/git_ops.rs](src-tauri/src/commands/git_ops.rs)).

---

## 커밋 발생 시점

### 1. 그래프 스냅샷 커밋 — `sync: ...`

- **트리거**: "Sync to Remote" 실행 시 ([src/App.tsx](src/App.tsx) `handleSync()`)
- **커밋 메시지**:
  ```
  sync: update graph snapshot
  ```
- **동작 순서**:
  1. 그래프 backend(SQLite)의 그래프 전체를 `graph.json`으로 내보내기
  2. `git add -A`로 모든 변경 파일 스테이징 (db/, pending/, graph.json 등)
  3. `sync: update graph snapshot` 커밋
  4. SQLite(`vcDbSaveSnapshot`)에 커밋 해시 기록
  5. `git pull --rebase origin <branch>`로 remote 변경 통합
  6. `git push`로 원격에 반영

### 2. 초기화 커밋 — `init: ...`

- **트리거**: 프로젝트 최초 생성 시 `git_init` 호출 ([src-tauri/src/commands/git_ops.rs](src-tauri/src/commands/git_ops.rs) 169번째 줄)
- **커밋 메시지**:
  ```
  init: bootstrap project
  ```
- **스테이징 대상**: `.gitkeep` 파일들, graph policy (`.llm-wiki/graph-policy.json`)

---

## 앱 사용 중 자동 커밋되지 않는 작업

아래 작업은 파일을 디스크에 즉시 기록하지만 **git 커밋은 발생하지 않는다**. 모두 "Sync to Remote" 시점에 함께 커밋·push된다.

| 작업 | 기록되는 파일 |
|------|--------------|
| 인제스트 (LLM Stage 3) | `db/` 페이지 파일들 |
| 수정 해결 (Approve / Discard / Pending / Counterexample) | `db/`, `pending/`, `counterexamples/`, `.llm-wiki/rejection-log.jsonl` |
| URL 인제스트 | `sources/` 원본 파일 |
| 사용자 직접 문서 편집 | 해당 `db/` 파일 |
| 그래프 실시간 변경 | `graph.json` 미반영 — Sync 시에만 스냅샷 기록 |

---

## 원격 저장소 동기화

### 프로젝트 열기 시

[src/App.tsx](src/App.tsx) `openProject()`:

1. `vcDbInit()` — 버전 관리 DB 초기화

원격 pull은 프로젝트 열기 시 수행하지 않는다. 최신 상태로 시작하려면 "Sync to Remote"를 사용한다.

### Sync to Remote (수동 실행)

두 가지 경로로 실행할 수 있다:

| 경로 | 설명 |
|------|------|
| 좌측 사이드바 하단 Upload 버튼 | 앱 사용 중 언제든지 즉시 동기화 |
| 앱 종료 시 `SyncOnExitDialog` | `tauri://close-requested` 이벤트 발생 시 표시 |

**동작 순서:**

```
1. graph.json export
2. git add -A  (모든 변경 파일 스테이징)
3. git commit -m "sync: update graph snapshot"
4. git pull --rebase origin <branch>
   └─ 충돌 없음 → 5번으로
   └─ 충돌 발생 → SyncConflictDialog 표시
5. git push origin <branch>
```

원격이 설정되지 않은 로컬 전용 프로젝트에서는 "Sync to Remote"가 비활성화(사이드바 버튼 숨김, 종료 다이얼로그 버튼 비활성)된다.

### 앱 종료 시 (수동 선택)

`tauri://close-requested` 이벤트 발생 시 `SyncOnExitDialog`가 표시된다 ([src/components/project/sync-on-exit-dialog.tsx](src/components/project/sync-on-exit-dialog.tsx)):

| 선택지 | 동작 |
|--------|------|
| Exit without Sync | 동기화 없이 즉시 종료 |
| Sync to Remote | 위의 Sync 흐름 실행 후 종료 |
| Cancel | 앱 유지 |

---

## Rebase 충돌 처리

`git pull --rebase` 도중 충돌이 발생하면 `SyncConflictDialog`가 열린다 ([src/components/project/sync-conflict-dialog.tsx](src/components/project/sync-conflict-dialog.tsx)).

```
┌─────────────────────────────────────────┐
│ Sync Conflict                           │
│ ─────────────────────────────────────── │
│ 충돌 파일 목록 (클릭 시 diff 표시)       │
│ ● db/foo/bar.md                         │
│ ● graph.json                            │
│                                         │
│ [선택 파일의 diff 뷰어]                  │
│ ─────────────────────────────────────── │
│ [Abort Rebase]  [Resolved & Continue]   │
└─────────────────────────────────────────┘
```

| 버튼 | 동작 |
|------|------|
| **Abort Rebase** | `git rebase --abort`로 rebase 중단. 로컬 커밋은 유지되나 push 안 됨. |
| **Resolved & Continue** | 외부 편집기에서 충돌 파일을 해결한 뒤 클릭. `git add -A` → `git rebase --continue` 실행. 추가 충돌 시 다이얼로그 유지. 성공 시 push. |

**백엔드 구현** ([src-tauri/src/commands/git_ops.rs](src-tauri/src/commands/git_ops.rs)):
- `git_pull_rebase`: `git pull --rebase` 실행, 충돌 시 `PullRebaseResult { success: false, conflicts: [...] }` 반환
- `git_rebase_continue`: `git add -A` → `git rebase --continue` 실행
- `git_rebase_abort`: `git rebase --abort` 실행
- `git_sync_commit`: `git add -A` → `git commit` 실행 (Sync 전용)

---

## History 탭 — 표시 내용 및 구조

구현 파일: [src/components/history/history-view.tsx](src/components/history/history-view.tsx)

### 레이아웃

```
┌─────────────────────────┬──────────────────────────────────────────┐
│  커밋 목록 (왼쪽)        │  커밋 상세 (오른쪽)                       │
│                         │                                          │
│  ● sync: graph snapshot │  sync: update graph snapshot             │
│  ● init: bootstrap      │  Author: LLM Wiki  Date: 2026-06-10     │
│  ...                    │  Hash: a1b2c3d4...                       │
│                         │  [Revert Commit]                         │
│                         │  ─────────────────                       │
│  [Load More]            │  M  graph.json   +12 -3  [Restore File] │
│                         │  ─────────────────                       │
│                         │  (선택한 파일의 unified diff)             │
└─────────────────────────┴──────────────────────────────────────────┘
```

### 커밋 목록 (왼쪽 패널)

- 한 페이지에 최대 **50개** 커밋 표시 (keyset 방식 페이지네이션, 커밋 해시를 커서로 사용)
- 그래프 관련 커밋 (`graph_`, `graph:`, `graph.db`, `graph.policy`, `managed_graph` 패턴)에는 파란색 Network 아이콘 표시
- "Load More"로 더 오래된 커밋 불러오기 가능

### 커밋 상세 (오른쪽 패널)

커밋 선택 시 `git show <hash>`로 상세 정보를 불러온다.

**표시 항목:**
- 전체 커밋 메시지 (subject + body)
- Author, Date, 전체 해시
- 변경된 파일 목록 (상태 코드 + 추가/삭제 줄 수)
- 파일 선택 시 unified diff 뷰어

**파일 상태 코드:**

| 코드 | 의미 | 색상 |
|------|------|------|
| A | 추가 | 초록 |
| M | 수정 | 노란 |
| D | 삭제 | 빨강 |
| R/C/T | 이름 변경/복사/타입 변경 | 기본 |

### 가능한 조작

- **Revert Commit**: 선택한 커밋 전체를 되돌리는 revert 커밋 생성 (충돌 발생 가능)
- **Restore File**: 특정 파일만 해당 커밋 시점 버전으로 복원 (`git checkout <hash> -- <file>`)

---

## 관련 파일 목록

| 역할 | 파일 |
|------|------|
| git 백엔드 (Rust) | [src-tauri/src/commands/git_ops.rs](src-tauri/src/commands/git_ops.rs) |
| git 프론트엔드 바인딩 | [src/commands/git.ts](src/commands/git.ts) |
| 커밋 메시지 포맷터 | [src/lib/auto-commit.ts](src/lib/auto-commit.ts) |
| History 탭 UI | [src/components/history/history-view.tsx](src/components/history/history-view.tsx) |
| 종료 시 동기화 다이얼로그 | [src/components/project/sync-on-exit-dialog.tsx](src/components/project/sync-on-exit-dialog.tsx) |
| 충돌 해결 다이얼로그 | [src/components/project/sync-conflict-dialog.tsx](src/components/project/sync-conflict-dialog.tsx) |
| 앱 레벨 동기화 로직 | [src/App.tsx](src/App.tsx) |
| 사이드바 Sync 버튼 | [src/components/layout/icon-sidebar.tsx](src/components/layout/icon-sidebar.tsx) |
