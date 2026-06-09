# Graph 품질 개선 — 현황 및 해결 방향

## 목표

raw 데이터를 ingest하면 문서 내용이 **여러 개의 지식그래프로 분산 표현**되어야 한다.

핵심 제약: **지식그래프 하나의 관계 타입은 최대 4개**. 관계 종류가 너무 많으면 사용자가 시각화된 그래프를 읽을 수 없다.

그래프명에 그래프 성격을 반영 (`combat_weakness_graph`, `combat_combo_graph` 등)

---

## Fix 33: 채팅 입력창에 질문 타입 드롭다운 추가 ✅ 구현 완료

### 기획 의도

질문 타입(`QuestionType`)은 LLM이 답변할 때 채워야 할 구조화된 필드(`fields`)와 프롬프트 템플릿(`promptTemplate`)을 정의한다.

예를 들어 `fields: { cause: "원인 설명", solution: "해결 방법" }` 라면, LLM은 자유 형식 답변 대신 **cause** 키에 해당하는 원인, **solution** 키에 해당하는 해결 방법을 각각 답변에 포함해야 한다.

사용자가 채팅 입력창 하단의 드롭다운에서 질문 타입을 선택하면, 해당 타입의 `fields`와 `promptTemplate`이 시스템 프롬프트에 추가 섹션으로 주입되어 LLM이 그 구조에 맞게 답변하도록 유도한다. 선택은 부가적(optional)이며, 미선택 시 기존 자유 형식 답변이 유지된다.

### 동작 흐름

```
사용자가 드롭다운에서 질문 타입 선택 (또는 미선택)
    ↓
handleSend(text, questionTypeId?) 호출
    ↓
questionTypeId가 있으면 loadQuestionTypes()로 해당 타입 객체 조회
    ↓
시스템 프롬프트 끝에 "## Answer Format" 섹션 추가:
  - fields가 있으면: 각 key와 그 설명(value)을 열거 → LLM이 각 key에 대응하는 값을 답변에 포함
  - promptTemplate이 있으면: 해당 템플릿을 지시사항으로 추가
    ↓
LLM이 지정된 구조로 답변 생성
```

### 구현 대상 파일

| 파일 | 변경 내용 |
|------|---------|
| `src/components/chat/chat-input.tsx` | `questionTypeId?: string` 포함하도록 `onSend` 시그니처 변경. 입력창 하단에 질문 타입 드롭다운 추가. 드롭다운 옵션은 "None" + 로드된 질문 타입 목록. 프로젝트가 없으면 숨김 |
| `src/components/chat/chat-panel.tsx` | `handleSend(text, questionTypeId?)` 시그니처 변경. `questionTypeId`가 있으면 `loadQuestionTypes()`로 타입 객체를 찾아 시스템 프롬프트에 `## Answer Format` 섹션 주입 |

### 구현된 변경 내용

| 파일 | 변경 내용 |
|------|---------|
| `src/components/chat/chat-input.tsx` | `onSend` 시그니처에 `questionTypeId?: string` 추가. `projectPath?: string` prop 추가. `useEffect`로 `loadQuestionTypes(projectPath)` 호출해 타입 목록 로드. 입력창 상단에 "None" + 타입 목록 드롭다운 렌더링 (프로젝트 없거나 타입 0개이면 숨김). 전송 시 선택된 타입 id를 `onSend`에 전달 |
| `src/components/chat/chat-panel.tsx` | `loadQuestionTypes` import 추가. `handleSend(text, questionTypeId?)` 시그니처 변경. `questionTypeId`가 있으면 `loadQuestionTypes(pp)`로 타입 조회 후 system prompt 끝에 `## Answer Format` 섹션 주입 (fields 열거 + promptTemplate). `ChatInput`에 `projectPath` prop 전달 |

### 변경이 필요 없는 것

- `src/lib/question-types.ts` — `loadQuestionTypes()`, `QuestionType` 인터페이스 그대로 사용
- `src/stores/chat-store.ts` — `DisplayMessage` 구조 변경 없음. 질문 타입은 전송 시점에만 소비되고 메시지에 저장하지 않음
- `src/components/settings/sections/question-types-section.tsx` — 변경 없음

### 알려진 문제: 드롭다운이 표시되지 않는 원인

`loadQuestionTypes(projectPath)`는 세 경로를 순서대로 탐색한다:
1. `schema/question_types` (앱 번들 기본값)
2. `{project}/question_types`
3. `{project}/.llm-wiki/question-types`

