# LLM Wiki

LLM Wiki는 로컬 파일 시스템 위에 개인 지식 베이스를 만들고, LLM으로 원본 문서를 `db/` 위키 페이지로 분해해 검색/채팅/리뷰/히스토리까지 관리하는 Tauri 데스크톱 앱입니다.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop | Tauri v2 (Rust backend) |
| Frontend | React 19 + TypeScript + Vite |
| UI | Tailwind CSS v4 + shadcn-style components |
| Editor / Markdown | Milkdown, react-markdown, remark-gfm, KaTeX |
| State | Zustand + persisted project store |
| Search | Token search, RRF hybrid retrieval, question-type exclusions, graph expansion |
| Vector DB | LanceDB (embedded Rust command layer, optional) |
| Graph | sigma.js + graphology + ForceAtlas2 + Louvain communities |
| Documents | PDFium (`pdfium-render`), `docx-rs`, `calamine`, ZIP/ODF parsing |
| LLM | OpenAI, Anthropic, Google Gemini, Ollama, Custom, MiniMax, Claude/Codex/Gemini CLI |
| i18n | react-i18next (`en`, `zh`, `ko`) |
| Versioning | Per-project Git repository + in-app history/revert UI |
| Extension | Chrome Manifest V3 web clipper via local HTTP server |

## Installation

### Pre-built Binaries

