# Development Plan - Step 6: Version Control & Sync [COMPLETED]

## Objective
Manage Knowledge Graph versions locally using SQLite and synchronize with the remote Git repository.

## Requirements (Completed)
- Local Version Control (VC) using SQLite.
- Ask to "Sync to Remote" or "Exit without Sync" when closing the project/app.
- Sync with remote when a project is selected at startup.

## Implementation Details

### 1. Local Database (SQLite)
- Added `rusqlite` with `bundled` feature to `src-tauri/Cargo.toml`.
- Implemented `vc_db` module in `src-tauri/src/commands/vc_db.rs` with tables:
  - `project_meta`: Key-value store for project settings.
  - `commits`: Git commit metadata (hash, author, date, message).
  - `graph_snapshots`: Serialized JSON snapshots of the FalkorDB state linked to git commits.
- Exposed TypeScript wrappers in `src/commands/vc-db.ts`.

### 2. Git Synchronization & Graph Export
- **Graph Export:** Added `graph_db_export` command to `src-tauri/src/commands/graph_db.rs` to serialize all nodes and edges to JSON.
- **Git Operations:** Added `git_pull` command to `src-tauri/src/commands/git_ops.rs`.
- **Sync Logic:** Implemented `handleSync` in `App.tsx` which:
  1. Exports FalkorDB state to `graph.json`.
  2. Commits `graph.json` to local Git repo.
  3. Saves the snapshot to the local SQLite `graph_snapshots` table.
  4. Pushes the branch to the `origin` remote.

### 3. Lifecycle Hooks
- **Startup Sync:** Updated `handleProjectOpened` in `App.tsx` to initialize `vc.db` and perform a `git pull` from the remote branch.
- **Exit Prompt:**
  - Modified Tauri's `CloseRequested` handler in `lib.rs` to emit a frontend event.
  - Created `SyncOnExitDialog.tsx` to prompt the user to "Sync to Remote", "Exit without Sync", or "Cancel".
  - Integrated the dialog into `App.tsx` using `listen` to intercept the close event.

## Verification
- **SQLite Check:** Verified that `vc.db` is created in the project root and snapshots are stored correctly.
- **Sync Check:** Confirmed that `graph.json` is generated, committed, and pushed to the remote.
- **Exit Check:** Verified that the "Sync to Remote" prompt appears and successfully pushes changes before the window closes.