앱 기본 질문 타입은 `schema/question_types/`에 존재하지만, `listDirectory()`는 Tauri 파일시스템 API를 사용한다. 이 경로는 Tauri 리소스 번들 내부에 있어 개발(dev) 환경과 프로덕션 빌드 모두에서 일반 파일 경로로 접근이 되지 않는다. 결과적으로 세 경로 모두 빈 배열을 반환하고, `questionTypes.length > 0` 조건을 통과하지 못해 드롭다운 자체가 렌더링되지 않는다. Fix 34에서 함께 수정한다.

---

## Fix 34: Vector Embedding 기본 활성화 + 채팅 입력창 Embedding 토글 + 질문 타입 드롭다운 수정

### 문제 정의

#### 문제 1: Vector Embedding이 기본 비활성화 상태

`wiki-store.ts`의 `embeddingConfig.enabled` 기본값이 `false`다. Embedding endpoint/model이 설정되어 있어도 사용자가 Settings에서 수동으로 토글을 켜야 한다. 설정이 갖춰진 상태에서도 검색이 token-only로 동작해 품질이 저하된다.

**기획 의도:** endpoint와 model이 설정되어 있으면 embedding 검색을 기본으로 사용한다. 단, 사용자가 채팅 입력창에서 쿼리별로 ON/OFF를 즉시 전환할 수 있어야 한다.

#### 문제 2: 쿼리별 Embedding 검색 ON/OFF 전환 수단 없음

현재는 Settings 화면을 열어야만 embedding을 켜고 끌 수 있다. 사용자가 특정 질문에 대해 token 검색만 원하거나, embedding 검색을 빠르게 비교해보고 싶을 때 대응 수단이 없다.

#### 문제 3: Fix 33 질문 타입 드롭다운 미표시

`schema/question_types/`가 Tauri 리소스 번들 경로라 `listDirectory()`로 접근되지 않아 드롭다운이 렌더링되지 않는다.

### 기획 의도

```
채팅 입력창 하단 (텍스트박스 아래):
┌──────────────────────────────────────────┐
│  [Question Type ▾]  [⚡ Embedding: ON ]  │
└──────────────────────────────────────────┘
```

- **Question Type 드롭다운**: 질문 타입 목록. 파일 로드 실패 시에도 "None" 옵션만으로 항상 표시.
- **Embedding 토글 버튼**: 현재 쿼리에 vector embedding 검색을 사용할지 여부. 버튼 클릭 시 즉시 ON/OFF 전환. 상태는 세션 내 유지 (store 저장 안 함).
  - ON 상태: `embeddingConfig.enabled`가 `true`일 때만 실제로 vector 검색 수행. 설정이 없으면 토글이 비활성화(disabled)되고 툴팁으로 안내.
  - OFF 상태: token 검색만 수행.
- **기본값**: `embeddingConfig.enabled && embeddingConfig.model`이 참이면 토글 초기값 ON, 아니면 OFF.

### 동작 흐름

```
사용자가 Embedding 토글 ON/OFF 선택
    ↓
handleSend(text, questionTypeId?, useEmbedding?) 호출
    ↓
useEmbedding=true이면 기존 searchWiki() 사용 (embeddingConfig 그대로)
useEmbedding=false이면 embeddingConfig를 일시적으로 disabled로 덮어씌워 searchWiki() 호출
    ↓
이후 파이프라인 동일
```

### 구현 대상 파일

| 파일 | 변경 내용 |
|------|---------|
| `src/stores/wiki-store.ts` | `embeddingConfig.enabled` 기본값을 `false → true`로 변경 |
| `src/lib/question-types.ts` | `loadQuestionTypes()`에서 `schema/question_types` 경로 대신 Tauri `resource()` API로 번들 리소스를 읽도록 수정. 또는 앱 기본 타입을 코드에 하드코딩해 파일 의존성 제거 |
| `src/components/chat/chat-input.tsx` | `onSend` 시그니처에 `useEmbedding?: boolean` 추가. Question Type 드롭다운을 파일 로드 성패와 무관하게 항상 표시(None 포함). Embedding 토글 버튼 추가 — `embeddingConfig` 구독해 초기값 설정, 설정 미완료 시 disabled. Question Type 드롭다운과 Embedding 토글을 같은 행에 배치 |
| `src/components/chat/chat-panel.tsx` | `handleSend(text, questionTypeId?, useEmbedding?)` 시그니처 변경. `useEmbedding=false`이면 `searchWiki()` 호출 전 `embeddingConfig`를 `{...embeddingConfig, enabled: false}`로 일시 override (store 상태 변경 없이 지역 변수로 처리). `ChatInput`에 `embeddingAvailable` prop 전달 |

