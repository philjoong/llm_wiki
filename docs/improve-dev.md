# 문서·엔티티·그래프 연결 개선 설계

상태: 구현 완료 (2026-07-12)

구현 검증:

- `knowledge.sqlite`가 page/section/entity/graph/assertion/evidence의 authoritative 저장소다.
- Markdown v2와 stable ID 기반 ingest/review/citation 경로를 사용한다.
- production의 legacy graph backend, graph policy, page graph index, entity JSON dictionary 및 `graph_sqlite` command를 제거했다.
- `npm run typecheck`, `npm run test:mocks`, `cargo test --manifest-path src-tauri/Cargo.toml`, `npm run build`가 통과한다.
- real LLM 품질·성능 측정은 API 환경에서 수행하는 별도 운영 검증으로 남긴다.

## 구현 이행 현황

이 문서는 v2 전환의 authoritative 설계와 이행 현황을 함께 관리한다. 이전의 Step 9~11
계획은 아래 결과로 통합했으며 별도 계획 문서는 제거했다.

- graph/entity/review/ingest의 production 경로를 knowledge DB와 stable ID command로
  전환하고, legacy graph backend·policy·page graph index·entity dictionary를 제거했다.
- Markdown v2의 page/section stable ID parser·validator와, Markdown write·assertion·evidence를
  한 operation으로 처리하는 recovery 가능한 atomic ingest 경로를 도입했다.
- multi-graph traversal과 section candidate 검색을 Graph/Chat의 공용 기반으로 전환하고,
  structured citation은 `pageId`/`sectionId`와 assertion/evidence provenance를 보존한다.
- source/reference를 구조화된 `SourceRef`로 전환하고, graph prefix는 단일
  `allowedGraphIds` allowlist로 해석하도록 정리했다.
- entity merge/split의 stable ID projection과 entity delete impact revision 재검증을
  transaction test로 고정했다.
- lifecycle에서 project open은 recovery, seed, cleanup, legacy migration을 실행하지
  않는다. 새 project만 초기 schema와 identity를 생성한다.
- export/import는 SQLite snapshot lock, SHA-256 manifest, schema version/checksum,
  zip path traversal·symlink 검증 및 staging directory atomic rename을 사용하며,
  Rust roundtrip test로 page/section stable ID 보존을 검증한다.

Step 12의 review assertion, RAG-off scope 통합, integrity 확장 및 최종 통합 검증까지
완료했다.

이 문서는 현재 데이터 형식과의 호환성을 전제로 하지 않는 차세대 설계안이다. 목표는 다음과 같다.

- 문서에서 관련 triple과 이웃 triple을 찾고, 그 결과에서 근거 문서로 되돌아갈 수 있어야 한다.
- 동일 엔티티를 매개로 여러 graph를 오가며 탐색할 수 있어야 한다.
- 수동으로 만든 node/edge에 `page_path`가 없어도 탐색이 끊기지 않아야 한다.
- 문서를 열기 전에 문서와 섹션의 종류, UI 범위, 관련 개념을 판단할 수 있어야 한다.
- 제목이나 파일 경로 같은 표시 문자열의 변경이 관계를 끊지 않아야 한다.

---

## 1. 설계 원칙

### 1.1 경로, 개념, 사실, 근거를 분리한다

현재의 `page_path`는 파일 위치이면서 문서 식별자, triple 출처, graph 연결 단서 역할까지 맡는다. 새 모델에서는 역할을 분리한다.

| 개념 | 안정 식별자 | 역할 |
|---|---|---|
| 문서 | `page_id` | 문서의 논리적 ID. 파일을 이동해도 유지 |
| 파일 위치 | `page_path` | 현재 Markdown 파일 위치. 변경 가능 |
| 섹션 | `section_id` | 문서 내부의 근거·검색 단위 |
| 엔티티 | `entity_id` | 여러 graph의 동일 개념을 묶는 전역 ID |
| graph node | `node_id` | 특정 graph 안에서 엔티티를 표현하는 projection |
| 사실 | `assertion_id` | `subject → predicate → object` 주장 |
| 근거 연결 | `evidence_id` | assertion과 문서 섹션의 관계 |

`page_path`는 외래 키로 사용하지 않는다. 모든 영속 관계는 안정 ID를 참조하고, 경로는 `pages` 테이블에서 찾는다.

### 1.2 저장 방향과 조회 방향을 구분하지 않는다

관계를 JSON 두 벌로 중복 저장하지 않는다. SQLite의 정규화된 관계 테이블을 진실 원천으로 두고 양방향 인덱스를 만든다.

```text
page ↔ section ↔ evidence ↔ assertion ↔ graph
                         ↘ entity ↔ graph_node ↔ graph
```

`page → graph[]`와 `graph → page[]`는 별도 파일이 아니라 동일 관계를 반대 방향으로 조회한 결과다.

### 1.3 graph 간 연결은 이름이 아니라 `entity_id`로 한다

예를 들어 엔티티 B가 graph A, M, F, G에 각각 node로 존재하면 네 node는 모두 같은 `entity_id`를 참조한다.

```text
entity B
├─ graph A / node 17
├─ graph M / node 42
├─ graph F / node 8
└─ graph G / node 31
```

graph A에서 B에 도달하면 entity 사전을 통해 M, F, G의 B projection으로 전환할 수 있다. 이름 비교나 fuzzy match는 새 엔티티를 등록할 때만 사용하고, 확정된 traversal에는 사용하지 않는다.

---

## 2. 권장 데이터 모델

### 2.1 핵심 테이블

