# GUIDE.md — LLM Wiki 사용자 가이드

이 문서는 [development-plan.md](development-plan.md) Stage 1~7 (Part 1, 2차 가공
파이프라인)과 [second-development-plan.md](second-development-plan.md) Stage
8~15 (Part 2, 배제 기반 검색)가 모두 구현된 상태의 LLM Wiki를 사용자가 어떻게
쓰는지 정리한다.

배경 철학은 [IDEA.md](IDEA.md)를 따른다.

> 정답을 한 번에 고르려 하지 말고, 명백한 오답을 배제한 뒤 남는 것을 답으로 본다.

이 철학은 검색 단계(Part 2)에서 본격적으로 작동한다. Part 1(2차 가공)은 사람이
수정 요청을 직접 허락/거절하는 흐름이라 정답/오답 모델이 필요 없다.

---

## 0. 한눈에 보기 — 사용자의 작업 흐름

```text
[1] 프로젝트 생성 (schema.md + purpose.md 입력)
       ↓
[2] Raw 파일 업로드 (PDF/DOCX/MD/XLSX 등)
       ↓
[3] 자동 2차 가공 — schema.md에 따라 db/ 트리에 분해 배치
       ↓
[4] 동일 의미 단위 v2 입력 시 → 수정 요청(Approve/Merge/Reject)
       ↓ (Reject면 Discard/Pending/Counterexample 2단계)
[5] 확정된 db/ 트리 + 출처 추적 + git commit 이력
       ↓ ─────────────  여기까지 Part 1  ─────────────
[6] question_types/ + exclusions/ 작성 (Part 2 준비)
       ↓
[7] 검색 — 유형 판정 → 배제 적용 → 잔존 결과 + 트레이싱
       ↓
[8] 검색 이력 누적 → Promotion (instance → pattern → axiom)
       ↓
[9] 자기 정정 (출처 의존성 / 신선도 / 반례 / archive)
```

각 단계의 산출물은 모두 **로컬 git**에 commit된다. 외부 git 서비스 연동은 선택
사항.

---

# Part 1 — 프로젝트 생성과 2차 가공

## 1. 프로젝트 생성

### 1.1 새 프로젝트 만들기

좌측 사이드바 "+" 또는 "New Project" 클릭 → 다이얼로그.

다이얼로그에 입력해야 할 4가지:

| 항목 | 설명 |
|---|---|
| 프로젝트 이름 | 사이드바·창 제목에 표시 |
| 부모 디렉토리 | 프로젝트가 만들어질 위치 (예: `~/Projects/`) |
| **스키마 파일** | `.md` 파일 picker로 선택 — **필수** |
| 프로젝트 목적 | markdown textarea (빈 값 허용) |

스키마 파일 picker는 임의의 `.md`를 받는다. 처음 쓴다면 저장소의
[schema/game-dev-example.md](schema/game-dev-example.md)를 선택해 시작점으로
삼는다. 도메인이 다르면 자기 도메인용 schema를 따로 작성해 picker에서 고른다.

### 1.2 자동으로 만들어지는 것

Create 클릭 시 다음이 일어난다.

```text
<projectPath>/
  schema.md              # picker로 고른 파일 복사본
  purpose.md             # textarea 입력 (빈 문자열도 허용)
  db/                    # 2차 산출물 — Part 1 가공 결과가 들어감
    .gitkeep
  processed_1/           # 1차 산출물 (raw → 가공 입력)
    .gitkeep
  pending/               # 사용자가 보류한 수정 요청
    .gitkeep
  counterexamples/       # 반례 등록한 수정 요청
    .gitkeep
  question_types/        # Part 2 — 빈 상태로 생성
    .gitkeep
  exclusions/            # Part 2 — 시드 2개 + 빈 디렉토리
    exclusion_schema.md
    promotion_rules.md
    by_question_type/.gitkeep
    axioms/.gitkeep
    instances/.gitkeep
  .llm-wiki/             # 앱 설정 / 큐 / 거절 로그
  .git/                  # 자동 git init
```

생성 직후 `init: bootstrap project` commit 1건이 자동 생성된다.

```bash
cd <projectPath>
git log --oneline
# → init: bootstrap project
```