### 변경이 필요 없는 것

- `src/lib/search.ts` — `fuseTokenAndVector()`는 `embeddingConfig.enabled`를 그대로 읽으므로 변경 없음. override는 chat-panel에서 처리
- `src/lib/embedding.ts` — 변경 없음
- `src/components/settings/sections/embedding-section.tsx` — Settings의 전역 ON/OFF는 그대로 유지

---

## Fix 35: 로컬 내장 임베딩 모델 (Built-in Embedding)

### 문제 정의

현재 embedding 검색을 쓰려면 사용자가 외부 서버(LM Studio, Ollama 등)를 별도로 실행하고 Settings에서 endpoint/model을 수동 입력해야 한다. 앱을 처음 실행하는 사용자는 설정 없이는 벡터 검색이 전혀 동작하지 않는다.

**기획 의도:** 앱 번들에 경량 다국어 임베딩 모델을 내장해 설정 없이도 즉시 벡터 검색이 동작하도록 한다. 외부 서버를 쓰고 싶은 사용자는 Settings에서 "External" 모드로 전환할 수 있다.

### 기술 선택: fastembed-rs (Rust)

| 후보 | 위치 | 장점 | 단점 |
|------|------|------|------|
| **fastembed-rs** | Rust (Tauri 백엔드) | 이미 Rust+LanceDB 파이프라인 존재, 번들 통합 자연스러움, ONNX 런타임 내장 | Cargo 의존성 추가, 첫 실행 시 모델 다운로드 필요 |
| Transformers.js | TS (프론트엔드) | JS 생태계 친숙 | Tauri WebView WASM 제한, 번들 복잡도 증가 |
| Ollama (외부) | 외부 프로세스 | 모델 선택 자유 | 사용자가 직접 설치해야 함 |

**선택: fastembed-rs** — 기존 Rust 벡터 파이프라인과 자연스럽게 통합되고, ONNX 런타임을 자체 포함해 별도 설치 불필요.

**기본 모델: `BAAI/bge-small-en-v1.5`** (fastembed-rs 기본값, ~130MB, 영어+한국어 실용 수준)
- 추후 `multilingual-e5-small`로 교체 가능 (한국어 품질 개선, ~470MB)

### 아키텍처 변경

#### 현재 흐름
```
fetchEmbedding(text, cfg)
  → HTTP POST cfg.endpoint  (외부 서버 필수)
  → 벡터 반환
```

#### 변경 후 흐름
```
fetchEmbedding(text, cfg)
  cfg.source === "builtin"  →  invoke("embed_text_builtin", { text })  (Rust fastembed)
  cfg.source === "external" →  HTTP POST cfg.endpoint  (기존 경로)
```

`EmbeddingConfig`에 `source: "builtin" | "external"` 필드 추가. 기본값 `"builtin"`.

### 구현 대상

| 파일 | 변경 내용 |
|------|---------|
| `src-tauri/Cargo.toml` | `fastembed = "4"` 의존성 추가 |
| `src-tauri/src/commands/vectorstore.rs` | `embed_text_builtin(text: String) → Vec<f32>` Tauri 커맨드 추가. fastembed `TextEmbedding` 초기화를 `OnceLock`으로 싱글턴 관리 (첫 호출 시 모델 초기화, 이후 재사용). 모델: `EmbeddingModel::BGESmallENV15` |
| `src-tauri/src/lib.rs` | `embed_text_builtin` 커맨드 등록 |
| `src/stores/wiki-store.ts` | `EmbeddingConfig`에 `source: "builtin" \| "external"` 추가. 기본값 `source: "builtin"`. 기존 저장값 마이그레이션: `source` 없으면 `endpoint`가 비어 있으면 `"builtin"`, 있으면 `"external"` |
| `src/lib/embedding.ts` | `fetchEmbedding()` 분기 추가: `cfg.source === "builtin"`이면 `invoke("embed_text_builtin")` 호출, `"external"`이면 기존 HTTP 경로. `embedPage()` / `searchByEmbedding()`의 `!cfg.model` 가드를 `source === "builtin"`일 때는 통과하도록 수정 (builtin은 model 필드 불필요) |
| `src/components/settings/sections/embedding-section.tsx` | 상단에 소스 선택 토글 추가: `Built-in (기본)` / `External (외부 서버)`. `"external"` 선택 시에만 endpoint/apiKey/model 필드 표시 (기존 UI 그대로 유지). `"builtin"` 상태 표시: "내장 모델 사용 중 (BGE-small)" + 현재 청크 수 |
| `src/lib/project-store.ts` | `loadEmbeddingConfig()` 반환값에 `source` 없으면 마이그레이션 로직 적용 |
| `src/App.tsx` | 변경 없음 — 기존 `loadEmbeddingConfig` 흐름 그대로 |

