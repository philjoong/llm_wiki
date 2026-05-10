# second-development-plan.md — IDEA Part 2 (검색) 단계별 실행 가이드

[development-plan.md](development-plan.md)가 IDEA Part 1(2차 산출물 생성)을
Stage 1~7로 풀었듯, 본 문서는 [IDEA.md](IDEA.md) Part 2(2차 산출물에 대한 검색)
§2.1~§2.10을 **수동 검증 가능한 단계**로 재구성한다. 재활용 지도는 [PLAN.md
§10](PLAN.md)를 따른다.

각 단계는 독립 PR. 단계 끝에서 앱을 켜고 "수동 검증" 절을 통과해야 다음 단계로
넘어간다.

**진입 조건:** development-plan.md Stage 1~7 모두 통과.

**범위 한정:** IDEA Part 2 §2.1~§2.10. **탐색 알고리즘 자체**(질문 본문에 따른
우선순위 산정, RRF 가중, 그래프 워크 등)는 본 plan 범위 밖 — 기존
[search.ts](src/lib/search.ts) / [embedding.ts](src/lib/embedding.ts) /
[graph-relevance.ts](src/lib/graph-relevance.ts)를 그대로 호출하되, 입력 후보
공간만 정적 배제로 좁힌다.

---

## Stage 0 — 사전 준비

검증용 프로젝트 경로: `/tmp/llm-wiki-stage{N}/`. 각 Stage마다 새 디렉토리에서
초기화. 모드는 `npm run tauri dev`.

자동 검증:

| 명령 | 의미 |
|---|---|
| `npm run typecheck` | 타입 에러 없음 |
| `npm run test:mocks` | LLM 호출 없는 단위 테스트 |
| `cargo test --lib commands::git_ops` | Stage 2/7에서 깐 git 백엔드 회귀 |

---

## Stage 8 — 검색용 디렉토리 부트스트랩 (PR-8, M7)

**목표:** 프로젝트 생성 시 `question_types/`, `exclusions/{by_question_type,axioms,instances}/`
4개 디렉토리 + 시드 schema 2개(`exclusion_schema.md`, `promotion_rules.md`)를
**시스템이 항상 보장**한다. 빌트인 question_type 데이터는 만들지 않으며, 사용자가
직접 채우거나 `schema/` 예시를 복사한다. ingest sandbox 허용 prefix를 확장한다.

### UX 변경

새 프로젝트 트리 (Stage 1의 시스템 prefix와 합쳐서):

```
db/                       # Stage 1
pending/                  # Stage 1
counterexamples/          # Stage 1
question_types/           # Stage 8 신규
exclusions/
  exclusion_schema.md     # Stage 8 시드
  promotion_rules.md      # Stage 8 시드
  by_question_type/       # Stage 8 신규
  axioms/                 # Stage 8 신규
  instances/              # Stage 8 신규
schema.md
purpose.md
```

> `processed_1/`은 second-fix-develop.md §2 D3에서 제거됨 — 패스스루 산출물은
> `raw/sources/<name>.md`에 직접 씀. 본 plan은 그 결정 이후 상태를 전제한다.

### 작업 항목

- [x] [src/lib/project-init.ts](src/lib/project-init.ts) — `SYSTEM_PREFIX_DIRS`에
  `question_types`, `exclusions/by_question_type`, `exclusions/axioms`,
  `exclusions/instances` 추가. 각 디렉토리에 `.gitkeep`.
- [x] [src/lib/project-init.ts](src/lib/project-init.ts) — `exclusions/exclusion_schema.md`
  및 `exclusions/promotion_rules.md`를 **시드 markdown**으로 작성:
  - `exclusion_schema.md`: 좌표계(질문 유형 축 단일) / 적용 시점(검색 시작 1회) /
    충돌 규칙(axiom > pattern, archived 제외).
  - `promotion_rules.md`: Level 1 → 2 → 3 임계값, "**자동 승격 금지** — 빈도는
    신호일 뿐 사람의 명시적 승인이 필수" 명시.
  - 두 파일 모두 사람이 자유 편집 가능한 plain markdown.