도메인별 서브 디렉토리(예: `db/systems/...`)는 부트스트랩 시점에 만들지 **않는다**.
첫 ingest에서 LLM이 schema.md를 읽고 필요한 위치에 페이지를 만들면서 같이
생긴다.

### 1.3 schema.md를 처음 작성한다면

[schema/game-dev-example.md](schema/game-dev-example.md)가 사람이 읽을 수 있는
정밀한 reference다. 자기 도메인의 schema를 만들 때 다음만 지키면 된다.

- 디렉토리 트리를 어떤 의미 단위로 쪼갤지 명시
- 각 디렉토리가 받을 콘텐츠 종류를 짧게 설명
- 분해 규칙 — "1차 산출물의 어떤 부분이 어디로 가는지"
- 기존 산출물과 신규 콘텐츠를 비교할 때의 기준

분량은 자유. 너무 길어 LLM이 한 번에 받기 부담스러우면 핵심 트리만 남긴다.

---

## 2. Raw 데이터 업로드 → 2차 가공

### 2.1 업로드

사이드바 **Raw** 탭(혹은 Sources) → "파일 추가". 받는 형식:

- `.md` / `.txt`
- `.pdf` (pdf-extract)
- `.docx` (docx-rs)
- `.xlsx` (calamine)
- 그 외 plain text

업로드한 파일은 `raw/sources/` 또는 처리 큐에 등록된다.

### 2.2 자동 2차 가공 흐름

업로드 1건당 다음이 일어난다.

```text
raw 파일
   ↓
[Step 0] processed_1/<basename>.md   — passthrough 1차 산출물
   ↓
[Step 1] LLM 분석 — schema.md를 보고 "어떤 db/ 경로로 분해할지" 결정
   ↓
[Step 2] LLM 생성 — 각 의미 단위별로 db/ 페이지 생성
   ↓
[Step 3] 기존 페이지와 충돌 검사
   ├─ 충돌 없음 → 그대로 db/에 저장 + sources 병합
   └─ 충돌 있음 → pending/_proposals/<...>.md에 보류 + review 카드 큐잉
   ↓
[Step 4] git commit (`ingest: <file> → N pages`)
```

활동 패널(Activity Panel)에서 진행 상황을 볼 수 있다. 처리 완료 후:

```bash
ls <projectPath>/processed_1/
# → 업로드한 파일이 .md로 정규화되어 그대로 들어 있음

find <projectPath>/db -name "*.md" -not -name ".gitkeep"
# → schema.md가 정의한 경로에 분해된 페이지들

git log --oneline
# → ingest: <file> → N pages
```

### 2.3 출처 추적 — frontmatter `sources`

가공된 db/ 페이지는 모두 frontmatter에 출처 정보를 가진다.

```md
---
title: 던전 A 보상
sources:
  - file: instance_server_design.docx
    range: section 3.2
  - file: dungeon_balance.xlsx
    range: DungeonA!B12:E18
---

# 던전 A 보상

- 클리어 시 골드 1000 + 장비 박스 1개
- 주간 1회 추가 보상
```

`sources`의 의미:

- 수정 요청 검토 시 **근거 제시**
- 원본 변경 시 **영향받는 페이지 식별** (Part 2의 §8.1 출처 의존성으로 연결)
- 검색 결과 카드에 **출처 라벨**로 출력
- 같은 page에 여러 raw 파일이 기여하면 sources 배열이 누적

수동 편집 시에도 `file`/`range` 형식을 지키면 시스템이 그대로 인식한다.

### 2.4 분해 결과가 기대와 다를 때

**자주 발생**: schema.md는 `db/systems/instance_server/`로 보내라 했는데 LLM이
`db/server/instance/`로 만든 경우.

대응 우선순위:
1. **schema.md 본문 보강** — "instance_server는 systems/ 하위에 둔다"고 명시.
2. 다음 ingest에서 다시 시도 — 자동으로 같은 분해가 반복되지 않음.
3. 필요 시 페이지를 직접 옮기고 `git commit`.

LLM 출력의 path가 schema와 100% 일치할 필요는 없다. **합리적으로 도메인 축에
맞으면 OK**.

---

## 3. 수정 요청 처리 (Modification Workflow)

같은 의미 단위가 v2 raw 파일로 다시 들어오면 자동 덮어쓰기가 **금지**된다.
대신 review 패널에 **modification 카드**가 큐잉된다.