### 상세 설명

#### fastembed-rs 싱글턴 초기화 (Rust)

```rust
// src-tauri/src/commands/vectorstore.rs 에 추가
use fastembed::{TextEmbedding, InitOptions, EmbeddingModel};
use std::sync::OnceLock;

static BUILTIN_EMBEDDER: OnceLock<TextEmbedding> = OnceLock::new();

fn get_builtin_embedder() -> Result<&'static TextEmbedding, String> {
    BUILTIN_EMBEDDER.get_or_try_init(|| {
        TextEmbedding::try_new(
            InitOptions::new(EmbeddingModel::BGESmallENV15)
        ).map_err(|e| format!("Failed to init built-in embedder: {e}"))
    }).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn embed_text_builtin(text: String) -> Result<Vec<f32>, String> {
    run_guarded_async("embed_text_builtin", async move {
        let embedder = get_builtin_embedder()?;
        let results = embedder
            .embed(vec![text], None)
            .map_err(|e| format!("Embed error: {e}"))?;
        Ok(results.into_iter().next().unwrap_or_default())
    }).await
}
```

**모델 파일 캐시 위치:** fastembed-rs는 `~/.cache/fastembed` (또는 `$XDG_CACHE_HOME/fastembed`)에 자동 다운로드. 첫 실행 시 ~130MB 다운로드 발생 → Settings에 "첫 사용 시 모델 다운로드 (~130MB)" 안내 표시 필요.

#### fetchEmbedding 분기 (TS)

```typescript
export async function fetchEmbedding(
  text: string,
  cfg: EmbeddingConfig,
): Promise<number[] | null> {
  if (cfg.source === "builtin") {
    const { invoke } = await import("@tauri-apps/api/core")
    try {
      return await invoke<number[]>("embed_text_builtin", { text })
    } catch (err) {
      lastEmbeddingError = err instanceof Error ? err.message : String(err)
      return null
    }
  }
  // 기존 외부 HTTP 경로 (변경 없음)
  if (!cfg.endpoint) return null
  // ... 기존 코드 그대로
}
```

#### EmbeddingConfig 타입 변경

```typescript
interface EmbeddingConfig {
  source: "builtin" | "external"  // 추가
  enabled: boolean
  endpoint: string
  apiKey: string
  model: string
  maxChunkChars?: number
  overlapChunkChars?: number
}

// 기본값
embeddingConfig: {
  source: "builtin",
  enabled: true,
  endpoint: "",
  apiKey: "",
  model: "",
}
```

#### 마이그레이션 (project-store.ts)

```typescript
export async function loadEmbeddingConfig(): Promise<EmbeddingConfig | null> {
  const store = await getStore()
  const raw = await store.get<any>(EMBEDDING_KEY)
  if (!raw) return null
  // source 필드 없는 구버전: endpoint 있으면 external, 없으면 builtin
  if (!raw.source) {
    raw.source = raw.endpoint ? "external" : "builtin"
  }
  return raw as EmbeddingConfig
}
```

### 변경이 필요 없는 것

- `src/lib/search.ts` — `fuseTokenAndVector()`는 `embeddingConfig`를 그대로 넘기므로 변경 없음
- `embedPage()` / `embedAllPages()` 내 LanceDB 저장 경로 — 변경 없음
- `src/components/chat/chat-input.tsx` — embedding 토글은 source와 무관하게 동작
- `src/components/chat/chat-panel.tsx` — override 로직 변경 없음

### 동작 흐름 (최초 실행)

