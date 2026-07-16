# Step 12 — 사용자 답 위키/그래프 축적 ("위키에 저장")

계획서 §6 설계 4 (Phase 4 — 루프 완성). 선행 Step: 11.

## 목표

역질문에 대한 사용자의 답을 위키/그래프에 축적한다. 저장된 내용은 다음 질문부터
일반 retrieval로 검색된다 — 질문 응대가 곧 DB 구축이 되는 루프의 완성.

## 확정 사항 (2026-07-15)

- 저장 위치는 **LLM 자동 제안 + 사용자 승인** — 기존 페이지 섹션 추가 / 신규 페이지
  생성 둘 다 허용, 사용자는 승인하거나 다른 위치로 변경.
- **저장 전 검수 단계는 두지 않는다** — 답한 사람 = 저장하는 사람이라 검수가
  자기 확인에 불과. 대신 assertion `origin`을 `user_chat`으로 남겨 추적 가능하게 한다.

## 변경 대상

| 파일 | 변경 |
|------|------|
| `src-tauri/src/knowledge/schema.rs` | `assertions.origin` CHECK에 `'user_chat'` 추가 |
| `src/components/chat/chat-message.tsx` | 사용자 답 카드에 "위키에 저장" 액션 (기존 "Save to Wiki" 버튼의 연장선) |
| `src/components/chat/chat-panel.tsx` (또는 신규 lib) | 저장 위치 LLM 제안 + 승인 UI 흐름 |
| `src/lib/ingest.ts` | 기존 파이프라인 재사용 (`reIngestDocument` L1390의 sectionId 경로 참고) |
| `src/i18n/en.json`, `src/i18n/ko.json` | UI 문자열 |

## 작업 내용

1. **origin 스키마 변경** — schema.rs L13의
   `CHECK(origin IN ('ingest', 'manual'))`에 `'user_chat'` 추가.
   **축적된 데이터가 없으므로 마이그레이션(테이블 재생성) 없이 CREATE 문을 직접
   수정한다** — 계획서의 "마이그레이션 필요" 언급은 이 전제로 대체(확정).
   기존 DB 파일이 있는 개발 환경은 DB 삭제 후 재생성으로 충분.
2. **저장 위치 제안** — LLM이 기존 페이지의 섹션 추가 또는 신규 페이지 생성을 제안.
   제안 로직은 decomposition이 이미 하는 page_path 결정(dbIndex를 프롬프트에 주입해
   기존 페이지 재사용 유도)을 **재사용**한다.
3. **승인 UI** — 제안된 위치를 표시하고 사용자가 승인 / 다른 위치로 변경.
   검수(내용 편집) 단계는 두지 않는다.
4. **저장 실행** — 승인 후 **기존 ingest 경로로 커밋**: 섹션 저장 +
   `extractKnowledgeAssertionWrites`로 assertion 추출까지 기존 파이프라인 재사용
   (`reIngestDocument`의 sectionId 경로 참고). 이때 생성되는 assertion의
   `origin`을 `user_chat`으로 기록.
5. **UX 연속성** — 채팅 메시지의 기존 "Save to Wiki" 버튼(chat-message.tsx)이 이미
   있으므로 UX·코드 모두 그 연장선에 둔다.
6. **테스트 작성** — origin 값 검증(Rust), 저장 위치 제안 파싱.

## 완료 조건 (정적 확인)

- [x] `origin` CHECK가 `('ingest','manual','user_chat')`이고 별도 마이그레이션 코드가 없다.
- [x] 사용자 답 카드에 저장 액션이 있고, LLM 위치 제안 → 승인/변경 → 기존 ingest
      파이프라인 호출 흐름이 구현되어 있다.
- [x] 저장 경로에서 생성된 assertion에 `origin: user_chat`이 기록된다.
- [x] 내용 검수 단계가 없다 (승인은 위치에 대해서만).
- [x] i18n 키가 en/ko 양쪽에 있다. 테스트가 작성되어 있다.

## Step 14 이월 검증

- "위키에 저장" → 페이지/섹션 + assertion(`origin: user_chat`) 생성 확인.
- **새 대화에서** 같은 질문 시 역질문 없이 citation과 함께 답하는지
  (루프의 end-to-end 검증).
