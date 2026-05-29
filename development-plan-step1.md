# Development Plan - Step 1: Project Selection & Branch List (Completed)

## Objective
Implement a project selection screen that displays the branch list from the repository `https://set-git.cloud.ncsoft.com/gameqa/claude-skills`.

## Requirements (Completed)
- Fetch branches from the remote Git repository.
- Use the provided token via environment variables for authentication.
- Display the list in the UI for the user to select.
- **Project Isolation:** Ensure graphs in FalkorDB are isolated by project name using prefixing.

## Implementation Details

### 1. Backend (Tauri/Rust)
- Added `git_ls_remote` command to `src-tauri/src/commands/git_ops.rs` to fetch remote branches using `git ls-remote --heads`.
- Registered `git_ls_remote` and `graph_db_query` in `src-tauri/src/lib.rs`.
- Added `graph_db_query` to `src-tauri/src/commands/graph_db.rs` to support arbitrary Cypher queries.

### 2. Frontend (TypeScript/React)
- **Git Integration:** Exposed `gitLsRemote` in `src/commands/git.ts`.
- **Global Store:** Added `selectedBranch` and `setSelectedBranch` to `src/stores/wiki-store.ts`.
- **Persistence:** Implemented `saveSelectedBranch` and `loadSelectedBranch` in `src/lib/project-store.ts` using `@tauri-apps/plugin-store`.
- **Component:** Created `ProjectBranchSelector` component to fetch and display the branch list on application startup.
- **App Integration:** Updated `App.tsx` to conditionally render `ProjectBranchSelector` when no branch is selected and hydrate the state from storage.

### 3. Environment & Security
- Created `.env` file to manage `VITE_GIT_USER` and `VITE_GIT_PASSWORD` securely.
- Implemented URL encoding (`encodeURIComponent`) in `ProjectBranchSelector` to handle special characters in credentials.

### 4. FalkorDB Project Isolation
- Refactored `src/commands/graph-db.ts` to automatically prefix graph names with the project name (e.g., `Project___GraphName`).
- Updated `listGraphDb` to filter and return only graphs belonging to the current project.
- Updated `GraphView` to pass the project name to all graph database operations.

## Verification
- **Manual Test:** Branch list is correctly fetched from the remote repository on boot.
- **Manual Test:** Selected branch is persisted across application restarts.
- **Manual Test:** Git credentials containing special characters (e.g., `!`) work correctly via URL encoding.
- **Manual Test:** Graphs created in Project A are not visible or accessible from Project B, ensuring isolation.
