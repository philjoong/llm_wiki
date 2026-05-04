# PLAN.md — IDEA.md 적용 계획

본 계획은 [IDEA.md](IDEA.md)를 [README.md](README.md) 기준의 현재 llm_wiki 프로젝트에 **전면 재설계** 형태로 적용하기 위한 단계별 개발 스텝이다. 기존 사용자의 wiki 디렉토리 호환성은 고려하지 않는다.

## 합의된 설계 결정 (Decisions)

1. **방향**: 전면 재설계. 현재의 자동 병합형 ingest와 4-Phase "정답 고르기" 검색을 IDEA.md 모델로 교체한다.
2. **schema.md의 위상**: 분해/재배치의 결정자. 자연어가 아니라 **기계가 파싱하는 구조화 형식**으로 강화한다. 단, schema는 앱에 하드코딩하지 않고 프로젝트별 파일로 관리하며, 프로젝트 진행 중에도 새 노드/파일/분해 규칙을 추가할 수 있어야 한다.
3. **수정 요청 UI**: 기존 Review와 분리된 **Pending Changes / Diff Review** 전용 화면을 새로 만든다.
4. **히스토리**: IDEA.md에 맞춰 2차 산출물 루트는 **local git 저장소**로 관리한다. 앱은 git 명령을 감싼 얇은 래퍼를 제공하고, 기존 `wiki/log.md`는 사람이 읽는 요약 로그로만 유지한다.
5. **검색**: 질문 유형 판정 → 정적 배제 → 그 위에서 기존 4-Phase 검색을 우선순위 알고리즘으로 재사용.
6. **호환성**: 기존 wiki 구조 마이그레이션 없음. 새 프로젝트부터 적용.

---

## 폴더 구조 (목표)

```
my-wiki/
├── purpose.md
├── schema.md                   # 프로젝트별 기본 schema (기계 파싱 가능한 구조화 마크다운)
├── schema.d/                   # 선택: 추후 추가되는 schema 모듈
├── raw/sources/
├── processed_1/                # 1차 산출물 (raw 파일 단위)
├── db/                         # 2차 산출물 (schema.md가 정의한 지식 구조 단위)
├── pending/                    # 거절-보류 항목
├── question_types/             # 질문 유형 정의
├── exclusions/
│   ├── exclusion_schema.md
│   ├── promotion_rules.md
│   ├── axioms/
│   ├── by_question_type/
│   └── instances/
└── .llm-wiki/
    ├── pending-changes/        # 수정 요청 큐
    └── rejection-log/          # 거절 사유 (재거절 방지)
```

---

# Phase 0. 사전 정리 (Cleanup & Scaffolding)

기존 모델과 새 모델이 섞이지 않도록 명확히 분리한다.

### Step 0.1 — 데드 코드 식별 및 격리
- 다음 영역은 새 모델에서 완전히 대체된다. **삭제 대상 후보**로 표시만 한다 (실제 삭제는 Phase 7에서).
  - [src/lib/ingest.ts](src/lib/ingest.ts) — analysis → generation 자동 병합 흐름
  - [src/lib/sweep-reviews.ts](src/lib/sweep-reviews.ts) — 기존 Review 큐
  - [src/lib/wiki-cleanup.ts](src/lib/wiki-cleanup.ts), [src/lib/source-delete-decision.ts](src/lib/source-delete-decision.ts) — 자동 cascade delete
  - [src/lib/templates.ts](src/lib/templates.ts) 의 wiki/entities, wiki/concepts 템플릿
- 단순 유지 대상: i18n, llm-providers, path-utils, tauri-fetch, claude-cli-transport, embedding/text-chunker(검색 단계 재사용), milkdown 에디터.

### Step 0.2 — 새 모듈 디렉토리 결정
- `src/lib/processing/` (Part 1: 2차 가공)
- `src/lib/retrieval/` (Part 2: 검색)
- `src/lib/history/` (local git 래퍼)
- `src/lib/schema/` (프로젝트별 schema 파서/검증/확장)

### Step 0.3 — 새 프로젝트 템플릿
- [src/lib/templates.ts](src/lib/templates.ts) 의 시나리오를 IDEA.md 모델 기준으로 재작성: 신규 프로젝트는 위 폴더 구조를 자동 생성.
- 각 템플릿은 앱 코드에 고정된 page type을 만들지 않고, 해당 프로젝트에 맞는 초기 `schema.md`, `question_types/`, `exclusions/` 초안만 제공한다.
- 템플릿 생성 이후 사용자는 `schema.md` 또는 `schema.d/*.md`를 추가/수정해 프로젝트별 지식 구조를 계속 확장할 수 있다.

