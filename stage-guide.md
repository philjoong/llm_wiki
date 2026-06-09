# Ingestion Pipeline: Stage 1 / 2 / 3

Raw data를 ingestion할 때 내부적으로 3개의 스테이지가 순서대로 실행된다.

---

## Stage 1 — 문서 분해 (LLM)

**역할:** source text를 의미 있는 섹션 단위로 쪼갠다.

**동작 방식:**
- LLM에게 source 문서를 읽고, 개념/토픽 단위로 SECTION 블록을 emit하도록 요청한다.
- 관계 추출, 그래프 배정은 하지 않는다. 순수하게 "어디서 어디까지가 하나의 개념인가"만 결정한다.
- 출력은 JSON이 아닌 SECTION 구분자 형식이다:

```
---SECTION: ## 신성조 - 외모와 개인사---
(source text 원문 그대로)
---END SECTION---
```

**출력:** `Stage1Section[]` — `source_id`, `source_range`, `source_text` 필드를 가진 섹션 목록

---

## Stage 2 — 그래프 배정 (LLM)

**역할:** Stage 1 섹션들을 읽고, 각 섹션을 여러 `subject → predicate → object` 트리플로 분해한다. 트리플 단위로 적합한 그래프를 독립적으로 배정한다.

**동작 방식:**
- Stage 1 출력(섹션 목록)을 scaffold JSON으로 변환해서 LLM에게 넘긴다.
- LLM은 각 섹션에서 하나 이상의 트리플을 추출하고, 트리플마다 아래 필드를 채운다:
  - `subject` — 주어 노드 이름 (예: "고블린 전사")
  - `predicate` — 관계 타입 (예: "WEAK_AGAINST")
  - `object` — 목적어 노드 이름 (예: "불")
  - `graph` — 배정할 그래프 이름 (예: `combat_weakness_graph`)
  - `page_path` — 저장될 파일 경로 (예: `db/enemies/goblin-warrior-weakness.md`)
  - `new_graph` — 신규 그래프 여부

**트리플 구조:**
```json
{
  "triples": [
    { "subject": "고블린 전사", "predicate": "WEAK_AGAINST", "object": "불", "graph": "combat_weakness_graph", "page_path": "db/enemies/goblin-warrior-weakness.md", "new_graph": false },
    { "subject": "고블린 전사", "predicate": "DROPS_ITEM", "object": "고블린 이빨", "graph": "enemy_loot_graph", "page_path": "db/enemies/goblin-warrior-loot.md", "new_graph": true }
  ]
}
```

**핵심 설계:**
- 1 섹션 → 여러 트리플. 하나의 섹션이 여러 사실을 담으면 각각 별도 트리플로 추출된다.
- 트리플이 같은 `page_path`를 공유하면 Stage 3에서 하나의 파일로 병합된다.
- 트리플이 없는 섹션(subject/predicate/object 미완성)은 Stage 3에서 드롭된다.

**출력:** `Stage2Triple[]`

---

## Stage 3 — 파일 생성 (순수 코드, LLM 없음)

**역할:** Stage 2 트리플을 받아서 `db/` 디렉토리에 마크다운 파일을 만든다.

**동작 방식 (코드 전용):**
- `buildFileBlocksFromAssignments()` 함수가 트리플을 `page_path` 기준으로 그룹화하며 FILE 블록 텍스트를 생성한다.
- 같은 `page_path`를 공유하는 트리플들은 하나의 파일로 병합된다.
- LLM 호출 없이 순수하게 데이터를 조립해서 마크다운 frontmatter + 본문을 만든다.

**생성되는 파일 구조:**
```markdown
---
title: ## 고블린 전사
status: draft
sources:
  - file: goblin-data.md
    range: "## 고블린 전사"
---

(source_text 원문)
```

**핵심:** `title`은 `source_range`(섹션 제목)이다. `graph:` frontmatter와 `## Related` 위키링크는 제거되었다. FalkorDB sync는 마크다운 파일이 아니라 `Stage2Triple[]`을 직접 읽으므로 파일에 트리플 정보를 중복 저장하지 않는다.

---

## Stage 3 이후 — 파일 저장 & 그래프 동기화

Stage 3는 파일 텍스트를 생성하는 것까지만 담당한다. 이후:

1. **파일 저장** — `db/` 디렉토리에 `.md` 파일로 기록된다.
2. **graph-sync** — Stage 2가 생성한 `Stage2Triple[]`을 직접 받아 FalkorDB에 Cypher로 노드/엣지를 생성한다. 마크다운 파일을 다시 읽지 않는다.
3. **page-graph-index 갱신** — graph-sync가 완료된 직후 `page_path → graph[]` 인덱스를 `.llm-wiki/page-graph-index.json`에 upsert한다. Files 탭이 파일 선택 시 이 인덱스를 읽어 연관 그래프를 즉시 표시한다.

```cypher
-- subject 노드 생성 (MERGE로 upsert)
MERGE (a:Page {id: '고블린 전사'}) SET a.label = '고블린 전사'

-- object 노드 생성 (없으면 자동 생성)
MERGE (b:Page {id: '불'}) SET b.label = '불'

-- 엣지 생성
MATCH (a:Page {id: '고블린 전사'}), (b:Page {id: '불'})
MERGE (a)-[r:WEAK_AGAINST]->(b)
```

**진실의 원천은 트리플:** graph-sync는 마크다운 파일이 아니라 Stage 2의 `Stage2Triple[]`을 직접 읽는다. object 노드가 별도 파일로 존재하지 않아도 MERGE로 자동 생성되므로 엣지가 항상 만들어진다.

**그래프 배정:** 각 트리플의 `graph` 필드가 FalkorDB의 어느 named graph에 기록될지를 결정한다. 같은 subject라도 predicate에 따라 다른 graph에 독립적으로 기록된다.

```
트리플 A: { subject: "고블린 전사", predicate: "WEAK_AGAINST", object: "불", graph: "combat_weakness_graph" }
  → combat_weakness_graph에 노드 "고블린 전사", "불" + 엣지 WEAK_AGAINST

트리플 B: { subject: "고블린 전사", predicate: "DROPS_ITEM", object: "고블린 이빨", graph: "enemy_loot_graph" }
  → enemy_loot_graph에 노드 "고블린 전사", "고블린 이빨" + 엣지 DROPS_ITEM
```

---

## 흐름 요약

```
source text
    │
    ▼ [Stage 1: LLM]
섹션 분해 — source_text를 개념 단위로 쪼갬 → Stage1Section[]
    │
    ▼ [Stage 2: LLM]
트리플 추출 + graph 배정 — 각 섹션 → subject/predicate/object 트리플[] (트리플 단위 graph 배정) → Stage2Triple[]
    │
    ├─▶ [Stage 3: 코드]
    │   파일 생성 — page_path 기준 그룹화 → db/*.md (위키 편집기용, title=source_range, source_text 본문)
    │
    └─▶ [graph-sync: 코드]
        FalkorDB 동기화 — Stage2Triple[] 직접 수신 → graph별로 subject/object 노드 MERGE + 엣지 MERGE
        → page-graph-index 갱신 — page_path→graph[] 인덱스를 .llm-wiki/page-graph-index.json에 upsert
```

---

## 네가 이해하고 있던 것과 실제의 차이

| 항목 | 네가 알고 있던 것 | 실제 |
|---|---|---|
| Stage 2 역할 | source text를 node-edge-node로 표현해서 그래프 생성 | 섹션을 subject/predicate/object 트리플로 분해하고 트리플 단위로 graph를 배정. 그래프 DB 기록은 graph-sync가 담당 |
| Stage 3 역할 | 그래프가 생성된 source text를 순수 코드로 마크다운 저장 | 위키 편집기용 마크다운 파일 생성. `buildFileBlocksFromAssignments()`가 동일 page_path 트리플을 병합. title=source_range, 본문=source_text. graph frontmatter·위키링크 없음 |
| graph-sync 입력 | 마크다운 파일 위키링크를 파싱해 FalkorDB에 기록 | `Stage2Triple[]`을 직접 수신. 마크다운 파일을 다시 읽지 않음. 트리플의 `graph` 필드가 FalkorDB named graph를 결정. sync 후 `page-graph-index.json` upsert |
| Files 탭 연관 그래프 | `graph:` frontmatter 또는 FalkorDB 전체 쿼리(파일명 기반, 실제로 작동 안 함) | `page-graph-index.json` 직접 조회. ingest 시점에 기록된 `page_path→graph[]` 매핑을 읽음 |
| Stage 3 프롬프트 | 없음 | `buildGenerationPrompt()`라는 함수가 있지만 현재 파이프라인에서는 호출되지 않음. Stage 3는 `buildFileBlocksFromAssignments()`(코드)가 담당. 해당 프롬프트는 레거시 |