```sql
CREATE TABLE pages (
  page_id       TEXT PRIMARY KEY,
  page_path     TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  page_type     TEXT NOT NULL,
  summary       TEXT,
  primary_entity_id TEXT REFERENCES entities(entity_id),
  updated_at    TEXT NOT NULL
);

CREATE TABLE sections (
  section_id    TEXT PRIMARY KEY,
  page_id       TEXT NOT NULL REFERENCES pages(page_id) ON DELETE CASCADE,
  parent_id     TEXT REFERENCES sections(section_id) ON DELETE CASCADE,
  heading_level INTEGER NOT NULL,
  heading_text  TEXT NOT NULL,
  section_type  TEXT NOT NULL,
  ui_scope      TEXT,
  ui_anchor     TEXT,
  ui_layer      TEXT,
  ui_aspect     TEXT,
  content_entity_id TEXT REFERENCES entities(entity_id),
  host_entity_id TEXT REFERENCES entities(entity_id),
  ordinal       INTEGER NOT NULL,
  summary       TEXT,
  UNIQUE(page_id, section_id)
);

CREATE TABLE entities (
  entity_id      TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  entity_type    TEXT NOT NULL,
  description    TEXT
);

CREATE TABLE entity_aliases (
  entity_id TEXT NOT NULL REFERENCES entities(entity_id) ON DELETE CASCADE,
  alias     TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  PRIMARY KEY(entity_id, normalized_alias)
);

CREATE TABLE graphs (
  graph_id   TEXT PRIMARY KEY,
  graph_name TEXT NOT NULL UNIQUE,
  purpose    TEXT NOT NULL
);

CREATE TABLE relation_types (
  graph_id          TEXT NOT NULL REFERENCES graphs(graph_id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  description       TEXT NOT NULL,
  subject_types     TEXT NOT NULL, -- JSON array; application validator also checks it
  object_types      TEXT NOT NULL, -- JSON array
  inverse_name      TEXT,
  symmetric         INTEGER NOT NULL DEFAULT 0 CHECK(symmetric IN (0, 1)),
  object_cardinality TEXT NOT NULL CHECK(object_cardinality IN ('one', 'many')),
  PRIMARY KEY(graph_id, name)
);

CREATE TABLE graph_nodes (
  node_id   TEXT PRIMARY KEY,
  graph_id  TEXT NOT NULL REFERENCES graphs(graph_id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL REFERENCES entities(entity_id),
  role      TEXT,
  UNIQUE(graph_id, entity_id, role)
);

CREATE TABLE assertions (
  assertion_id     TEXT PRIMARY KEY,
  graph_id         TEXT NOT NULL REFERENCES graphs(graph_id) ON DELETE CASCADE,
  subject_entity_id TEXT NOT NULL REFERENCES entities(entity_id),
  predicate        TEXT NOT NULL,
  object_entity_id TEXT NOT NULL REFERENCES entities(entity_id),
  origin           TEXT NOT NULL CHECK(origin IN ('ingest', 'manual')),
  status           TEXT NOT NULL CHECK(status IN ('active', 'review', 'superseded')),
  created_at       TEXT NOT NULL,
  FOREIGN KEY(graph_id, predicate) REFERENCES relation_types(graph_id, name)
);

CREATE TABLE assertion_evidence (
  evidence_id  TEXT PRIMARY KEY,
  assertion_id TEXT NOT NULL REFERENCES assertions(assertion_id) ON DELETE CASCADE,
  page_id      TEXT REFERENCES pages(page_id) ON DELETE SET NULL,
  section_id   TEXT REFERENCES sections(section_id) ON DELETE SET NULL,
  evidence_type TEXT NOT NULL CHECK(evidence_type IN
    ('supports', 'contradicts', 'mentions')),
  quote        TEXT,
  confidence   REAL,
  UNIQUE(assertion_id, section_id, evidence_type)
);

CREATE TABLE page_entities (
  page_id    TEXT NOT NULL REFERENCES pages(page_id) ON DELETE CASCADE,
  section_id TEXT REFERENCES sections(section_id) ON DELETE CASCADE,
  entity_id  TEXT NOT NULL REFERENCES entities(entity_id),
  role       TEXT NOT NULL CHECK(role IN ('subject', 'mentions', 'ui_target', 'content_target')),
  PRIMARY KEY(page_id, section_id, entity_id, role)
);

CREATE TABLE tags (
  tag_id     TEXT PRIMARY KEY,
  namespace  TEXT NOT NULL,
  value      TEXT NOT NULL,
  UNIQUE(namespace, value)
);

CREATE TABLE page_tags (
  page_id TEXT NOT NULL REFERENCES pages(page_id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(tag_id),
  PRIMARY KEY(page_id, tag_id)
);
```

`graph_nodes`는 graph 화면과 graph별 속성을 위한 projection이다. 실제 assertion은 `entity_id`를 참조하므로 node row가 다시 생성되어도 사실 관계가 끊기지 않는다.

### 2.2 필수 인덱스

```sql
CREATE INDEX idx_sections_page ON sections(page_id, ordinal);
CREATE INDEX idx_nodes_entity ON graph_nodes(entity_id, graph_id);
CREATE INDEX idx_assertions_graph ON assertions(graph_id);
CREATE INDEX idx_assertions_subject ON assertions(subject_entity_id);
CREATE INDEX idx_assertions_object ON assertions(object_entity_id);
CREATE INDEX idx_evidence_page ON assertion_evidence(page_id);
CREATE INDEX idx_evidence_section ON assertion_evidence(section_id);
CREATE INDEX idx_evidence_assertion ON assertion_evidence(assertion_id);
CREATE INDEX idx_page_entities_entity ON page_entities(entity_id, page_id);
CREATE INDEX idx_pages_type ON pages(page_type);
CREATE INDEX idx_sections_type ON sections(section_type);
CREATE INDEX idx_relation_types_graph ON relation_types(graph_id, name);
CREATE INDEX idx_page_tags_tag ON page_tags(tag_id, page_id);
```

이 구조에서는 `page-graph-index.json`이 필요 없다. 캐시가 필요하면 materialized view나 재생성 가능한 검색 인덱스로만 둔다.

---

## 3. 수동 graph 수정 규칙

수동 수정은 “출처가 없는 불완전한 triple”이 아니라 “사용자가 탐색 구조를 보강한 assertion”으로 취급한다.

### 3.1 수동 node 생성

수동 node를 만들 때는 다음 중 하나를 반드시 선택한다.

1. 기존 entity에 연결한다.
2. 새 entity를 만들고 canonical name과 `entity_type`을 지정한다.

graph에만 존재하고 entity 사전에 없는 node는 허용하지 않는다. 이 규칙 덕분에 `page_path`가 없어도 다른 graph의 동일 엔티티로 이동할 수 있다.