---

# Phase 1. schema.md 기계화와 확장성 (Part 1의 토대)

schema.md가 분해/재배치의 결정자가 되려면 LLM 프롬프트뿐 아니라 **코드가 직접 읽고 검증할 수 있어야** 한다. 동시에 프로젝트마다 다른 schema를 적용하고, 프로젝트 진행 중 schema를 추가할 수 있어야 하므로 schema는 "앱의 고정 타입"이 아니라 "프로젝트 파일에서 로드되는 계약"으로 다룬다.

### Step 1.1 — schema.md 형식 정의
- 새 파일: `docs/schema-md-spec.md` — 형식 사양.
- 사양 원칙:
  - `schema.md`는 프로젝트의 기본 schema이다.
  - `schema.d/*.md`는 선택적 확장 schema이다. 앱은 `schema.md`를 먼저 읽고 파일명 정렬 순서로 `schema.d/*.md`를 병합한다.
  - 기존 schema를 깨지 않고 새 node, file, field, decomposition rule을 추가할 수 있어야 한다.
  - node id와 path는 안정적인 식별자로 취급한다. 이름 변경/경로 이동은 단순 수정이 아니라 migration 또는 relocate ChangeRequest로 처리한다.
  - 앱이 모르는 확장 필드는 `x-` prefix 아래에 보존한다. 파서는 버리지 않고 downstream prompt/context에 전달할 수 있게 한다.
- 형식 (예시):
  ```md
  ---
  version: 1
  extends: []
  ---

  # Nodes
  ## dungeon
    path: db/instance_server/dungeon/{slug}/
    files:
      - overview.md
      - entry_rules.md
      - rewards.md
    fields:
      - name: entry.min_level (int)
      - name: entry.party_size (range)

  # DecompositionRules
  - keyword: "입장 조건" → dungeon/{slug}/entry_rules.md
  - keyword: "보상" → dungeon/{slug}/rewards.md
  ```

### Step 1.2 — 파서 구현
- 새 파일: [src/lib/schema/schema-parser.ts](src/lib/schema/schema-parser.ts)
  - frontmatter + 섹션 단위 파싱
  - 출력: `SchemaDoc { version, sources, nodes: NodeDef[], rules: DecompositionRule[], extensions }`
- 새 파일: [src/lib/schema/schema-loader.ts](src/lib/schema/schema-loader.ts)
  - 프로젝트 루트에서 `schema.md`와 `schema.d/*.md`를 로드하고 병합한다.
  - 병합 순서는 결정적이어야 하며, 충돌은 자동 해결하지 않고 검증 오류로 반환한다.
- 새 파일: [src/lib/schema/schema-parser.test.ts](src/lib/schema/schema-parser.test.ts)

### Step 1.3 — schema 검증기
- 새 파일: [src/lib/schema/schema-validate.ts](src/lib/schema/schema-validate.ts)
  - 노드 id/path 충돌, slug 누락, 파일 템플릿 충돌, 삭제/이동에 따른 기존 `db/` 고아 파일, 순환 참조 등을 검출.
  - 기존 `db/`가 있는 상태에서 schema가 확장되면 새 규칙은 허용하되, 기존 파일을 깨뜨리는 변경은 migration 후보로 표시한다.
- Lint 화면에 "Schema Issues" 섹션 추가.

### Step 1.4 — schema 변경 워크플로우
- schema 추가/수정은 즉시 `db/`를 변경하지 않는다.
- schema 변경 후 다음 ingest/search 전에 schema validation을 실행한다.
- 기존 `db/` 파일을 새 schema 위치로 옮겨야 하는 경우 `relocate` ChangeRequest를 생성해 Pending Changes에서 사람이 승인한다.
- schema 변경 자체도 Phase 4의 local git commit 대상이다. commit 메시지는 `schema: add node <id>` 또는 `schema: update rule <id>` 형식을 사용한다.

---

# Phase 2. 1차 산출물 → 의미 단위 분해

### Step 2.1 — 1차 산출물 정의
- raw 파일 1개 → `processed_1/{원본명}.md` 1개.
- 기존 텍스트 추출 백엔드([src-tauri/src/commands/fs.rs](src-tauri/src/commands/fs.rs))의 PDF/DOCX/PPTX/XLSX 파이프 재사용.
- 새 파일: [src/lib/processing/primary-artifact.ts](src/lib/processing/primary-artifact.ts) — raw → primary 변환.