### 3.1 카드 구조

```text
┌────────────────────────────────────────────┐
│ 🔀 modification                             │
│ db/content/dungeons/dungeon_a/rewards.md    │
├────────────────────────────────────────────┤
│ Existing                  │ Incoming        │
│ - 골드 1000 + 박스 1개    │ - 골드 1500     │
│ - 주간 1회                │ - 주간 2회      │
├────────────────────────────────────────────┤
│ Source: instance_server_design_v2.md        │
│        > section 3.2                        │
├────────────────────────────────────────────┤
│ [Approve]  [Merge]  [Reject]                │
└────────────────────────────────────────────┘
```

### 3.2 1단계 액션 (primary)

| 액션 | 결과 |
|---|---|
| **Approve** | 신규 내용으로 db/ 페이지 갱신, 기존 sources에 신규 source 병합, draft 삭제, commit |
| **Merge** | draft 파일을 에디터에서 열어 사용자가 직접 편집 → 저장 후 다시 [Approve] |
| **Reject** | 카드가 2단계 액션으로 전환 |

Merge는 시스템이 자동 병합하지 않는다 — **사용자가 직접 손으로 합친다**. 자동
병합은 정답을 가짜로 만들어내는 위험이 있어 의도적으로 배제됨.

### 3.3 2단계 액션 (rejection-handling)

Reject 클릭 시 같은 카드의 버튼이 다음 3개로 전환:

| 액션 | 결과 |
|---|---|
| **Discard** | draft 삭제, `.llm-wiki/rejection-log.jsonl`에 기록, commit |
| **Pending** | draft를 `pending/<slug>.md`로 이동, commit |
| **Counterexample** | draft를 `counterexamples/<slug>.md`로 이동, commit |

#### Discard — 단순 폐기

신규 내용이 잘못 들어왔거나 무관할 때. 다음에 동일 raw section이 다시 들어와도
이 거절 사유가 LLM 컨텍스트에 주입되어 같은 카드가 또 안 뜬다.

#### Pending — 나중에 다시 보기

지금은 결정 못 하지만 버리기는 아까운 내용. 사이드바 [Review | Pending] 탭에서
언제든 다시 꺼낼 수 있다 (§4 참조).

#### Counterexample — 기존이 맞다는 근거로 활용

이게 LLM Wiki의 가장 독특한 옵션. **신규 내용이 틀렸다는 사실 자체를 자산으로
저장**한다.

- `counterexamples/<slug>.md`에 영구 보관
- 다음에 같은/유사 신규 내용이 raw에 들어오면 LLM 컨텍스트에 "이건 반례로 등록된
  적 있다" 정보가 주입되어 자동 dismiss됨
- 검색 결과에서 [정답으로 표시]를 누르면 Part 2의 배제 entry 무효화 트리거가
  되기도 함 (§9.3)

### 3.4 모든 액션은 git commit 1건

```bash
git log --oneline | head
# modification: approve db/.../rewards.md
# modification: discard db/.../foo.md
# modification: pending db/.../bar.md
# modification: counterexample db/.../baz.md
```

잘못 누른 액션은 history 패널(§5)에서 commit 단위로 revert.

---

## 4. Pending / Counterexample 활용

### 4.1 Pending 패널

사이드바 **Review** 탭 → 헤더의 [Review | Pending] 토글 → Pending 탭.

각 Pending 항목 카드:

```text
┌────────────────────────────────────────────┐
│ 던전 A 보상 (수정 v2)                       │
│ pending/dungeon_a_rewards.md                │
│ → db/content/dungeons/dungeon_a/rewards.md  │
├────────────────────────────────────────────┤
│ [Re-review]  [Promote to db/]  [Discard]    │
└────────────────────────────────────────────┘
```

