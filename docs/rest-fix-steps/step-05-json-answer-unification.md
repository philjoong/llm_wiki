# Step 05 — 답변 형식 JSON 통일 (md 답변 폐지)

계획서 §3.4. 선행 Step: 없음 (Step 04와 독립, 병렬 가능).

## 목표

question type 선택 시 항상 YAML `fields` 계약대로 JSON을 강제한다.
md 답변 허용은 폐지. 파싱은 렌더 타임에 수행해 대화 리로드 후에도 카드가 유지된다.

## 변경 대상

| 파일 | 변경 |
|------|------|
| `src/components/chat/chat-panel.tsx` | Answer Format 병합부(L271-290) 프롬프트 교체, "Use markdown formatting" 줄 제거(L250 근방) |
| `schema/question_types/*.yaml` (4개) | `prompt_template`의 `{{context}}`/`{{question}}` 플레이스홀더 삭제 |
| `src/components/chat/chat-message.tsx` | 렌더 타임 JSON 파싱 + 필드별 카드 렌더 + 원본 fallback |
| `src/lib/` (신규 또는 chat-citations.ts) | 코드펜스 스트리핑 + JSON 파싱 유틸 |

## 작업 내용

1. **프롬프트 충돌 제거** — 유형 선택 시 base 프롬프트의 "Use markdown formatting" 줄을
   제거하고 "Return ONLY a single JSON object with these keys" 지시로 대체.
   키 목록은 `qt.fields`에서 생성(기존 L271-290 병합부 개조).
2. **플레이스홀더 정리** — 현재 `qt.promptTemplate`는 치환 없이 그대로 붙어 리터럴
   `{{context}}`/`{{question}}`이 프롬프트에 들어간다(기존 버그). **치환을 구현하지 않고**
   YAML에서 플레이스홀더를 삭제한다 — context는 Citation Sections로, question은
   user 메시지로 이미 전달된다. 템플릿은 지시문 전용으로 유지.
3. **렌더 타임 파싱** — 메시지는 raw 문자열로 저장(저장 형식 무변경).
   렌더러가 매번 코드펜스 스트리핑(ingest.ts L1302의 인라인 패턴을 유틸로 추출해 재사용)
   후 `JSON.parse`. onDone 일회성 교체가 아니므로 대화 리로드 후에도 카드 유지.
4. **스트리밍 중** — 원본 텍스트 그대로 표시. 완료 후 파싱 성공 시 필드별 카드,
   **실패 시 원본 텍스트 fallback**(로컬 모델의 JSON 이탈 대비 최후 안전망).
5. **citation** — 각 JSON 필드 값은 마크다운 문자열이고 `[[CIT:key]]` 마커를 유지.
   `finalizeCitations`(chat-citations.ts L68)는 regex 기반이라 raw JSON 전체에도,
   필드별 재실행에도 동작(계획서에서 확인됨). **별도 sources 배열 필드는 두지 않는다.**
   ```json
   {
     "affected_pages": "- 스킬 A [[CIT:3]]\n- 시스템 B [[CIT:7]]",
     "update_candidates": "- 밸런스 시트 [[CIT:3]]"
   }
   ```
6. **테스트 작성** — 파싱 유틸(코드펜스 유/무, 불완전 JSON → fallback 판정),
   필드 키가 `fields` 계약과 다를 때의 렌더 동작.

## 완료 조건 (정적 확인)

- [ ] 유형 선택 시 프롬프트에 markdown 지시가 없고 JSON-only 지시가 있다.
- [ ] YAML 4개의 `prompt_template`에 `{{...}}` 플레이스홀더가 없다.
- [ ] 렌더러가 매 렌더마다 스트리핑+파싱하며, 메시지 저장 형식은 raw 문자열 그대로다.
- [ ] 파싱 실패 시 원본 텍스트 fallback 경로가 있다.
- [ ] 필드 카드 안 `[[CIT:key]]`가 기존 citation 링크 경로로 처리된다.
- [ ] vitest 테스트가 작성되어 있다.

## Step 14 이월 검증

- 파싱 성공/실패 두 경로 실제 렌더 확인.
- 카드 안 citation 링크 클릭 동작.
- 대화 리로드 후 카드 유지.
- 스트리밍 중 원본 표시 → 완료 후 카드 전환.