### 3.2 수동 edge 생성

수동 edge는 별도의 이유나 설명을 입력받지 않는다. edge 자체가 다음의 완결된 명제를 표현해야 한다.

```text
subject entity → 명확한 predicate → object entity

BattleResultFlow → SHOWS → ResultModal
ResultModal → CONTAINS → RewardList
ConfirmButton → NAVIGATES_TO → LobbyScreen
```

- `RELATED`, `LINKED`, `ASSOCIATED`처럼 방향과 의미를 알 수 없는 predicate는 허용하지 않는다.
- “떨어진 노드를 잇기 위해서”라는 목적은 별도 데이터가 아니다. 두 노드가 실제로 어떤 관계인지 predicate로 표현한다.
- 적합한 predicate가 없으면 기존 relation type 중 비슷한 것을 억지로 사용하지 않고, 의미와 방향을 정의한 새 relation type을 먼저 등록한다.
- 수동 생성 여부인 `origin=manual`은 시스템이 자동 기록하며 사용자에게 추가 입력을 요구하지 않는다.
- 관련 문서가 있으면 선택적으로 evidence를 연결한다.
- 문서가 없어도 subject/object의 `entity_id`를 통해 다른 graph와 관련 문서를 찾을 수 있다.
- 이후 실제 문서 근거가 발견되면 같은 assertion에 `supports` evidence를 추가한다. 수동 assertion을 삭제하고 새 edge를 만들 필요는 없다.

relation type 정의에는 적어도 다음 정보가 있어야 한다.

| 필드 | 예 | 역할 |
|---|---|---|
| `name` | `NAVIGATES_TO` | edge에 저장되는 고유 predicate |
| `description` | 사용자 동작 후 대상 화면으로 전환된다 | 관계의 정확한 의미 |
| `subject_types` | `ui.action`, `ui.screen` | 허용되는 시작 entity type |
| `object_types` | `ui.screen`, `ui.modal` | 허용되는 도착 entity type |
| `inverse` | `NAVIGATED_FROM` | 역방향 표현이 필요할 때의 predicate |
| `symmetric` | `false` | 방향을 뒤집어도 같은 관계인지 여부 |
| `object_cardinality` | `one` 또는 `many` | 같은 subject가 이 predicate로 가질 수 있는 object 수 |

이 정의는 relation type을 등록할 때 한 번 정하고, edge를 만들 때마다 입력하지 않는다. 수동 edge UI는 허용되는 entity type을 기준으로 predicate 후보를 좁혀 보여준다.

### 3.3 assertion 충돌

`A P B`와 `A P C`가 충돌하는지는 relation type의 `object_cardinality`로 판정한다.

- `many`: 두 assertion을 정상적인 병렬 관계로 저장한다. 예: `Character USES Sword`, `Character USES Shield`.
- `one`: 기존과 다른 object가 들어오면 새 assertion을 `review` 상태로 저장하고 기존 `active` assertion은 유지한다.
- 사용자가 새 값을 승인하면 새 assertion을 `active`, 기존 assertion을 `superseded`로 변경한다.
- 근거 없이 기존 assertion을 자동 덮어쓰지 않는다.
- 시간에 따라 값이 바뀌는 관계는 첫 버전에서 별도 시제 모델을 만들지 않고 evidence에 시점 정보를 남긴다.

### 3.4 provenance 상태

UI에는 assertion의 상태를 구분해 표시한다.

| 상태 | 조건 | 의미 |
|---|---|---|
| Documented | `supports` evidence가 1개 이상 | 문서 근거가 있음 |
| Manual | `origin=manual`, evidence 없음 | 사용자가 탐색 목적으로 추가 |
| Contradicted | `contradicts` evidence 존재 | 반대 근거가 있어 검토 필요 |
| Orphaned | subject/object entity가 유효하지 않음 | 저장을 거부하거나 복구 필요 |

“문서가 없는 node는 traversal을 중단한다”는 규칙은 제거한다. 대신 조회 결과의 신뢰도와 출처 상태를 표시한다.

### 3.5 derived 관계

첫 버전에서는 derived assertion을 DB에 저장하지 않는다. 결정론적으로 추론할 수 있는 관계는 검색 시점에만 계산하고 결과의 설명 경로로 반환한다.

```text
A PART_OF B
B PART_OF C
→ 검색 결과에서 A PART_OF C 경로를 계산
```

LLM은 derived assertion을 생성하거나 확정하지 않는다. 향후 반복 계산 비용이 문제가 되면 원본 assertion ID 목록으로 재생성할 수 있는 materialized cache를 별도 도입한다.

---

## 4. 여러 graph를 넘나드는 탐색

### 4.1 기본 traversal

문서 P에서 시작하는 기본 흐름은 다음과 같다.

1. `page_entities`와 `assertion_evidence`로 P의 seed entity/assertion을 구한다.
2. assertion을 따라 같은 graph의 이웃 entity로 이동한다.
3. 각 entity에 대해 `graph_nodes(entity_id)`를 조회한다.
4. 사용자가 허용한 graph 또는 목적에 맞는 graph로 전환한다.
5. 도달한 assertion의 evidence를 통해 관련 page/section을 수집한다.
6. page/section 메타데이터로 실제 문서를 열지 결정한다.

### 4.2 graph 전환 비용

무제한 graph hopping은 관련 없는 결과를 폭증시킬 수 있으므로 비용을 둔다.

| 이동 | 기본 비용 |
|---|---:|
| 같은 graph의 assertion 1개 이동 | 1 |
| 같은 entity의 다른 graph projection으로 전환 | 1 |

기본 검색은 총 비용 3 이하, graph 전환 최대 2회로 제한한다. manual/documented 여부는 이동 비용을 바꾸지 않는다. 사용자가 “전체 연결 보기”를 선택할 때만 제한을 확장한다.

### 4.3 결과에 포함할 설명 경로

검색 결과는 page 목록만 반환하지 말고 왜 연결됐는지 경로를 함께 반환한다.