### Step 2.2 — 의미 단위 분해 (LLM 1단계)
- 새 파일: [src/lib/processing/decompose.ts](src/lib/processing/decompose.ts)
  - 입력: 1차 산출물 + 프로젝트에서 로드/병합된 SchemaDoc
  - 출력: `SemanticBlock[]` — 각 블록은 `{content, suggested_path, source_ref}`
- 프롬프트 템플릿: 병합된 SchemaDoc의 DecompositionRules를 system prompt로 강제. 앱 코드의 고정 page type을 프롬프트에 섞지 않는다.
- 새 파일: [src/lib/processing/decompose.test.ts](src/lib/processing/decompose.test.ts) — 분해 결과의 path가 schema에 존재하는지 검증.

### Step 2.3 — 출처 추적 포맷 표준화
- 새 파일: [src/lib/processing/source-ref.ts](src/lib/processing/source-ref.ts)
  - `SourceRef { document, locator }` 직렬화 (`instance_server_design.docx > section 3.2`).
  - 모든 2차 산출물 마크다운 파일에 `## Sources` 섹션 자동 부착.

---

# Phase 3. 수정 요청 다이얼로그 시스템

가장 큰 신규 영역이다. 자동 병합을 전혀 하지 않는다.

### Step 3.1 — Diff 산출
- 새 파일: [src/lib/processing/diff-engine.ts](src/lib/processing/diff-engine.ts)
  - 입력: 신규 SemanticBlock + 기존 2차 산출물 파일(있다면)
  - 출력: `ChangeRequest` — `{kind, existing, incoming, source, schemaVersion}`
  - 기본 kind: `add | modify | relocate`
  - 확장 kind: `schema_migration | exclusion_promote | freshness_review`
  - kind 분류 규칙은 IDEA.md 1.5의 6가지 케이스를 그대로 반영.

### Step 3.2 — Pending Changes 큐
- 저장 위치: `.llm-wiki/pending-changes/{id}.json`
- 새 파일: [src/lib/processing/pending-queue.ts](src/lib/processing/pending-queue.ts) — enqueue / list / resolve.
- ingest는 자동 적용을 절대 하지 않는다. 항상 큐에 쌓는다.

### Step 3.3 — Pending Changes / Diff Review 화면
- 새 파일: [src/components/pending/pending-view.tsx](src/components/pending/pending-view.tsx)
  - 좌: ChangeRequest 목록.
  - 중: existing vs incoming diff (라이브러리: `diff` 또는 Milkdown diff view).
  - 우: source 미리보기 + 액션 버튼 (허락 / 병합 / 거절).
- 새 파일: [src/components/pending/merge-editor.tsx](src/components/pending/merge-editor.tsx)
  - "병합" 선택 시 사용자가 직접 편집할 수 있는 에디터.
- 좌측 아이콘 사이드바([src/components/layout/icon-sidebar.tsx](src/components/layout/icon-sidebar.tsx))에 새 항목 추가.

### Step 3.4 — 거절 처리 후속 다이얼로그
- 거절 클릭 → modal: 폐기 / 보류 / 반례 등록 선택.
- 폐기 → `.llm-wiki/rejection-log/{hash}.json`에 사유 기록 → 동일 입력 재진입 시 자동 skip.
- 보류 → `pending/` 디렉토리로 이동.
- 반례 등록 → 출처 추적의 counter-evidence로 기록(다음 동일/유사 신규 진입 시 사용자에게 경고).

### Step 3.5 — 수정 요청 적용
- 새 파일: [src/lib/processing/apply-change.ts](src/lib/processing/apply-change.ts)
  - 허락/병합 결과를 실제 `db/` 파일에 쓴다.
  - Sources 섹션 갱신.
  - 적용 직후 Phase 4의 local git commit을 호출한다.

---

# Phase 4. local git 히스토리

IDEA.md의 원칙에 맞춰 2차 산출물 루트는 실제 local git 저장소로 관리한다. 원격 GitHub/GitLab 연동은 하지 않지만, 사용자는 익숙한 git log/diff/revert 모델로 변경 이력을 볼 수 있어야 한다.