| 액션 | 결과 |
|---|---|
| **Re-review** | pending 파일을 `pending/_proposals/`로 옮기고 modification 카드를 review 큐에 다시 등록. 1단계 액션부터 처음 다시 시작. |
| **Promote to db/** | pending 내용을 target으로 즉시 적용 (Approve와 동일) |
| **Discard** | pending 파일 삭제 + rejection log 기록 |

Target 파일이 그 사이에 사라졌으면 카드에 "(target not found)" 라벨이 뜬다.
이 경우 직접 commit 이력을 확인하고 적절한 path를 새로 정해 수동 처리.

### 4.2 Counterexample은 직접 만지지 않는다

`counterexamples/`는 시스템이 자동으로 LLM 컨텍스트에 주입하는 파일들이다.
**사용자가 직접 편집하거나 삭제할 일은 거의 없다.** 잘못 등록했다면:

- 해당 파일을 git에서 직접 삭제하고 commit, 또는
- Part 2 검색 결과에서 [정답으로 표시] (§9.3) — counterexample도 같은 무효화
  메커니즘으로 처리됨

---

## 5. Git 히스토리 / 롤백

사이드바 **History** 아이콘 → 3-pane 패널.

### 5.1 패널 구조

```text
┌─────────────┬─────────────────────┬──────────────────┐
│ Commit list │ Selected commit     │ File diff        │
│             │                     │                  │
│ • ingest…   │ message body        │ + 추가 라인       │
│ • modific…  │ files changed:      │ - 삭제 라인       │
│ • init…     │ - rewards.md (M)    │   ...            │
│ [Load more] │ - server.md (A)     │                  │
└─────────────┴─────────────────────┴──────────────────┘
```

좌측에서 commit 클릭 → 중앙에 메타 + 변경 파일 → 파일 클릭 → 우측에 diff.

### 5.2 액션

| 액션 | 위치 | 결과 |
|---|---|---|
| **이 버전으로 복원** | 변경 파일 카드 | 그 파일만 선택한 commit 시점으로 되돌림 → `revert: restore <path> to <hash>` commit 1건 |
| **이 커밋 되돌리기** | commit 헤더 | 선택 commit을 통째로 revert (`git revert`) → `Revert "..."` commit 1건 |

### 5.3 충돌 시

"이 커밋 되돌리기"가 충돌나면 alert에 **충돌한 파일 경로**가 명시된다. 자동
resolve / abort는 하지 않으므로:

1. 터미널에서 `cd <projectPath>`
2. `git status` → unmerged paths 확인
3. 직접 충돌 해결 (또는 `git revert --abort`)
4. resolve 후 `git revert --continue`

UI에서 처리하는 게 부담스러우면 외부 git GUI(Sourcetree, Tower, GitKraken)도
그대로 쓸 수 있다 — 같은 로컬 repo이므로.

### 5.4 history는 단순한 시간 축, 검색이 아니다

특정 메시지/파일을 검색하려면 터미널이 더 빠르다.

```bash
git log --oneline --grep="^modification:"
git log --oneline --follow db/content/dungeons/dungeon_a/rewards.md
git log -p --since="1 week ago" -- db/
```

---

## 6. 언어 / UI 라벨

설정 → Interface → 언어. ko / en / zh 3개 지원.

| 영문 | 한국어 | 중국어 |
|---|---|---|
| Wiki | DB | DB |
| Sources | Raw | Raw |
| Review | 수정 요청 | 修改请求 |
| History | 히스토리 | 历史 |
| Settings | 설정 | 设置 |

3개 언어 키는 i18n parity 테스트로 동기화가 강제된다 — 한 언어에만 있는 키는
릴리스에 들어가지 않는다.

---

# Part 2 — 배제 기반 검색

여기부터는 [IDEA.md](IDEA.md) Part 2의 적용. Part 1으로 db/ 트리에 데이터가
적재된 상태가 전제다.

## 7. 검색의 큰 그림

검색 1회는 다음 흐름으로 동작한다.

```text
질문 입력
   ↓
[1] 질문 유형 판정 (LLM 분류기)
   ↓
[2] 유형 기반 배제 적용 (pattern + 적용되는 axiom 모두)
   ↓
[3] 줄어든 후보 위에서 탐색 (기존 search 엔진)
   ↓
결과 + 트레이싱 + 자동 instance 로그 + git commit
```

사용자가 통제하는 것은 **[1]의 유형 정의**와 **[2]의 배제 지도**다. [3]은 기존
검색이 그대로 쓰인다.

검색을 처음 쓰려면 **두 가지만 준비**하면 된다.

1. `question_types/`에 최소 1개 type 정의를 넣는다.
2. `exclusions/by_question_type/`에 그 type의 배제 규칙을 넣는다 (선택).

빈 프로젝트도 검색은 동작한다 — 단, 분류기가 매번 `null`을 반환하고 배제가 적용
안 된 채 fallback 검색이 실행된다.

---

## 8. Question Type 작성하기

### 8.1 형식

`question_types/<id>.md`에 plain markdown으로 작성한다. 파일명 stem이 type id가
된다 (예: `policy_violation.md` → id: `policy_violation`).

```md
---
title: 정책 위반 탐지
---

## Description

사용자/운영 정책에 위반되는 동작을 식별한다. 정책 문서가 명시한 금지 행위를
다른 시스템 동작이 우회하거나 모순되는지 본다.

## Input

- 검사 대상 행위/시나리오 (자연어 또는 시스템 동작 명세)

## Output

- 위반된 정책 항목과 근거 문서
- 위반 없음(잔존 0)인 경우 명시적 신호

## Zero residue

잔존 0 = 위반 없음 (긍정적 신호). "결과 없음"이 아니라 "정책 위반이 식별되지
않았다"로 사용자에게 출력된다.
```

### 8.2 필수/선택 섹션

| 섹션 | 필수? | 용도 |
|---|---|---|
| `title` (frontmatter) 또는 첫 H1 | **필수** | 분류기와 UI에 보이는 이름 |
| `## Description` | **필수** | 분류기가 type을 식별하는 가장 중요한 신호 |
| `## Input` | 권장 | 분류기 정확도 향상 |
| `## Output` | 권장 | 결과 렌더 형태 안내 |
| `## Zero residue` | 권장 | 잔존 0일 때의 의미 (§11) |

알 수 없는 섹션은 무시되므로 자유롭게 메모를 추가해도 된다.

### 8.3 시작점: schema 예시 복사

`schema/question_types/`에 game-dev 도메인의 5~6개 예시(condition_based_test,
policy_violation, regression_test 등)가 들어 있다. 새 프로젝트의
`question_types/`로 그대로 복사한 뒤 본문만 자기 도메인에 맞게 고쳐 쓰는 편이
빠르다.

[IDEA.md §2.3](IDEA.md)의 12개 카탈로그가 type 명명/구분의 기준이 된다.

### 8.4 type을 몇 개 두어야 하나

너무 많으면 분류기가 흔들리고, 너무 적으면 유형별 배제의 효용이 사라진다. 실무
경험상 **5~12개**가 적정. 12개 이상이 되면 type이 사실 더 큰 카테고리로 묶일
수 있는지 검토.

---

## 9. Exclusions 작성하기 (4가지 경로)

배제 entry를 만드는 방법은 4가지다.

### 9.1 직접 편집 — pattern (Level 2)

`exclusions/by_question_type/<type-id>.md`를 직접 작성한다.

```md
# 정책 위반 탐지 유형의 배제 대상

## 배제

- db/instance_server/server_structure.md
  근거: 서버 구조는 정책이 아닌 인프라 설명. 정책 위반 판정과 무관.
- db/**/spawn_rules.md
  근거: 스폰 규칙은 게임 정책이 아닌 운영 데이터.

