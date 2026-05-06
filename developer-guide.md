# developer-guide.md — LLM Wiki 개발자 가이드

이 문서는 LLM Wiki를 **소스에서 빌드, 실행, 디버깅, 배포**하려는 개발자를 위한
가이드다. 사용자 가이드는 [GUIDE.md](GUIDE.md), 설계 철학은 [IDEA.md](IDEA.md),
구현 단계는 [development-plan.md](development-plan.md) /
[second-development-plan.md](second-development-plan.md)를 참고한다.

LLM Wiki는 **Tauri v2 (Rust 백엔드) + React 19 (TypeScript / Vite 프론트엔드)**
구조의 데스크톱 앱이다. 따라서 Node 툴체인과 Rust 툴체인을 모두 갖춰야 한다.

---

## 0. 한눈에 보기 — 30초 요약

```bash
# 1) 의존성 설치
npm install

# 2) 데스크톱 앱 개발 모드 (Vite + Tauri 동시 기동)
npm run tauri dev
winget install protobuf

# 3) 프로덕션 번들 빌드 (.msi / .dmg / .deb / .AppImage)
npm run tauri build

# 4) 테스트
npm run test:mocks   # 빠름. CI에서 항상 실행
npm run test:llm     # 실제 LLM 호출. .env.test.local 필요

# 5) 타입체크만
npm run typecheck
```

| 작업 | 명령 | 비고 |
|---|---|---|
| 프론트엔드 단독 dev | `npm run dev` | 브라우저에서 [http://localhost:1420](http://localhost:1420). Tauri IPC는 동작 X |
| 데스크톱 앱 dev | `npm run tauri dev` | Rust 컴파일 + Vite 동시. 실제 검증은 항상 이걸로 |
| 프로덕션 빌드 | `npm run tauri build` | typecheck → vite build → cargo build --release → bundle |
| 프론트 빌드만 | `npm run build` | `dist/` 생성. typecheck 포함 |
| 단위 테스트 | `npm run test:mocks` | mock LLM. 모든 PR에서 통과해야 함 |
| 실제 LLM 테스트 | `npm run test:llm` | 비용 발생. 직렬 실행 (`--no-file-parallelism`) |

---

## 1. 사전 요구사항

### 1.1 공통

| 도구 | 최소 버전 | 확인 |
|---|---|---|
| Node.js | **20+** | `node -v` |
| npm | 10+ | `npm -v` |
| Rust (stable) | 1.70+ | `rustc --version` |
| Cargo | (Rust에 포함) | `cargo --version` |
| protoc (Protobuf 컴파일러) | 3+ | `protoc --version` |
| Git | 최신 | `git --version` |

`protoc`는 LanceDB(벡터 DB) 빌드에 필요하다. **없으면 `cargo build`가 중간에 깨진다.**

### 1.2 플랫폼별 추가 의존성

#### Windows

```powershell
# protoc — Chocolatey 또는 scoop, 혹은 release zip 직접 다운로드
choco install protoc -y
# 또는
scoop install protobuf

# Visual Studio Build Tools (C++ workload) — Rust 링커가 필요로 함
# https://visualstudio.microsoft.com/visual-cpp-build-tools/

# WebView2 — Windows 11에는 기본 포함. Windows 10이면 다음에서 설치:
# https://developer.microsoft.com/microsoft-edge/webview2/
```

#### macOS

```bash
# Xcode Command Line Tools
xcode-select --install

# Homebrew + protoc
brew install protobuf
```

#### Linux (Ubuntu 22.04 기준)

```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libappindicator3-dev \
  librsvg2-dev \
  patchelf \
  protobuf-compiler \
  build-essential \
  curl \
  wget \
  file \
  libxdo-dev \
  libssl-dev
```

`webkit2gtk-4.1`이 핵심이다. 다른 배포판(Fedora, Arch)이면 패키지명이 다르므로
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)를 참조.

### 1.3 Tauri CLI

`@tauri-apps/cli`는 `package.json`의 devDependencies에 포함되어 있어 `npm install`
한 번이면 자동 설치된다. 별도로 `cargo install tauri-cli`를 할 필요가 없다.

```bash
npx tauri --version
# → 2.x.x
```

---

## 2. 프로젝트 구조 (개발자 시점)