```json
{
  "pageId": "page-results-modal",
  "sectionId": "sec-01JZ0000000000000000000002",
  "score": 0.86,
  "path": [
    { "graph": "ui_navigation", "assertion": "Lobby NAVIGATES_TO Battle" },
    { "entity": "Battle", "switchToGraph": "ui_result_flow" },
    { "graph": "ui_result_flow", "assertion": "Battle SHOWS ResultModal" }
  ],
  "evidenceState": "documented"
}
```

이 설명이 있어야 사용자가 수동 edge가 결과에 어떤 영향을 주었는지 검증할 수 있다.

---

## 5. Markdown 문서 규칙

제목 문자열만 보고 의미를 추측하지 않는다. `Screen`이라는 단어가 UI 전체 화면인지 콘텐츠 이름인지 모호하기 때문이다. 표시용 제목과 기계 판독용 의미를 분리한다.

### 5.1 문서 frontmatter

```yaml
---
schema: llm-wiki/page/v2
page_id: page-battle-result
title: 전투 결과
page_type: ui_spec
summary: 전투 종료 후 표시되는 결과 UI의 구조와 동작
primary_entity: ent-battle-result
tags:
  - domain:ui
  - lifecycle:post-battle
sections:
  sec-01JZ0000000000000000000001:
    type: overview
    summary: 결과 UI의 목적과 진입 조건
  sec-01JZ0000000000000000000002:
    type: ui
    ui_scope: modal
    ui_anchor: viewport-center
    ui_aspect: layout
    content_entity: ent-battle-result
    summary: 중앙 모달의 영역과 표시 요소
  sec-01JZ0000000000000000000003:
    type: behavior
    summary: 버튼과 닫기 동작
---
```

### 5.2 heading 형식

H1은 문서 제목으로 한 번만 사용한다. H2는 독립적으로 검색·근거 연결할 수 있는 의미 섹션 경계다.

```md
# 전투 결과

## 개요 {#sec-01JZ0000000000000000000001}

...

## 레이아웃 {#sec-01JZ0000000000000000000002}

...

## 동작 {#sec-01JZ0000000000000000000003}

...
```

- `{#section_id}`는 필수이며 한 프로젝트 안에서 유일하다.
- `section_id`는 `sec-` 접두사를 붙인 ULID를 사용한다. heading 의미를 ID에 넣지 않는다.
- 화면에 보이는 heading text는 자유롭게 바꿀 수 있다.
- 병합, evidence, embedding chunk는 heading text가 아니라 `section_id`를 참조한다.
- H3 이하는 섹션 내부 표현 구조이며 독립 ID가 필요 없다. 별도 근거 단위가 필요하면 H2로 승격한다.
- frontmatter의 `sections`에 없는 H2 또는 본문에 없는 section metadata는 validation error다.

표기법은 Markdown heading attribute인 `## 제목 {#sec-ULID}`로 고정한다. 전용 parser와 validator가 이 속성을 처리하며 HTML comment 방식은 지원하지 않는다.

### 5.3 `section_type` 통제 어휘

초기 어휘는 작게 유지하고 필요할 때 스키마 버전으로 확장한다.

| type | 의미 | 문서를 열 판단에 주는 정보 |
|---|---|---|
| `overview` | 대상의 요약·범위 | 빠른 개요가 필요할 때 |
| `ui` | UI 구조·콘텐츠·상호작용·상태 | UI 관련 질문일 때. 세부 성격은 `ui_aspect` 사용 |
| `behavior` | 입력에 대한 동작 | 클릭·전환·상태 변화 질문일 때 |
| `flow` | 단계 또는 화면 이동 | 진입·이탈·순서 질문일 때 |
| `rule` | 제품/게임 규칙 | 조건과 판정 질문일 때 |
| `data` | 수치·필드·스키마 | 값이나 구조 질문일 때 |
| `exception` | 예외와 오류 처리 | 실패·경계 조건 질문일 때 |
| `example` | 비규범 예시 | 이해 보조가 필요할 때 |
| `history` | 변경 기록 | 현재 동작 검색에서는 기본 제외 |

`Screen`, `UI`, `Modal` 같은 단어는 section type이 아니다. UI의 의미는 별도 필드로 표현한다.

### 5.4 UI 의미 필드

`section_type`이 `ui`이면 다음 필드를 사용할 수 있다.

| 필드 | 허용 예 | 설명 |
|---|---|---|
| `ui_scope` | `full-screen`, `modal`, `panel`, `overlay`, `toast`, `widget`, `embedded` | 차지하는 UI 범위 |
| `ui_anchor` | `viewport-center`, `top`, `bottom`, `left`, `right`, `world-space`, `parent-relative` | 어디에 표시되는지 |
| `ui_layer` | `base`, `overlay`, `system` | 다른 화면과의 적층 관계 |
| `ui_aspect` | `layout`, `content`, `interaction`, `state` | 이 섹션이 설명하는 UI의 측면 |
| `content_entity` | `entity_id` | UI가 표현하는 콘텐츠/기능 |
| `host_entity` | `entity_id` | UI를 포함하거나 띄우는 화면/기능 |

예를 들어 `Screen`이 콘텐츠 고유명이라면 `content_entity`로 기록하고, 전체 화면이라는 의미라면 `ui_scope: full-screen`으로 기록한다. 문자열 하나에 두 의미를 겹쳐 담지 않는다.

---

## 6. 태그 규칙

태그는 자유 키워드 모음이 아니라 `namespace:value` 형식의 통제 어휘다. 태그는 후보 문서를 빠르게 거르는 faceting 용도이며, entity나 assertion을 대신하지 않는다.

### 6.1 권장 namespace

| namespace | 예 | 용도 |
|---|---|---|
| `domain` | `domain:ui`, `domain:combat` | 큰 업무/콘텐츠 영역 |
| `platform` | `platform:mobile`, `platform:pc` | 적용 플랫폼 |
| `lifecycle` | `lifecycle:post-battle` | 발생 시점 |
| `audience` | `audience:player`, `audience:operator` | 대상 사용자 |

UI 범위·위치·상태는 tag로 중복 저장하지 않고 `ui_scope`, `ui_anchor`, `ui_aspect` 같은 구조화된 section 속성으로 관리한다. 콘텐츠 개념은 tag 대신 `entity_id`로 연결한다.

