# 엔티티 수동 Merge 현황

[ingest-current-state.md](ingest-current-state.md) §7이 말하는 "이름이 비슷하지만 다른 엔티티로 각각 생성된 경우, 사용자가 Graph 화면의 `entity` 탭에서 수동으로 **merge**해야 한다"의 실제 코드 상황을 정리한다. ingest 경로에는 fuzzy 매칭/사용자 확인이 없으므로(§7), 이름이 갈린 중복 엔티티를 정리하는 유일한 수단이 아래의 수동 merge 기능이다.

---

## 1. 어디 있는가

- 화면: `GraphView`(`src/components/graph/graph-view.tsx`)의 `entity` 탭 → `EntityView`(`src/components/entity/entity-view.tsx`)
- 프론트엔드 command: `mergeKnowledgeEntities()` (`src/commands/knowledge.ts:37`)
- Tauri 커맨드: `merge_knowledge_entities` (`src-tauri/src/knowledge/commands.rs:305`)

```text
GraphView (탭: knowledge / graphs / entity)
  └─ entity 탭 → EntityView
       └─ 엔티티 목록에서 "Edit" 클릭 → 인라인 편집 패널
            └─ "Merge by ID" 버튼 → mergeKnowledgeEntities() → merge_knowledge_entities (Rust)
```

---

## 2. UI 동작 (`entity-view.tsx`)

병합 대상 후보를 검색/선택하는 UI는 없다 — **entity ID를 직접 텍스트로 입력**해야 한다.

1. 병합해서 없앨 엔티티(source) 행에서 "Edit" 클릭 → `value` state에 그 엔티티의 canonical name이 채워짐.
2. `value` 입력창에 **병합 대상(target) 엔티티의 entity ID**를 직접 타이핑해서 덮어써야 한다 (canonical name이 아니라 ID). 화면에 다른 엔티티의 ID를 찾아볼 수 있는 검색/자동완성은 없고, 각 행에 표시되는 `entity.entityId`(모노스페이스 텍스트)를 직접 보고 옮겨 적어야 한다.
3. "Merge by ID" 클릭 → `merge()` 함수:
   - `entities` state에서 `entityId === value`인 엔티티를 target으로 찾는다. 못 찾으면 `"Choose a target entity ID."` 경고만 띄우고 종료.
   - `confirm("Merge "{source}" into "{target}"?")` 네이티브 확인 다이얼로그.
   - 확인 시 `mergeKnowledgeEntities(projectPath, source.entityId, target.entityId)` 호출 후 목록 reload.

즉 target 선택 UI는 "ID 문자열을 텍스트 인풋에 입력 → 목록에서 그 ID와 정확히 일치하는 엔티티를 찾기"로 구현되어 있다. 오타가 있으면 조용히 실패(경고만)하며, 어떤 엔티티끼리 이름이 비슷한지 미리 보여주는 유사도 안내나 후보 추천은 없다.

---

## 3. Rust 구현 (`merge_knowledge_entities`, `commands.rs:305`)

하나의 트랜잭션(`PRAGMA defer_foreign_keys=ON`)으로 source의 모든 참조를 target으로 옮긴 뒤 source 엔티티를 삭제한다.

| 순서 | 동작 |
|------|------|
| 1 | `graph_nodes`: target이 이미 같은 `(graph_id, role)`에 노드를 가지고 있으면 source의 해당 노드를 **삭제**(중복 방지) |
| 2 | `graph_nodes`: 남은 source 노드는 `entity_id`를 target으로 **UPDATE** (다른 graph/role은 그대로 이관) |
| 3 | `assertions.subject_entity_id`가 source인 행을 target으로 UPDATE |
| 4 | `assertions.object_entity_id`가 source인 행을 target으로 UPDATE |
| 5 | `page_entities`: target에 이미 같은 페이지 연결이 있으면 `UPDATE OR IGNORE`로 무시, 나머지는 target으로 이관 후 source에 남은 행은 DELETE |
| 6 | `entity_aliases`: 마찬가지로 `UPDATE OR IGNORE` 후 source에 남은 별칭은 DELETE (target과 정규화 별칭이 중복되는 별칭은 버려짐) |
| 7 | `pages.primary_entity_id`가 source인 행을 target으로 UPDATE |
| 8 | `sections.content_entity_id`가 source인 행을 target으로 UPDATE |
| 9 | `sections.host_entity_id`가 source인 행을 target으로 UPDATE |
| 10 | `entities`에서 source 행 DELETE |

