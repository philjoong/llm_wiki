# Step 07 — 답변 범위(scope) 통제: UI + allowlist 확장

계획서 §4 (Phase 2). 선행 Step: 02 (options 인자), 04 (`scope: selectable` 플래그).

## 목표

**change_impact를 제외한 세 유형 전부**(related_content / new_system_impact /
version_comparison)가 사용자에게서 답변 범위를 받고, 그 범위가 프롬프트 부탁이 아니라
**retrieval 필터로 강제**되게 한다. 통제 단위는 **그래프 + 페이지/엔티티까지**(확정).

## 변경 대상

| 파일 | 변경 |
|------|------|
| `src/components/chat/chat-input.tsx` 또는 `chat-reference-panel.tsx` | 범위 선택기 UI |
| `src/components/chat/chat-panel.tsx` | 선택 범위 상태(대화 단위) + retrieval 호출에 전달 |
| `src/lib/knowledge/section-search.ts` | `options`에 page/entity 필터 인자 추가 |
| `src/lib/graph-qna.ts` | `getGraphContext`에 동일 필터 적용 |
| `src/i18n/en.json`, `src/i18n/ko.json` | UI 문자열 |

## 작업 내용

1. **범위 선택 UI** — Chat 입력/참조 패널에 범위 선택기.
   - 노출 조건: 선택된 question type의 `retrieval.scope === "selectable"` (Step 04 플래그).
     **type id 하드코딩 금지.**
   - 후보: 그래프(system) 단위 — `listKnowledgeGraphs`; 엔티티/페이지(content) 단위 —
     기존 entity/page 조회 커맨드. 다중 선택.
2. **allowlist 확장** —
   - 그래프 단위: 기존 경로(`resolveAllowedGraphIds` → `allowedGraphIds`)로 바로.
   - 페이지/엔티티 단위: `searchSectionCandidates`는 현재 `db/` 전체 순회 후
     `allowedGraphIds`로만 거른다. Step 02에서 도입한 `options`에
     `allowedPageIds?: string[]` / `allowedEntityIds?: string[]` 필터를 얹어
     후보 생성 단계에서 거른다(승격 후보 포함).
   - `getGraphContext`에도 같은 필터를 넘겨 그래프 컨텍스트가 범위 밖을 참조하지 않게 한다.
3. **상태 보존** — 선택 범위를 **대화 단위**로 유지(사용자가 바꿀 때까지).
   대화 전환 시 그 대화의 범위로 복원.
4. **테스트 작성** — 필터 지정 시 범위 밖 페이지/섹션이 후보에서 제외되는지,
   미지정 시 전체(기존 동작)인지.

## 완료 조건 (정적 확인)

- [x] 범위 선택기가 `scope: selectable` 플래그로만 노출 분기한다.
- [x] `searchSectionCandidates` options에 page/entity 필터가 있고 lexical 후보와
      승격 후보(Step 02) 모두에 적용된다.
- [x] `getGraphContext`에도 같은 필터가 전달된다.
- [x] 범위 상태가 대화 단위로 저장·복원된다.
- [x] i18n 키가 en/ko 양쪽에 있다.
- [x] vitest 테스트가 작성되어 있다.

## Step 14 이월 검증

- 범위를 시스템 A로 한정 시 시스템 B 페이지가 citation 후보/그래프 컨텍스트에서
  제외되는지 — **실제 retrieval 결과 관찰**(프롬프트 지시가 아니라).
- 범위 미선택 시 기존 동작(전체 그래프)과 동일한지 회귀.
- change_impact 선택 시 범위 선택기가 노출되지 않는지.