### 6.2 금지 규칙

- `UI`, `ui`, `UserInterface`처럼 같은 뜻의 자유 변형을 허용하지 않는다.
- entity 이름을 태그로 복제하지 않는다. `entity_id` 관계를 사용한다.
- 문장형 태그를 만들지 않는다.
- `related`, `misc`, `etc`처럼 검색 판단에 도움이 되지 않는 값을 금지한다.
- 계층을 파일 경로나 슬래시 문자열로 표현하지 않는다. 필요하면 tag vocabulary에 `parent` 관계를 둔다.

tag vocabulary는 `.llm-wiki/tag-schema.yaml`에서 관리한다.

```yaml
schema: llm-wiki/tags/v1
namespaces:
  domain:
    values: [ui, combat]
  platform:
    values: [mobile, pc, console]
  lifecycle:
    values: [pre-battle, in-battle, post-battle]
  audience:
    values: [player, operator, developer]
```

---

## 7. 문서를 열지 결정하는 검색 절차

문서 원문을 읽기 전에 `pages`, `sections`, tags, entity 연결만으로 후보를 평가한다.

1. 질문에서 entity, 예상 section type, tag facet을 추출한다.
2. entity 사전에서 canonical entity를 확정한다.
3. `page_entities`와 graph traversal로 후보 page/section을 수집한다.
4. `page_type`, `section_type`, UI 의미 필드, tags로 필터링한다.
5. `summary`와 assertion 경로를 이용해 점수를 계산한다.
6. 상위 section만 Markdown에서 읽는다. 파일 전체를 기본 단위로 열지 않는다.

권장 scoring 예시:

```text
0.35 entity match
+ 0.25 graph path relevance
+ 0.20 section_type match
+ 0.10 tag match
+ 0.10 summary semantic match
```

검색 API는 최소한 다음을 반환한다.

```ts
interface SectionCandidate {
  pageId: string
  pagePath: string
  sectionId: string
  headingText: string
  pageType: string
  sectionType: string
  summary?: string
  tags: string[]
  matchedEntities: string[]
  graphPath: TraversalStep[]
  evidenceState: "documented" | "manual" | "contradicted"
  score: number
}
```

---

## 8. 쓰기·수정 시 정합성 규칙

모든 변경은 한 SQLite transaction에서 다음 관계를 함께 갱신한다.

### 문서 ingest

1. `page_id`와 `section_id` 생성 또는 재사용
2. page/section metadata validation
3. entity mention을 `page_entities`에 연결
4. assertion 생성
5. assertion마다 최소 하나의 `supports` 또는 `mentions` evidence 연결
6. 검색 인덱스 갱신

### 문서 이동

`pages.page_path`만 변경한다. assertion, entity, evidence는 안정 ID를 사용하므로 변경하지 않는다.

### heading 이름 변경

`sections.heading_text`만 변경한다. `section_id`가 같으면 동일 섹션이다.

### 수동 node/edge 수정

- node 추가: entity 선택/생성을 같은 transaction에서 수행
- edge 추가: subject/object type에 허용된 명확한 predicate를 선택하고 `origin=manual`은 시스템이 자동 저장
- edge 삭제: 해당 assertion과 evidence를 transaction으로 삭제
- node 삭제: 다른 graph projection과 assertion 참조를 보여준 뒤 삭제 범위를 선택

### 문서 삭제

- page/section evidence는 `ON DELETE SET NULL`로 근거 부재 상태가 된다.
- assertion 자체는 즉시 삭제하지 않는다.
- evidence가 모두 사라진 ingest assertion은 review 대상으로 표시한다.
- manual assertion은 문서 유무와 무관하게 유지한다.

---

## 9. 검증 규칙

저장 전 다음을 강제한다.

- 모든 graph node는 정확히 하나의 `entity_id`를 가진다.
- 모든 assertion의 subject/object entity가 존재한다.
- ingest assertion은 page/section evidence를 가져야 한다.
- 모든 assertion의 predicate는 등록된 relation type이어야 한다.
- assertion의 subject/object entity type은 relation type의 허용 범위를 만족해야 한다.
- 의미가 불명확한 범용 predicate(`RELATED`, `LINKED`, `ASSOCIATED`)는 등록할 수 없다.
- `page_id`, `section_id`, `entity_id`, `assertion_id`는 표시 문자열에서 재계산하지 않는다.
- 모든 H2에는 유효한 `section_id`가 있고 frontmatter metadata와 1:1 대응한다.
- `section_type`과 tag는 등록된 스키마 값만 허용한다.
- `ui` section은 `ui_scope`를 필수로 가진다.
- `content_entity`, `host_entity`, `primary_entity`는 entity 사전에 존재해야 한다.

정기 integrity check는 dangling reference, evidence 없는 ingest assertion, 사용되지 않는 entity, tag schema 위반을 보고한다. 자동 fuzzy merge는 하지 않는다.

---

## 10. 현재 구현에서의 전환 계획

이 절은 `ingest-current-state.md`, `answer-guide.md`, `import-export-status.md`에 기록된 현재 흐름을 새 모델로 교체할 때의 작업 경계다. 이전 버전에서 보존하거나 변환해야 할 사용자 데이터는 없다고 전제한다. 따라서 기존 저장 형식의 읽기·쓰기·변환·호환 계층은 만들지 않으며, 새 모델 전환과 함께 관련 레거시 코드와 저장 산출물을 남김없이 제거한다. 구·신 저장소를 동시에 운영하거나 레거시 형식으로 폴백하는 기간도 두지 않는다.

### 10.1 저장소와 스키마 기반