- [x] [src/lib/ingest.ts:66](src/lib/ingest.ts#L66) `SAFE_INGEST_PREFIXES` —
  `question_types/`, `exclusions/` 2개 추가. 거부 메시지에도 반영.
- [x] [src/lib/__tests__/project-init.test.ts](src/lib/__tests__/project-init.test.ts)
  갱신 — 신규 디렉토리 4개 + 시드 파일 2개 생성 + git initial commit에 staged 검증.

### 자동 검증

```bash
npm run typecheck
npm run test:mocks
```

### 수동 검증 (앱 실행)

1. `npm run tauri dev`. 새 프로젝트 `/tmp/llm-wiki-stage8/` 생성.
2. ```bash
   ls -la /tmp/llm-wiki-stage8/
   ```
   **확인:** Stage 1의 4개 prefix + `question_types/` + `exclusions/`가 모두 존재.
3. ```bash
   cat /tmp/llm-wiki-stage8/exclusions/exclusion_schema.md
   cat /tmp/llm-wiki-stage8/exclusions/promotion_rules.md
   ```
   **확인:** 사람이 읽을 수 있는 시드 내용. 자동 승격 금지 문구 포함.
4. ```bash
   cd /tmp/llm-wiki-stage8 && git log --stat HEAD
   ```
   **확인:** initial commit에 신규 디렉토리/파일이 모두 staged.

### 완료 조건

1~4 통과. ingest 회귀 — Stage 1 검증 절차 반복 시 동일 결과.

---

## Stage 9 — Question Type / Static Exclusion 로더 + glob 매처 (PR-9, M7)

**목표:** `question_types/*.md`와 `exclusions/{by_question_type,axioms}/*.md`를
파싱하는 **순수 로더**와, db/ 트리 후보 리스트에 적용하는 **glob 매처**.
이 단계는 데이터 레이어만 — UI/검색 wiring은 Stage 11.

### 데이터 모델

```ts
// src/lib/question-types.ts
export interface QuestionType {
  id: string                    // 파일명 stem (e.g. "policy_violation")
  name: string                  // frontmatter `title` 또는 첫 H1
  description: string           // 본문 첫 단락
  inputShape?: string           // ## Input 섹션 본문 (optional)
  outputShape?: string          // ## Output 섹션 본문 (optional)
  zeroResidueMeaning?: string   // ## Zero residue 섹션 본문 (§2.10)
}

// src/lib/exclusions.ts
export interface ExclusionEntry {
  pattern: string               // "db/instance_server/server_structure.md"
                                // 또는 "db/**/spawn_rules.md"
  rationale: string
  sources: string[]             // ["사람 검토 (2026-04-12)", "도메인 정책: ..."]
  lastValidatedAt?: string      // ISO date — axiom 전용 (Stage 14 신선도)
  needsReview?: boolean         // Stage 14에서 set
  archived?: boolean            // Stage 14에서 set
}

export interface ExclusionDoc {
  questionTypeId: string        // pattern 파일은 파일명 stem,
                                // axiom 파일은 frontmatter `applies_to` 배열
  level: "pattern" | "axiom"
  filePath: string              // 출처 추적용
  entries: ExclusionEntry[]
}
```

### 작업 항목

- [x] [src/lib/question-types.ts](src/lib/question-types.ts) **신규** —
  `loadQuestionTypes(projectPath): Promise<QuestionType[]>`. malformed 파일은
  `console.warn` + skip. sources-merge.ts에 범용 frontmatter 파서가 없어
  `parseFrontmatter`를 question-types.ts에 새로 만들어 export
  (exclusions.ts가 재사용).
- [x] [src/lib/exclusions.ts](src/lib/exclusions.ts) **신규**:
  - `loadExclusions(projectPath): Promise<ExclusionDoc[]>` — `by_question_type/`
    + `axioms/` 모두. axiom은 `applies_to` frontmatter 배열로 여러 type에 매핑.
    plan의 `questionTypeId: string`은 axiom 다중 매핑과 모순이라
    `questionTypeIds: string[]`로 구현 (pattern은 단일 원소 배열).
  - `matchesPattern(pattern, candidatePath): boolean` — `**` / `*` / 리터럴
    3가지만 지원. 외부 deps(minimatch 등) 도입하지 않고 단순 정규식 빌더로 구현.
  - `applyExclusions(candidates, entries) → { kept, excludedByEntry }` —
    `excludedByEntry`는 `Map<pattern, string[]>` 형태로 트레이싱용 (§2.9).
    매칭 0건 entry는 map에서 omit (트레이스에 노이즈 방지).
  - `archived: true` 항목은 skip. 누락된 path는 자연스럽게 적용에서 제외
    (candidates에 없으면 매칭이 안 되므로 추가 처리 불필요).
- [x] [src/lib/__tests__/question-types.test.ts](src/lib/__tests__/question-types.test.ts)
  **신규** — 9 케이스: 디렉토리 부재 / IDEA §2.4 예시 round-trip / H1·stem
  fallback / Input·Output·Zero residue 섹션 / dotfile·dir·read 실패 skip /
  다중 파일 순서 / 빈 줄 + 헤딩 뒤 첫 단락 + parseFrontmatter scalar/bool/array.
- [x] [src/lib/__tests__/exclusions.test.ts](src/lib/__tests__/exclusions.test.ts)
  **신규** — 13 케이스: matchesPattern 리터럴/`*`/`**`/메타문자 escape +
  loadExclusions pattern·axiom·혼합·entry 메타데이터·dotfile 스킵 +
  applyExclusions kept/excluded 경계·archived skip·빈 entries·매칭 0건 omit·
  중첩 entry dedup.

### 자동 검증

```bash
npm run typecheck
npm run test:mocks
```

### 수동 검증 (앱 실행)

이 단계는 UI 노출 X — 검증은 단위 테스트 + 임시 dev console 호출로 한다.

1. `/tmp/llm-wiki-stage9/`를 Stage 8 흐름으로 생성.
2. 다음 두 파일을 직접 작성 ([IDEA.md §2.4 정확 예시](IDEA.md) 그대로):
   ```md
   <!-- question_types/policy_violation.md -->
   ---
   title: 정책 위반 탐지
   ---
   ## Description
   사용자/운영 정책에 위반되는 동작을 식별한다.
   ## Zero residue
   잔존 0 = 위반 없음 (긍정적 신호).
   ```
   ```md
   <!-- exclusions/by_question_type/policy_violation.md -->
   # 정책 위반 탐지 유형의 배제 대상
   ## 배제
   - db/instance_server/server_structure.md
     근거: 서버 구조는 정책이 아닌 인프라 설명.
   - db/**/spawn_rules.md
     근거: 스폰 규칙은 운영 데이터.
   ## 출처
   - 사람 검토 (2026-04-12)
   ```
3. 개발자 모드 콘솔(또는 임시 React 페이지)에서:
   ```ts
   const types = await loadQuestionTypes(pp)
   const docs = await loadExclusions(pp)
   const { kept, excludedByEntry } = applyExclusions(
     ["db/instance_server/server_structure.md", "db/foo/bar.md", "db/x/spawn_rules.md"],
     docs[0].entries,
   )
   ```
   **확인:** `kept = ["db/foo/bar.md"]`, `excludedByEntry`에 2개 entry가 각각
   1개 path를 가짐.

### 완료 조건

1~3 통과. **MVP까지 거리: Stage 11 끝나면 검색 가능.**

---

## Stage 10 — Question Type 분류기 (LLM) (PR-10, M8)

**목표:** 사용자 질문 + 프로젝트 question_types 목록을 LLM에 보내 정확히 하나의
typeId를 결정한다. 결과에 confidence + 짧은 근거 첨부. 분류 실패 시 `null` 반환
(검색 파이프라인이 fallback 처리).

### 작업 항목

- [x] [src/lib/classify-question.ts](src/lib/classify-question.ts) **신규**:
  - `classifyQuestion(question, types, llmConfig): Promise<{ typeId, confidence, reasoning } | null>`.
  - 프롬프트는 question_type 카드(name + description + inputShape) 리스트 + 질문 +
    "정확히 하나의 typeId만 반환하거나 매칭이 약하면 null" 지시. JSON 응답 강제.
  - 알 수 없는 typeId 회수 시 `null` (LLM hallucination 방지).
  - 호출은 [llm-client.ts](src/lib/llm-client.ts) `streamChat` 재활용 — HTTP
    공급자(OpenAI/Anthropic 등)와 CLI 공급자(claude-code/codex-cli/gemini-cli)
    분기는 [llm-providers.ts](src/lib/llm-providers.ts) `isCliProvider`가 이미
    처리하므로 classifier는 공급자 무관하게 동작. JSON 정제는 sweep-reviews.ts의
    `extractJsonObject` 재활용으로 ```json 펜스도 허용.
  - **Claude Code CLI 특수 케이스 폴백:** Claude Code가 JSON 응답 대신 Read/Write
    도구를 호출하려 들어 분류가 실패하면 [claude-cli-ingest-plan.md](claude-cli-ingest-plan.md)
    Stage B에서 확정한 패턴을 재활용 — [claude-cli-transport.ts](src/lib/claude-cli-transport.ts)
    `streamClaudeCodeCli`를 직접 호출하면서 `{disableTools: true, systemPrompt}`
    옵션 전달. 어댑터 (JSON 파싱 + 코드펜스 제거 + path 가드)는
    [agent-ingest.ts](src/lib/agent-ingest.ts)의 `parseAgentIngestResponse`
    형태를 본떠 동일 모듈에 두면 된다. (현재 구현은 streamChat만으로 충분히
    동작 — 폴백은 회귀 발생 시 진입.)
- [x] [src/lib/__tests__/classify-question.test.ts](src/lib/__tests__/classify-question.test.ts)
  **신규** — 8 케이스 (모두 LLM 모킹): 정상 매칭 / null 반환 / 알 수 없는 typeId
  거부 / JSON 파싱 실패 / 빈 types 배열 / streamChat onError / ```json 펜스 /
  프롬프트 카드 포함.

### 자동 검증

```bash
npm run typecheck
npm run test:mocks
```

### 수동 검증 (앱 실행)

1. `/tmp/llm-wiki-stage10/`를 Stage 8 흐름으로 생성. [IDEA.md §2.3 12개 question
   type](IDEA.md) 중 3~4개를 직접 작성 (condition_based_test, policy_violation,
   regression_test 등).
2. dev console에서:
   ```ts
   const types = await loadQuestionTypes(pp)
   const r = await classifyQuestion(
     "Fireball을 SafeZone에서 발사할 때 어떻게 되는가?",
     types,
     llmConfig,
   )
   ```
   **확인:** `typeId === "condition_based_test"` (또는 가장 적합한 type), confidence
   부여, 짧은 reasoning.
3. **확인:** 일부러 모호한 질문("이거 좀 봐줘") → `null` 또는 confidence 낮음.

### 완료 조건

2~3 통과. **분류 정확도 100% 보장 어려움** — 알 수 없는 typeId가 빠져나오지
않고, 명확한 케이스에서 사람이 기대한 type이 반환되면 OK.

---

## Stage 11 — 검색 파이프라인 + 트레이싱 UI (PR-11, M8) — Part 2 MVP 완료

**목표:** 사용자가 chat 입력에 질문을 보내면

1. `classifyQuestion` → typeId
2. typeId의 pattern + axiom + 모든 axiom(applies_to에 typeId 포함) 로드
3. db/ 트리 → `applyExclusions` → 줄어든 후보
4. 줄어든 후보 위에서 [search.ts](src/lib/search.ts) `searchWiki`(또는 분기된
   `searchPaths`) 실행
5. assistant 메시지 위에 트레이싱 블록(judged type / 적용된 배제 / residue 수 /
   hits / 결과별 sources / zeroResidueMeaning) 렌더

> **UX 모델 결정:** 본 plan 초안은 별도 "사이드바 검색 박스"를 가정했지만,
> 구현은 chat 흐름을 검색 진입점으로 통합했다 — chat 메시지 1건이 곧 검색
> 1회. 트레이스는 그 메시지 카드 위에 collapsible로 붙는다. 후속 Stage(12·13)도
> 이 모델 위에서 동작한다.

### 작업 항목

- [x] [src/lib/exclude-search.ts](src/lib/exclude-search.ts) **신규** — PLAN.md §10
  명명 그대로. `runExcludeSearch(question, projectPath, llmConfig) → SearchResult`:
  ```ts
  interface SearchTrace {
    judgedType: { id: string; name: string; confidence: number; reasoning: string } | null
    appliedEntries: { pattern: string; rationale: string; matched: string[] }[]
    initialCandidateCount: number
    residueCount: number
    zeroResidueMeaning?: string
  }
  interface SearchResult {
    hits: SearchHit[]                  // searchWiki 결과 reuse
    trace: SearchTrace
  }
  ```
- [x] [src/lib/search.ts](src/lib/search.ts) — `searchWiki`가 `wiki/`를 쓰는 부분을
  **`db/`도 함께** 검색하도록 확장(또는 `searchPaths(projectPath, query, paths[])`로
  분기). 기존 wiki/ 호환성은 유지(legacy 프로젝트 회귀 방지). (구현은
  `searchPaths` 분기 — `runExcludeSearch`가 db/ 후보 리스트를 좁힌 뒤
  searchPaths로 토큰 스코어링. wiki/는 기존 searchWiki가 그대로 처리.)
- [x] [src/components/chat/chat-panel.tsx](src/components/chat/chat-panel.tsx) —
  chat send 시 기존 `searchWiki` 호출 자리를 `runExcludeSearch`로 교체. 반환된
  trace는 assistant 메시지에 첨부([chat-store.ts](src/stores/chat-store.ts) 메시지
  타입 확장). residue == 0 + judgedType !== null + zeroResidueMeaning 있으면
  LLM 호출을 생략하고 zeroResidueMeaning을 그대로 응답으로 finalize.
- [x] [src/components/chat/chat-message.tsx](src/components/chat/chat-message.tsx) —
  assistant 메시지 본문 위에 `ExclusionTrace`를 렌더. think/citation collapsible과
  동일 패턴.
- [x] [src/components/chat/exclusion-trace.tsx](src/components/chat/exclusion-trace.tsx)
  **신규** — IDEA.md §2.9 예시 형식대로 렌더:
  ```
  판정된 유형: 조건 기반 가상 테스트
  적용된 배제: 47개 중 21개 제거
    - condition_based_test.md → 21
  탐색 시작 후보: 26개
  결과: 1개
    → "SafeZone 내 공격성 스킬 차단"
  근거: instance_server_design.docx > section 3.2
  ```
- [x] **잔존 0개 처리** — type의 `zeroResidueMeaning`을 결과 영역에 출력 (§2.10).
  type이 결정되지 않은 경우 일반 "결과 없음".
- [x] i18n 키 추가 — `search.judgedType`, `search.appliedExclusions`,
  `search.residueCount`, `search.zeroResidue.label` 등. en/zh/ko 동시 갱신.
  (실제 키는 `search.trace.*` + `search.zeroResidue.label`로 nested.)
- [x] [src/lib/__tests__/exclude-search.test.ts](src/lib/__tests__/exclude-search.test.ts)
  **신규** — full pipeline 모킹: classify(LLM) + exclusions 로드 + fake retriever →
  trace shape 정확. 7 케이스: 정상 분류+패턴 / classifier null fallback /
  question_types 비어있을 때 classifier 스킵 / axiom applies_to 매칭 /
  잔존 0 + zeroResidueMeaning + searchPaths 미호출 / 매칭 0 entry 트레이스 omit /
  db/ 부재 → 0 후보.

### 자동 검증

```bash
npm run typecheck
npm run test:mocks
```

### 수동 검증 (앱 실행)

1. Stage 4까지 검증을 통과한 game-dev 데이터 보유 프로젝트를 `/tmp/llm-wiki-stage11/`로
   복사. (또는 신규 생성 후 Stage 3~4 다시 1회 통과시켜 db/ 트리 적재.)
2. `question_types/condition_based_test.md` + `exclusions/by_question_type/condition_based_test.md`
   직접 작성 — 후자에 `db/instance_server/server_structure.md` 등을 배제 등록.
3. chat 입력 → "Fireball을 SafeZone에서 발사할 때 어떻게 되는가?" 전송.
4. **확인:** assistant 메시지 위 트레이싱 블록 — "판정된 유형: condition_based_test",
   "47 → 26 (21 제거)", 결과 카드별 sources 표시.
5. 일부러 모든 후보가 배제되도록 패턴을 넓게 작성 → 잔존 0 + zeroResidueMeaning
   문구가 assistant 응답으로 출력 (LLM 호출 생략).
6. (회귀) Stage 4 검증 — modification flow는 영향 없음.

### 완료 조건

3~6 통과. **여기까지가 Part 2 MVP** — 이후 Stage 12~14는 운영 품질·자기 정정.

---

## Stage 12 — Instance Exclusion 로깅 (Level 1) (PR-12, M9)

**목표:** chat send 1회(=`runExcludeSearch` 호출 1회)마다
`exclusions/instances/<YYYY-MM>/<query-id>.md`에 trace를 markdown으로 영구
기록한다. git commit 1건 발생 → 사람이 git tooling으로 이력 조회 가능.

### 작업 항목

- [x] [src/lib/instance-log.ts](src/lib/instance-log.ts) **신규**:
  - `recordSearchInstance(projectPath, question, result, now?): Promise<{ path, commitHash }>`.
    Inject `now` for deterministic tests; production omits it.
  - 경로 결정: `exclusions/instances/<YYYY-MM>/q-<compact-ISO>-<slug>.md`.
    `<slug>`는 [wiki-filename.ts](src/lib/wiki-filename.ts) `makeQuerySlug` 재활용
    (Unicode-aware, CJK 보존). compact-ISO는 `:`/`.`을 `-`로 평탄화 (Windows-safe).
  - markdown 본문: frontmatter(question_type / initial_candidates / residue_count /
    hits_count / recorded_at) + Question / Judged Type / Applied Exclusions /
    Residue / Top Hits 섹션. Hits는 상위 10개만.
- [x] [src/lib/auto-commit.ts](src/lib/auto-commit.ts) — `commitSearchInstance` +
  순수 `formatSearchInstanceMessage` 추가. 메시지: `search: <type-id> → N hits
  (M excluded)`. typeId == null이면 `search: untyped → ...`. withProjectLock 경유.
- [x] [src/lib/exclude-search.ts](src/lib/exclude-search.ts) — `runExcludeSearch`
  반환 직전에 `recordSearchInstance` 호출. 빈/공백 질문은 안전망으로 스킵.
  로깅 실패는 console.warn으로 swallow — 사용자 검색 결과를 깨뜨리지 않는다.
- [x] [src/lib/__tests__/exclude-search.test.ts](src/lib/__tests__/exclude-search.test.ts)
  — `instance-log` 모킹 추가 (Stage 12 회귀 방지).
- [x] [src/lib/__tests__/instance-log.test.ts](src/lib/__tests__/instance-log.test.ts)
  **신규** — 5 케이스: 파일 생성 + frontmatter / `<YYYY-MM>` 디렉토리 (Dec→Jan
  경계 포함) / 잔존 0 케이스도 기록 / 동일 ms 타임스탬프 충돌 회피 (`-1` 접미사) /
  commit 호출 정합성 (typed + untyped 메시지).

### 자동 검증

```bash
npm run typecheck
npm run test:mocks
```

### 수동 검증 (앱 실행)

1. Stage 11 검증을 통과한 프로젝트를 `/tmp/llm-wiki-stage12/`로 복사.
2. chat에서 서로 다른 질문 3건을 순서대로 전송.
3. ```bash
   ls /tmp/llm-wiki-stage12/exclusions/instances/2026-05/
   ```
   **확인:** `q-...md` 3개 생성.
4. ```bash
   cd /tmp/llm-wiki-stage12 && git log --oneline | head
   ```
   **확인:** `search: <type> → ...` 메시지의 commit 3건 추가.
5. 한 instance 파일을 열어 본문 검사 — 질문 / type / 배제 entry / residue / hits
   상위 항목 모두 포함.

### 완료 조건

3~5 통과.

---

## Stage 13 — Pattern → Axiom 승격 UI (Level 2 → 3) (PR-13, M9)

**목표:** Level 1 (instance) 빈도가 임계값을 넘은 (typeId, excluded path) 쌍을
승격 후보로 사람에게 제시한다. **자동 승격 금지** — IDEA §2.6 명시. 패턴은
`exclusions/by_question_type/<type>.md`에, axiom은 `exclusions/axioms/<name>.md`에
사람이 [Promote] 버튼을 눌러 추가된다.

### 작업 항목

- [ ] [src/lib/promotion.ts](src/lib/promotion.ts) **신규**:
  - `analyzePromotionCandidates(projectPath, opts?): Promise<PromotionCandidate[]>` —
    `exclusions/instances/**/*.md`를 스캔해 (typeId, path) 쌍별 빈도 집계.
    `promotion_rules.md`에 정의된 임계값(파싱 단순화 위해 `default 5` 등 fallback
    포함)을 넘은 후보만 반환.
  - `promoteToPattern(candidate)` / `promoteToAxiom(candidate, axiomName)` —
    대상 파일 entry 추가, instance 출처를 `sources:`에 인용, git commit
    (`promote: pattern <type>` / `promote: axiom <name>`).
  - `dismissCandidate(candidate, reason)` — `.llm-wiki/promotion-dismissals.jsonl`에
    기록 (Stage 4 rejection-log와 동일 패턴) → 향후 같은 후보가 다시 떠도 dedup.
- [ ] [src/components/exclusions/promotion-panel.tsx](src/components/exclusions/promotion-panel.tsx)
  **신규** — [icon-sidebar.tsx](src/components/layout/icon-sidebar.tsx)의 기존
  view 목록(file-tree·knowledge-tree·sources·review·lint 등) 옆에 promotion view
  하나를 추가하고, 그 안에 렌더된다. 카드: typeId + path + 빈도 + 인용된 instance
  N개. 액션 [Promote to Pattern] / [Promote to Axiom] / [Dismiss].
- [ ] [src/components/layout/icon-sidebar.tsx](src/components/layout/icon-sidebar.tsx)
  — promotion view 아이콘 추가 (`TrendingUp` 등). 정확한 배치는 기존 view
  엔트리 순서를 따른다 (review 다음 등). `nav.promotion` i18n 키 ko/en/zh.
- [ ] [src/lib/__tests__/promotion.test.ts](src/lib/__tests__/promotion.test.ts)
  **신규** — 6 케이스: 빈도 집계 정확 / 임계값 미달 후보 제외 / promote가 entry
  추가하고 instance 인용 / dismiss가 dedup 작동 / promotion_rules.md 파싱 fallback /
  archived entry는 후보 재진입 X.

### 자동 검증

```bash
npm run typecheck
npm run test:mocks
```

### 수동 검증 (앱 실행)

1. Stage 12 검증을 통과한 프로젝트에서, 동일 (typeId, path) 쌍을 일치시키는
   chat 질문을 임계값 + 1 회 반복 전송.
2. 사이드바 promotion view에 후보 카드 1건이 보임.
3. **Promote to Pattern 분기:** 클릭 →
   `exclusions/by_question_type/<type>.md`에 entry 추가 + commit 1건.
   - 기존 file에 `## 배제` 섹션이 없으면 새로 만들고, 있으면 append.
   - entry의 `sources:`에 instance 파일 N개 경로 인용.
4. **Promote to Axiom 분기:** 다른 후보로 클릭 → axiom 이름 입력 받고 →
   `exclusions/axioms/<name>.md` 새로 생성. `applies_to: [<typeId>, ...]`
   frontmatter 설정.
5. **Dismiss 분기:** 한 후보를 dismiss → 다시 promotion view에 안 보임.
   `.llm-wiki/promotion-dismissals.jsonl` 1줄 추가.
6. chat에서 동일 type으로 분류될 질문 1회 전송 → assistant 메시지 위 트레이싱이
   새 axiom/pattern을 적용하는지 확인.

### 완료 조건

2~6 통과.

---

## Stage 14 — 자기 정정 메커니즘 (PR-14, M10)

**목표:** IDEA §2.8의 4가지 무효화 메커니즘. 배제 지도가 시간에 따라 자기
정정되도록 한다.

### 14.1 출처 의존성

- [ ] exclusion entry는 `sources: [path]`로 의존 source 파일을 명시.
- [ ] [src/lib/exclusion-validity.ts](src/lib/exclusion-validity.ts) **신규** —
  source 파일의 git mtime이 entry의 `last_validated_at`보다 새로우면
  `needs_review: true`로 마킹.
- [ ] 사이드바 promotion view에 `needsReview` 필터 + 경고 배지.

### 14.2 신선도

- [ ] axiom의 `last_validated_at`이 N일(`promotion_rules.md`의 `freshness_days`,
  기본 90) 초과 시 `stale: true` 마킹.
- [ ] [src/lib/lint.ts](src/lib/lint.ts) — Lint 룰 추가: stale axiom 카드를 lint
  결과에 표시 (PLAN.md §10 신선도/무효화 권장).
- [ ] axiom 카드에 [Mark validated] 액션 — `last_validated_at` 갱신 + commit.

### 14.3 반례 발견

- [ ] chat assistant 메시지의 결과 카드에 [이 결과를 정답으로 표시] 액션.
- [ ] 그 결과 path가 다른 type에서 배제되어 있다면, 해당 entry를 `needsReview`로
  마킹 + 반례로 instance 파일 인용.
- [ ] [src/lib/exclusion-validity.ts](src/lib/exclusion-validity.ts)에 함수 추가.

### 14.4 명시적 폐기

- [ ] axiom/pattern entry 카드에 [Archive] 버튼.
- [ ] entry에 `archived: true` 마킹만, 파일 삭제 X. `applyExclusions`는
  `archived` skip (Stage 9에서 이미 처리).
- [ ] [Restore] 버튼으로 archive 해제 가능.

### 작업 항목 (공통)

- [ ] [src/lib/__tests__/exclusion-validity.test.ts](src/lib/__tests__/exclusion-validity.test.ts)
  **신규** — 메커니즘별 4개 케이스 + 4개 시나리오.
- [ ] i18n 키 — `exclusion.needsReview`, `exclusion.stale`, `exclusion.markValidated`,
  `exclusion.archive`, `exclusion.restore`. en/zh/ko 동시.

### 자동 검증

```bash
npm run typecheck
npm run test:mocks
```

### 수동 검증 (앱 실행)

각 메커니즘 1회씩:

1. **출처 의존성:** Stage 13의 axiom이 인용한 source markdown을 직접 수정 후
   commit → axiom 카드에 needs_review 배지 표시.
2. **신선도:** 임시로 axiom 파일의 `last_validated_at`을 100일 전으로 수정 →
   Lint view에 stale 경고 1건. [Mark validated] 클릭 → 갱신.
3. **반례:** chat 응답 카드에서 이전에 배제됐던 path를 [정답으로 표시] →
   해당 배제 entry가 needs_review로 전환.
4. **Archive:** 한 entry [Archive] 클릭 → 다음 chat send에서 적용 안 됨, 파일에는
   보존. [Restore] → 다시 적용됨.

### 완료 조건

1~4 모두 1회씩 통과.

---

## Stage 15 — Part 2 통합 시나리오 + 사용자 가이드 (PR-15, M10)

**목표:** Stage 8~14를 처음부터 끝까지 1회 통과시키는 시나리오 테스트와, 사용자가
question_types/exclusions를 어떻게 쓰는지에 대한 사용자 가이드 정리.

### 작업 항목

- [ ] [src/test-helpers/scenarios/search-scenarios.ts](src/test-helpers/scenarios/search-scenarios.ts)
  **신규** — game-dev 도메인 시나리오:
  - 부트스트랩 → 3개 question_type + 1개 axiom 작성 → chat 질문 5회 (동일 후보
    4회 + 다른 1회) → promotion 후보 1건 발견 → axiom 승격 → 다음 chat 질문에서
    axiom 적용 트레이싱.
  - LLM 응답은 모킹.
- [ ] [src/lib/exclude-search.scenarios.test.ts](src/lib/exclude-search.scenarios.test.ts)
  **신규** — 위 시나리오 실행, 각 단계 산출물 검증.
- [ ] [schema/](schema/) 디렉토리에 `question_types/` 예시 모음 추가 — IDEA §2.3의
  12 유형 중 game-dev에 가장 가까운 5~6개를 plain markdown으로. 사용자가 새
  프로젝트에서 복사 시작점으로 쓴다.
- [ ] (선택) `USAGE.md` — Part 2 사용법 1-page 가이드:
  - "프로젝트에 question_type을 어떻게 추가하나"
  - "exclusions를 작성하는 4가지 방법 (직접 / promotion / archive / counterexample)"
  - "신선도/무효화는 언제 일어나나"

### 자동 검증

```bash
npm run typecheck
npm run test:mocks
cargo test --lib commands::git_ops
```

### 수동 검증 (앱 실행)

[IDEA.md §2.9 예시 시나리오](IDEA.md)를 그대로 재현:

1. 새 프로젝트에 game-dev schema + Stage 3~4 분해 데이터 적재.
2. `schema/question_types/`에서 `condition_based_test.md` 복사 → 프로젝트
   `question_types/`로.
3. chat 입력에 "Fireball을 SafeZone에서 발사할 때 어떻게 되는가?" 전송.
4. **확인:** assistant 메시지 위 트레이싱 블록이 IDEA §2.9의 예시 모양과 일치 —
   판정 유형, 적용된 배제, 탐색 시작 후보, 결과, 근거.

### 완료 조건

3~4 통과 + 시나리오 테스트 green.

---

## 부록 A — 단계별 git commit 권장

각 Stage 끝, 수동 검증 통과 시 코드 변경을 commit한다. 메시지 컨벤션은 Part 1과
동일:

```
feat(stage{N}): <한 줄 요약>

PLAN.md 마일스톤 M{7~10} 구현. 자세한 작업 항목은 second-development-plan.md 참조.

Manual verification: second-development-plan.md Stage {N} 수동 검증 절차 통과.
```

## 부록 B — 의존성 그래프

```
Stage 8 (디렉토리 시드)
   ↓
Stage 9 (로더 + glob 매처)            ← 데이터 레이어
   ↓
Stage 10 (LLM 분류기)                  ← LLM 적재
   ↓
Stage 11 (검색 파이프라인 + UI)        ← Part 2 MVP 완료
   ↓
Stage 12 (Instance 로깅 / Level 1)
   ↓
Stage 13 (승격 / Level 2 → 3)
   ↓
Stage 14 (자기 정정 4 메커니즘)
   ↓
Stage 15 (통합 시나리오 + 가이드)
```

- **Stage 11까지가 Part 2 MVP.** 이후 Stage 12~14는 운영 품질 + 자기 정정.
- Stage 8과 Stage 9는 묶어 같은 PR로 처리해도 무방 (둘 다 데이터 레이어). 다만
  검증 명확성을 위해 분리.
- Stage 14 4 메커니즘은 한 PR로 묶지 말고 sub-PR로 쪼개도 좋다 (14.1 / 14.2 /
  14.3 / 14.4 각각 검증). plan에서는 한 Stage로 표기하지만 실제 PR은 더 잘게
  쪼갤 자유.

## 부록 C — Part 1 산출물과의 매핑

| Part 2 컴포넌트 | Part 1에서 재활용 |
|---|---|
| `loadExclusions` 글롭 매처 | [path-utils.ts](src/lib/path-utils.ts) |
| frontmatter 파싱 (question_types, exclusions) | Stage 3의 [sources-merge.ts](src/lib/sources-merge.ts) |
| Instance commit | Stage 2 [auto-commit.ts](src/lib/auto-commit.ts) |
| Promotion 후보 dedup | Stage 4 review-store dedup 패턴 |
| Stale axiom Lint 룰 | [lint.ts](src/lib/lint.ts) (semantic lint 확장) |
| 트레이싱 collapsible | [chat-message.tsx](src/components/chat/chat-message.tsx) think/citation |
| `searchWiki` retriever | [search.ts](src/lib/search.ts) (db/ 분기 추가) |
| 임베딩 보강 | [embedding.ts](src/lib/embedding.ts) (Part 2에서 RRF 가중) |
| Stage 10 LLM 호출 (HTTP + CLI 통합 디스패처) | [llm-client.ts](src/lib/llm-client.ts) `streamChat` + [llm-providers.ts](src/lib/llm-providers.ts) `isCliProvider` |
| LLM JSON 응답 파싱 / 펜스 제거 | [sweep-reviews.ts](src/lib/sweep-reviews.ts) `extractJsonObject` |
| Claude Code CLI 도구 비활성화 + JSON 강제 (폴백 패턴) | [claude-cli-transport.ts](src/lib/claude-cli-transport.ts) `streamClaudeCodeCli({disableTools, systemPrompt, cwd})` + [agent-ingest.ts](src/lib/agent-ingest.ts) `buildAgentIngestPrompt` / `parseAgentIngestResponse` ([claude-cli-ingest-plan.md](claude-cli-ingest-plan.md) Stage B) |
| 다른 CLI 공급자 (Codex / Gemini) | [codex-cli-transport.ts](src/lib/codex-cli-transport.ts), [gemini-cli-transport.ts](src/lib/gemini-cli-transport.ts) — 동일 폴백 패턴 적용 가능 |

## 부록 D — Part 3 진입 조건 (메모)

Stage 15까지 통과하면 IDEA.md §2 전체가 구현 완료. **Part 3** (탐색 알고리즘
강화 — 그래프 워크 / RRF 가중 / 상대화된 우선순위)는 본 plan 범위 밖이며, 별도
IDEA Part 3 / PLAN Part 3 문서를 작성한 뒤 진입한다. Part 3 진입 시점에는 본
plan의 `runExcludeSearch`가 이미 Step 4(탐색)를 [search.ts](src/lib/search.ts)에
위임하고 있으므로, 위임 대상만 새 알고리즘으로 교체하면 된다 (인터페이스 안정성
보장).