Download from [Releases](https://github.com/nashsu/llm_wiki/releases):

- **macOS**: `.dmg`
- **Windows**: `.msi`
- **Linux**: `.deb` / `.AppImage`

### Build from Source

```bash
# Prerequisites: Node.js 20+, Rust 1.70+
git clone https://github.com/nashsu/llm_wiki.git
cd llm_wiki
npm install
npm run tauri dev      # Development
npm run tauri build    # Production build
```

Useful scripts:

```bash
npm run typecheck
npm run test:mocks
npm run test:llm
```

### Chrome Extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `extension/` directory

The desktop app starts a local clip server on `127.0.0.1:19827`; the sidebar status dot and Settings > About show its health.

## Quick Start

1. Launch the app and create a project.
2. Pick a `schema.md` source file, for example [`schema/game-dev-example.md`](schema/game-dev-example.md), and write the project purpose.
3. Open **Settings > LLM** and choose a provider preset. Local CLI providers (`claude`, `codex`, `gemini`) work without storing an API key in the app.
4. Open **Sources** and import files or folders. Import pre-processes sources into markdown under `raw/sources/` and stores originals under gitignored `raw/originals/`.
5. Watch the Activity Panel while the ingest queue creates or updates pages under `db/`.
6. Use the chat/wiki view to ask questions, inspect citations, and save useful answers back into the project.
7. Use **Graph**, **Review**, **Promotion**, **History**, and **Lint** to inspect relationships, triage proposals, maintain exclusions, review Git history, and keep the wiki healthy.

## Project Structure

New projects are bootstrapped by [`src/lib/project-init.ts`](src/lib/project-init.ts):

```text
my-wiki/
├── purpose.md                         # Project goals and research scope
├── schema.md                          # Authoritative db/ layout rules
├── db/                                # LLM-generated wiki pages
├── raw/
│   ├── sources/                       # Preprocessed markdown inputs
│   └── originals/                     # Original imported files, gitignored
├── pending/                           # Human-reviewable proposed changes
├── counterexamples/                   # Rejected/negative examples for future ingest
├── question_types/                    # Question classifier definitions
├── exclusions/
│   ├── exclusion_schema.md            # How exclusion rules are represented
│   ├── promotion_rules.md             # Thresholds for promotion candidates
│   ├── by_question_type/              # Type-specific exclusion patterns
│   ├── axioms/                        # Cross-type exclusion axioms
│   └── instances/                     # Search traces logged from chat queries
├── .llm-wiki/                         # App metadata, project id, chats, queues
└── .git/                              # Per-project version history
```

Legacy projects using `wiki/` are migrated toward the current `db/` layout when opened; see [`src/commands/fs.ts`](src/commands/fs.ts) and [`src-tauri/src/commands/migrate.rs`](src-tauri/src/commands/migrate.rs).

## Codebase Map

- **Frontend app shell**: [`src/App.tsx`](src/App.tsx), [`src/components/layout/app-layout.tsx`](src/components/layout/app-layout.tsx), [`src/components/layout/icon-sidebar.tsx`](src/components/layout/icon-sidebar.tsx), [`src/components/layout/content-area.tsx`](src/components/layout/content-area.tsx)
- **Project creation/opening**: [`src/components/project/create-project-dialog.tsx`](src/components/project/create-project-dialog.tsx), [`src/components/project/schema-picker.tsx`](src/components/project/schema-picker.tsx), [`src/lib/project-init.ts`](src/lib/project-init.ts), [`src/lib/project-identity.ts`](src/lib/project-identity.ts)
- **Backend IPC commands**: [`src-tauri/src/lib.rs`](src-tauri/src/lib.rs), [`src-tauri/src/commands/`](src-tauri/src/commands/), [`src/commands/`](src/commands/)
- **Persistent state**: [`src/stores/wiki-store.ts`](src/stores/wiki-store.ts), [`src/stores/chat-store.ts`](src/stores/chat-store.ts), [`src/stores/review-store.ts`](src/stores/review-store.ts), [`src/lib/persist.ts`](src/lib/persist.ts), [`src/lib/project-store.ts`](src/lib/project-store.ts)
- **i18n**: [`src/i18n/index.ts`](src/i18n/index.ts), [`src/i18n/en.json`](src/i18n/en.json), [`src/i18n/zh.json`](src/i18n/zh.json), [`src/i18n/ko.json`](src/i18n/ko.json), [`src/i18n/i18n-parity.test.ts`](src/i18n/i18n-parity.test.ts)

## Main Features

### 1. Desktop Layout and Views

The app uses a resizable three-column layout with an icon sidebar, left file/knowledge tree, central content area, chat bar, preview panel, and activity panel.

Current primary views are `Wiki`, `Sources`, `Graph`, `Lint`, `Review`, `Promotion`, `History`, and `Settings`. The routing is state-driven via [`src/stores/wiki-store.ts`](src/stores/wiki-store.ts), rendered through [`src/components/layout/content-area.tsx`](src/components/layout/content-area.tsx).

### 2. Source Import and Multi-format Preprocessing

Source import lives in [`src/components/sources/sources-view.tsx`](src/components/sources/sources-view.tsx). Imported files are converted to markdown via [`src-tauri/src/commands/fs.rs`](src-tauri/src/commands/fs.rs), then queued for ingest.

Supported inputs include markdown/text/code/data files, PDF, DOCX/PPTX/XLSX, ODF formats, HTML/XML/CSV/JSON/YAML, plus image/media stubs for single-file import. PDF extraction uses bundled PDFium resolution from Tauri resources.

### 3. Ingest Pipeline

The default ingest path in [`src/lib/ingest.ts`](src/lib/ingest.ts) runs a two-step LLM flow:

1. Analyze the source against `purpose.md`, `schema.md`, current `db/` index, and prior rejections.
2. Generate strict `FILE` / `REVIEW` blocks under safe project prefixes.

Important supporting pieces:

- Incremental cache: [`src/lib/ingest-cache.ts`](src/lib/ingest-cache.ts)
- Persistent serial queue with restore/retry/cancel: [`src/lib/ingest-queue.ts`](src/lib/ingest-queue.ts)
- Per-project mutex: [`src/lib/project-mutex.ts`](src/lib/project-mutex.ts)
- Modification conflict cards: [`src/lib/pending-resolve.ts`](src/lib/pending-resolve.ts)
- Auto-commit after successful ingest: [`src/lib/auto-commit.ts`](src/lib/auto-commit.ts), [`src/commands/git.ts`](src/commands/git.ts)
- Auto-embedding for written `db/` pages when enabled: [`src/lib/embedding.ts`](src/lib/embedding.ts)

Local coding-agent CLIs use a separate JSON-based ingest path in [`src/lib/agent-ingest.ts`](src/lib/agent-ingest.ts), because Claude/Codex/Gemini CLI streams behave differently from HTTP chat APIs.

### 4. Search, Chat, and Retrieval

Chat is implemented by [`src/components/chat/chat-panel.tsx`](src/components/chat/chat-panel.tsx), [`src/components/chat/chat-message.tsx`](src/components/chat/chat-message.tsx), and [`src/components/chat/chat-input.tsx`](src/components/chat/chat-input.tsx). Conversations persist under `.llm-wiki/chats/`.

Retrieval combines:

- Token and phrase scoring with CJK bigrams: [`src/lib/search.ts`](src/lib/search.ts)
- Optional LanceDB vector search and RRF fusion: [`src/lib/embedding.ts`](src/lib/embedding.ts), [`src-tauri/src/commands/vectorstore.rs`](src-tauri/src/commands/vectorstore.rs)
- Graph relevance expansion: [`src/lib/graph-relevance.ts`](src/lib/graph-relevance.ts)
- Context budgeting and assembly: [`src/lib/context-budget.ts`](src/lib/context-budget.ts), [`src/lib/search.ts`](src/lib/search.ts)
- Output language control: [`src/lib/output-language.ts`](src/lib/output-language.ts), [`src/lib/detect-language.ts`](src/lib/detect-language.ts)

The message renderer supports `<think>` block display and KaTeX math rendering.

### 5. Question Types, Exclusions, and Promotion

The current search path can classify a question, apply type-specific exclusions, search only the remaining candidate space, and log the trace:

- Question type loader: [`src/lib/question-types.ts`](src/lib/question-types.ts)
- LLM classifier: [`src/lib/classify-question.ts`](src/lib/classify-question.ts)
- Exclusion loader/matcher: [`src/lib/exclusions.ts`](src/lib/exclusions.ts)
- Exclusion-aware search orchestration: [`src/lib/exclude-search.ts`](src/lib/exclude-search.ts)
- Instance log writer: [`src/lib/instance-log.ts`](src/lib/instance-log.ts)
- Promotion candidate analysis and actions: [`src/lib/promotion.ts`](src/lib/promotion.ts)
- Freshness/validity checks: [`src/lib/exclusion-validity.ts`](src/lib/exclusion-validity.ts)
- Promotion UI: [`src/components/exclusions/promotion-panel.tsx`](src/components/exclusions/promotion-panel.tsx)

Promotion is intentionally human-driven: repeated instance logs surface candidates, but the app only writes pattern/axiom files after explicit user action.

### 6. Review, Lint, and Cleanup

Review cards cover generated pages, modification proposals, and follow-up actions. The main logic is in [`src/lib/review-utils.ts`](src/lib/review-utils.ts), [`src/lib/sweep-reviews.ts`](src/lib/sweep-reviews.ts), and [`src/components/review/review-view.tsx`](src/components/review/review-view.tsx).

Wiki health checks are in [`src/lib/lint.ts`](src/lib/lint.ts) and [`src/components/lint/lint-view.tsx`](src/components/lint/lint-view.tsx). Source deletion performs cascade cleanup through [`src/lib/source-delete-decision.ts`](src/lib/source-delete-decision.ts), [`src/lib/wiki-page-delete.ts`](src/lib/wiki-page-delete.ts), [`src/lib/wiki-cleanup.ts`](src/lib/wiki-cleanup.ts), and [`src/lib/sources-merge.ts`](src/lib/sources-merge.ts).

### 7. Knowledge Graph

Graph construction and visualization are split between [`src/lib/wiki-graph.ts`](src/lib/wiki-graph.ts) and [`src/components/graph/graph-view.tsx`](src/components/graph/graph-view.tsx).

The graph view uses sigma.js/graphology, ForceAtlas2 layout, Louvain community detection, position caching, graph insights, hover/click interactions, and relevance signals from [`src/lib/graph-relevance.ts`](src/lib/graph-relevance.ts) and [`src/lib/graph-insights.ts`](src/lib/graph-insights.ts).

### 8. Git History

Each project is initialized as a Git repository on creation. In-app history support includes commit list, commit detail, per-file diff, restoring a file to a commit, and reverting a commit:

- Frontend command wrapper: [`src/commands/git.ts`](src/commands/git.ts)
- Rust command implementation: [`src-tauri/src/commands/git_ops.rs`](src-tauri/src/commands/git_ops.rs)
- UI/data helpers: [`src/lib/git-history.ts`](src/lib/git-history.ts), [`src/components/history/history-view.tsx`](src/components/history/history-view.tsx)

### 9. LLM Providers and Settings

Provider presets live in [`src/components/settings/llm-presets.ts`](src/components/settings/llm-presets.ts), with resolution/persistence handled by [`src/components/settings/preset-resolver.ts`](src/components/settings/preset-resolver.ts), [`src/components/settings/sections/llm-provider-section.tsx`](src/components/settings/sections/llm-provider-section.tsx), and [`src/lib/project-store.ts`](src/lib/project-store.ts).

HTTP providers flow through [`src/lib/llm-providers.ts`](src/lib/llm-providers.ts), [`src/lib/llm-client.ts`](src/lib/llm-client.ts), and [`src/lib/tauri-fetch.ts`](src/lib/tauri-fetch.ts). Local CLI providers are implemented by:

- [`src/lib/claude-cli-transport.ts`](src/lib/claude-cli-transport.ts) and [`src-tauri/src/commands/claude_cli.rs`](src-tauri/src/commands/claude_cli.rs)
- [`src/lib/codex-cli-transport.ts`](src/lib/codex-cli-transport.ts) and [`src-tauri/src/commands/codex_cli.rs`](src-tauri/src/commands/codex_cli.rs)
- [`src/lib/gemini-cli-transport.ts`](src/lib/gemini-cli-transport.ts) and [`src-tauri/src/commands/gemini_cli.rs`](src-tauri/src/commands/gemini_cli.rs)

Settings also cover embedding, output language, interface language, update checks, and clip server status through [`src/components/settings/settings-view.tsx`](src/components/settings/settings-view.tsx) and [`src/components/settings/sections/`](src/components/settings/sections/).

### 10. Browser Web Clipper

The Chrome extension uses Manifest V3 files under [`extension/`](extension/). It extracts readable page content with Readability/Turndown and sends clips to the desktop app through the local HTTP server in [`src-tauri/src/clip_server.rs`](src-tauri/src/clip_server.rs). The frontend watcher in [`src/lib/clip-watcher.ts`](src/lib/clip-watcher.ts) imports clips into the active project and triggers ingest.

### 11. Cross-platform Safety

- Path normalization and Unicode-safe helpers: [`src/lib/path-utils.ts`](src/lib/path-utils.ts)
- Tauri app bootstrap, close behavior, plugins, and command registry: [`src-tauri/src/lib.rs`](src-tauri/src/lib.rs)
- Native command panic guard: [`src-tauri/src/panic_guard.rs`](src-tauri/src/panic_guard.rs)
- Platform-specific Tauri configs: [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json), [`src-tauri/tauri.windows.conf.json`](src-tauri/tauri.windows.conf.json), [`src-tauri/tauri.macos.conf.json`](src-tauri/tauri.macos.conf.json), [`src-tauri/tauri.linux.conf.json`](src-tauri/tauri.linux.conf.json)
- Capability permissions: [`src-tauri/capabilities/default.json`](src-tauri/capabilities/default.json)

## Recommended Reading Order

1. **Project bootstrap**: [`src/components/project/create-project-dialog.tsx`](src/components/project/create-project-dialog.tsx) -> [`src/lib/project-init.ts`](src/lib/project-init.ts) -> [`schema/game-dev-example.md`](schema/game-dev-example.md)
2. **Import and ingest**: [`src/components/sources/sources-view.tsx`](src/components/sources/sources-view.tsx) -> [`src/lib/ingest-queue.ts`](src/lib/ingest-queue.ts) -> [`src/lib/ingest.ts`](src/lib/ingest.ts) -> [`src/lib/agent-ingest.ts`](src/lib/agent-ingest.ts)
3. **Chat and search**: [`src/components/chat/chat-panel.tsx`](src/components/chat/chat-panel.tsx) -> [`src/lib/exclude-search.ts`](src/lib/exclude-search.ts) -> [`src/lib/search.ts`](src/lib/search.ts) -> [`src/lib/context-budget.ts`](src/lib/context-budget.ts)
4. **Exclusion lifecycle**: [`src/lib/question-types.ts`](src/lib/question-types.ts) -> [`src/lib/exclusions.ts`](src/lib/exclusions.ts) -> [`src/lib/instance-log.ts`](src/lib/instance-log.ts) -> [`src/lib/promotion.ts`](src/lib/promotion.ts)
5. **Graph**: [`src/lib/wiki-graph.ts`](src/lib/wiki-graph.ts) -> [`src/lib/graph-relevance.ts`](src/lib/graph-relevance.ts) -> [`src/lib/graph-insights.ts`](src/lib/graph-insights.ts) -> [`src/components/graph/graph-view.tsx`](src/components/graph/graph-view.tsx)
6. **Native boundary**: [`src/commands/`](src/commands/) -> [`src-tauri/src/commands/`](src-tauri/src/commands/) -> [`src-tauri/src/lib.rs`](src-tauri/src/lib.rs)
7. **Extension path**: [`extension/popup.js`](extension/popup.js) -> [`src-tauri/src/clip_server.rs`](src-tauri/src/clip_server.rs) -> [`src/lib/clip-watcher.ts`](src/lib/clip-watcher.ts)

Most `*.test.ts` files double as executable specifications. For behavior-heavy modules, read the tests before the implementation.