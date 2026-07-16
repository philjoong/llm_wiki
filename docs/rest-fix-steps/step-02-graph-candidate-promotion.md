# Step 02 — 그래프 확장 retrieval: traversal hit 후보 승격

계획서 §3.3 (공백 C 해소). 선행 Step: 01.

## 목표

traversal hit이 **새 후보 섹션을 추가**하게 만든다. 현재 traversal(section-search.ts L85)은
lexical 후보의 `graphPath` 라벨 계산에만 쓰이고 후보 집합을 바꾸지 못한다.
이 Step 없이는 `graph_expand`도 `predicate_axes`도 답변을 바꾸지 못한다 — Phase 1의 선행 작업.

## 변경 대상

| 파일 | 변경 |
|------|------|
| `src/lib/knowledge/section-search.ts` | `searchSectionCandidates`(L42)에 `options` 인자 추가 + 승격 로직 |
| `src/lib/knowledge/section-search.test.ts` | 승격/회귀 테스트 추가 |

## 작업 내용

1. **시그니처 확장** — 현재 3-인자
   `searchSectionCandidates(projectPath, query, allowedGraphIds?)`에
   `options?: { graphExpand?: number; allowedPredicates?: string[] }` 를 4번째 인자로 추가.
   (Step 07의 콘텐츠 단위 필터도 이 `options` 자리에 얹는다 — §4 작업 2.)
2. **traversal 파라미터 치환** — 내부 traversal 호출(L85)의 `maxCost: 3`을
   `options.graphExpand`로 치환하고 `allowedPredicates`(Step 01)를 전달.
   `graphExpand`가 `0` 또는 미지정이면 **승격 없음** — 현재 동작(라벨 계산용 traversal)을 유지.
3. **승격 로직** — traversal hit 경로상의 assertion들에 대해
   `assertion_evidence.section_id`를 역참조해, lexical 후보에 없던 섹션을
   `SectionCandidate`로 추가한다.
   - `matchedRanges`: evidence quote를 섹션 본문에서 재탐색(`indexOf`)해 채우고,
     실패 시 빈 배열 — citation은 key만으로 동작하므로 문제 없음.
   - `assertionIds`/`graphPath` 등 기존 후보 메타데이터 필드도 채운다.
4. **상한 분리** — 승격 후보는 별도 상한 **8개**를 두고 기존 lexical 상한 12개
   (L88의 `.slice(0,12)`)와 분리한다. lexical 결과를 밀어내지 않는다.
5. **테스트 작성** — (a) lexical 매칭 안 되는 섹션이 traversal 경유로 후보에 추가되는지,
   (b) `graphExpand: 0`/미지정이면 기존 결과와 동일한지(회귀),
   (c) 승격 상한 8개가 지켜지는지. 기존 `section-search.test.ts`의 픽스처 패턴 재사용.

## 완료 조건 (정적 확인)

- [ ] `searchSectionCandidates`에 `options` 인자(`graphExpand`, `allowedPredicates`)가 있다.
- [ ] traversal hit → `assertion_evidence.section_id` 역참조 → `SectionCandidate` 추가
      경로가 구현되어 있고, quote 재탐색 실패 시 빈 `matchedRanges` 폴백이 있다.
- [ ] 승격 상한(8)과 lexical 상한(12)이 분리되어 있다.
- [ ] `graphExpand` 미지정/0 경로가 기존 코드와 동일 동작임을 코드 리뷰로 확인.
- [ ] vitest 테스트가 작성되어 있다.

## Step 14 이월 검증

- vitest — 승격/회귀/상한 테스트 통과.
- 실제 위키 데이터에서 lexical 미매칭 섹션이 traversal 경유로 citation 후보에 뜨는지.