```text
llm_wiki/
├── src/                          # 프론트엔드 (React + TS)
│   ├── App.tsx                   # 라우팅 진입점
│   ├── main.tsx                  # ReactDOM.render
│   ├── components/               # UI 컴포넌트 (3-column 레이아웃 등)
│   ├── lib/                      # 도메인 로직 (ingest, search, graph, lint)
│   ├── commands/                 # 프론트엔드 → Tauri IPC 래퍼
│   ├── stores/                   # Zustand 상태
│   ├── i18n/                     # ko/en/zh 리소스 + parity 테스트
│   └── test-helpers/             # vitest setup (.env.test.local 로더)
│
├── src-tauri/                    # 백엔드 (Rust)
│   ├── src/
│   │   ├── main.rs               # 데스크톱 앱 entry
│   │   ├── lib.rs                # 부트스트랩 / window 이벤트
│   │   ├── commands/             # IPC 명령 (#[tauri::command])
│   │   ├── clip_server.rs        # 브라우저 확장용 HTTP 서버 (port 19827)
│   │   └── panic_guard.rs        # 네이티브 패닉 → Result 변환
│   ├── Cargo.toml                # Rust 의존성
│   ├── tauri.conf.json           # 공통 Tauri 설정
│   ├── tauri.{macos,windows,linux}.conf.json   # 플랫폼별 오버라이드
│   ├── capabilities/             # Tauri permission scopes
│   ├── pdfium/                   # 플랫폼별 pdfium 동적 라이브러리 (PDF 추출용)
│   └── icons/                    # 앱 아이콘
│
├── extension/                    # Chrome 확장 (Manifest V3)
├── schema/                       # 사용자 schema 예시 (game-dev 등)
├── dist/                         # vite build 산출물 (gitignore)
├── package.json                  # 프론트엔드 의존성 + npm 스크립트
├── vite.config.ts                # Vite 설정 (port 1420 고정)
├── tsconfig.*.json               # TypeScript 설정 분할
├── README.md / GUIDE.md / IDEA.md / *.md  # 설계·사용자 문서
└── .github/workflows/            # CI (ci.yml) + Release (build.yml)
```

핵심 진입점 매핑:

| 영역 | 진입점 | 비고 |
|---|---|---|
| Frontend | `src/main.tsx` → `src/App.tsx` | React 19, Strict Mode |
| Backend | `src-tauri/src/main.rs` → `lib.rs` | Tauri 2 setup hook |
| IPC | `src/commands/*.ts` ↔ `src-tauri/src/commands/*.rs` | 양쪽이 짝을 이룸 |
| 그래프 | `src/lib/wiki-graph.ts` + `src/components/graph/graph-view.tsx` | sigma.js |
| 검색 | `src/lib/search.ts` | 4-phase pipeline |

---

## 3. 처음 빌드할 때 (Step-by-step)

### 3.1 클론과 설치

```bash
git clone https://github.com/nashsu/llm_wiki.git
cd llm_wiki
npm install
```

`npm install`은 다음을 수행한다:

- 프론트엔드 패키지 설치 (`node_modules/`)
- `@tauri-apps/cli`도 함께 설치되므로 별도 cargo 작업 불필요

### 3.2 첫 데스크톱 빌드 (개발 모드)

```bash
npm run tauri dev
```

이 명령이 내부적으로 하는 일:

