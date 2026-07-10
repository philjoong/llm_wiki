# LLM Wiki 데이터 교환 양식 (Interchange Spec)

버전: 1.0 (2026-07-08)

외부 앱에서 쌓은 지식(문서·엔티티·그래프)을 LLM Wiki 프로젝트로 가져오기 위한 표준 양식이다.
이 문서대로 파일을 생성해 `.llmwiki` 패키지로 묶으면 앱의 **프로젝트 가져오기(import)** 기능으로 읽을 수 있다.

---

## 1. 패키지 구조

`.llmwiki` 파일은 확장자만 다른 **일반 zip**이다. 내부 구조:

```
my-knowledge.llmwiki (zip)
├─ db/                          # 위키 문서 (2장)
│   └─ **/*.md
├─ graphs.json                  # 그래프 스냅샷 (3장) — zip 루트에 위치
└─ .llm-wiki/
    ├─ graph-policy.json        # 그래프 정책 (4장)
    └─ entity-dict.json         # 엔티티 사전 (5장, 선택)
```

**만들지 말아야 하는 파일:**

| 파일 | 이유 |
|---|---|
| `.llm-wiki/graph.sqlite` | 앱 내부 그래프 DB. 이 파일이 zip에 있으면 해당 그래프의 `graphs.json` 복원이 건너뛰어진다(이미 존재하는 그래프는 skip). 그래프는 반드시 `graphs.json`으로만 전달한다. |
| `.llm-wiki/page-graph-index.json` | 프로젝트 열기 시 그래프 DB에서 자동 재빌드된다. |

`question_types/`, `data_types/`는 선택이다. 없으면 프로젝트 열기 시 `data_types/`만 앱 번들 기본값으로 보강되고, `question_types/`는 보강되지 않는다(빈 상태로 남음).

---

## 2. 위키 문서 — `db/**/*.md`

### 2-1. 경로 규칙 (`page_path`)

문서 경로는 다른 파일들(`graphs.json`의 `pagePath`, `entity-dict.json`의 `pagePaths`)에서
문서를 참조하는 **키**로 쓰이므로 전 파일에 걸쳐 문자열이 정확히 일치해야 한다.

- `db/`로 시작하는 상대 경로, 구분자는 `/` (백슬래시 금지)
- `..` 세그먼트, 절대 경로, 드라이브 문자, 제어 문자 금지
- 파일명은 소문자-하이픈 ASCII slug 권장 (예: `db/enemies/goblin-warrior.md`)

### 2-2. 파일 양식

YAML frontmatter + 본문. 본문은 **원본 자료의 verbatim 텍스트**를 담는다.
위키링크(`[[...]]`)나 앱 전용 마크업은 사용하지 않는다.

```md
---
title: 고블린 전사
status: draft
sources:
  - file: enemy_design.docx
    range: "section 2.1"
---

고블린 전사는 근접형 적으로, 체력 120에 공격력 15를 가진다. ...
```

| 키 | 필수 | 타입 | 설명 |
|---|---|---|---|
| `title` | ✓ | string | 문서 제목. 보통 원본의 섹션 제목 |
| `status` | ✓ | string | `draft` 고정 (앱이 생성하는 값과 동일하게) |
| `sources` | ✓ | list | 출처 목록. `file`(원본 파일명), `range`(섹션/범위, 선택) |

**문서↔그래프 연결은 frontmatter로 하지 않는다.** 문서와 그래프의 관계는 N:M이며,
`graphs.json` 노드/엣지의 `pagePath`(`properties.page_path`)에서 파생된다 — 한 문서에서
추출된 사실(triple)들이 서로 다른 여러 그래프의 노드가 될 수 있다. 앱은 프로젝트 열기 시
이 정보로 `page_path → graph[]` 인덱스를 자동 재구성한다.

---

## 3. 그래프 스냅샷 — `graphs.json`

zip **루트**에 둔다. import가 이 파일을 읽어 그래프 DB에 복원한 뒤 파일은 남겨둔다(무해).

