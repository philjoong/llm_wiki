# Step 14 — 최종 빌드 + 통합 검증

선행 Step: 01–13 전부. **이 Step에서 처음으로 빌드를 실행한다** — 이전 Step들은
빌드 가능 상태를 보장하지 않았으므로, 여기서 컴파일 오류 수정부터 런타임 검증까지
일괄 수행한다.

## 진행 방침 (2026-07-16 확정)

- §1 빌드 + §2 자동 테스트는 개발 측이 수행하고, §3 런타임 통합 검증은
  **사용자가 앱에서 직접 수행**한다(샘플 프로젝트 준비 포함).
- §2의 "전체 통과"에는 Windows 환경 기인 기존 실패 8건의 **수정이 포함**된다:
  - `git_checkout_path`/`git_revert` 테스트 2건 — `core.autocrlf` CRLF 변환으로
    내용 비교 실패("v1\r\n" != "v1\n"). 비교 전 개행 정규화 등으로 환경 무관하게 수정.
  - knowledge 스위트 6건 — 테스트 정리 시 `remove_dir_all` 파일 잠금(code 32).
    재시도/지연 해제 등으로 환경 무관하게 수정.

## 1. 빌드 통과

- [x] `cargo check` / `cargo build` (src-tauri) — Rust 컴파일 오류 0.
      (`cargo check` 통과, `cargo build` dev 프로파일 Finished. 기존 dead-code 경고 5건
      — 미사용 enum variant/struct — 만 잔존, 오류 아님.)
- [x] TS 타입 체크 + 프론트 빌드 (`npm run build`) — 오류 0.
      (`tsc --build` 통과, `vite build` dist 산출. 기존 chunk-size/dynamic-import 경고만 잔존.)
- [ ] Tauri dev 앱 기동 확인 — **§3와 함께 사용자 런타임 세션으로 이월**.
      앱 바이너리 링크(`cargo build`)와 프론트 번들(`vite build`)이 통과하므로 기동 전제는
      충족. 실제 GUI 기동은 디스플레이가 필요한 런타임 동작이라 §3 사용자 검증에서 수행.

빌드 오류 수정은 이 Step의 정규 작업이다. 단, 수정이 특정 Step의 설계를 바꾸면
해당 Step 문서에 변경 내역을 추기한다. (이번엔 설계 변경 없음 — 테스트 하네스만 수정.)

## 2. 자동 테스트 일괄 실행

- [x] `cargo test` — Step 01(predicate 필터) 포함 전체 통과.
      (lib 66 passed / 0 failed / 1 ignored(PDF probe), main 0, doc-test 0. Windows 기인
      기존 실패 8건을 아래대로 환경 무관하게 수정해 이 머신에서 실제 전체 통과 달성.)
- [x] vitest 전체 통과 — Step 02/03/04/05/07/08/10/11/12/13에서 작성한 테스트 포함.
      (840 passed / 0 failed, 41 skip은 `RUN_LLM_TESTS` 게이트. 전체 스위트 12연속 반복
      실행 0 실패로 flaky 회귀 없음 확인.)

### 개발 측 수정 내역 (2026-07-16)

Windows 환경 기인 실패 및 발견된 flaky 테스트를 **테스트 하네스 수정만으로** 해결
(프로덕션 코드·Step 설계 무변경).

- **`git_checkout_path`/`git_revert` CRLF 2건** (`git_ops.rs`) — `core.autocrlf=true`(Windows
  git 기본)가 checkout 시 `\n`→`\r\n` 변환하는 문제. 비교 전 `\r\n`→`\n` 정규화로 수정.
- **knowledge 스위트 `remove_dir_all`(code 32) 6건** (`knowledge/tests.rs`) — **근본 원인은
  파일 잠금 지연이 아니라 연결 누수**였다. 각 실패 테스트가 `Connection`/`open_project`
  핸들을 스코프에 살린 채 정리(`remove_dir_all`)를 호출 → SQLite 파일이 열린 상태라
  삭제가 500ms 내내 실패. **정리 직전 `drop(conn/c/db)`** 로 연결을 먼저 닫아 수정.
  더불어 공용 `cleanup()` 헬퍼(짧은 백오프 재시도)로 OS 핸들 해제 지연에도 견고화.
- **`integrity_reports…` orphan 경로 1건** (`knowledge/tests.rs`) — 기대 경로를
  `dir.join("db/.page.operation.tmp")`(리터럴 `/` 잔존)로 만들어, `read_dir`가 내는
  OS 네이티브 구분자(Windows 백슬래시)와 불일치. `dir.join("db").join(".page.operation.tmp")`
  로 컴포넌트를 분리 결합해 수정.
