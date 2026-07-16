# Step 10 — `required_info` 입력 계약 + `information_requests` 출력 계약

계획서 §6 설계 0–1 (Phase 4). 선행 Step: 05 (JSON 출력 계약 위에 예약 키를 얹음).

## 목표

question type YAML에 **입력 계약 `required_info`**를 선언하고, LLM이 미충족 항목만
`information_requests` 예약 키로 역질문하게 한다. `fields`가 출력 계약이라면
`required_info`는 입력 계약 — 이것이 없으면 LLM이 무엇을 물을지·언제 그만 물을지
판단할 기준이 없다.

## 변경 대상

| 파일 | 변경 |
|------|------|
| `src/lib/question-types.ts` | `requiredInfo` 파싱 (`QuestionType`에 추가) |
| `schema/question_types/*.yaml` (4개) | `required_info:` 블록 추가 |
| `src/components/chat/chat-panel.tsx` | 프롬프트에 required_info 판정 지시 + `information_requests` 계약 추가 |

## 작업 내용

1. **YAML 선언** — 각 유형에 `required_info:` 맵(`info_key: 설명`) 추가. 초안(§6 표):
   | 유형 | required_info |
   |------|---------------|
   | `change_impact` | `change_target`(질문) / `change_detail`(질문·역질문) / `dependency_map`(그래프) |
   | `new_system_impact` | `new_system_rules`(질문·역질문) / `check_targets`(범위 선택·그래프) |
   | `related_content` | `target_content`(질문) / `answer_scope`(범위 선택, 선택사항) |
   | `version_comparison` | `target_content`(질문) / `compare_point`(시점 선택 UI 또는 기본값) / `past_content`(git) |
   Phase 2 범위 선택·Phase 3 시점 선택은 required_info 일부를 질문 전에 미리 수집하는
   특수 UI다 — 같은 개념의 사전/사후 수집.
2. **출력 계약** — Step 05의 JSON 계약에 예약 키 `information_requests` 추가:
   ```json
   {
     "affected_pages": "...(아는 만큼 답변)...",
     "information_requests": [
       { "info_key": "change_detail",
         "question": "스킬 A의 재사용 대기시간 상한이 어디에 정의되어 있나요?",
         "reason": "영향 범위 판단에 필요하나 위키에 없음",
         "input_type": "text",
         "options": [] }
     ]
   }
   ```
   `input_type`은 `"choice" | "text" | "file" | "link"` **닫힌 집합**,
   `options`는 `choice`일 때 라디오 후보.
3. **프롬프트 지시** — "required_info 각 항목의 충족 여부를 판정하라. 컨텍스트에 없는
   정보가 답변에 필요하면 추측하지 말고 미충족 항목만 `information_requests`에 담아라.
   아는 부분은 답하고, 모르는 부분만 물어라. 사용자가 이미 '없다'고 답한 항목은
   다시 묻지 말라." — 기존 "정직하게 없다고 말하라" 규칙의 구조화 버전.
4. **완료 조건 의미론** — 모든 항목이 충족(fulfilled)이거나 사용자 제공 불가(unavailable)로
   마킹되면 더 묻지 않는다. unavailable 항목이 있어도 **가진 정보 안에서 답하고 한계를
   명시**한다 — "정보가 없어서 답변 불가"로 끝내지 않는다. (unavailable 마킹의 UI/상태는
   Step 11.)
5. **파싱/검증** — 렌더 타임 파싱(Step 05)에서 `information_requests`를 인식해
   구조 검증(닫힌 `input_type` 집합, `info_key`가 해당 유형의 required_info에 존재).
   검증 실패 요청은 무시하고 답변 본문만 렌더.
6. **테스트 작성** — YAML 파싱, `information_requests` 구조 검증(허용/거부 케이스).

## 완료 조건 (정적 확인)

- [x] YAML 4개에 `required_info` 블록이 있고 파서가 이를 로드한다.
- [x] 프롬프트에 판정·역질문 지시와 `information_requests` 스키마가 포함된다.
- [x] `input_type` 닫힌 집합과 `info_key` 유효성 검증이 파싱 경로에 있다.
- [x] vitest 테스트가 작성되어 있다.

## Step 14 이월 검증

- 위키에 없는 정보를 요구하는 질문 → `information_requests` 생성(환각으로 채우지 않음),
  각 요청이 그 유형의 `required_info` 항목에 대응하는지.
- 아는 부분은 답변 필드에, 모르는 부분만 요청에 들어가는지.
