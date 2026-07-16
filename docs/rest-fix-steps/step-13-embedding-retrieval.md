# Step 13 — embedding 시맨틱 검색: retrieval 병합

계획서 §7 (Phase 5, lexical 랭킹 공백 해소). 선행 Step: 02 (options/병합 지점).

## 목표

lexical 랭킹 공백(§1 공통 노트: ANY-token 매치, 조사 붙은 토큰 실패, relevance 랭킹
없음)을 embedding 시맨틱 검색 도입으로 해소한다. 축적(LanceDB 인덱싱)은 이미 있으므로
**소비(retrieval 병합)만 잇는다**. new_system_impact의 개념 매칭(이름이 다른 유사 시스템
찾기)도 함께 좋아진다.

## 이미 있는 것 (재사용)

- `embedPage`(embedding.ts L291) — ingest가 `IngestPlan.embeddingJobs`로 이미 호출(설정 on일 때).
- `searchByEmbedding`(L426) — chunk 검색 후 페이지 단위 blended score, `matchedChunks`
  (top 3 chunk 텍스트/headingPath) 포함.
- `embedAllPages`(L348), `removePageEmbedding`(L489).
- ChatInput의 `useEmbedding` 인자 — 시그니처에 있으나 현재 `void` 처리(chat-panel.tsx L182).

## 변경 대상

| 파일 | 변경 |
|------|------|
| `src/lib/embedding.ts` (호출부 포함) | page_id를 v2 ULID로 통일 |
| `src/lib/knowledge/section-search.ts` | embedding 후보 provider + 병합·랭킹 |
| `src/components/chat/chat-panel.tsx` | `useEmbedding` 인자를 실제 분기로 연결 (`void` 제거) |

## 작업 내용

1. **ID 정합** — LanceDB의 `page_id`는 경로 기반(`pageIdFromRelPath` L275 — `/`→`_` 치환)
   이고 v2 페이지의 `page_id`는 frontmatter ULID다. `embedPage`/`removePageEmbedding`
   호출부가 v2 `page_id`를 쓰도록 통일한다.
   **축적된 데이터가 없으므로 재인덱싱 절차는 두지 않는다** — 계획서의 "일괄 재인덱싱
   1회 필요"는 이 전제로 불필요(확정). `embedAllPages`는 기존 기능으로 유지만 한다.
2. **chunk → 섹션 대응** — LanceDB chunk는 `chunkMarkdown` 청크라 sectionId를 모른다.
   `matchedChunks` 텍스트를 섹션 본문에서 재탐색해 섹션을 결정한다
   (Step 02 승격의 quote 재탐색과 같은 패턴). 실패 시 페이지 첫 섹션 폴백.
3. **retrieval 병합** — `searchSectionCandidates`에 embedding provider 추가:
   - lexical 후보 + embedding 후보 + graph 승격 후보(Step 02)를 병합.
   - **embedding score를 1차 정렬 키**로 써서 12개 컷(기존 ordinal 정렬 대체 —
     embedding 후보가 있을 때만).
   - embedding 설정 off거나 인덱스가 비면 기존 lexical-only 동작(회귀 안전).
   - `useEmbedding` 인자(chat-panel.tsx L178, 현재 `void`)가 이 분기를 다시 살린다.
4. **테스트 작성** — 병합·랭킹 로직(embedding 후보 우선, off 시 기존 동일),
   chunk→섹션 재탐색(성공/폴백).

## 완료 조건 (정적 확인) — 2026-07-16 완료

- [x] `embedPage`/`removePageEmbedding` 호출부가 v2 ULID `page_id`를 쓰고,
      재인덱싱 마이그레이션 코드가 없다. (ingest.ts는 written 파일 frontmatter ULID,
      wiki-page-delete.ts는 삭제 전 파일 읽어 ULID로 cascade. `embedAllPages`는 기존 유지.)
- [x] chunk→섹션 재탐색 + 첫 섹션 폴백이 구현되어 있다. (`mergeEmbedding` 내 `relocate`,
      최소 ordinal 섹션 폴백.)
- [x] 병합 시 embedding score 1차 정렬 + 12개 컷, off 시 기존 경로가 유지된다.
      (`embeddingConfig` 미지정/disabled/빈결과/예외 → base 그대로 반환.)
- [x] `void useEmbedding`이 제거되고 실제 분기로 연결되어 있다.
      (토글 on일 때만 `embeddingConfig`를 옵션으로 전달.)
- [x] vitest 테스트가 작성되어 있다. (section-search 병합 9테스트, delete/queue 테스트 재작성.)

## Step 14 이월 검증

- lexical로 안 잡히는 동의어/개념 질문이 embedding 경유로 후보에 들어오는지 —
  new_system_impact 질문에서 명칭이 다른 유사 시스템이 상위에 오는지.
- embedding off 시 기존과 완전히 동일한지(회귀).
- v2 ID로 인덱싱된 상태에서 페이지 삭제 시 `removePageEmbedding` 연동이 동작하는지.

## 미결정 (범위 밖, 기록만)

- 인덱스를 섹션 단위로 재구성할지 — chunk 재탐색으로 시작, 재탐색 실패율이 실측으로
  문제 되면 그때 재구성.