```json
{
  "graphs": {
    "enemy_graph": {
      "nodes": [
        { "id": "n1", "labels": ["Page"], "name": "고블린 전사",
          "pagePath": "db/enemies/goblin-warrior.md", "properties": {} },
        { "id": "n2", "labels": ["Page"], "name": "곤봉", "properties": {} }
      ],
      "edges": [
        { "id": "e1", "sourceId": "n1", "targetId": "n2", "relationType": "USES",
          "properties": { "page_path": "db/enemies/goblin-warrior.md" } }
      ]
    }
  }
}
```

### 3-1. 그래프 이름 (관례)

```
<domain>_graph
```

- 소문자 + 언더스코어 + `_graph` 접미사
- 문자, 숫자, `_`, `-` 권장
- 예: `ui_graph`, `skill_graph`, `enemy_graph`, `quest_graph`

코드가 문자셋·길이를 강제하지는 않는다. 일관성을 위한 관례로 따른다.

### 3-2. 노드

| 필드 | 필수 | 설명 |
|---|---|---|
| `id` | ✓ | **스냅샷 안에서만 유효한 임의 문자열.** import 시 새 ID로 재발급되며, edge의 `sourceId`/`targetId` 연결에만 쓰인다 |
| `labels` | ✓ | `["Page"]` 고정. import 시 어차피 `["Page"]`로 대체되므로 다른 값을 넣어도 무시된다 |
| `name` | ✓ | 노드 이름 = 엔티티 이름. 엔티티 사전의 `canonicalName`과 일치시킬 것 (5장) |
| `pagePath` | 선택 | 이 노드가 추출된 문서. `db/` 문서 경로와 정확히 일치해야 함 |
| `properties` | ✓ | 추가 속성 객체. 없으면 `{}` |

**중복 판정 (stable key)**: import는 같은 그래프 안에서 다음 키가 같은 노드를 하나로 합친다.

```
pagePath 있음 → "page:{pagePath}"
pagePath 없음 → "name:{name을 trim + 소문자화}"
```

즉, `pagePath` 없는 노드는 **이름의 대소문자만 다른 경우 병합**된다. 같은 개념은 같은
표기로 통일해서 내보낼 것.

### 3-3. 엣지 (관계)

| 필드 | 필수 | 설명 |
|---|---|---|
| `id` | ✓ | 임의 문자열 (재발급됨) |
| `sourceId` / `targetId` | ✓ | 같은 스냅샷 `nodes`의 `id` 참조. 목록에 없는 id를 참조하는 edge는 조용히 버려진다 |
| `relationType` | ✓ | 관계 타입. `UPPER_SNAKE_CASE` (예: `REQUIRES`, `UPGRADES_TO`). 영숫자 외 문자는 `_`로 치환·대문자화되며, 빈 값은 `RELATED`가 된다 |
| `properties` | ✓ | 추가 속성. **출처 문서가 있으면 `page_path` 키에 담는 것이 관례** — 문서 삭제 시 연관 edge 정리 등에 쓰인다 |

같은 그래프에서 `(source, target, relationType)`이 동일한 edge는 하나만 저장된다 (중복은 무시).

relation type 명명은 `VERB_NOUN` 패턴을 권장한다 (예: `REQUIRES`, `UPGRADES_TO`,
`NAVIGATES_TO`, `WEAK_AGAINST`). 도메인별 추천 목록은 부록 A 참고.

---

## 4. 그래프 정책 — `.llm-wiki/graph-policy.json`

```json
{
  "managedGraphs": ["enemy_graph", "skill_graph"],
  "graphRelationTypes": {
    "enemy_graph": ["USES", "WEAK_AGAINST"],
    "skill_graph": ["REQUIRES", "UPGRADES_TO"]
  }
}
```

**relation type은 그래프에 속한 개념이다.** 4개 제한은 그래프별 제한이며, 서로 다른
그래프가 같은 타입 이름(예: 둘 다 `REQUIRES`)을 각자 쓰는 것은 전혀 문제없다.
프로젝트 전역의 relation type 어휘라는 개념은 없다.

