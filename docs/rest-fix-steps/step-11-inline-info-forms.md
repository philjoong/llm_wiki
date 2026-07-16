# Step 11 — 인라인 active 입력 폼 + unavailable 마킹 + ingest 완료 알림

계획서 §6 설계 2–3 (Phase 4). 선행 Step: 10.

## 목표

`information_requests`가 있으면 답변 카드 아래에 요청별 입력 폼을 **인라인**(모달 아님,
확정)으로 렌더한다. 사용자의 답은 일반 user 메시지로 대화에 들어가 다음 턴 컨텍스트가
된다(별도 주입 채널 불필요 — 대화 히스토리가 곧 주입, §6 설계 3).

## 변경 대상

| 파일 | 변경 |
|------|------|
| `src/components/chat/chat-message.tsx` (또는 신규 폼 컴포넌트) | `input_type`별 인라인 폼 렌더 |
| `src/components/chat/chat-panel.tsx` | 폼 제출 → user 메시지 생성, unavailable 상태(대화 단위) |
| `src/components/layout/activity-panel.tsx` | ingest 완료 → 역질문 카드 배지 연동 |
| `src/i18n/en.json`, `src/i18n/ko.json` | UI 문자열 |

## 작업 내용

1. **input_type별 폼** —
   - `choice`: 라디오 버튼(`options`) + **"기타(직접 입력)" 항목**
   - `text`: 텍스트 박스
   - `file`: 파일 업로드 — **기존 raw file injection 큐로 그대로 투입**
     (icon-sidebar의 ingest 경로 재사용). ingest되면 다음 턴 retrieval이 자연히 찾는다.
   - `link`: URL 입력 — 기존 URL injection 경로 재사용.
   - 공통: **"이 정보는 없음/모름" 버튼(필수)** — 해당 `info_key`를 unavailable로
     마킹하는 구조화 응답을 대화에 넣는다. 이것이 루프의 종료 조건을 만든다.
2. **제출 → user 메시지** — 폼 제출 결과는 `info_key`를 명시한 **일반 user 메시지**로
   대화에 들어간다. 다음 턴에 LLM이 이전 턴의 자기 역질문 + 사용자 답을 보고 원래 질문에
   마저 답한다(`maxHistoryMessages` 내). 별도 주입 메커니즘을 만들지 않는다.
3. **대화 흐름 비차단** — 인라인 폼은 대화를 차단하지 않는다. 사용자는 폼을 무시하고
   그냥 채팅으로 답할 수도 있다(폼은 편의 수단).
4. **unavailable 마킹 (확정)** — **대화 단위로만 유지, 영속화하지 않는다.**
   위키에 정보가 나중에 추가되면 새 대화에서 다시 조달된다.
   마킹된 `info_key`는 프롬프트에 "사용자가 제공 불가라고 답한 항목" 목록으로 실어
   재질문을 막는다(Step 10 프롬프트 지시와 연동).
5. **`file`/`link` 재개는 수동 (확정)** — ingest가 끝나도 원 질문을 자동 재실행하지
   않는다. 대신 **ingest 완료 알림**:
   - 인앱(기본): ingest 큐 완료를 activity-panel.tsx의 기존 큐 상태에 더해,
     해당 역질문 카드에 **"반영 완료 — 다시 질문" 배지 + 재전송 버튼** 표시.
     재전송 버튼은 원 질문을 같은 question type으로 다시 보낸다.
   - OS 알림(윈도우 토스트): `tauri-plugin-notification` **미설치** — 플러그인 추가가
     선행이므로 **후속 작업으로 범위 밖**(이 Step에서 하지 않음).
6. **테스트 작성** — unavailable 마킹 상태 로직, 폼 제출 → 메시지 포맷.

## 완료 조건 (정적 확인)

- [x] 4가지 `input_type` 폼이 인라인으로 렌더되고, 모든 폼에 "없음/모름" 버튼이 있다.
- [x] `file`/`link`가 기존 injection 경로를 재사용한다(신규 ingest 경로 없음).
- [x] 제출 결과가 `info_key` 명시 user 메시지로 대화에 추가된다.
- [x] unavailable 마킹이 대화 단위 상태로만 존재하고 영속 저장소에 쓰지 않는다.
- [x] ingest 완료 시 역질문 카드에 배지+재전송 버튼이 뜨는 연동 코드가 있다.
- [x] i18n 키가 en/ko 양쪽에 있다. vitest 테스트가 작성되어 있다.

## Step 14 이월 검증

- 사용자 답 → 다음 턴 답변에 반영, 같은 항목 재질문 없음.
- **모든 미충족 항목을 "없음/모름" 마킹** → 재질문 없이 가진 정보 안에서 답하고
  한계를 명시하는지 (종료 조건 검증).
- `file`/`link` 응답 → ingest 완료 배지 → 재전송 시 해당 내용이 citation으로 반영되는지.