```
앱 시작
  → loadEmbeddingConfig() → null (첫 실행)
  → store 기본값 사용: { source: "builtin", enabled: true, ... }
  → 사용자가 채팅 질문
  → fetchEmbedding() → invoke("embed_text_builtin")
  → [첫 호출] fastembed OnceLock 초기화 → ~/.cache/fastembed 모델 다운로드 (~130MB)
  → 이후 호출: 캐시된 모델 즉시 사용
```

### Settings UI 변경 (embedding-section.tsx)

```
┌─────────────────────────────────────────────────────┐
│ Embedding Source                                    │
│  ● Built-in  (BGE-small, ~130MB, 첫 사용 시 다운로드)│
│  ○ External  (직접 endpoint 입력)                   │
└─────────────────────────────────────────────────────┘
[External 선택 시 기존 endpoint/apiKey/model 필드 표시]
```

---

## Fix 36: Question Type 삭제 및 YAML 편집 완전 지원

### 문제 정의

현재 `QuestionTypesSection`에는 편집(Edit)·삭제(Delete) 버튼이 UI에 존재하지만 실제 동작이 불완전하다.

1. **앱 기본 타입 삭제 불가** — `handleDelete`가 user override 경로(`/.llm-wiki/question-types/`)에 파일이 없으면 "Cannot delete system-default question types." alert만 뱉고 끝난다. 앱 기본 타입을 숨기는 메커니즘 자체가 없다.
2. **앱 기본 타입 편집 결과가 불명확** — 기본 타입을 편집 후 저장하면 user override 경로에 파일이 생기지만, 편집 화면에서 `editing.id`가 기존 id와 동일하므로 override가 되긴 한다. 그러나 사용자는 이 사실을 알 수 없고, 파일명(= id) 변경이 불가능하다.
3. **project-specific 경로(`question_types/`) 편집·삭제 불가** — `handleSave`는 항상 user override 경로에만 쓰고, `handleDelete`도 user 경로만 확인한다.
4. **출처(source) 정보 미전달** — `QuestionType`에 어느 경로에서 로드됐는지 정보가 없어서 편집/삭제 시 올바른 파일 경로를 추적할 수 없다.
5. **신규 타입의 id 결정 방식이 취약** — `handleSave`에서 `editing.id || parsed.name?.toLowerCase().replace(...)` 방식으로 id를 결정해, 새로 추가 시 id를 직접 지정할 수 없다.

### 설계 방침

| 타입 분류 | 편집 가능 | 삭제 가능 | 저장 경로 |
|---------|--------|--------|---------|
| 앱 기본 타입 | O (user override에 복사본 저장) | O (tombstone 파일 생성) | `/.llm-wiki/question-types/<id>.yaml` |
| project-specific (`question_types/`) | O | O | `question_types/<id>.yaml` |
| user override (`/.llm-wiki/question-types/`) | O | O | `/.llm-wiki/question-types/<id>.yaml` |

**앱 기본 타입 삭제 전략 — tombstone**: `/.llm-wiki/question-types/<id>.yaml`에 `_deleted: true` 필드를 가진 파일을 쓴다. `loadQuestionTypes`가 tombstone을 감지하면 해당 id를 결과에서 제외한다.

### 구현 대상

| 파일 | 변경 내용 |
|------|---------|
| `src/lib/question-types.ts` | `QuestionType`에 `_source: "app" \| "project" \| "user"` 및 `_filePath?: string` 필드 추가 (내부 전용, UI 비표시). `loadQuestionTypes`에서 각 타입 로드 시 출처 기록. tombstone(`_deleted: true`) 파일을 감지해 해당 id를 최종 목록에서 제외하는 로직 추가 |
| `src/components/settings/sections/question-types-section.tsx` | `handleDelete`: `_source === "app"`이면 user override 경로에 tombstone 파일 작성; `"project"` 또는 `"user"`이면 `_filePath` 직접 삭제. `handleSave`: `_source === "app"` 편집 → user override 경로에 저장; `"project"` 또는 `"user"` → `_filePath` 경로에 덮어쓰기. 신규(`handleNew`) 시 id 입력 필드 추가. 편집 화면에서 id 표시 및 신규 시 변경 가능하도록 수정 |

### 상세 설명

#### QuestionType 타입 변경