- **ingest-queue 통합 테스트 flaky 3개소** (`ingest-queue.integration.test.ts`) — 전체
  스위트 병렬 실행 시에만 재현. `enqueueBatch`의 fire-and-forget `processNext`가 큐 파일을
  다시 쓰는(→"processing") 중 truncate 순간에, 외부 리더/`restoreQueue`의 `loadQueue`가
  잘린 파일을 읽어 `JSON.parse` 실패를 빈 큐로 삼킴. `waitFor` 가드 **안에서** 파싱값을
  포착하거나, restore를 카운트 도달까지 재시도하도록 하여 안정화(프로덕션 write는
  단일 이벤트 루프라 실제 앱에서는 이 중첩이 발생하지 않음 — 하네스 관측 방식 아티팩트).

## 3. 런타임 통합 검증 (각 Step에서 이월된 항목)

샘플 게임 문서 여러 건을 ingest하고 Sync를 2회 이상 수행한 프로젝트를 준비한 뒤 진행.

### Phase 1 — 유형별 retrieval + JSON
- [ ] (S06) ingest 후 `DEPENDS_ON`류 assertion이 graph 탭에 생성된다.
- [ ] (S01/S04) `change_impact` 질문 시 traversal 요청에 dependency predicate 목록이
      실리고, 서사 엣지(`ATTACKS` 등)가 경로에 나타나지 않는다.
- [ ] (S02) lexical 매칭 안 되는 섹션이 traversal 경유로 citation 후보에 추가된다.
      `graph_expand: 0`(version_comparison) / 일반 질문은 기존과 동일(회귀).
- [ ] (S03) `related_content` 질문에서 프롬프트에 방향 보존 경로 라인(`A --PRED--> B`)이
      실리고, 답변 `relation_paths`가 경로를 citation과 함께 서술한다.
      그래프에 관계가 없으면 블록이 비고 empty-state 규칙 유지.
- [ ] (S04) `new_system_impact` 질문 시 LLM 추출 엔티티가 `seedEntityIds`로 실린다.
- [ ] (S05) JSON 파싱 성공 → 필드별 카드 / 실패 → 원본 fallback. 카드 안 citation 링크
      동작. 대화 리로드 후 카드 유지. 스트리밍 중 원본 표시.

### Phase 2 — scope
- [ ] (S07) 범위를 시스템 A로 한정 → 시스템 B 페이지가 citation 후보/그래프 컨텍스트에서
      제외(실제 retrieval 결과로 확인). 미선택 시 전체(회귀).
- [ ] (S07) 범위 선택기가 change_impact에서는 안 뜨고 나머지 세 유형에서 뜬다
      (플래그 분기 확인).

### Phase 3 — version_comparison
- [ ] (S08) version_comparison 질문 시 과거 본문 블록이 주입되고 답변이 실제 차이를
      서술한다. 비교의 "현재"가 working tree 내용이다.
- [ ] (S08) 마지막 커밋이 다른 페이지만 바꾼 상황에서 zero_residue 오답이 나지 않는다.
- [ ] (S08) Sync 미실행 프로젝트 → "과거 정보를 확인할 수 없다" 답변.
- [ ] (S09) 시점 선택기가 version_comparison에서만 노출, 날짜/시간 중심 표시(해시 숨김).
      과거 시점 선택 → 그 시점 기준 비교. 시점이 대화 단위로 유지된다.

### Phase 4 — 역질문 루프
- [ ] (S10) 위키에 없는 정보를 요구하는 질문 → `information_requests` 생성(환각 없음),
      각 요청이 `required_info` 항목에 대응.
- [ ] (S11) 폼으로 답 → 다음 턴 답변에 반영, 같은 항목 재질문 없음.
- [ ] (S11) 모든 미충족 항목 "없음/모름" 마킹 → 재질문 없이 가진 정보로 답하고 한계 명시.
- [ ] (S11) `file`/`link` 제출 → ingest 완료 배지 → 재전송 시 citation 반영.
- [ ] (S12) "위키에 저장" → 위치 제안·승인 → 섹션 + assertion(`origin: user_chat`) 생성
      → **새 대화**에서 같은 질문 시 역질문 없이 citation과 함께 답한다(루프 완성).

### Phase 5 — embedding
- [ ] (S13) 동의어/개념 질문이 embedding 경유로 후보에 들어온다 — new_system_impact에서
      명칭이 다른 유사 시스템이 상위 노출.
- [ ] (S13) embedding off → 기존과 완전히 동일(회귀). 페이지 삭제 시 embedding 연동 삭제.

## 4. 완료 조건

위 체크리스트 전부 통과. 실패 항목은 원인 Step을 특정해 수정 후 해당 항목만 재검증한다.
전 항목 통과 시점이 rest-fix-plan의 최종 목표 달성 시점이다.
