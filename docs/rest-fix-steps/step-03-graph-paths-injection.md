# Step 03 — "Graph Paths" 경로 주입 (공백 D 해소)

계획서 §3.3 경로 주입. 선행 Step: 02.

## 목표

traversal 경로 자체를 system prompt에 주입한다. 현재 `getGraphContext` 결과는
`noGraphContext` 플래그 계산에만 쓰이고 내용은 버려진다(chat-panel.tsx L226-227) —
LLM은 assertion을 한 줄도 보지 못하며, `related_content.relation_paths`는
구조적으로 답할 수 없다. Step 02가 "근거 섹션 본문"을 준다면 이 Step은
"관계 구조 자체"를 준다.

## 변경 대상

| 파일 | 변경 |
|------|------|
| `src/lib/knowledge/section-search.ts` | traversal 경로를 호출자에게 반환 (반환 타입 확장) |
| `src/components/chat/chat-panel.tsx` | system prompt에 "Graph Paths" 블록 조립·주입 |
| (필요 시) `src/lib/chat-citations.ts` | 경로 라인의 `[CIT:key]` 병기 유틸 |

## 작업 내용

1. **경로 반환** — Step 02의 traversal 결과에서 hit 경로(스텝 목록)를
   `searchSectionCandidates` 반환값에 포함시킨다(예: `{ candidates, graphPaths }` 형태로
   반환 타입 확장, 또는 별도 필드). 경로 스텝은 `TraversalStep.forward`(방향)와
   `predicate`를 보존한다.
2. **방향 보존 포맷** — 각 경로를 `A --DEPENDS_ON--> B --AFFECTS--> C` 형태로 직렬화.
   `forward: false`인 스텝은 화살표 방향을 반대로 표기해 LLM이 영향 방향을 판단하게 한다 (§3.2).
3. **citation 병기** — 경로상 assertion의 evidence 섹션은 Step 02 승격으로 후보에 함께
   들어와 있으므로, 경로 라인 옆에 해당 섹션의 `[CIT:key]`를 병기한다.
   이것이 chat-panel.tsx의 원래 우려("uncitable second source 주입 금지" 주석)를 해소한다 —
   인용 불가능한 소스가 아니게 된다.
4. **프롬프트 주입** — `handleSend`의 system prompt 조립부에 "Graph Paths" 블록을 추가.
   - `graphExpand: 0`(Step 04 도입 전에는 항상)이면 블록을 생성하지 않는다.
   - 경로가 하나도 없으면 블록을 비우고 기존 empty-state 규칙(`noGraphContext` 분기,
     L244-246)을 유지한다.

## Step 04와의 연결

이 Step 완료 시점에는 아직 유형별 분기(`graph_expand` 플래그)가 없으므로, 블록 생성은
Step 04에서 `retrieval` 힌트가 연결될 때 활성화된다. 이 Step에서는 **조립 로직과
반환 경로까지 구현**하고, 활성화 분기는 Step 04에 맡긴다 (빌드 가능 상태 유지 의무가
없으므로 dead code 상태로 두어도 된다).

## 완료 조건 (정적 확인)

- [ ] `searchSectionCandidates` 반환값에 방향·predicate 보존 경로 데이터가 포함된다.
- [ ] `A --PRED--> B` 직렬화에서 `forward` 여부에 따라 화살표 방향이 뒤집힌다.
- [ ] 경로 라인에 evidence 섹션의 `[CIT:key]`가 병기된다.
- [ ] 경로 없음 → 블록 미생성 + 기존 `noGraphContext` 규칙 유지 경로가 있다.
- [ ] 직렬화 로직에 대한 vitest 테스트가 작성되어 있다.

## Step 14 이월 검증

- `related_content` 질문에서 프롬프트에 방향 보존 경로 라인이 실리는지,
  답변의 `relation_paths`가 그 경로를 citation과 함께 서술하는지.
- 그래프에 관계가 없으면 블록이 비고 기존 empty-state 답변이 유지되는지.
