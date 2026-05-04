# LLM Wiki

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop | Tauri v2 (Rust backend) |
| Frontend | React 19 + TypeScript + Vite |
| UI | shadcn/ui + Tailwind CSS v4 |
| Editor | Milkdown (ProseMirror-based WYSIWYG) |
| Graph | sigma.js + graphology + ForceAtlas2 |
| Search | Tokenized search + graph relevance + optional vector (LanceDB) |
| Vector DB | LanceDB (Rust, embedded, optional) |
| PDF | pdf-extract |
| Office | docx-rs + calamine |
| i18n | react-i18next |
| State | Zustand |
| LLM | Streaming fetch (OpenAI, Anthropic, Google, Ollama, Custom) |
| Web Search | Tavily API |

## Installation

### Pre-built Binaries

Download from [Releases](https://github.com/nashsu/llm_wiki/releases):
- **macOS**: `.dmg` (Apple Silicon + Intel)
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

### Chrome Extension

1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `extension/` directory

## Quick Start

1. Launch the app → Create a new project (choose a template)
2. Go to **Settings** → Configure your LLM provider (API key + model)
3. Go to **Sources** → Import documents (PDF, DOCX, MD, etc.)
4. Watch the **Activity Panel** — LLM automatically builds wiki pages
5. Use **Chat** to query your knowledge base
6. Browse the **Knowledge Graph** to see connections
7. Check **Review** for items needing your attention
8. Run **Lint** periodically to maintain wiki health

## Project Structure

```
my-wiki/
├── purpose.md              # Goals, key questions, research scope
├── schema.md               # Wiki structure rules, page types
├── raw/
│   ├── sources/            # Uploaded documents (immutable)
│   └── assets/             # Local images
├── wiki/
│   ├── index.md            # Content catalog
│   ├── log.md              # Operation history
│   ├── overview.md         # Global summary (auto-updated)
│   ├── entities/           # People, organizations, products
│   ├── concepts/           # Theories, methods, techniques
│   ├── sources/            # Source summaries
│   ├── queries/            # Saved chat answers + research
│   ├── synthesis/          # Cross-source analysis
│   └── comparisons/        # Side-by-side comparisons
├── .obsidian/              # Obsidian vault config (auto-generated)
└── .llm-wiki/              # App config, chat history, review items
```

### 코드베이스 전반 구조 (먼저 이해할 것)

학습 전 머릿속에 잡아두면 좋은 큰 그림:

- **Frontend (React + TS)** — [src/](src/)
  - UI/레이아웃: [src/components/layout/](src/components/layout/)
  - 도메인 로직 (ingest, search, graph, lint 등 순수 함수 위주): [src/lib/](src/lib/)
  - 화면 단위 컴포넌트: [src/components/](src/components/)
- **Backend (Rust / Tauri v2)** — [src-tauri/src/](src-tauri/src/)
  - Tauri 명령(IPC) 정의: [src-tauri/src/commands/](src-tauri/src/commands/)
  - 앱 부트스트랩: [src-tauri/src/lib.rs](src-tauri/src/lib.rs), [src-tauri/src/main.rs](src-tauri/src/main.rs)
- **i18n 리소스** — [src/i18n/en.json](src/i18n/en.json), [src/i18n/zh.json](src/i18n/zh.json)
---

### 1. Desktop Application 구조 (3-column layout, icon sidebar, 패널)

- 앱 루트 / 라우팅: [src/App.tsx](src/App.tsx)
- 전체 레이아웃 (3-column, resizable): [src/components/layout/app-layout.tsx](src/components/layout/app-layout.tsx)
- 좌측 아이콘 사이드바 (Wiki / Sources / Search / Graph / Lint / Review / Deep Research / Settings 전환): [src/components/layout/icon-sidebar.tsx](src/components/layout/icon-sidebar.tsx)
- 좌측 패널 (Knowledge Tree / File Tree): [src/components/layout/sidebar-panel.tsx](src/components/layout/sidebar-panel.tsx), [src/components/layout/knowledge-tree.tsx](src/components/layout/knowledge-tree.tsx), [src/components/layout/file-tree.tsx](src/components/layout/file-tree.tsx)
- 중앙 콘텐츠 / 채팅 영역: [src/components/layout/content-area.tsx](src/components/layout/content-area.tsx), [src/components/chat/chat-panel.tsx](src/components/chat/chat-panel.tsx)
- 우측 프리뷰 패널: [src/components/layout/preview-panel.tsx](src/components/layout/preview-panel.tsx)
- 드래그 리사이즈 패널 컴포넌트: [src/components/ui/resizable.tsx](src/components/ui/resizable.tsx)
- Activity Panel (실시간 ingest 진행률): [src/components/layout/activity-panel.tsx](src/components/layout/activity-panel.tsx)
- 상태 영속화 (Zustand 등): [src/lib/persist.ts](src/lib/persist.ts), [src/lib/project-store.ts](src/lib/project-store.ts), [src/lib/project-identity.ts](src/lib/project-identity.ts)
- Scenario 템플릿 (Research / Reading / Personal Growth / Business / General): [src/lib/templates.ts](src/lib/templates.ts), [src/components/project/template-picker.tsx](src/components/project/template-picker.tsx), [src/components/project/create-project-dialog.tsx](src/components/project/create-project-dialog.tsx), [src/components/project/welcome-screen.tsx](src/components/project/welcome-screen.tsx)

### 2. purpose.md — Wiki의 의도(Why) 정의

- 템플릿이 `purpose.md` / `schema.md` 초기 내용을 결정: [src/lib/templates.ts](src/lib/templates.ts)
- ingest / query 시 LLM 컨텍스트로 purpose.md를 읽어 들이는 흐름은 [src/lib/ingest.ts](src/lib/ingest.ts) 와 [src/lib/search.ts](src/lib/search.ts) 에서 확인할 수 있습니다.

### 3. Two-Step Chain-of-Thought Ingest

- **Ingest 메인 파이프라인** (analysis → generation 두 단계 LLM 호출): [src/lib/ingest.ts](src/lib/ingest.ts)
- 프롬프트가 어떻게 구성되는지 검증: [src/lib/ingest.prompt.test.ts](src/lib/ingest.prompt.test.ts)
- 시나리오 단위로 동작을 확인: [src/lib/ingest.scenarios.test.ts](src/lib/ingest.scenarios.test.ts), [src/lib/ingest.real-llm.test.ts](src/lib/ingest.real-llm.test.ts)
- LLM 응답 파싱: [src/lib/ingest-parse.test.ts](src/lib/ingest-parse.test.ts)
- **SHA256 incremental cache** (변경 없는 파일 skip): [src/lib/ingest-cache.ts](src/lib/ingest-cache.ts), [src/lib/ingest-cache.test.ts](src/lib/ingest-cache.test.ts)
- **Persistent ingest queue** (직렬 처리, 재시작 복구, 재시도, cancel): [src/lib/ingest-queue.ts](src/lib/ingest-queue.ts), [src/lib/ingest-queue.test.ts](src/lib/ingest-queue.test.ts), [src/lib/ingest-queue.integration.test.ts](src/lib/ingest-queue.integration.test.ts)
- 동시 실행 방지를 위한 mutex: [src/lib/project-mutex.ts](src/lib/project-mutex.ts)
- 큐 시각화 UI: [src/components/layout/activity-panel.tsx](src/components/layout/activity-panel.tsx)
- **Folder import** / 파일 검색은 commands 계층에서 처리: [src/commands/fs.ts](src/commands/fs.ts) (frontend), [src-tauri/src/commands/fs.rs](src-tauri/src/commands/fs.rs) (backend)
- **Auto-embedding** (ingest 직후 임베딩 자동 갱신): [src/lib/embedding.ts](src/lib/embedding.ts)

### 4. Knowledge Graph + 4-Signal Relevance Model

- **4-signal 관련도 계산** (direct link, source overlap, Adamic-Adar, type affinity, 가중치 ×3.0/×4.0/×1.5/×1.0): [src/lib/graph-relevance.ts](src/lib/graph-relevance.ts)
- 그래프 데이터 빌더 (wiki 디렉토리 → nodes/edges): [src/lib/wiki-graph.ts](src/lib/wiki-graph.ts)
- 그래프 시각화 (sigma.js + graphology + ForceAtlas2, hover, zoom, position cache): [src/components/graph/graph-view.tsx](src/components/graph/graph-view.tsx)

### 5. Louvain Community Detection

- 클러스터 감지(graphology-communities-louvain), cohesion 점수, 12-color 팔레트 처리: [src/components/graph/graph-view.tsx](src/components/graph/graph-view.tsx) 내부의 community 관련 로직과 [src/lib/wiki-graph.ts](src/lib/wiki-graph.ts) 를 함께 보세요.
- (Type/Community 토글, legend도 동일 컴포넌트에 함께 있음.)

### 6. Graph Insights — Surprising Connections & Knowledge Gaps

- **인사이트 산출 알고리즘** (cross-community edge, isolated nodes, sparse community, bridge node, 종합 surprise score): [src/lib/graph-insights.ts](src/lib/graph-insights.ts)
- 인사이트 카드 / 클릭 하이라이트 / Deep Research 트리거 UI: [src/components/graph/graph-view.tsx](src/components/graph/graph-view.tsx)
- Graph Insight → Deep Research 연결 시 사용되는 도메인-aware 토픽 최적화: [src/lib/optimize-research-topic.ts](src/lib/optimize-research-topic.ts), [src/lib/optimize-research-topic.test.ts](src/lib/optimize-research-topic.test.ts)

### 7. Optimized Query Retrieval Pipeline (4-Phase)

- **Phase 1 / 1.5 / 2 / 3 / 4 통합 검색**: [src/lib/search.ts](src/lib/search.ts)
- CJK bigram, stopword, RRF 등 토크나이저/스코어링 검증: [src/lib/search.scenarios.test.ts](src/lib/search.scenarios.test.ts), [src/lib/search-rrf.test.ts](src/lib/search-rrf.test.ts)
- **Phase 1.5 Vector Search** (LanceDB 기반):
  - Frontend embedding 호출 / 증분 동기화: [src/lib/embedding.ts](src/lib/embedding.ts), [src/lib/embedding.test.ts](src/lib/embedding.test.ts)
  - 텍스트 청킹: [src/lib/text-chunker.ts](src/lib/text-chunker.ts), [src/lib/text-chunker.test.ts](src/lib/text-chunker.test.ts)
  - Tauri 명령으로 LanceDB 접근: [src-tauri/src/commands/vectorstore.rs](src-tauri/src/commands/vectorstore.rs)
  - 임베딩 endpoint 정규화 (`/v1/embeddings` 등): [src/lib/endpoint-normalizer.ts](src/lib/endpoint-normalizer.ts)
  - 설정 UI: [src/components/settings/sections/embedding-section.tsx](src/components/settings/sections/embedding-section.tsx)
- **Phase 2 Graph Expansion**: [src/lib/graph-relevance.ts](src/lib/graph-relevance.ts) (검색 결과를 seed로 2-hop 확장)
- **Phase 3 Budget Control** (4K~1M, 60/20/5/15 split): [src/lib/context-budget.ts](src/lib/context-budget.ts), [src/lib/context-budget.test.ts](src/lib/context-budget.test.ts)
- **Phase 4 Context Assembly** + 시스템 프롬프트 (purpose, language, citation, index): [src/lib/search.ts](src/lib/search.ts) 의 컨텍스트 빌더 부분과 [src/lib/output-language.ts](src/lib/output-language.ts), [src/lib/detect-language.ts](src/lib/detect-language.ts) 참고.
- 검색 화면 UI: [src/components/search/search-view.tsx](src/components/search/search-view.tsx)

### 8. Multi-Conversation Chat with Persistence

- 채팅 패널 / 메시지 / 입력: [src/components/chat/chat-panel.tsx](src/components/chat/chat-panel.tsx), [src/components/chat/chat-message.tsx](src/components/chat/chat-message.tsx), [src/components/chat/chat-input.tsx](src/components/chat/chat-input.tsx)
- 회화 목록 / 상단 바: [src/components/layout/chat-bar.tsx](src/components/layout/chat-bar.tsx)
- 회화 단위 영속화 (`.llm-wiki/chats/{id}.json`): [src/lib/persist.ts](src/lib/persist.ts)
- 인용 페이지 묶음 / Save to Wiki / Regenerate 동작은 [src/components/chat/chat-panel.tsx](src/components/chat/chat-panel.tsx) 와 [src/lib/search.ts](src/lib/search.ts) 를 함께 보세요. (Save to Wiki는 `wiki/queries/` 작성 후 [src/lib/ingest.ts](src/lib/ingest.ts) 재호출)
- 인사말 등 가벼운 입력 감지 (검색 생략): [src/lib/greeting-detector.ts](src/lib/greeting-detector.ts)

### 9. Thinking / Reasoning Display (`<think>` 블록)

- 메시지 렌더러에서 `<think>` 태그를 분리해 5줄 롤링 / 페이드 / collapsible로 그리는 로직: [src/components/chat/chat-message.tsx](src/components/chat/chat-message.tsx)
- 모델별 streaming 처리 (think 토큰 포함): [src/lib/llm-client.ts](src/lib/llm-client.ts), [src/lib/llm-providers.ts](src/lib/llm-providers.ts)

### 10. KaTeX Math Rendering

- 메시지 / 프리뷰 렌더 (remark-math + rehype-katex 적용 위치): [src/components/chat/chat-message.tsx](src/components/chat/chat-message.tsx), [src/components/editor/file-preview.tsx](src/components/editor/file-preview.tsx)
- Milkdown 에디터의 math 플러그인: [src/components/editor/wiki-editor.tsx](src/components/editor/wiki-editor.tsx)
- 자동 `$$` 래핑 / `\begin{aligned}` 감지, Unicode 폴백: [src/lib/latex-to-unicode.ts](src/lib/latex-to-unicode.ts)

### 11. Review System (Async Human-in-the-Loop)

- 리뷰 항목 정의 / 정규화 / 액션 제약 (Create Page, Deep Research, Skip): [src/lib/review-utils.ts](src/lib/review-utils.ts), [src/lib/review-utils.test.ts](src/lib/review-utils.test.ts)
- 리뷰 큐 일괄 처리 (sweep): [src/lib/sweep-reviews.ts](src/lib/sweep-reviews.ts), [src/lib/sweep-reviews.scenarios.test.ts](src/lib/sweep-reviews.scenarios.test.ts), [src/lib/sweep-reviews.race.test.ts](src/lib/sweep-reviews.race.test.ts)
- 리뷰 화면: [src/components/review/review-view.tsx](src/components/review/review-view.tsx)
- 리뷰 항목은 ingest 시 LLM이 만들어 둠 → [src/lib/ingest.ts](src/lib/ingest.ts)

### 12. Deep Research

- 리서치 파이프라인 (Tavily 호출, 멀티 쿼리, 결과 합성, auto-ingest): [src/lib/deep-research.ts](src/lib/deep-research.ts)
- Tavily / 웹 검색 클라이언트: [src/lib/web-search.ts](src/lib/web-search.ts)
- 도메인-aware 토픽/쿼리 최적화 (overview.md + purpose.md 활용): [src/lib/optimize-research-topic.ts](src/lib/optimize-research-topic.ts)
- Research 사이드 패널 (실시간 streaming, thinking 표시): [src/components/layout/research-panel.tsx](src/components/layout/research-panel.tsx)
- 설정: [src/components/settings/sections/web-search-section.tsx](src/components/settings/sections/web-search-section.tsx)

### 13. Browser Extension (Chrome Web Clipper)

- Manifest V3 정의: [extension/manifest.json](extension/manifest.json)
- 팝업 UI (project picker 포함): [extension/popup.html](extension/popup.html), [extension/popup.js](extension/popup.js)
- 본문 추출: [extension/Readability.js](extension/Readability.js)
- HTML → Markdown 변환: [extension/Turndown.js](extension/Turndown.js)
- **Local HTTP API 서버 (port 19827, tiny_http)** — App 측 수신부: [src-tauri/src/clip_server.rs](src-tauri/src/clip_server.rs)
- 클립 폴더 폴링 (3초 간격) 및 자동 ingest 트리거: [src/lib/clip-watcher.ts](src/lib/clip-watcher.ts)

### 14. Multi-format Document Support

- 파일 타입 분기 / 확장자 매핑: [src/lib/file-types.ts](src/lib/file-types.ts)
- 프리뷰 (이미지/비디오/오디오/마크다운/오피스): [src/components/editor/file-preview.tsx](src/components/editor/file-preview.tsx)
- 백엔드(Rust)에서 PDF/DOCX/PPTX/XLSX 텍스트 추출: [src-tauri/src/commands/fs.rs](src-tauri/src/commands/fs.rs) (Cargo 의존성은 [src-tauri/Cargo.toml](src-tauri/Cargo.toml) 참고 — `pdf-extract`, `docx-rs`, `calamine` 등)

### 15. File Deletion with Cascade Cleanup

- 삭제 의사결정 (어떤 wiki 페이지가 함께 지워져야 하나 / sources[]에서만 제거되어야 하나): [src/lib/source-delete-decision.ts](src/lib/source-delete-decision.ts), [src/lib/source-delete-decision.test.ts](src/lib/source-delete-decision.test.ts)
- 페이지 삭제 + index.md / wikilink 정리: [src/lib/wiki-page-delete.ts](src/lib/wiki-page-delete.ts), [src/lib/wiki-cleanup.ts](src/lib/wiki-cleanup.ts), [src/lib/sources-merge.ts](src/lib/sources-merge.ts)
- 위키링크 보강/치환: [src/lib/enrich-wikilinks.ts](src/lib/enrich-wikilinks.ts)

### 16. Configurable Context Window (4K → 1M)

- 토큰 예산 비례 분배 (60/20/5/15): [src/lib/context-budget.ts](src/lib/context-budget.ts)
- 슬라이더 UI: [src/components/settings/context-size-selector.tsx](src/components/settings/context-size-selector.tsx)

### 17. Cross-Platform Compatibility

- **`normalizePath()` 등 경로 정규화 / Unicode-safe 문자열 처리**: [src/lib/path-utils.ts](src/lib/path-utils.ts), [src/lib/path-utils.test.ts](src/lib/path-utils.test.ts), [src/lib/path-utils.property.test.ts](src/lib/path-utils.property.test.ts)
- Tauri 설정 (플랫폼별 윈도우 동작 / 번들): [src-tauri/tauri.conf.json](src-tauri/tauri.conf.json), [src-tauri/tauri.macos.conf.json](src-tauri/tauri.macos.conf.json), [src-tauri/tauri.windows.conf.json](src-tauri/tauri.windows.conf.json), [src-tauri/tauri.linux.conf.json](src-tauri/tauri.linux.conf.json)
- 권한(capabilities): [src-tauri/capabilities/default.json](src-tauri/capabilities/default.json)
- 종료/숨김(close-to-hide / 종료 확인) 등 윈도우 이벤트: [src-tauri/src/lib.rs](src-tauri/src/lib.rs)
- 네이티브 패닉 가드: [src-tauri/src/panic_guard.rs](src-tauri/src/panic_guard.rs)

### 18. 그 밖의 추가 기능

- **i18n (en/zh)**: [src/i18n/index.ts](src/i18n/index.ts), [src/i18n/en.json](src/i18n/en.json), [src/i18n/zh.json](src/i18n/zh.json), 누락 키 검사: [src/i18n/i18n-parity.test.ts](src/i18n/i18n-parity.test.ts)
- **언어 감지 / 출력 언어 강제**: [src/lib/detect-language.ts](src/lib/detect-language.ts), [src/lib/output-language.ts](src/lib/output-language.ts)
- **LLM 멀티 프로바이더** (OpenAI / Anthropic / Google / Ollama / Custom 별 streaming, 헤더 차이): [src/lib/llm-providers.ts](src/lib/llm-providers.ts), [src/lib/llm-client.ts](src/lib/llm-client.ts), [src/lib/__tests__/llm-providers.test.ts](src/lib/__tests__/llm-providers.test.ts)
- **Claude Code CLI provider (API 키 불필요)** — 최근 추가된 기능: [src/lib/claude-cli-transport.ts](src/lib/claude-cli-transport.ts), [src/lib/__tests__/claude-cli-transport.test.ts](src/lib/__tests__/claude-cli-transport.test.ts), [src-tauri/src/commands/claude_cli.rs](src-tauri/src/commands/claude_cli.rs), 프리셋: [src/components/settings/llm-presets.ts](src/components/settings/llm-presets.ts), [src/components/settings/preset-resolver.ts](src/components/settings/preset-resolver.ts)
- **Tauri 기반 fetch 어댑터** (CORS 우회, 헤더 제어): [src/lib/tauri-fetch.ts](src/lib/tauri-fetch.ts)
- **Lint** (wiki 건강도 점검): [src/lib/lint.ts](src/lib/lint.ts), [src/components/lint/lint-view.tsx](src/components/lint/lint-view.tsx)
- **자동 저장 / 업데이트 체크 / 위키 파일명 정규화**: [src/lib/auto-save.ts](src/lib/auto-save.ts), [src/lib/update-check.ts](src/lib/update-check.ts), [src/lib/wiki-filename.ts](src/lib/wiki-filename.ts)
- **설정 화면 전반**: [src/components/settings/settings-view.tsx](src/components/settings/settings-view.tsx) 와 [src/components/settings/sections/](src/components/settings/sections/) 하위 섹션들

---

### 추천 학습 순서

1. **3-layer 모델 체감** — 빈 프로젝트를 만들고 [src/lib/templates.ts](src/lib/templates.ts) 가 어떤 `purpose.md` / `schema.md` 를 생성하는지 본다.
2. **Ingest 흐름** — [src/lib/ingest.ts](src/lib/ingest.ts) → [src/lib/ingest-queue.ts](src/lib/ingest-queue.ts) → [src/lib/ingest-cache.ts](src/lib/ingest-cache.ts) 순서로 읽고, [src/lib/ingest.scenarios.test.ts](src/lib/ingest.scenarios.test.ts) 로 검증.
3. **Search/Query 파이프라인** — [src/lib/search.ts](src/lib/search.ts) 를 한 번에 정독한 뒤, 곁가지로 [src/lib/context-budget.ts](src/lib/context-budget.ts), [src/lib/embedding.ts](src/lib/embedding.ts), [src/lib/graph-relevance.ts](src/lib/graph-relevance.ts) 를 본다.
4. **Graph & Insights** — [src/lib/wiki-graph.ts](src/lib/wiki-graph.ts) → [src/lib/graph-relevance.ts](src/lib/graph-relevance.ts) → [src/lib/graph-insights.ts](src/lib/graph-insights.ts) → [src/components/graph/graph-view.tsx](src/components/graph/graph-view.tsx).
5. **Deep Research / Review 사이클** — [src/lib/deep-research.ts](src/lib/deep-research.ts), [src/lib/sweep-reviews.ts](src/lib/sweep-reviews.ts).
6. **Cross-cutting (LLM provider, 경로/유니코드, Tauri)** — [src/lib/llm-providers.ts](src/lib/llm-providers.ts), [src/lib/path-utils.ts](src/lib/path-utils.ts), [src-tauri/src/lib.rs](src-tauri/src/lib.rs).
7. **Extension** — [extension/popup.js](extension/popup.js) → [src-tauri/src/clip_server.rs](src-tauri/src/clip_server.rs) → [src/lib/clip-watcher.ts](src/lib/clip-watcher.ts) 흐름으로 클립 한 건이 wiki에 들어가는 경로 추적.

> 각 항목의 `*.test.ts` 파일은 **명세서 역할**을 합니다. 함수 시그니처보다 테스트의 입출력 예시를 먼저 보면 가장 적은 노력으로 의도를 파악할 수 있습니다.