## 출처

- 사람 검토 (2026-04-12)
- 도메인 정책: 정책 = Policy/Intent Layer 한정
```

**glob 문법:** 리터럴 / `*` (단일 segment) / `**` (재귀)만 지원. minimatch 전체
문법은 일부러 채택하지 않았다 — 사람이 읽고 검증하기 쉬운 범위로 제한.

### 9.2 직접 편집 — axiom (Level 3)

여러 type에 공통 적용되는 본질적 배제는 axiom으로 둔다.
`exclusions/axioms/<name>.md`:

```md
---
applies_to:
  - condition_based_test
  - regression_test
  - test_gap
last_validated_at: 2026-05-05
---

# Spawn rules는 테스트 명세가 아니다

## 배제

- db/**/spawn_rules.md
  근거: spawn rules는 운영 데이터로, 테스트 기대값과 무관.

## 출처

- 사람 검토 (2026-05-05)
```

`applies_to` frontmatter는 axiom의 적용 범위를 결정한다. 여기 나열된 모든 type의
검색에서 이 entry가 함께 적용된다.

### 9.3 Promotion으로 만들기 (instance → pattern → axiom)

검색을 반복하다 보면 같은 (type, path) 쌍이 instance 로그에 누적된다. 임계값
(`promotion_rules.md`의 `pattern_threshold`, 기본 5)을 넘으면 사이드바
**Promotion view**에 후보로 뜬다.

| 액션 | 결과 |
|---|---|
| Promote to Pattern | `exclusions/by_question_type/<type>.md`에 entry 추가 |
| Promote to Axiom | `exclusions/axioms/<name>.md` 새로 생성 (이름 입력) |
| Dismiss | 후보 무시 — 다시 떠도 dedup |

**자동 승격은 절대 일어나지 않는다.** 빈도는 신호일 뿐, 실제 추가는 사람이
버튼을 눌러야 한다 (IDEA §2.6).

### 9.4 반례 등록으로 무효화 → 재작성

검색 결과에서 [정답으로 표시] 버튼을 누르면, 그 path가 다른 type에서 배제되어
있는 경우 해당 entry가 `needs_review: true`로 자동 마킹된다. 사용자는 entry를
열어 근거를 다시 검토하고 archive하거나 패턴을 좁힌다.

---

## 10. 검색하기 — 트레이싱 읽는 법

검색 박스에 질문을 입력하면 결과 위에 **트레이싱 블록**이 collapsible로 붙는다.

```text
판정된 유형: 조건 기반 가상 테스트 (condition_based_test)
신뢰도: 0.87
근거: 질문이 특정 조건(SafeZone)에서의 시스템 동작을 묻고 있음