| 필드 | 타입 | 제약 | 설명 |
|---|---|---|---|
| `managedGraphs` | `string[]` | 최대 200개, 중복 불가 | 그래프 목록. `graphs.json`의 `graphs` 키 목록과 **반드시 일치**시킨다. 앱의 그래프 목록 UI와 export가 이 목록 기준으로 동작한다 |
| `graphRelationTypes` | `Record<string, string[]>` | 그래프별 최대 4개 | **그래프별 허용 relation type. `managedGraphs`의 모든 그래프에 대해 채운다.** 각 그래프의 스냅샷에서 실제 사용한 타입을 등록한다 |

중복 판정은 대소문자 무시, 값은 trim 후 저장되며, 초과분은 로드 시 잘린다.

### 4-1. import 이후 이 정책이 하는 일 (참고)

이후 사용자가 이 프로젝트에서 새 자료를 ingest하면, 앱이 정책을 LLM 프롬프트에 주입한다:

- `managedGraphs`가 1개 이상이면: "각 사실(triple)을 이 그래프 목록 중 도메인이 맞는 곳에
  배정하라"는 지시와 그래프별 relation type 목록이 주입된다. 맞는 그래프가 없으면 LLM이
  새 그래프를 제안할 수 있고(`new_graph: true`), relation type이 4개 미만인 그래프는
  타입 확장을 제안할 수 있다. 확장/신규 그래프는 review 단계에서 사용자 승인을 거친다.
- `managedGraphs`가 비어 있으면(그래프가 아직 없는 새 프로젝트): 정책 블록 없이 Stage 2
  기본 지시만으로 동작하고, 모든 triple이 새 그래프 제안이 된다. 이 패키지 양식대로면
  `managedGraphs`가 항상 채워지므로 해당 없는 경로다.

즉 relation type 목록은 고정 화이트리스트가 아니라 **LLM이 확장을 제안할 수 있는 시드**다.
외부 데이터를 정확히 등록해 두면, 이후 ingest가 같은 그래프·같은 어휘를 재사용하는
방향으로 유도된다.

---

## 5. 엔티티 사전 — `.llm-wiki/entity-dict.json` (선택, 권장)

엔티티(노드 이름)의 정식 명칭·별칭 사전. 제공하면 import 직후부터 ingest 시
LLM이 기존 이름을 재사용하도록 유도되고, 유사 이름 충돌 감지가 동작한다.

최상위는 `id → entry` 객체다:

```json
{
  "3f2b6c1e-....": {
    "id": "3f2b6c1e-....",
    "canonicalName": "고블린 전사",
    "aliases": ["Goblin Warrior", "고블린전사"],
    "primaryPagePath": "db/enemies/goblin-warrior.md",
    "pagePaths": ["db/enemies/goblin-warrior.md", "db/quests/goblin-camp.md"],
    "graphNodes": []
  }
}
```

| 필드 | 필수 | 설명 |
|---|---|---|
| `id` | ✓ | UUID v4. 키와 동일한 값 |
| `canonicalName` | ✓ | 정식 이름. `graphs.json` 노드의 `name`과 일치시킬 것 |
| `aliases` | ✓ | 별칭 배열. 없으면 `[]` |
| `primaryPagePath` | 선택 | 대표 문서 |
| `pagePaths` | ✓ | 이 엔티티가 등장/추출된 문서 목록. 없으면 `[]` |
| `graphNodes` | ✓ | **외부 생성 시 반드시 `[]`** — 아래 참고 |

**`graphNodes`를 채울 수 없는 이유**: 이 필드는 그래프 DB의 노드 row ID를 참조하는데,
import 시 모든 노드 ID가 재발급되므로 외부에서 미리 알 수 없다. 빈 배열로 두면
이후 ingest·수동 편집 시점에 앱이 링크를 채워 나간다. 사전의 핵심 기능
(ingest 이름 힌트, 충돌 감지, 엔티티 화면)은 `canonicalName`/`aliases`/`pagePaths`만으로 즉시 동작한다.

---

## 6. Import 절차와 동작