1. 빈 프로젝트에서 최신 SQLite schema를 직접 생성하는 bootstrap을 추가한다. 과거 schema를 단계적으로 올리는 migration runner나 legacy schema 감지·변환 분기는 구현하지 않는다.
2. 기존 graph backend의 `graphs/nodes/edges` 저장 모델을 제거하고 `pages/sections/entities/graphs/graph_nodes/relation_types/assertions/assertion_evidence/page_entities/tags/page_tags`만 단일 DB 경계에서 관리한다. 기존 테이블과 새 테이블을 함께 읽거나 쓰는 adapter는 두지 않는다.
3. `graph-policy.json`의 `managedGraphs` 및 그래프별 최대 4개 relation type 정책을 `graphs`와 `relation_types`로 이동한다. 새 모델에서는 임의의 4개 제한을 두지 않으며, subject/object type과 cardinality가 필수다.
4. `page-graph-index.json`은 영속 진실 원천에서 제거한다. Graph 탭과 Chat 모두 DB 관계를 조회하고, 필요하면 재생성 가능한 캐시만 사용한다.
5. SQLite foreign key를 연결마다 활성화한다. DB의 schema version이 현재 버전과 다르면 자동 변환하지 않고 명확한 오류와 함께 열기를 중단한다.

### 10.2 Markdown v2 parser와 파일 쓰기

1. frontmatter, H1 1개, H2 `{#sec-ULID}`, section metadata 1:1 대응을 파싱·검증하는 전용 모듈을 만든다.
2. 현재 `splitIntoSections()`/`reconcileSections()`가 heading text를 키로 비교하는 방식을 `section_id` 기준으로 바꾼다. heading rename은 동일 section 수정이며, 같은 ID의 서로 다른 본문만 충돌이다.
3. `buildFileBlocksFromSections()`가 `page_id`, section ID, page/section type, summary를 생성하도록 decomposition/structured data type 출력 계약을 바꾼다. LLM 출력은 저장 전에 결정론적 validator를 통과해야 한다.
4. 같은 chunk 또는 후속 chunk가 동일 `page_id`를 선택하면 현재처럼 순차 갱신된 DB index를 다음 decomposition prompt에 제공한다. `page_path`는 저장 위치 후보일 뿐 identity 선택에 사용하지 않는다.
5. modification proposal에는 `page_id`와 `section_id`를 저장한다. Approve/Merge 후 현재처럼 최종 파일 전체를 다시 ingest하되, 기존 안정 ID를 재사용하고 승인되지 않은 충돌 section의 assertion/evidence는 갱신하지 않는다.
6. data type ingest의 파일당·타입당 단일 문서 보장은 유지한다. 빈 추출, YAML 누락, 다중 data type task 분리 동작도 유지하되 생성 문서는 v2 validation을 통과해야 한다.

### 10.3 Ingest와 원자적 동기화

현재의 `파일 저장 → syncGraphToBackend()` 두 단계는 파일만 저장되고 graph sync가 실패할 수 있다. 새 흐름은 다음처럼 명시적으로 처리한다.

1. LLM decomposition/graph assignment 결과를 메모리에서 hydrate하고 전부 검증한다.
2. Markdown을 임시 파일에 쓰고 fsync한 뒤, DB transaction에서 page/section/entity/assertion/evidence와 검색 인덱스 작업 목록을 갱신한다.
3. DB commit 후 원자적 rename으로 Markdown을 교체한다. rename 실패 시 보상 transaction 또는 재시도 가능한 recovery journal로 DB를 이전 상태로 되돌린다.
4. 파일 교체 후 embedding 갱신에 실패해도 핵심 데이터는 유지하고 재생성 작업으로 기록한다. ingest cache와 git commit은 파일/DB commit 성공 뒤에만 실행한다.
5. chunk 실패는 현재처럼 해당 chunk review item으로 남기고 다음 chunk를 계속한다. 단, 한 chunk 안의 page/section/assertion/evidence는 전부 성공하거나 전부 실패한다.
6. bare scalar object 금지, 안전하지 않은 경로 거부, unknown relation type 거부를 유지한다. relation type 추가는 설명·허용 entity type·cardinality까지 등록되어야 승인된다.

### 10.4 수동 Graph 편집

1. node 추가 UI에서 기존 entity exact/alias 검색 또는 새 entity 생성을 강제한다.
2. edge UI는 subject/object entity type에 허용된 relation type만 표시하고 범용 predicate를 차단한다.
3. cardinality `one` 충돌은 기존 active 값을 보존한 채 review assertion을 만든다. 승인/거절/supersede가 한 transaction에서 처리되어야 한다.
4. page evidence가 없는 manual assertion도 저장·탐색 가능하며 provenance badge와 설명 경로에 `manual`을 표시한다.
5. node/edge 삭제 UI는 다른 graph projection, assertion, evidence 영향 범위를 먼저 계산한다.

### 10.5 Chat 검색 경로 교체

1. 기존 token/vector 검색과 relevance threshold/RRF는 recall 보조로 유지하되, 파일이 아니라 section 단위 결과로 정규화한다.
2. 현재 `graph-qna.ts`의 LLM graph/relation/entity 선택, entity alias 해석, 2-hop 영향 탐색, 두 entity 사이 path 탐색을 새 traversal API 위로 옮긴다. traversal은 총비용 3, graph 전환 2회 제한과 graph path 설명을 강제한다.
3. `graphPrefixFilter`를 유지해 Casemap/Persona scoped Chat이 허용된 graph 밖으로 전환하지 못하게 한다.
4. `context-budget.ts`의 예산 안에서 상위 section 본문만 읽고, prompt의 Page List와 References에는 `page_id`, `section_id`, 현재 `page_path`를 함께 매핑한다.
5. 관련 section이 없을 때 폴백 문서를 넣지 않는 현재 동작, graph context가 없을 때 섹션을 생략하는 동작, RAG off, question type Answer Format, 출력 언어 reminder 위치를 그대로 보존한다.
6. prompt에 제공하는 각 근거 구간에 구조화된 citation key를 부여하고 모델은 답변에서 그 key만 참조한다. 스트리밍 완료 시 key를 검색 후보의 `page_id`, `section_id`, 실제 근거 구간의 `quoted_text`로 결정론적으로 변환해 메시지에 저장하며, 모델이 임의로 작성한 quote나 path는 신뢰하지 않는다. 필요하면 동일 문구를 구분하기 위한 앞뒤 문맥도 anchor로 함께 저장한다. 화면 표시 시 안정 ID로 현재 path와 section을 해석한 뒤 anchor를 다시 찾으므로 문서 이동이나 heading rename 뒤에도 저장된 대화의 References가 열려야 한다.
7. 사용자가 References 항목을 선택하면 해당 문서의 section을 미리보기로 열고 `quoted_text`와 일치하는 실제 근거 구간을 하이라이트한다. 정확한 anchor를 찾지 못하면 section은 열되 임의의 유사 문장을 하이라이트하지 않고 “근거 구간을 찾을 수 없음” 상태를 표시한다. 여러 근거 구간이 있으면 모두 표시하되 선택한 citation의 구간을 우선 강조한다.
8. 새 메시지는 구조화된 citation만 저장·렌더링한다. 과거 메시지 호환을 위한 HTML 주석, `[N]`, `[[wikilink]]` 순차 파싱 fallback과 구형 reference shape adapter는 제거한다.

