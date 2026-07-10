# Windows 배포 빌드 계획

대상: 다른 사용자 PC에 설치 가능한 Windows 인스톨러 생성

---

## 사전 준비 (빌드 머신 기준)

### 필수 도구 설치

| 도구 | 버전 | 확인 명령 |
|------|------|-----------|
| Rust | stable (rustup) | `rustc --version` |
| Node.js | 20 이상 | `node --version` |
| WebView2 런타임 | (Visual Studio 설치 시 포함) | - |

Rust 설치:
```powershell
winget install Rustlang.Rustup
```

### pdfium.dll 확인

Windows 번들에 `pdfium.dll`이 포함되어야 합니다. 빌드 전에 반드시 확인하세요.

```
src-tauri/pdfium/pdfium.dll  ← 이 파일이 존재해야 함
```

파일이 없으면 빌드는 되지만 PDF 기능이 런타임에 실패합니다.  
pdfium 바이너리는 [pdfium-binaries](https://github.com/bblanchon/pdfium-binaries/releases) 에서 `win-x64` 빌드를 받아 배치하세요.

---

## 빌드 절차

```powershell
# 1. 의존성 설치
npm install

# 2. Tauri 앱 빌드 (프론트엔드 빌드 + Rust 컴파일 + 인스톨러 생성)
npm run tauri build
```

빌드 완료 후 인스톨러 위치:

| 형식 | 경로 |
|------|------|
| MSI | `src-tauri/target/release/bundle/msi/*.msi` |
| NSIS EXE | `src-tauri/target/release/bundle/nsis/*.exe` |

---

## 설치 대상 PC 요구사항

| 항목 | 요구사항 |
|------|----------|
| OS | Windows 10 이상 (64비트) |
| WebView2 | 대부분의 Windows 10/11에 기본 설치됨. 없으면 인스톨러가 자동 다운로드 시도 |
| 관리자 권한 | MSI 설치 시 필요, NSIS는 per-user 설치 가능 |
| 추가 런타임 | 없음 (pdfium.dll, lancedb 등 모두 번들에 포함) |
| **git** | **필수** — PATH에 설치되어 있어야 함. 없으면 버전 관리 기능 전체 동작 안 함 |
| Port 19827 | 앱 시작 시 127.0.0.1:19827을 점유함. 다른 앱과 충돌 시 클립 캡처 기능 비활성화 |

### git 설치 확인

```powershell
git --version
```

미설치 시: [git-scm.com](https://git-scm.com/download/win) 또는 `winget install Git.Git`

### 선택적 LLM CLI 프로바이더

설정 페이지에서 Claude CLI / Codex / Gemini CLI를 선택한 경우 해당 바이너리도 PATH에 있어야 합니다. API 키 방식 프로바이더(OpenAI, Anthropic API 등)는 별도 설치 불필요.

| 프로바이더 | 필요 바이너리 |
|------------|--------------|
| Claude CLI | `claude` |
| OpenAI Codex | `codex` |
| Google Gemini CLI | `gemini` |

---

## 인스톨러 형식 선택

| 형식 | 특징 | 권장 상황 |
|------|------|-----------|
| NSIS (`.exe`) | 관리자 권한 없이 per-user 설치 가능, 작은 설치 파일 | 일반 배포 권장 |
| MSI (`.msi`) | 시스템 전체 설치, 그룹 정책 배포 가능 | IT 관리 환경 |

---

## 코드 서명 (선택)

현재 서명 설정이 없습니다. 서명 없이 배포하면 Windows Defender SmartScreen에서 "알 수 없는 게시자" 경고가 표시됩니다.

사내 배포라면 서명 없이도 무방하나, 경고를 없애려면 코드 서명 인증서가 필요합니다.

- **EV 인증서** (권장): SmartScreen 경고 즉시 해소
- **OV 인증서**: 초기에는 경고가 남을 수 있음 (평판 누적 필요)

인증서 적용 시 `tauri.conf.json`에 서명 설정을 추가하고 GitHub Actions 시크릿에 인증서를 등록하면 됩니다.

---

## 버전 관리

배포 전 버전 번호를 올리려면 두 파일을 동시에 수정해야 합니다.

```
package.json           → "version": "x.y.z"
src-tauri/Cargo.toml   → version = "x.y.z"
```

두 파일의 버전이 다르면 빌드 경고가 발생합니다.

---

## 빌드 시간 참고

- 최초 빌드: 15~30분 (Rust 크레이트 전체 컴파일)
- 이후 증분 빌드: 2~5분 (변경된 부분만 재컴파일)

Rust 컴파일 캐시(`src-tauri/target/`)를 보존하면 반복 빌드 속도가 크게 빨라집니다.
