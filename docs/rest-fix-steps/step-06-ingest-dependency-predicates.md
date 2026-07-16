# Step 06 — ingest 프롬프트에 의존/영향 predicate 추출 지시

계획서 §2.1 (공백 A의 축적 측). 선행 Step: 없음 (병렬 가능; 소비처는 Step 01).

## 목표

graph assignment 프롬프트에 의존/영향 축 predicate 추출 지시를 추가해,
처음부터 `DEPENDS_ON`/`AFFECTS`/`MODIFIES`/`DERIVES_FROM` 계열 엣지가 쌓이게 한다.
데이터가 비어 있어 재축적 비용이 0이므로 지금 추가하는 것이 최적 시점이다.

## 변경 대상

| 파일 | 변경 |
|------|------|
| `src/lib/ingest.ts` | `extractKnowledgeAssertionWrites`(L1273)의 graph assignment 프롬프트(L1286-1299)에 지시 추가 |

## 작업 내용

1. **프롬프트 지시 추가** — 기존 predicate 지시(L1293: uppercase snake case, 기존 재사용,
   신규는 정확한 relationDescription)에 더해:
   "요소 간 의존·영향 관계는 `DEPENDS_ON` / `AFFECTS` / `MODIFIES` / `DERIVES_FROM`
   계열 predicate로 추출하라"는 지시를 추가한다.
   - predicate 목록은 Step 04의 `PREDICATE_AXES.dependency` 상수를 **단일 출처**로
     참조한다(문자열 하드코딩 금지) — 축적과 소비가 어긋나지 않게 하는 §3.1의 원칙.
     Step 04가 아직 미완이면 상수 파일을 이 Step에서 먼저 만들어도 된다.
   - 기존 명명 규칙(`{purpose}_{subjectType}_{action}_{objectType}` graph 명명,
     서술형 predicate)과 **병행** — 대체가 아니다.
2. **검증 경로 무변경** — `object_cardinality`·`ENTITY_TYPES`·quote substring 등
   기존 검증 경로를 그대로 재사용한다. 이 Step에서 검증 코드를 수정하지 않는다.
3. **`reIngestDocument` 경로 확인** — 단일 섹션 재추출(L1390 → L1409)도 같은 프롬프트를
   쓰므로 별도 작업 없이 함께 적용됨을 확인만 한다.

## 완료 조건 (정적 확인)

- [ ] graph assignment 프롬프트에 의존/영향 축 추출 지시가 있고, predicate 목록이
      `PREDICATE_AXES.dependency` 상수에서 온다.
- [ ] 기존 명명 규칙 지시가 삭제·약화되지 않았다.
- [ ] 검증 경로(`object_cardinality` 등) 코드에 변경이 없다.

## Step 14 이월 검증

- 샘플 문서 ingest 후 `DEPENDS_ON`류 assertion이 graph 탭에 생성되는지.
- `change_impact` 질문에서 해당 엣지가 traversal 경로(Step 01 필터 통과)에 나타나는지.