1. 앱에서 **프로젝트 가져오기**로 `.llmwiki` 파일과 대상 폴더, 새 프로젝트 이름을 선택
2. zip이 그대로 풀리고, `graphs.json`의 각 그래프가 DB로 복원됨 (이미 존재하는 그래프 이름은 skip)
3. 프로젝트 열기 시: `data_types/` 기본값 보강, `page-graph-index.json` 자동 재빌드

주의사항:

- `graphs.json` 파싱에 실패하면 그래프 복원이 **조용히 건너뛰어진다** — 배포 전 JSON 유효성 검증 필수
- import 후 `graphs.json`이 프로젝트 루트에 남지만 동작에는 영향 없음

---

## 7. 제작 측 검증 체크리스트

- [ ] zip 루트에 `db/`, `graphs.json`, `.llm-wiki/graph-policy.json`이 있다
- [ ] `.llm-wiki/graph.sqlite`, `.llm-wiki/page-graph-index.json`이 없다
- [ ] 모든 `pagePath`/`pagePaths` 값이 실제 존재하는 `db/` 파일 경로와 문자열까지 일치한다
- [ ] `graphs.json`의 그래프 이름 == `graph-policy.json`의 `managedGraphs`
- [ ] `managedGraphs`의 모든 그래프에 `graphRelationTypes` 항목이 있다
- [ ] 모든 edge의 `sourceId`/`targetId`가 같은 스냅샷의 노드 `id`에 존재한다
- [ ] `relationType`이 `UPPER_SNAKE_CASE`이고, 각 그래프의 `graphRelationTypes` 목록(그래프당 최대 4개)과 정합적이다
- [ ] `pagePath` 없는 노드 중 이름이 대소문자만 다른 쌍이 없다 (병합됨)
- [ ] `entity-dict.json`의 `graphNodes`가 전부 `[]`이고, `canonicalName`이 노드 `name`과 일치한다
- [ ] 같은 개념이 문서/그래프/사전에서 **하나의 표기**로 통일되어 있다

---

## 부록 A. 도메인별 추천 Edge Types

그래프를 새로 설계할 때 참고용 (게임 개발 도메인 예시).

| Graph | 추천 Edge Types |
|---|---|
| `ui_graph` | `NAVIGATES_TO`, `CONTAINS`, `TRIGGERS` |
| `skill_upgrade_graph` | `UPGRADES_TO`, `BRANCHES_INTO`, `UNLOCKS`, `PROMOTES_TO` |
| `skill_synergy_graph` | `SYNERGIZES_WITH`, `COMBOS_WITH`, `REDUCES_CD`, `BOOSTS` |
| `skill_scaling_graph` | `SCALES_WITH`, `REQUIRES_STAT`, `CONVERTS_TO`, `CAPPED_BY` |
| `skill_tag_graph` | `HAS_TAG`, `ELEMENT_OF`, `WEAPON_TYPE`, `CATEGORY_OF` |
| `enemy_tactic_graph` | `USES_SKILL`, `TARGETS`, `FLEES_AT`, `PHASES_INTO` |
| `item_set_graph` | `PART_OF_SET`, `SYNERGIZES_WITH`, `REQUIRED_FOR`, `EQUIPPED_BY` |
| `stat_relation_graph` | `INFLUENCES`, `DERIVED_FROM`, `CAPS`, `AUGMENTS` |
| `system_loop_graph` | `FEEDS_INTO`, `PROVIDES_RESOURCE_FOR`, `GATED_BY`, `CONSUMES` |
| `system_logic_graph` | `OVERRIDES`, `TRIGGERS`, `BLOCKS`, `REQUIRES` |
| `quest_graph` | `NEXT`, `REQUIRES`, `UNLOCKS` |
| `economy_graph` | `GENERATES`, `CONSUMES`, `EXCHANGES` |
| `faction_graph` | `ALLY`, `ENEMY`, `NEUTRAL` |
| `event_graph` | `TRIGGERS`, `CONDITIONAL`, `CHAINED_TO` |
| `progression_graph` | `LEVELS_TO`, `UNLOCKS`, `REQUIRES_XP` |
