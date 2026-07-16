# Step 09 — 비교 시점 선택 UI

계획서 §5 작업 4 (Phase 3). 선행 Step: 08.

## 목표

사용자가 "직전"만이 아니라 **더 이전 상태와의 비교 시점을 직접 선택**할 수 있게 한다
(확정 요구사항). 선택기는 `include_history: true`인 유형에서만 노출한다.

## 변경 대상

| 파일 | 변경 |
|------|------|
| `src/components/chat/chat-input.tsx` | 시점 선택기 UI |
| `src/components/chat/chat-panel.tsx` | 선택 시점 상태(대화 단위) + Step 08 주입 경로에 전달 |
| `src/lib/git-history.ts` | 커밋 목록 조달(`loadCommitPage`/`gitLog` 재사용) |
| `src/i18n/en.json`, `src/i18n/ko.json` | UI 문자열 |

## 작업 내용

1. **노출 분기** — 선택된 question type의 `retrieval.includeHistory === true`일 때만
   Chat 입력부에 시점 선택기 노출 (현재는 version_comparison뿐이지만 분기 기준은
   어디까지나 플래그 — type id 하드코딩 금지).
2. **후보 목록** — **repo 커밋 목록**(기존 `loadCommitPage`/`gitLog` 재사용,
   Sync 커밋이 대부분). 파일별 커밋 목록이 아닌 이유: 질문 시점에는 retrieval이
   아직 안 돌아서 어느 페이지가 대상인지 모른다. 시점을 먼저 고르고, retrieval이
   찾은 후보 파일들을 그 커밋 기준으로 `git_show_file`(Step 08) 조회한다.
   그 시점에 파일이 없으면 "당시 존재하지 않음"으로 주입(Step 08 경로 재사용).
3. **표시 형식 (확정)** — **날짜/시간 중심 목록**: 상대 시간("3일 전") + 절대 날짜.
   해시는 숨긴다. Sync 커밋은 메시지가 전부 동일("sync: update knowledge database")하므로
   커밋 메시지는 **sync가 아닌 커밋(restore 등)에만 보조로 노출**한다.
4. **기본값** — 선택 없으면 Step 08 작업 2의 기본값(파일별 최근 변경 커밋)을 그대로 쓴다.
5. **상태 보존** — 선택한 시점은 **대화 단위**로 유지 (Step 07의 scope 상태 보존과
   같은 원칙 — 구현 패턴을 공유한다).

## 완료 조건 (정적 확인)

- [x] 시점 선택기가 `includeHistory` 플래그로만 노출 분기한다.
- [x] 후보가 repo 커밋 목록이고, 상대+절대 시간 표시·해시 숨김·sync 커밋 메시지
      비노출 규칙이 구현되어 있다.
- [x] 선택 시점이 Step 08의 `git_show_file` 조회 기준으로 전달된다.
- [x] 미선택 시 Step 08 기본값 경로가 동작한다.
- [x] 시점 상태가 대화 단위로 저장·복원된다.
- [x] i18n 키가 en/ko 양쪽에 있다.

## Step 14 이월 검증

- version_comparison 선택 시에만 선택기가 뜨는지.
- 과거 시점 선택 → 그 시점 기준 본문이 주입되어 답변이 그 시점과 비교하는지.
- 미선택 시 기본값(최근 변경 커밋) 비교가 동작하는지.

## 미결정 (범위 밖, 기록만)

- 페이지 rename/split 시 과거-현재 대응 (`git log --follow`, `git log -S "sec-..."` 단서).