1. `cargo build` — `src-tauri/`의 Rust 의존성을 컴파일 (**최초 5~15분 소요**)
2. `npm run dev` — Vite를 [http://localhost:1420](http://localhost:1420)에 기동
3. Vite가 준비되면 Tauri가 네이티브 윈도우를 띄워 그 URL을 로드

처음 빌드는 LanceDB / pdfium / arrow 등 무거운 crate 컴파일이 들어가서 느리다.
이후 빌드는 Rust 증분 캐시로 훨씬 빠르다. 캐시는 `src-tauri/target/`에 들어간다.

### 3.3 잘 됐는지 확인

윈도우가 뜨면서 다음이 보이면 정상:

- 좌측 아이콘 사이드바 (Wiki / Sources / Search / Graph 등)
- "New Project" 버튼이 있는 welcome screen
- 콘솔 (Vite + Rust 로그)에 에러가 없음

---

## 4. 개발 워크플로

### 4.1 일상 개발

```bash
npm run tauri dev
```

이걸 띄워둔 채로:

- **프론트엔드 변경**: 저장 즉시 Vite HMR로 핫리로드 (앱 재시작 불필요)
- **Rust 변경**: Tauri가 자동으로 다시 컴파일 → 앱 재시작 (수십 초 ~ 수 분)
- **`tauri.conf.json` 변경**: 같은 방식. 보통은 `npm run tauri dev`를 한 번 끄고
  다시 띄우는 게 안전

### 4.2 프론트엔드만 빠르게 보고 싶을 때

```bash
npm run dev
```

브라우저에서 [http://localhost:1420](http://localhost:1420). **단, Tauri IPC
(`invoke()`)가 동작하지 않으므로** 파일 시스템 접근, LanceDB, pdfium 등은 전부
실패한다. CSS / 레이아웃 / 컴포넌트 시각 점검 정도에만 쓴다.

### 4.3 타입체크 / 린트

```bash
npm run typecheck     # tsc --build
```

ESLint 설정은 별도로 두지 않았다. TypeScript strict 모드 + 컴파일러 진단을
1차 게이트로 사용한다.

### 4.4 테스트

```bash
npm run test:mocks    # Mock LLM 사용. 빠름 (수 초 ~ 수십 초)
npm run test:llm      # 실제 LLM 호출. .env.test.local 필요. 직렬 실행
npm test              # 위 두 개 순차 실행 (mocks → llm)
```

테스트 파일 분류:

- `*.test.ts` — 일반 단위 / 시나리오 테스트 (mock)
- `*.real-llm.test.ts` — 실제 LLM 통합 테스트
- `*.scenarios.test.ts` — 도메인 시나리오 묶음
- `*.property.test.ts` — fast-check 속성 기반 테스트
- `i18n-parity.test.ts` — ko/en/zh 키 일치 검증

#### `.env.test.local` 작성 예시 (real-LLM 테스트용)

저장소 루트에 만든다 (gitignore됨):

```env
# 예: OpenAI 호환 endpoint
TEST_LLM_PROVIDER=openai
TEST_LLM_BASE_URL=https://api.openai.com/v1
TEST_LLM_API_KEY=sk-...
TEST_LLM_MODEL=gpt-4o-mini

# 또는 로컬 Ollama
# TEST_LLM_PROVIDER=ollama
# TEST_LLM_BASE_URL=http://localhost:11434
# TEST_LLM_MODEL=llama3.1:8b
```

로더 구현은 [src/test-helpers/load-test-env.ts](src/test-helpers/load-test-env.ts)
에 있다. `process.env`에 이미 키가 있으면 덮어쓰지 않는다 (CI 호환).

### 4.5 단일 테스트 실행

```bash
# 특정 파일만
npx vitest run src/lib/search.scenarios.test.ts

# 특정 케이스 이름 매칭
npx vitest run -t "RRF score"

# watch 모드
npx vitest src/lib/search.scenarios.test.ts
```

---

## 5. 디버깅

### 5.1 프론트엔드 (React / TS)

#### 5.1.1 DevTools 열기

`npm run tauri dev`로 띄운 데스크톱 앱에서:

- **Windows / Linux**: `F12` 또는 `Ctrl+Shift+I`
- **macOS**: `Cmd+Option+I`

DevTools는 dev 빌드에서만 열린다 (release 빌드는 막혀 있음).
Release 빌드에서 강제로 열려면 `tauri.conf.json`의 보안 설정을 풀어야 하지만
**보통은 dev 빌드로 디버깅한다**.

#### 5.1.2 React 컴포넌트 디버깅

- Sources, Network, Console 탭 그대로 사용 가능
- React DevTools 확장은 Tauri WebView에 직접 설치할 수 없으므로, 컴포넌트 레벨
  검증이 필요하면 `npm run dev` (브라우저)로 띄워 React DevTools 확장과 함께 본다
- Zustand 상태는 [src/lib/persist.ts](src/lib/persist.ts), [src/lib/project-store.ts](src/lib/project-store.ts)
  에서 직접 expose하므로 콘솔에서 store 객체에 접근해 검증할 수 있다

#### 5.1.3 자주 보는 로그

- Vite/Console: `console.log`, `console.error`
- IPC 호출 실패 시: `invoke()`가 던지는 Error의 message에 Rust 측 에러가 들어옴

### 5.2 백엔드 (Rust)

#### 5.2.1 로그 보기

`npm run tauri dev`를 실행한 터미널에 Rust `println!` / `eprintln!`이 그대로
출력된다. `tracing` / `log` crate가 명시적으로 들어와 있지 않으므로
**디버그 출력은 `eprintln!("..."); ` 또는 `println!`** 으로 한다.

좀 더 구조화된 로그를 임시로 넣고 싶다면 `tracing`을 dev-dependencies가 아닌
일반 dependency로 추가해 사용해도 된다. PR로 합치기 전에는 제거.

#### 5.2.2 panic_guard

[src-tauri/src/panic_guard.rs](src-tauri/src/panic_guard.rs)는 Tauri 명령 경계에서
`std::panic::catch_unwind`로 panic을 잡아 `Result::Err`로 변환한다.

- `Cargo.toml`의 `panic = "unwind"`이 이를 가능하게 함
- 따라서 PDF 파서가 깨져도 앱이 통째로 죽지 않음
- 디버깅할 때 panic의 원본 스택을 보고 싶다면, 환경변수로 띄운다:

```bash
# Windows PowerShell
$env:RUST_BACKTRACE = "1"
npm run tauri dev

# macOS / Linux
RUST_BACKTRACE=1 npm run tauri dev
```

#### 5.2.3 IDE 디버거 붙이기

Rust 디버거를 Tauri 데스크톱 프로세스에 attach 할 수 있다:

- **VS Code + rust-analyzer + CodeLLDB**:
  - `.vscode/launch.json`에 `lldb` `attach` 구성을 만든 뒤
  - `npm run tauri dev`로 앱을 띄우고
  - 그 PID(예: `LLM Wiki.exe` / `llm-wiki`)에 attach
- **JetBrains RustRover / CLion**: 동일하게 attach 방식

명령형 컴파일/실행이 더 편하면 직접:

```bash
cd src-tauri
cargo build
# 실행 파일은 src-tauri/target/debug/llm-wiki(.exe)
# 단, 단독 실행 시 frontend가 없으므로 의미 없음 — 위의 attach 방식을 쓴다
```

### 5.3 Tauri IPC 디버깅

명령이 안 통하는 것 같으면 다음 순서로 확인:

1. **frontend 측**: `src/commands/*.ts`에서 `invoke("...")`의 인자 이름이
   Rust 측 `#[tauri::command]` 함수의 파라미터 이름과 정확히 같은가? (snake_case)
2. **command 등록 누락**: 새 명령은 `src-tauri/src/lib.rs`의
   `tauri::generate_handler![ ... ]`에 추가되어야 한다
3. **capabilities**: 일부 plugin (dialog, store, http, fs)은
   [src-tauri/capabilities/default.json](src-tauri/capabilities/default.json)
   의 permission에도 들어가야 한다
4. **CSP**: `tauri.conf.json`의 `security.csp`가 외부 호출을 막는 경우 있음.
   `connect-src`에 도메인 추가

### 5.4 클립 서버 (port 19827)

브라우저 확장과 통신하는 로컬 HTTP 서버는
[src-tauri/src/clip_server.rs](src-tauri/src/clip_server.rs)에 있다.

- 포트 19827이 이미 사용 중이면 서버 기동 실패 → 콘솔 로그 확인
- curl로 직접 검증 가능:

```bash
curl -X POST http://localhost:19827/clip \
  -H "Content-Type: application/json" \
  -d '{"title":"test","url":"http://example.com","content":"hi"}'
```

### 5.5 자주 보이는 빌드 에러와 해결

| 증상 | 원인 | 해결 |
|---|---|---|
| `error: failed to run custom build command for 'lance-...'` + protoc 언급 | protoc 미설치 | §1.2 플랫폼별로 protoc 설치, 셸 재시작 |
| `error: failed to find tool 'cl.exe'` (Windows) | MSVC 빌드툴 누락 | Visual Studio Build Tools에서 "C++ build tools" 워크로드 설치 |
| `error: linking with 'cc' failed` (Linux) | `build-essential` 누락 또는 webkit dev lib 누락 | §1.2 Linux 의존성 재설치 |
| `Error loading webview` (Windows 10) | WebView2 런타임 부재 | Microsoft에서 Evergreen 설치 |
| `pdfium ... failed to load library` | pdfium 동적 라이브러리 경로 문제 | `src-tauri/pdfium/`에 플랫폼별 파일이 있는지 확인 (libpdfium.dylib / .so / pdfium.dll) |
| `Port 1420 is already in use` | 이전 dev 인스턴스가 살아있음 | 해당 프로세스 종료. `vite.config.ts`의 `strictPort: true`라 자동 변경 안 됨 (의도적) |
| `Port 19827 is already in use` | 다른 LLM Wiki 인스턴스 또는 충돌 | 기존 인스턴스 종료. 그래도 충돌하면 OS의 점유 프로세스 확인 |
| Rust 빌드는 됐는데 화면이 비어있음 | Vite가 1420에 안 떴거나 CSP가 차단 | 콘솔 / DevTools Network 탭 확인 |

---

## 6. 프로덕션 빌드와 배포

### 6.1 로컬 프로덕션 번들

```bash
npm run tauri build
```

산출물 위치(`src-tauri/target/release/bundle/`):

| 플랫폼 | 산출물 |
|---|---|
| Windows | `msi/*.msi`, `nsis/*.exe` |
| macOS | `dmg/*.dmg`, `macos/*.app` |
| Linux | `deb/*.deb`, `appimage/*.AppImage` |

타겟이 "all" (`tauri.conf.json`)이라 가능한 모든 번들을 시도한다. 특정 타겟만
원하면:

```bash
npm run tauri build -- --bundles msi
npm run tauri build -- --bundles dmg
npm run tauri build -- --bundles deb,appimage
```

### 6.2 플랫폼별 오버라이드

- [src-tauri/tauri.windows.conf.json](src-tauri/tauri.windows.conf.json)
- [src-tauri/tauri.macos.conf.json](src-tauri/tauri.macos.conf.json)
- [src-tauri/tauri.linux.conf.json](src-tauri/tauri.linux.conf.json)

빌드 시 자동으로 OS에 맞는 파일이 머지된다. 윈도우 동작·번들 옵션·코드사이닝
관련 설정이 여기 들어간다.

### 6.3 GitHub Release (CI)

[.github/workflows/build.yml](.github/workflows/build.yml)이 다음을 자동화:

- `git push` 시 태그가 `v*` 패턴이면 → tauri-action으로 모든 플랫폼 빌드 후
  GitHub Release에 업로드
- `workflow_dispatch` (수동)이면 → Release 만들지 않고 artifact로만 업로드
- 추가로 `extension/manifest.json`의 버전을 `package.json`과 동기화한 뒤
  zip으로 묶어 release에 첨부

릴리스를 찍는 흐름:

```bash
# 1) 버전 올리기 — package.json, src-tauri/Cargo.toml, src-tauri/tauri.conf.json
#    세 파일의 version 필드를 동시에 동일 값으로 갱신
# 2) 커밋 + 태그
git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json
git commit -m "release: v0.4.0"
git tag v0.4.0
git push origin main
git push origin v0.4.0
# 3) GitHub Actions가 알아서 빌드/업로드
```

세 파일의 version이 어긋나면 사용자 UI(Settings)와 Cargo / Tauri 메타데이터가
서로 다른 값을 보인다. 갱신 누락이 흔한 실수다.

### 6.4 코드사이닝 (선택)

macOS의 dmg를 외부에 배포하려면 Apple Developer 인증서가 필요하다.
build.yml의 env 블록에 다음 secret이 있어야 한다:

- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_ID`
- `APPLE_PASSWORD`
- `APPLE_TEAM_ID`

없으면 unsigned 번들이 만들어지고 macOS Gatekeeper가 차단한다.
Windows MSI는 현재 코드사이닝 없이 배포된다.

---

## 7. 브라우저 확장 (Chrome Web Clipper)

### 7.1 개발 중 로드

1. Chrome에서 `chrome://extensions` 열기
2. 우상단 "개발자 모드" 토글
3. "압축해제된 확장 프로그램을 로드합니다" 클릭
4. 저장소의 [extension/](extension/) 디렉토리 선택

이 상태에서 데스크톱 앱(`npm run tauri dev`)이 떠 있으면 클립 시 port 19827로
전송 → 앱이 받아 wiki에 ingest.

### 7.2 변경 후

`extension/popup.js` 등 수정 후 `chrome://extensions`에서 새로고침 아이콘 클릭.
Manifest V3는 hot reload가 없다.

### 7.3 빌드/패키징

CI(build.yml)의 `package-extension` 잡이 태그 푸시 시 zip으로 자동 빌드한다.
수동 빌드:

```bash
cd extension
zip -r ../llm-wiki-extension.zip . -x "*.DS_Store"
```

`manifest.json`의 version은 chrome web store 호환을 위해 numeric-only
(`0.3.13`)여야 한다. CI는 자동으로 `package.json` 값으로 동기화한다.

---

## 8. 새 IPC 명령 추가하기 (체크리스트)

자주 하는 작업이라 절차를 박제한다.

1. **Rust 측**: [src-tauri/src/commands/](src-tauri/src/commands/)에 함수 추가
   ```rust
   #[tauri::command]
   pub async fn my_new_command(arg: String) -> Result<String, String> {
       Ok(format!("got {arg}"))
   }
   ```
2. **모듈 export**: 같은 디렉토리의 `mod.rs`에 `pub mod` 추가
3. **handler 등록**: [src-tauri/src/lib.rs](src-tauri/src/lib.rs)의
   `tauri::generate_handler![ ... ]` 매크로에 함수 이름 추가
4. **frontend wrapper**: [src/commands/](src/commands/)에 `invoke` 호출 래퍼
   ```ts
   import { invoke } from "@tauri-apps/api/core"
   export async function myNewCommand(arg: string): Promise<string> {
     return invoke("my_new_command", { arg })
   }
   ```
5. **capabilities** (필요 시): plugin 호출이라면
   [src-tauri/capabilities/default.json](src-tauri/capabilities/default.json)에
   permission 추가
6. **타입체크 + 재빌드**: `npm run tauri dev`를 한 번 껐다 다시 켜는 게 안전
   (Rust 핸들러 등록은 컴파일 타임에 결정됨)

---

## 9. 의존성 업데이트

### 9.1 Frontend

```bash
# 사소한 패치 업데이트
npm update

# major 업데이트는 패키지별로
npm install react@latest react-dom@latest
npm install @tauri-apps/api@latest @tauri-apps/cli@latest
```

업데이트 후 반드시:

```bash
npm run typecheck
npm run test:mocks
npm run tauri dev   # 시각/UX 회귀 점검
```

### 9.2 Backend (Rust)

```bash
cd src-tauri
cargo update             # Cargo.lock의 SemVer 호환 범위 내 업데이트
cargo update -p lancedb  # 특정 crate만
```

major 업데이트는 `Cargo.toml`을 직접 편집한 뒤 `cargo build`로 깨진 곳 수리.
Tauri / lancedb / pdfium-render는 메이저 변경 시 brittle하므로 별도 PR로 분리.

---

## 10. 흔히 하는 실수 (개발자 편)

| 증상 | 원인 / 해결 |
|---|---|
| "분명히 코드 고쳤는데 반영이 안 돼" | `npm run dev` (브라우저) 본 거임. Tauri IPC 쓰는 코드는 `npm run tauri dev`로 봐야 함 |
| Rust 코드 바꿔도 반영 안 됨 | `tauri.conf.json` 변경처럼 종종 자동 재컴파일이 누락됨. dev 프로세스 끄고 다시 띄우기 |
| Vite HMR이 죽음 | port 1420 충돌. 다른 인스턴스 종료 |
| `cargo build`만 단독으로 했더니 frontend가 없음 | 정상. `tauri dev` / `tauri build`가 frontend 빌드까지 묶어줌 |
| `git status`에 `dist/`가 잡힘 | gitignore에 들어있어야 함. 안 잡히면 `.gitignore` 점검 |
| 새 명령 등록했는데 frontend에서 못 찾음 | §8의 3번(handler 등록) 누락 |
| LanceDB 경로 에러 | macOS sandbox / Windows 경로 정규화 문제일 수 있음. [src/lib/path-utils.ts](src/lib/path-utils.ts) 우선 확인 |
| Tauri capability 에러("not allowed") | [src-tauri/capabilities/default.json](src-tauri/capabilities/default.json)에 permission 추가 |
| `npm run test:llm` 호출인데 매번 `null` 반환 | `.env.test.local`이 비었거나 endpoint URL 잘못 입력 |
| i18n parity 테스트 실패 | en/zh/ko 중 한 곳에만 키 추가됨. 세 파일 모두 갱신 |

---

## 11. 더 읽을 거리

- [README.md](README.md) — 프로젝트 개요 + 코드베이스 지도
- [GUIDE.md](GUIDE.md) — 사용자 워크플로
- [IDEA.md](IDEA.md) — 설계 철학 (Part 1: 가공, Part 2: 배제 검색)
- [development-plan.md](development-plan.md) — Stage 1~7 (Part 1)
- [second-development-plan.md](second-development-plan.md) — Stage 8~15 (Part 2)
- [Tauri v2 docs](https://v2.tauri.app/) — 공식 가이드
- [Vite docs](https://vitejs.dev/) — 프론트엔드 빌드
- [Vitest docs](https://vitest.dev/) — 테스트 러너