인자 검증은 `source_entity_id == target_entity_id`이면 즉시 `ValidationFailed` 에러를 내는 것뿐이다 — 그 외에는:

- **되돌리기(undo) 없음.** 병합은 즉시 커밋되며 별도 확인창(Rust 쪽) 없이 실행된다. UI의 `confirm()`이 유일한 안전장치다.
- **cardinality 재검증 없음.** merge로 인해 같은 subject+predicate가 서로 다른 object를 가리키는 assertion이 새로 생겨도(§7의 cardinality 충돌 로직, `assertion()` 헬퍼)은 merge 경로에서 호출되지 않는다 — merge 이후 우연히 카디널리티 위반 상태가 되어도 `status:"review"`로 표시되지 않고 두 assertion이 그대로 `active`로 공존할 수 있다.
- Markdown 파일(`db/*.md`) 자체는 수정되지 않는다 — merge는 knowledge.sqlite에만 반영되고, 파일 프론트매터의 `primary_entity` 필드 등은 그대로 남는다 (DB의 `pages.primary_entity_id` 등은 target으로 갱신되지만, 파일 프론트매터와의 동기화는 별개 문제).

> **수정 이력:** 이전에는 `pages.primary_entity_id` / `sections.content_entity_id` / `host_entity_id`가 갱신되지 않아 병합 후 삭제된 source entity_id를 그대로 참조하는 버그가 있었다 (`delete_knowledge_entity`는 동일 컬럼을 정리하는데 `merge_knowledge_entities`만 빠뜨린 상태였다). 위 표의 7~9단계로 수정 완료 — 테스트: `entity_merge_keeps_all_references_on_the_target_stable_id` (`src-tauri/src/knowledge/tests.rs`).

---

## 4. 한계 요약

| 항목 | 현재 상태 |
|------|-----------|
| 중복 후보 추천 | 없음 — `find_knowledge_entities`(부분일치 검색)는 entity 탭 검색창에 쓰이지만 merge 대상 추천에는 연결되어 있지 않다 |
| Target 선택 방식 | entity ID 문자열 수동 입력 (이름 기반 선택 UI 없음) |
| 실패 처리 | target ID를 못 찾으면 경고 메시지만 표시, 조용히 중단 |
| 트랜잭션 범위 | `graph_nodes`/`assertions`/`page_entities`/`entity_aliases`/`pages`/`sections`/`entities` 갱신 |
| 갱신 안 되는 참조 | Markdown 파일(`db/*.md`) 프론트매터의 `primary_entity` 등 — DB 컬럼은 갱신되지만 파일 자체는 동기화되지 않음 |
| cardinality 재검사 | 없음 — merge 후 중복 predicate가 병렬 `active` assertion으로 남을 수 있음 |
| Undo | 없음 — `confirm()` 다이얼로그가 유일한 방지책 |

---

## 5. 관련 코드 위치

| 역할 | 파일 |
|------|------|
| Entity 탭 UI, merge 버튼 핸들러 | `src/components/entity/entity-view.tsx` |
| Graph 화면 탭 구성 (`entity` 탭 포함) | `src/components/graph/graph-view.tsx` |
| 프론트엔드 command 래퍼 | `src/commands/knowledge.ts` — `mergeKnowledgeEntities()` |
| Merge 트랜잭션 구현 | `src-tauri/src/knowledge/commands.rs` — `merge_knowledge_entities` |
| ingest 시 엔티티 자동 매칭(exact match) 배경 설명 | [ingest-current-state.md](ingest-current-state.md) §7 |