적용된 배제: 47개 중 21개 제거
  - condition_based_test.md → 21
    (db/instance_server/server_structure.md
     db/instance_server/policies/...
     ...)

탐색 시작 후보: 26개

결과: 1개
  → "SafeZone 내 공격성 스킬 차단"
  근거: instance_server_design.docx > section 3.2
```

### 10.1 무엇을 보면 되나

| 필드 | 의미 | 이상 신호 |
|---|---|---|
| 판정된 유형 | 분류기가 고른 type | `null`이면 분류 실패 — fallback 검색 |
| 신뢰도 | 0~1 | 0.5 미만이면 type 정의가 모호하거나 질문이 모호 |
| 적용된 배제 N개 중 M개 제거 | 후보 공간 축소량 | 0 제거 = 배제 지도가 비어있음 |
| 탐색 시작 후보 | 배제 후 남은 후보 수 | 너무 많으면 type 외 추가 axiom 필요 |
| 결과 | 탐색 hits | 잔존 0이면 §11 참조 |

### 10.2 트레이싱이 잘못된 type을 짚었을 때

질문을 더 명시적으로 다시 쓰거나, type 정의의 `## Description` /`## Input`을
보강한다. 분류기는 type 카드 본문만 보고 판단하므로, 본문이 빈약하면 매번
헛갈린다.

---

## 11. 잔존 0의 의미

배제 후 hits가 0개여도 단순한 "결과 없음"이 아니다. type이 정의한
`## Zero residue` 섹션이 결과 영역에 출력된다.

| Type | 잔존 0의 의미 |
|---|---|
| `condition_based_test` | 명세 공백 — 해당 조건에 대한 정의가 db에 없음 |
| `policy_violation` | 위반 없음 (긍정적 신호) |
| `regression_test` | 영향 없음 |
| `test_gap` | 공백 없음 |

type을 작성할 때 `## Zero residue`를 빠뜨리면 일반 "결과 없음"이 출력된다.
도메인적으로 의미 있는 신호를 받고 싶다면 항상 채워두자.

---

## 12. Instance 로그 — 검색 이력 활용

검색 1회마다 다음이 자동으로 일어난다.

1. `exclusions/instances/<YYYY-MM>/q-<timestamp>-<slug>.md` 생성
2. git commit (`search: <type-id> → N hits (M excluded)`)

### 12.1 사용자가 직접 보고 싶을 때

```bash
# 최근 검색 1주일치
cd <project-path>
git log --oneline --since="1 week ago" --grep="^search:"

# 특정 type의 검색만
git log --oneline --grep="^search: policy_violation"

# 한 instance 본문 열기
$EDITOR exclusions/instances/2026-05/q-2026-05-05T...md
```

### 12.2 왜 이게 가치 있는가