### Step 4.1 — Git 저장소 초기화
- 새 파일: [src/lib/history/git-store.ts](src/lib/history/git-store.ts)
  - 프로젝트 생성 시 `git init` 여부를 확인하고, 없으면 초기화한다.
  - `db/`, `schema.md`, `schema.d/`, `question_types/`, `exclusions/`, `pending/`의 변경을 commit 대상으로 삼는다.
  - `.llm-wiki/pending-changes/`와 임시 작업 파일은 기본적으로 commit하지 않는다.

### Step 4.2 — Git 래퍼 API
- 새 파일: [src/lib/history/git-store.ts](src/lib/history/git-store.ts) — init / commit / log / diff / revert.
- 단위: ChangeRequest 처리 1건 = commit 1건. 자동 메시지 포맷 `{action} {path} (from {source})`.
- schema 변경은 별도 commit으로 남긴다. schema 변경이 db relocate를 유발하면 schema commit과 relocate commit을 분리한다.

### Step 4.3 — 히스토리 UI
- 새 파일: [src/components/history/history-view.tsx](src/components/history/history-view.tsx)
  - log: `git log` 기반 커밋 리스트.
  - diff: 커밋 클릭 시 `git diff` 기반 before/after 패널.
  - revert: 단일 커밋 되돌리기. 파괴적 reset은 제공하지 않고, 역방향 commit을 추가한다.
- 기존 `wiki/log.md`는 사람이 읽을 수 있는 요약 로그로 격하한다. 히스토리 원천은 local git이다.

---

# Phase 5. 검색 — 질문 유형 + 정적 배제

기존 4-Phase 검색은 "잔존 후보 위에서의 우선순위 알고리즘"으로 재사용한다.

### Step 5.1 — 질문 유형 정의 파일
- 디렉토리: `question_types/`
- 새 파일: [src/lib/retrieval/question-type-parser.ts](src/lib/retrieval/question-type-parser.ts)
  - 각 `question_types/{type}.md`는 frontmatter로 `id`, `name`, `null_meaning`(잔존 0의 의미) 등을 가진다.

### Step 5.2 — 질문 유형 판정기
- 새 파일: [src/lib/retrieval/classify-question.ts](src/lib/retrieval/classify-question.ts)
  - LLM 1회 호출로 `질문 → typeId` 결정. 결과는 local git commit 대상이 아니며, 검색 결과에 부착된다.

### Step 5.3 — 정적 배제 적용
- 디렉토리: `exclusions/by_question_type/`, `exclusions/axioms/`
- 새 파일: [src/lib/retrieval/exclusion-loader.ts](src/lib/retrieval/exclusion-loader.ts) — glob 패턴 기반.
- 새 파일: [src/lib/retrieval/apply-exclusions.ts](src/lib/retrieval/apply-exclusions.ts)
  - 입력: 전체 db/ 파일 목록 + typeId
  - 출력: `{candidates, excluded: ExclusionRecord[]}`
- **검색 진입 시점에 한 번만** 적용한다 (IDEA.md 2.2 준수).

### Step 5.4 — 4-Phase 검색을 후보 공간 위에서 동작하도록 변경
- 수정: [src/lib/search.ts](src/lib/search.ts)
  - 시그니처 변경: `search(query, candidatePaths)` — 토큰/임베딩/RRF/그래프 확장 모두 `candidatePaths`로 제한.
  - 기존 `wiki/` 경로 가정 제거 → `db/` 기준.
  - graph-relevance와 graph-insights도 `db/`의 wikilink 기준으로 재구성.

### Step 5.5 — 검색 결과에 배제 추적 부착
- 응답 포맷: `{ answers, type, excluded: {count, by_rule[]}, candidates: {start, after} }`
- 검색 화면([src/components/search/search-view.tsx](src/components/search/search-view.tsx))에 "적용된 배제 / 잔존 후보" 패널 추가.
- 잔존 0건의 의미는 typeDef.null_meaning으로 표시 (단순 "결과 없음"이 아니라 "명세 공백" / "위반 없음" 등).

---

# Phase 6. 배제 자산화 (Instance / Pattern / Axiom)

### Step 6.1 — Instance 기록
- 새 파일: [src/lib/retrieval/exclusion-instance.ts](src/lib/retrieval/exclusion-instance.ts)
- 매 검색마다 `exclusions/instances/YYYY-MM/query_*.md` 자동 작성.

### Step 6.2 — 승격 제안기
- 새 파일: [src/lib/retrieval/promotion-suggester.ts](src/lib/retrieval/promotion-suggester.ts)
  - 빈도 임계치는 `exclusions/promotion_rules.md`에서 읽어온다.
  - **자동 승격 금지**. 결과는 Pending Changes 큐에 ChangeRequest로 들어간다 (kind=`exclusion_promote`).