### 10.6 Import/Export와 프로젝트 수명주기

1. 전송 포맷에 manifest(`format_version`, `schema_version`, checksum 목록)를 추가하고 새 관계 DB 또는 일관된 DB snapshot을 authoritative payload로 포함한다. `graphs.json`만으로 새 모델을 복원하지 않는다.
2. export는 DB checkpoint/snapshot과 Markdown이 같은 논리 시점을 가리키도록 잠금 또는 snapshot transaction 안에서 만든다. 임시 산출물은 성공·실패 모두 정리한다.
3. import는 zip entry를 canonicalize해 대상 폴더 밖 경로, absolute path, symlink를 거부하고, checksum/schema version 검증이 끝난 뒤 임시 폴더를 최종 위치로 rename한다. 기존 대상 폴더를 조용히 덮어쓰지 않는다.
4. import 후 graph가 이미 있다는 이유로 일부만 건너뛰지 않는다. 프로젝트 snapshot 전체를 복원하거나 충돌로 실패한다. 루트의 임시 `graphs.json`도 남기지 않는다.
5. 프로젝트 내부 `question_types/`, `data_types/`, tag/relation schema가 authoritative source다. question type은 YAML 형식만 허용하고 레거시 Markdown question type parser와 관련 type·fixture를 제거한다. 번들 `schema/...` seed는 새 프로젝트 생성 시에만 실행하고 open/import 시 자동 보강하지 않는다.
6. `.llm-wiki/` 전체를 무조건 내보내지 않고 공유 schema/DB와 local-only queue, chat, review, cache를 분류한다. 포함/제외 목록을 manifest와 테스트 fixture로 고정한다.

### 10.7 운영 도구와 전환 완료

1. integrity check, orphan/evidence review, graph path inspector, embedding/cache rebuild 명령을 제공한다.
2. 개발 fixture도 새 Markdown v2와 새 DB schema로 다시 만든다. 기존 Markdown/graph snapshot을 변환하는 importer, compatibility adapter, legacy fixture는 유지하지 않는다.
3. 새 read/write 경로가 준비되면 ingest, Graph 탭, Chat, import/export를 같은 DB API로 한 번에 전환한다.
4. 전환 커밋에서 `page-graph-index`, 레거시 graph snapshot, 기존 `graphs/nodes/edges` backend와 이에 연결된 read/write command, type, serializer, test helper를 삭제한다. 사용되지 않는 코드로 남겨 두거나 feature flag로 보존하지 않는다.
5. 모든 legacy compatibility adapter와 fallback을 제거한다. 여기에는 레거시 파일 탐색, legacy schema 판별·변환, 구형 import/export 수용, 레거시 Markdown question type parser, 구형 chat reference 변환·파싱, 읽기 실패 시 구형 경로 재시도가 포함된다. 새 형식이 아니면 지원하지 않는 형식으로 실패한다. 관련 문서 없음, LLM selector 오류처럼 현재 형식의 정상적인 실패를 처리하는 제품 동작은 legacy fallback으로 보지 않는다.
6. 저장소 전체 검색과 빌드 산출물 검사를 CI에 추가해 레거시 module import, command 등록, 형식명, fixture, 생성 파일이 남아 있으면 전환 완료로 처리하지 않는다.

## 11. 필수 테스트 계획

각 단계의 단위 테스트만으로 완료 처리하지 않는다. 실제 파일 시스템 + SQLite를 사용하는 integration test와 대표 사용자 흐름 end-to-end test를 함께 통과해야 한다.

### 11.1 스키마·ID·정합성

- clean DB에서 최신 schema 직접 생성, 현재 schema 재오픈, 현재 버전과 다른 과거·미래 schema 거부, legacy migration/adapter가 호출되지 않음을 확인
- 모든 FK/unique/check 제약, delete cascade/set-null 정책, 앱 재시작 후 foreign key 활성화
- path/제목/heading rename 뒤 ID 및 assertion/evidence 유지, 서로 다른 page에서 section ID 중복 거부
- relation type 허용 entity type, inverse/symmetric, `one`/`many` cardinality와 범용 predicate 금지
- tag namespace/value, UI section의 `ui_scope`, entity 참조 필드 validation

### 11.2 Markdown·Ingest·충돌

- frontmatter round-trip, H1/H2 규칙, malformed YAML/ID, metadata 누락·잉여, H3 포함 section parsing
- 신규 문서, 동일 본문 재ingest의 idempotency, 신규 section 병합, 동일 ID 본문 충돌, heading rename, 혼합 신규+충돌
- modification Approve/Merge/Reject 세 경로에서 파일·DB·evidence가 일치하고 최종 편집 본문으로 graph가 재생성되는지 확인
- chunk 1 결과가 chunk 2의 page/entity 선택에 반영되는지, 한 chunk rollback 후 다음 chunk가 계속되는지 확인
- 자유 decomposition과 data type ingest 각각에서 page path 누락/unsafe path, 빈 추출, YAML 누락, 다중 선택 task, bare scalar, unknown/new relation type 검증
- 파일 write, DB commit, rename, embedding, git commit 각 지점에 fault injection을 넣어 partial page/assertion과 잘못된 cache가 남지 않는지 확인

### 11.3 Graph 편집·탐색