- **Promotion view의 입력**: 빈도 집계가 instance 폴더에서 나온다.
- **반례 등록의 근거**: instance 본문이 그대로 entry의 `sources:`로 인용된다.
- **검색 디버깅**: "왜 그때 이 결과가 안 나왔지?"를 git log로 역추적.

instance 파일은 **삭제하지 않는다**. 너무 많아지면 archive 디렉토리로 이동하는
관행을 쓰자 (현재 자동화 없음).

---

## 13. 자기 정정 워크플로우

배제 지도는 영원히 누적되지 않는다. 4가지 무효화 메커니즘이 자동으로 작동한다.

### 13.1 출처 의존성 (자동)

entry의 `sources:`에 명시된 path 파일이 git에서 더 새로운 mtime으로 바뀌면,
해당 entry는 다음 lint/promotion view에서 `needs_review` 배지로 표시된다.

대응:
- entry 본문을 다시 읽고 근거가 여전히 유효한지 확인.
- 유효하면 axiom 카드의 [Mark validated] 클릭 → `last_validated_at` 갱신.
- 무효하면 [Archive].

### 13.2 신선도 (자동)

axiom의 `last_validated_at`이 `promotion_rules.md`의 `freshness_days` (기본 90)
초과 시 Lint view에 stale 경고가 뜬다.

대응: 위와 동일.

### 13.3 반례 발견 (사용자 트리거)

검색 결과 카드에서 [이 결과를 정답으로 표시]를 누르면, 그 path가 다른 type에서
배제되어 있는 경우 그 entry가 `needs_review`로 자동 전환되며, 누른 instance가
반례로 인용된다.

이 흐름은 Part 1의 counterexample 등록(§3.3)과 같은 정신을 공유한다 — **사람의
명시적 판단을 자산으로 누적**.

### 13.4 명시적 폐기 (사용자)

axiom/pattern entry 카드의 [Archive] 버튼.

- entry는 파일에 보존되지만 `archived: true`로 마킹.
- `applyExclusions`는 archived entry를 skip → 다음 검색부터 적용 X.
- [Restore]로 되돌릴 수 있음.

**삭제 대신 archive를 쓰는 이유**: 과거 instance 로그에 남은 인용이 깨지지 않게
하기 위함이다.

---

## 14. promotion_rules.md 튜닝

`exclusions/promotion_rules.md`는 시드로 들어온 plain markdown이다. 다음 키를
인식한다 (한 줄 `key: value` 형식):

```md
# 승격 규칙

pattern_threshold: 5         # 같은 (type, path) 쌍이 N회 이상 instance에 등장하면 후보
axiom_min_types: 2            # axiom 후보가 되려면 N개 이상의 type에서 등장
freshness_days: 90            # axiom의 last_validated_at 임계
noise_min_question_length: 8  # 이보다 짧은 질문은 instance 기록 생략

## 메모

- **자동 승격은 금지된다.** 위 임계값은 후보를 사람에게 보일지 결정하는 신호일
  뿐이다. 실제 추가는 항상 사람의 명시적 [Promote] 버튼으로만 일어난다.
```

키를 인식 못 하면 코드 default가 적용된다. 메모 섹션은 자유 markdown.

---

# 부록

## 부록 A — 흔한 함정

### Part 1 (가공)

| 증상 | 원인 | 대응 |
|---|---|---|
| ingest가 schema와 다른 path에 페이지 생성 | schema.md 본문이 모호 | schema 보강 후 재 ingest |
| v2 입력했는데 자동 덮어써짐 | 충돌 검출이 frontmatter만 다른 케이스를 동일로 판정 | review 카드에 안 뜨면 그대로 두고, 차이가 의미 있는데 review가 빠졌다면 이슈 보고 |
| Counterexample 등록했는데 같은 카드가 또 뜸 | LLM 비결정성 — 컨텍스트 주입은 보장이 아니라 신호 | Discard 한 번 더 누르면 누적되어 다음에 더 강한 신호 |
| Pending이 너무 많이 쌓임 | 결정 미루기 습관 | 주 1회 Pending 탭 비우기 — Promote / Discard 중 하나 선택 |
| 잘못 Approve한 modification | — | History 패널에서 그 commit 선택 → "이 커밋 되돌리기" |

### Part 2 (검색)

