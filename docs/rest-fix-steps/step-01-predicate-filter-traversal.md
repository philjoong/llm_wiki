# Step 01 — predicate 필터 traversal (Rust + TS 미러)

계획서 §3.2. 선행 Step: 없음.

## 목표

traversal이 특정 predicate 집합(예: 의존축 `DEPENDS_ON`/`AFFECTS`/`MODIFIES`/`DERIVES_FROM`)만
따라가도록 `allowed_predicates` 필터를 추가한다. 공백 A(§1)의 **소비처**를 만드는 작업 —
Step 06이 쌓는 의존축 엣지를 검색이 실제로 사용하게 된다.

## 변경 대상

| 파일 | 변경 |
|------|------|
| `src-tauri/src/knowledge/model.rs` | `TraversalRequest`(L142-144)에 `allowed_predicates: Option<Vec<String>>` 필드 추가 |
| `src-tauri/src/knowledge/commands.rs` | `traverse_knowledge_graph`(L465-501)의 이웃 assertion 확장 SQL(L494-496)에 `AND predicate IN (...)` 조건 추가 |
| `src/lib/knowledge/types.ts` | `TraversalRequest`(L109)에 `allowedPredicates?: string[]` 미러 |
| `src/commands/knowledge.ts` | 커맨드 래퍼에 인자 전달 |

## 작업 내용

1. **Rust struct** — `TraversalRequest`에 `allowed_predicates: Option<Vec<String>>` 추가
   (serde rename 규칙은 기존 필드들과 동일하게 맞춘다).
2. **SQL 필터** — 이웃 assertion 확장 쿼리(현재
   `SELECT ... FROM assertions WHERE graph_id=? AND status IN ('active','review') AND (subject=? OR object=?)`)에
   `allowed_predicates`가 `Some`이고 비어 있지 않을 때만 `AND predicate IN (...)` 을 동적으로 붙인다.
   - 확장 지점은 이 한 곳뿐이다(계획서 확인). seed 확장 SQL(L471)은 대상 아님.
   - `graph_switch` 스텝은 predicate가 없으므로 필터와 무관 — 기존 동작 유지.
   - `None`(또는 미지정)이면 현재와 완전히 동일하게 동작해야 한다.
3. **방향 처리** — traversal은 양방향 확장을 유지한다. `TraversalStep.forward`(L148)가
   이미 방향을 기록하므로 추가 작업 없음. predicate별 의미 방향으로 확장 자체를 자르는 것은
   **v2 확정 과제**로 이 Step 범위 밖 (§3.2).
4. **TS 미러** — `types.ts`의 `TraversalRequest`에 `allowedPredicates?: string[]` 추가,
   `src/commands/knowledge.ts` 래퍼가 그대로 넘기도록 수정.
5. **Rust 테스트 작성** — `allowed_predicates: ["DEPENDS_ON"]` 지정 시 다른 predicate
   (예: `REL`/`ATTACKS`) 엣지가 확장되지 않고, 미지정 시 전부 확장되는 테스트.
   (실행은 Step 14.)

## 완료 조건 (정적 확인)

- [ ] Rust `TraversalRequest`에 `allowed_predicates` 필드가 있고 TS `TraversalRequest`에
      `allowedPredicates`가 미러되어 있다 (직렬화 이름 일치).
- [ ] assertion 확장 SQL에 predicate IN 조건이 조건부로 붙는 코드가 있다.
- [ ] 필터 미지정 경로는 기존 SQL과 동일하다 (diff 상 무필터 분기 확인).
- [ ] Rust 테스트 코드가 작성되어 있다.

## Step 14 이월 검증

- `cargo test` — `allowed_predicates: ["DEPENDS_ON"]`일 때 다른 predicate 엣지 미확장.
- 필터 미지정 traversal 결과가 변경 전과 동일(회귀).