```typescript
export interface QuestionType {
  id: string
  name: string
  description: string
  fields?: Record<string, string>
  promptTemplate?: string
  inputShape?: string
  outputShape?: string
  zeroResidueMeaning?: string
  // 내부 전용 — UI에 표시하지 않음
  _source: "app" | "project" | "user"
  _filePath?: string  // "app" 타입은 undefined (파일 없음)
}
```

#### loadQuestionTypes 변경

```typescript
export async function loadQuestionTypes(projectPath: string): Promise<QuestionType[]> {
  const projectSpecificPath = `${projectPath}/question_types`
  const userOverridePath = `${projectPath}/.llm-wiki/question-types`

  const outMap = new Map<string, QuestionType>()

  // 1. 앱 기본 타입 (source: "app")
  for (const qt of APP_DEFAULT_QUESTION_TYPES) {
    outMap.set(qt.id, { ...qt, _source: "app" })
  }

  // 2. project-specific (source: "project") — 덮어쓰기
  for (const node of await tryListDirectory(projectSpecificPath)) {
    const qt = await loadNode(projectSpecificPath, node, "project")
    if (qt) outMap.set(qt.id, qt)
  }

  // 3. user override (source: "user") — 덮어쓰기, tombstone 처리
  for (const node of await tryListDirectory(userOverridePath)) {
    const qt = await loadNodeOrTombstone(userOverridePath, node)
    if (qt === null) {
      outMap.delete(node.name.replace(/\.(yaml|yml)$/, ""))  // tombstone → 제거
    } else if (qt) {
      outMap.set(qt.id, qt)
    }
  }

  return Array.from(outMap.values())
}
```

`loadNodeOrTombstone`: yaml 파싱 후 `_deleted: true`면 `null` 반환 (제거 신호), 정상이면 `QuestionType` 반환.

#### handleDelete 변경 (question-types-section.tsx)

```typescript
const handleDelete = async (qt: QuestionType) => {
  if (!projectPath) return
  if (!confirm(t("settings.questionTypes.confirmDelete", { id: qt.id }))) return

  if (qt._source === "app") {
    // tombstone: user override 경로에 _deleted: true yaml 저장
    const userPath = `${projectPath}/.llm-wiki/question-types`
    if (!(await fileExists(userPath))) await createDirectory(userPath)
    await writeFile(`${userPath}/${qt.id}.yaml`, "_deleted: true\n")
  } else {
    // project / user: 파일 직접 삭제
    await deleteFile(qt._filePath!)
  }

  await reload()
}
```

#### handleSave 변경 (question-types-section.tsx)

```typescript
const handleSave = async () => {
  if (!editing || !projectPath) return
  try {
    const parsed = yaml.load(yamlText) as any
    if (!parsed || typeof parsed !== "object") throw new Error("Invalid YAML")

    const id = editingId.trim() || "unnamed"
    const savePath = (editing._source === "project")
      ? `${projectPath}/question_types/${id}.yaml`
      : `${projectPath}/.llm-wiki/question-types/${id}.yaml`

    const dir = savePath.substring(0, savePath.lastIndexOf("/"))
    if (!(await fileExists(dir))) await createDirectory(dir)

    await writeFile(savePath, yamlText)
    setEditing(null)
    await reload()
  } catch (err: any) {
    setError(err.message)
  }
}
```

`editingId`는 별도 state로 관리. 신규 생성(`handleNew`)과 기존 편집 모두 id 필드를 표시하되, 신규 시에만 편집 가능하게 한다 (기존 타입 id 변경은 파일명 변경이 필요해 복잡도가 높으므로 이번 Fix 범위 밖).

#### 편집 UI 변경

- 편집 화면 상단에 `id` 표시: 신규 시 Input 필드, 기존 편집 시 읽기 전용 텍스트
- 앱 기본 타입 편집 시 "기본 타입을 편집하면 user override로 저장됩니다" 안내 문구 표시
- 앱 기본 타입 삭제 시 confirm 메시지에 "앱을 재설치하면 복구됩니다" 문구 추가

### 변경이 필요 없는 것

- `loadQuestionTypes` 반환 타입의 외부 소비자들 — `_source`, `_filePath`는 optional이고 기존 소비자는 이 필드를 읽지 않으므로 영향 없음
- chat-input.tsx, chat-panel.tsx — Question Type 선택 드롭다운은 id/name만 사용
- `parseFrontmatter`, `parseYamlQuestionType`, `parseMdQuestionType` — 변경 없음