| 증상 | 원인 | 대응 |
|---|---|---|
| 분류기가 매번 `null` | type 정의가 비었거나 description이 모호 | type 본문 보강 |
| 트레이싱 "0개 제거" | exclusions가 비었거나 glob이 어긋남 | pattern 작성, glob을 `db/**/...`로 |
| 결과가 항상 잔존 0 | exclusions가 너무 광범위 | pattern을 좁히거나 archive |
| Promotion 후보가 안 뜸 | 임계값 미달 또는 같은 후보가 dismiss됨 | `pattern_threshold` 낮추기 / `.llm-wiki/promotion-dismissals.jsonl` 검토 |
| `wiki/` 시절 검색 결과가 안 보임 | legacy `wiki/` 트리는 db/ 분기 검색에서 후순위 | `wiki/`를 `db/`로 복사 또는 schema에 wiki 경로 추가 |
| Lint에 stale axiom이 폭증 | 초기 axiom들이 한꺼번에 90일 경과 | [Mark validated]를 일괄 처리, 또는 freshness_days 상향 |

---

## 부록 B — 빠른 시작 체크리스트

### Part 1 (첫 ingest까지)

1. [ ] [schema/game-dev-example.md](schema/game-dev-example.md) 또는 자기 schema
       작성
2. [ ] 새 프로젝트 생성 — schema picker로 schema.md 선택, purpose 입력
3. [ ] `git log --oneline` → `init: bootstrap project` 1건 확인
4. [ ] Raw 탭 → 작은 raw 파일(`.md` 또는 `.pdf`) 1개 업로드
5. [ ] 활동 패널에서 ingest 완료 대기
6. [ ] `find <projectPath>/db -name "*.md"` → 페이지 생성 확인
7. [ ] 임의 페이지 frontmatter `sources` 확인 — `file`/`range` 들어있는지
8. [ ] `git log --oneline | head` → `ingest: <file> → N pages` commit 1건

### Part 1 (수정 요청 처리)

9. [ ] 같은 raw의 v2(내용을 살짝 바꾼 것) 업로드
10. [ ] Review 패널에 modification 카드 1건 등장
11. [ ] [Approve] / [Reject → Discard|Pending|Counterexample] 중 1개 시도
12. [ ] `git log --oneline` → `modification: <action> ...` commit 추가

### Part 2 (검색)

13. [ ] `schema/question_types/`에서 도메인에 맞는 type 1~3개 복사
14. [ ] 복사한 type 파일의 `## Description` / `## Zero residue`를 자기 도메인에
       맞게 수정
15. [ ] `exclusions/by_question_type/<type>.md`를 1개 작성 (선택이지만 권장)
16. [ ] 사이드바 검색에 질문 1건 입력 → 트레이싱 블록 확인
17. [ ] 트레이싱이 기대와 다르면 type 본문 또는 exclusions를 손본 뒤 재실행
18. [ ] 같은 패턴의 검색을 5회 이상 반복 → Promotion view에 후보 등장 확인
19. [ ] [Promote to Pattern] / [Promote to Axiom] 1회씩 시도
20. [ ] axiom 1개에 [Archive] / [Restore] 시도
21. [ ] `git log --grep="^search:"` 또는 `--grep="^promote:"`로 이력 조회

여기까지 통과하면 Part 1과 Part 2가 모두 손에 익은 상태다. 이후로는 일상
ingest와 검색을 쓰면서 Promotion view와 Lint의 신호를 주기적으로 처리하면 된다.

---

## 부록 C — 더 읽을 거리

- [IDEA.md](IDEA.md) — 설계 철학과 Part 1/Part 2 정의
- [PLAN.md](PLAN.md) — 마일스톤 M1~M10과 재활용 지도
- [development-plan.md](development-plan.md) — Part 1 구현 단계 (Stage 1~7)
- [second-development-plan.md](second-development-plan.md) — Part 2 구현 단계
  (Stage 8~15)
- [schema/game-dev-example.md](schema/game-dev-example.md) — game-dev schema의
  사람이 읽는 reference
- `schema/question_types/` (저장소 내) — 12 카탈로그 중 game-dev 예시 5~6개
- 프로젝트 내 `exclusions/exclusion_schema.md` — 좌표계와 적용 순서의 정확한
  정의