- 기존/alias entity에 node 연결, 신규 entity 생성, entity 없는 node 거부
- documented/manual/contradicted badge, evidence 추가 후 manual assertion 재사용, 문서 삭제 뒤 evidence 상태
- 같은 graph 1~3 hop, 동일 entity를 통한 1~2회 graph 전환, 비용 초과 차단, cycle/중복 edge에서 종료·중복 제거
- path 설명의 assertion/entity/graph switch가 실제 조회 row와 일치하고 삭제·superseded assertion을 기본 결과에서 제외
- cardinality 충돌의 review/approve/reject 동시성 및 두 편집 세션 race

### 11.4 검색·Chat 회귀

- token only, vector only, RRF, threshold 탈락, RAG off, `searchPaths()` 범위 밖 vector hit 차단을 section 결과에서도 유지
- entity alias, relation 열거, 2-hop 영향, 두 entity shortest path, 빈 graph context, LLM selector malformed JSON fallback
- metadata scoring과 부분 section 읽기가 context budget을 넘지 않고 history/response 예약량을 침범하지 않는지 확인
- Casemap/Persona prefix 밖 graph 전환 차단과 메인 Chat 전체 graph 허용
- 관련 문서 없음 응답, YAML question type 형식, Markdown question type 거부, 다국어 reminder, streaming 완료/실패, 구조화된 citation 저장·재로드
- citation 선택 시 현재 파일의 올바른 section을 미리보기로 열고 실제 `quoted_text` 구간을 하이라이트하는지 확인
- 동일 문구가 여러 번 등장할 때 문맥 anchor로 올바른 구간을 선택하고, 여러 근거 구간을 모두 표시하며, anchor가 사라졌을 때 임의의 유사 문장을 강조하지 않는지 확인
- page 이동과 heading rename 후 저장 메시지의 section reference preview와 근거 하이라이트가 현재 파일의 올바른 section을 여는지 확인
- HTML 주석, `[N]`, `[[wikilink]]` 및 구형 reference shape만 포함한 메시지를 호환 파싱하지 않고 지원하지 않는 형식으로 처리하는지 확인

### 11.5 Import/Export·수명주기·보안

- 새 프로젝트만 question/data/tag/relation schema가 seed되고 open/import는 프로젝트 값을 변경하지 않는지 확인
- 빈/대형/다중 graph 프로젝트 round-trip 후 page/section/entity/assertion/evidence/tag와 Markdown checksum 동일성
- export 도중 동시 ingest가 있어도 snapshot 내부가 일관적인지, 실패/취소 뒤 임시 파일이 없는지 확인
- 누락·손상 manifest/DB/checksum, 미지원 version, 중복 graph/ID에서 원자적으로 실패하고 반쪽 프로젝트를 남기지 않는지 확인
- `../`, absolute path, Windows prefix, symlink, 중복 entry, zip bomb 크기/개수 제한 테스트
- 공유 설정과 local-only queue/chat/review/cache의 포함·제외 정책 및 import 후 임시 snapshot 정리

### 11.6 성능과 완료 게이트

- 대표 규모 fixture에서 entity lookup, 3-cost traversal, section 후보 검색, integrity check의 기준 시간을 기록하고 query plan이 필수 인덱스를 사용하는지 확인
- 고차수 entity와 cycle graph에서 결과 수/메모리 상한, Chat context 상한을 확인
- parser/validator/property test로 임의 Markdown과 ID 입력에서 panic이 없고 serialize-parse 불변식을 만족하는지 확인
- Rust backend test, TypeScript unit/integration test, 실제 패키지에서의 import/export smoke test를 CI 필수 게이트로 둔다

### 완료 조건

- 임의의 page에서 관련 assertion과 1~2 hop 이웃을 찾을 수 있다.
- 각 결과 assertion에서 근거 section/page로 되돌아갈 수 있다.
- 동일 entity를 통해 둘 이상의 graph를 전환한 경로가 설명과 함께 반환된다.
- 문서가 없는 수동 edge도 명확한 predicate를 가진 채 traversal에 사용되고 `manual` 상태가 표시된다.
- page 경로 및 heading text를 변경해도 기존 관계가 유지된다.
- 원문을 읽지 않고도 UI의 범위·위치·콘텐츠 의미를 metadata로 판별할 수 있다.
- ingest 실패 지점 어디에서도 Markdown과 관계 DB가 서로 다른 상태로 남지 않는다.
- Chat의 기존 threshold, context budget, scoped graph와 YAML question type 동작이 section 기반 검색에서도 회귀하지 않는다.
- 구조화된 citation을 선택하면 근거 문서의 해당 section이 열리고 실제 근거 구간이 하이라이트된다.
- export한 프로젝트를 새 위치에 import했을 때 안정 ID와 모든 관계가 보존되고, 악성·손상 archive는 원자적으로 거부된다.
- 레거시 저장소·인덱스·snapshot·importer·adapter·fallback·Markdown question type·chat reference parser·fixture와 관련 read/write 코드가 저장소 및 패키지 산출물에 남아 있지 않다.

---

## 12. 확정된 정책

| 항목 | 결정 |
|---|---|
| Graph hopping | 같은 graph의 assertion 이동과 graph 전환 비용은 모두 1. 기본 총비용은 3, graph 전환은 최대 2회 |
| Section ID | Markdown heading attribute `{#sec-ULID}` 사용. 프로젝트 전역에서 유일하고 heading text와 무관하게 유지 |
| Section type | `overview`, `ui`, `behavior`, `flow`, `rule`, `data`, `exception`, `example`, `history`로 시작 |
| UI 세부 분류 | tag가 아니라 `ui_scope`, `ui_anchor`, `ui_layer`, `ui_aspect` 구조화 속성 사용 |
| Tag namespace | `domain`, `platform`, `lifecycle`, `audience`만 최초 허용 |
| Derived 관계 | assertion으로 저장하지 않고 검색 시 계산하여 설명 경로로만 반환 |
| Assertion 충돌 | relation type의 `object_cardinality`가 `many`이면 병렬 저장, `one`이면 review 후 기존 값을 `superseded` 처리 |

section type, tag vocabulary와 relation type은 스키마 파일로 관리한다. 허용 목록을 확장할 때는 스키마 버전을 올리고 validator와 검색 facet을 함께 갱신한다.
