# Step 08 — 과거 버전 조회 커맨드 + 히스토리 컨텍스트 주입

계획서 §5 작업 1–3 (Phase 3, 공백 B 해소). 선행 Step: 04 (`include_history` 플래그).

## 전제 (계획서 §5에서 확정)

- git 커밋은 **Sync 시점에만** 생긴다. ingest 후 자동 커밋은 하지 않는다(확정).
  과거 해상도는 Sync granularity를 수용한다.
- 비교의 "현재"는 HEAD가 아니라 **working tree 파일**이다 — 수동 Sync 구조상
  working tree가 HEAD보다 앞서 있는 것이 보통이다.
- Sync를 한 번도 안 한 프로젝트는 비교할 과거가 없다 → "과거 정보를 확인할 수 없다"
  답변(기존 프롬프트 규칙 유지).

## 변경 대상

| 파일 | 변경 |
|------|------|
| `src-tauri/src/commands/git_ops.rs` | 신규 커맨드 `git_show_file` (`git show <hash>:<path>` 상당) |
| `src-tauri/src/lib.rs` | 커맨드 등록 |
| `src/lib/git-history.ts` (또는 commands 래퍼) | TS 래퍼 + 기본 비교 시점 결정 로직 |
| `src/components/chat/chat-panel.tsx` | `include_history` 유형 선택 시 과거 본문 주입 |

## 작업 내용

1. **`git_show_file` 커맨드 신설** — 특정 커밋의 특정 파일 **내용**을 반환하는
   읽기 전용 Tauri 커맨드. 현재 없음(확인됨 — `git_show`(L385)는 커밋 메타데이터+변경
   요약만, `loadFileDiff`는 diff만, `restoreFileFromCommit`은 working tree 변경+커밋이라
   재사용 불가). 해당 커밋에 파일이 없으면 "존재하지 않음"을 구분해 반환(에러와 구분).
   TS 래퍼를 git-history.ts 스타일로 추가.
2. **기본 비교 시점 결정** — 사용자가 시점을 고르지 않았을 때(Step 09 이전엔 항상):
   HEAD~1이 아니라 **그 파일 내용이 현재(working tree)와 달라지는 가장 최근 커밋**을 쓴다.
   `git log -- <path>`를 최근부터 따라가며 각 커밋의 내용(`git_show_file`)을
   working tree 내용과 비교, 처음으로 달라지는 커밋을 채택.
   - HEAD~1 고정은 마지막 커밋이 다른 페이지만 바꿨을 때 "변화 없음"(zero_residue)
     오답을 낸다 — 이것이 이 로직의 존재 이유.
   - 파일별로 결정한다(후보 섹션마다 대상 파일이 다름).
3. **컨텍스트 주입** — `retrieval.includeHistory === true`인 유형이 선택됐을 때만
   (Step 04 플래그, type id 하드코딩 금지):
   현재 section 후보 각각에 대응하는 **과거 버전 본문**을 system prompt에 함께 넣는다.
   블록 형식은 Citation Sections와 구분되는 "Previous Version" 류 블록으로,
   어느 시점(커밋 날짜)의 내용인지 명시한다.
   - 과거 시점에 파일이 없으면 "당시 존재하지 않음"으로 주입.
   - 커밋이 하나도 없으면(Sync 미실행) 주입 없음 → 기존 "과거 정보 없음" 규칙.
4. **섹션 대응** — 과거 본문에서 현재 후보 섹션을 찾을 때 `sectionId`(`{#sec-ULID}`)가
   본문에 박혀 있으므로 ID로 대응한다. rename/split 추적(`git log --follow`,
   `git log -S "sec-..."`)은 **미결정 과제로 이 Step 범위 밖** — 파일 경로 동일 가정으로
   시작한다.
5. **테스트 작성** — 기본 시점 결정 로직(마지막 커밋이 무관한 파일만 바꾼 경우
   그 이전 커밋 채택), 파일 부재 시 "당시 존재하지 않음" 처리.

## 완료 조건 (정적 확인)

- [x] `git_show_file` Rust 커맨드 + TS 래퍼가 있고 읽기 전용이다(working tree 무변경).
- [x] 기본 비교 시점이 "파일 내용이 달라지는 가장 최근 커밋"으로 구현되어 있다
      (HEAD~1 고정 아님).
- [x] 비교의 "현재"가 working tree 내용이다.
- [x] 주입이 `includeHistory` 플래그로만 분기한다.
- [x] 파일 부재/커밋 없음 경로가 처리되어 있다.
- [x] 테스트가 작성되어 있다.

## Step 14 이월 검증

- version_comparison 질문 시 프롬프트에 과거 본문 블록이 실리는지.
- 마지막 커밋이 다른 페이지만 바꾼 상황에서 zero_residue 오답이 나지 않는지.
- Sync 미실행 프로젝트에서 "과거 정보를 확인할 수 없다" 답변이 유지되는지.
