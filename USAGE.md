# USAGE — IDEA Part 2 (검색) 사용 가이드

[IDEA.md](IDEA.md) Part 2 — **배제 기반 검색**의 1-page 사용법.
이론적 배경은 [IDEA.md §2](IDEA.md#2-2차-산출물에-대한-검색)를, 구현 단계는
[second-development-plan.md](second-development-plan.md)를 참조한다.

---

## 1. 프로젝트에 question_type 추가하기

Part 2 검색은 모든 질문을 먼저 **질문 유형**으로 분류한 뒤, 그 유형에서 무관한
문서를 사전 배제한다. 새 프로젝트는 `question_types/` 디렉토리만 비어 있는 상태로
부트스트랩되며, 사용자가 직접 채워야 한다.

세 가지 방법.

1. **schema/question_types/에서 복사.** Part 2 MVP 단계에서 game-dev 도메인 기준
   예시 5~6개를 [schema/question_types/](schema/question_types/)에 두었다.
   적절한 파일을 골라 프로젝트의 `question_types/`에 그대로 복사하면 된다.

2. **직접 작성.** [IDEA.md §2.3](IDEA.md#23-질문-유형)의 12개 유형을 참고해
   프로젝트 도메인에 맞게 작성한다. 파일 stem이 `typeId`로 쓰인다 — kebab/snake
   모두 허용되지만 일관성을 유지하라.

3. **점진 추가.** 처음에는 1~2개로 시작해도 무방하다. 분류기에 후보가 적을수록
   분류 정확도가 올라간다 — 12개를 모두 채울 의무는 없다.

각 파일이 정의해야 할 항목:

```md
---
title: 사람이 읽는 이름
---

# 사람이 읽는 이름

이 유형이 어떤 질문을 다루는가에 대한 한두 문단.

## Input
이 유형 질문이 가져야 하는 정보 (조건 / 트리거 / 비교 대상 등).

## Output
이 유형이 기대하는 답의 형태.

## Zero residue
잔존 0의 의미. 이 유형에서 0개 결과가 무엇을 의미하는가 — IDEA §2.10.
```

`## Zero residue` 섹션이 있으면 검색 결과가 0개일 때 그 텍스트가 응답으로 출력되며
LLM은 호출되지 않는다 (긍정적 신호인 0과 "검색 실패"인 0을 구분하기 위해).

---

## 2. exclusions를 작성하는 4가지 방법

배제 지도는 `exclusions/` 트리에 사람이 읽고 수정 가능한 markdown으로 누적된다.
다음 4가지 경로로 entry가 추가된다.

### 2.1 직접 작성

```text
exclusions/by_question_type/<typeId>.md     (Level 2 — 유형별 패턴)
exclusions/axioms/<name>.md                 (Level 3 — 유형 횡단 axiom)
```

[IDEA.md §2.4](IDEA.md#24-질문-유형-기반-배제)의 예시 형식을 그대로 따른다.
적용은 새로 만든 파일이 디스크에 있는 즉시 — 다음 chat send부터 반영된다.

### 2.2 Promotion (instance → pattern/axiom)

매 chat send가 `exclusions/instances/<YYYY-MM>/q-...md`에 trace를 기록한다 (Level 1).
사이드바의 promotion view는 instance를 집계해 **임계값을 넘은 (typeId, path) 쌍**을
승격 후보로 노출한다. 카드의 [Promote to Pattern] 또는 [Promote to Axiom]을 클릭하면
사람의 결정으로 Level 2/3에 entry가 append된다.

임계값은 `exclusions/promotion_rules.md`의 `pattern_min_count`로 조절 가능 (기본 5).
**자동 승격은 없다** — 빈도는 신호이며 사람의 명시적 승인이 항상 필요하다 (§2.6).

### 2.3 Archive

기존 entry가 잘못된 배제임이 드러나면 카드의 [Archive] 버튼으로 무효화한다.
파일은 보존되며 (`archived: true` 마킹) git 이력으로 추적 가능. [Restore]로 되살릴 수 있다.

### 2.4 Counterexample 마킹

assistant 메시지의 결과 카드에서 "이 결과를 정답으로 표시"를 클릭하면, 그 path를
**다른 유형의 검색**에서 배제해놨던 entry가 있을 경우 자동으로 `needs_review: true`로
표시된다. 추적 가능한 반례를 통해 잘못된 배제를 사람에게 다시 묻는다.

---

## 3. 신선도/무효화는 언제 일어나나

배제 지도가 영원히 굳지 않게 하는 4가지 메커니즘 (IDEA §2.8 / Stage 14).

1. **출처 의존성** — entry의 `sources:`에 인용된 source 파일이 git에서 수정되면
   해당 entry는 자동으로 `needs_review: true`로 전환된다.
2. **신선도** — axiom의 `last_validated_at`이 `freshness_days` (기본 90일)를
   초과하면 Lint view에 stale 경고로 표시된다. 카드의 [Mark validated] 버튼으로
   `last_validated_at`을 갱신할 수 있다.
3. **반례 발견** — 2.4 참조. 사람이 결과를 정답으로 마킹할 때 트리거.
4. **명시적 폐기** — 2.3 참조. 사람이 직접 archive.

신선도·무효화는 사람의 review 큐를 키울 뿐, 자동으로 배제를 풀거나 새로 만들지 않는다.

---

## 4. 검색 trace 읽기

chat assistant 메시지 위 collapsible 블록은 다음을 보여준다.

```
판정된 유형: 조건 기반 가상 테스트  (confidence 0.85)
적용된 배제: 47개 중 21개 제거
  - condition_based_test.md → 21
탐색 시작 후보: 26개
결과: 1개
  → "SafeZone 내 공격성 스킬 차단"
근거: instance_server_design.md > section 3.2
```

- **판정된 유형이 null**이면 분류기가 매칭에 실패한 것 — 배제는 적용되지 않고
  전체 `db/` 트리가 검색된다 (fallback).
- **적용된 배제가 비어 있다**면, 해당 typeId에 대해 pattern/axiom이 아직 없거나
  매칭된 문서가 0개라는 의미.
- **잔존 0개**일 때는 `question_types/<id>.md`의 `## Zero residue` 텍스트가
  응답으로 사용된다 (LLM 호출 생략).

---

## 5. 관련 파일

- [IDEA.md](IDEA.md) — Part 2 설계 원리 (§2.1~§2.10)
- [PLAN.md](PLAN.md) — 파일 시스템 / 모듈 매핑 (§10)
- [second-development-plan.md](second-development-plan.md) — Stage 8~15 구현 가이드
- [schema/question_types/](schema/question_types/) — 사용자가 복사할 question_type 예시