- Pending 화면이 일반 변경/배제 승격을 모두 처리하는 단일 진입점이 된다.

### Step 6.3 — 신선도 체크
- 새 파일: [src/lib/retrieval/freshness-check.ts](src/lib/retrieval/freshness-check.ts)
  - axiom의 `last_validated_at`이 N일 초과 → "재검토 필요" Pending 항목 생성.
  - 출처(2차 산출물 파일)가 변경되면 의존하는 배제 규칙도 재검토 후보로 전환.

---

# Phase 7. 정리 및 마감

### Step 7.1 — 데드 코드 삭제
- Phase 0.1에서 표시한 후보들을 삭제.
- 기존 Review 시스템 ([src/components/review/](src/components/review/), [src/lib/sweep-reviews.ts](src/lib/sweep-reviews.ts), [src/lib/review-utils.ts](src/lib/review-utils.ts)) 제거.
- 기존 `wiki/entities/`, `wiki/concepts/` 등을 가정하는 코드 모두 정리.

### Step 7.2 — i18n 갱신
- [src/i18n/en.json](src/i18n/en.json), [src/i18n/zh.json](src/i18n/zh.json)에 한국어 추가([src/i18n/ko.json](src/i18n/ko.json) 신규)도 함께 진행할지 별도 결정.
- Pending / History / Exclusions 화면 키 추가.

### Step 7.3 — 문서 갱신
- README.md를 새 모델로 다시 작성: Project Structure, Quick Start, 학습 순서.
- IDEA.md ↔ 코드의 매핑 표를 README 부록으로 추가.

### Step 7.4 — E2E 시나리오 테스트
- 신규 프로젝트 생성 → schema.md 작성 → schema.d에 node 추가 → schema validation → raw 1건 import → processed_1 생성 → 의미 분해 → Pending 3건 발생 → 허락/병합/거절(폐기) 처리 → db/ 반영 → local git commit 확인 → 검색(유형 판정 → 정적 배제 → 결과 + 배제 추적) → 잔존 0의 의미 출력.

---

## 의존 관계와 진행 순서

```
Phase 0 (정리/스캐폴딩)
   ↓
Phase 1 (schema 기계화/확장성)  ─┐
                          ↓
                       Phase 2 (분해)
                          ↓
                       Phase 3 (수정 요청 UI/큐) ←── Phase 4 (히스토리)
                          ↓
                       Phase 5 (검색)
                          ↓
                       Phase 6 (배제 자산화)
                          ↓
                       Phase 7 (정리/마감)
```

- Phase 1과 Phase 4는 다른 단계와 의존이 약하므로 Phase 2/3과 병렬 가능. 단, Phase 2는 항상 프로젝트에서 로드된 최신 SchemaDoc을 입력으로 받아야 한다.
- Phase 5는 Phase 2가 만들어낸 db/ 구조 위에서만 의미가 있으므로 Phase 2 이후.
- Phase 6은 Phase 5와 Phase 3에 모두 의존 (Pending 큐를 사용).

---

## 위험 요소 (개발 중 모니터링)

- **schema.md 형식의 표현력과 진화 가능성**: 너무 단순하면 분해가 어렵고 너무 복잡하면 사람이 못 읽는다. Phase 1.1에서 최소 코어 사양을 정하되, 프로젝트별 `schema.md`/`schema.d/*.md`가 추후 확장될 수 있도록 unknown extension 보존, deterministic merge, validation/migration 후보 생성을 함께 설계한다.
- **Pending 큐 폭발**: 자동 병합을 전혀 안 하므로 raw 파일 1개에서 ChangeRequest 수십 건이 발생할 수 있다. Phase 3.3에서 batch-resolve UI(같은 출처/같은 종류 일괄 처리)를 함께 설계.
- **기존 검색 자산 손실 위험**: Phase 5.4에서 4-Phase 검색의 입력만 후보 공간으로 좁히는 형태로 재사용. 점수 알고리즘은 건드리지 않는다.
- **local git 호출 안정성**: 앱 내부에서 git binary를 호출해야 하므로 설치 여부, 경로, 실패 메시지, revert 충돌 처리를 명확히 해야 한다. 원격 동기화는 범위 밖이며, 단일 사용자 local history를 우선 보장한다.
