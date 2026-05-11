/**
 * Stage 15 — Part 2 end-to-end scenarios.
 *
 * Each scenario walks the search pipeline from a freshly-bootstrapped
 * project through 5 chat-driven `runExcludeSearch` calls, then a
 * `analyzePromotionCandidates` → `promoteToAxiom` step, then one final
 * `runExcludeSearch` that should show the new axiom in its trace.
 *
 * Unlike the data-driven scenarios in `search-scenarios.ts` (Part 1
 * `searchWiki` ranking), these are SEQUENCED — each step depends on
 * disk state mutated by the previous step. The runner in
 * `exclude-search.scenarios.test.ts` drives them step-by-step.
 *
 * LLM responses (the classifier's JSON) are pre-baked per step; nothing
 * here makes a real network call. Git commits are stubbed at the runner
 * level — the scenario only asserts file content.
 */

/** One chat send. The runner mocks streamChat to emit `classifierResponse`. */
export interface ExcludeSearchStep {
  /** Human-readable label used in test output. */
  label: string
  /** Question text the chat-user types. */
  query: string
  /** Raw JSON the classifier mock should return for this query. */
  classifierResponse: string
  expected: {
    /** Expected typeId on the trace's judgedType (null when classifier said null). */
    judgedTypeId: string | null
    /** Project-relative paths that MUST appear in hits (subset match). */
    hitPathsContain?: string[]
    /** Patterns that MUST appear in trace.appliedEntries (subset match). */
    appliedEntryPatterns?: string[]
    /** Exact residue size after exclusions. */
    residueCount?: number
  }
}

export interface ExcludeSearchScenario {
  name: string
  description: string
  /**
   * Initial project tree. Must seed:
   *   - `db/**` candidate files (with content that real `searchPaths`
   *     will match on the step queries)
   *   - `question_types/<id>.md` for whichever ids the classifier may
   *     return
   *   - `exclusions/exclusion_schema.md`, `exclusions/promotion_rules.md`
   *     (the bootstrap seeds — see project-init.ts)
   *   - `exclusions/by_question_type/.gitkeep`, `exclusions/axioms/.gitkeep`,
   *     `exclusions/instances/.gitkeep` (directory placeholders)
   */
  initialWiki: Record<string, string>
  /** Steps before promotion — typically 5 queries (4 same hit + 1 different). */
  preSteps: ExcludeSearchStep[]
  /** Threshold override the runner passes to analyzePromotionCandidates. */
  patternMinCount: number
  /** What the runner expects from analyzePromotionCandidates. */
  promotion: {
    /** The (typeId, path) pair that must surface as the top candidate. */
    typeId: string
    path: string
    /** Name passed to promoteToAxiom — produces `exclusions/axioms/<name>.md`. */
    axiomName: string
    /** Substrings the runner asserts in the newly-written axiom file. */
    axiomFileContains: string[]
  }
  /** Steps after promotion — typically 1 query verifying the axiom fires. */
  postSteps: ExcludeSearchStep[]
}

const CLASSIFIER_CBT = JSON.stringify({
  typeId: "condition_based_test",
  confidence: 0.85,
  reasoning: "조건 기반 가상 동작 판정",
})

// IDEA §2.3 — the 12 named types. The scenario only seeds 3 to keep the
// classifier prompt short, but the schema/question_types/ examples cover
// more for the user-facing copy-from-schema flow.
const QT_CONDITION_BASED_TEST = `---
title: 조건 기반 가상 테스트
---

# 조건 기반 가상 테스트

특정 조건/상호작용에서 게임 시스템이 어떻게 동작해야 하는지를 가상으로 검증한다.

## Input

- 조건 (어떤 상황에서)
- 트리거 (어떤 행위가 일어나면)
- 기대 결과 (어떻게 동작해야 하는가)

## Output

- 규칙/문서/정책 인용
- 동작 명세 또는 명세 공백 (residue 0)

## Zero residue

잔존 0 = 명세 공백. 이 조건에 대한 규칙이 wiki 어디에도 정의되어 있지 않다는 신호.
`

const QT_POLICY_VIOLATION = `---
title: 정책 위반 탐지
---

# 정책 위반 탐지

사용자/운영 정책에 위반되는 동작·콘텐츠를 식별한다.

## Zero residue

잔존 0 = 위반 없음 (긍정적 신호).
`

const QT_REGRESSION_TEST = `---
title: 회귀 테스트
---

# 회귀 테스트

이전 패치/변경 이후 깨질 가능성이 있는 영역을 식별한다.

## Zero residue

잔존 0 = 영향 없음.
`

// Seeds from project-init.ts — copied verbatim so the scenario stays
// runnable even if those constants change shape later. The runner doesn't
// re-bootstrap; it just lays these on disk.
const EXCLUSION_SCHEMA_MD = `# 배제 좌표계

검색 시작 시 후보 공간을 축소하는 정적 배제 규칙의 좌표계와 적용 순서.
사람이 자유 편집 가능한 plain markdown.
`

const PROMOTION_RULES_MD = `# 승격 규칙

instance(Level 1) → pattern(Level 2) → axiom(Level 3) 승격 기준.

## 임계값

- \`pattern_min_count: 4\` — 동일 (typeId, path) 쌍이 instance에 4회 누적되면 후보로 노출.
- \`freshness_days: 90\` — axiom의 last_validated_at이 90일 초과하면 stale.

승격은 자동이 아니다. 빈도 신호 + 사람의 명시적 승인을 결합한다.
`

export const partTwoMvpScenarios: ExcludeSearchScenario[] = [
  {
    name: "game-dev/condition-based-promotion",
    description:
      "Game-dev project. 5 condition-based-test questions are sent. The first " +
      "4 all return db/systems/instance_server/server_structure.md as the top " +
      "hit (infra repeatedly surfaces for behavior questions); the 5th hits a " +
      "different file. analyzePromotionCandidates surfaces 1 candidate (count=4). " +
      "Promoting to an axiom adds an entry under exclusions/axioms/infra_structure.md. " +
      "The post-promotion query shows that axiom firing in the trace and the " +
      "infra file no longer in the residue.",
    initialWiki: {
      "purpose.md": "# Purpose\n\nGame-dev wiki for an MMORPG.\n",
      "schema.md": "# Schema\n\nSee schema/game-dev-example.md.\n",

      // Question types — the classifier picks one of these by id.
      "question_types/condition_based_test.md": QT_CONDITION_BASED_TEST,
      "question_types/policy_violation.md": QT_POLICY_VIOLATION,
      "question_types/regression_test.md": QT_REGRESSION_TEST,

      // Exclusion seeds — empty by_question_type/axioms but the schema +
      // promotion_rules files exist so analyzePromotionCandidates reads
      // the threshold we wrote (pattern_min_count: 4).
      "exclusions/exclusion_schema.md": EXCLUSION_SCHEMA_MD,
      "exclusions/promotion_rules.md": PROMOTION_RULES_MD,
      "exclusions/by_question_type/.gitkeep": "",
      "exclusions/axioms/.gitkeep": "",
      "exclusions/instances/.gitkeep": "",

      // db/ candidate space. The infra file deliberately contains keywords
      // that all 4 pre-step queries hit — exactly the situation that should
      // raise a promotion candidate (real wiki has an "infra spam" that
      // shouldn't have been surfaced for condition-based questions).
      "db/systems/instance_server/server_structure.md":
        "---\ntitle: 인스턴스 서버 구조\n---\n\n" +
        "# 인스턴스 서버 구조\n\n" +
        "인스턴스 서버는 채널마다 별도 프로세스로 동작한다. " +
        "메인 서버와 gRPC로 통신하며 동작 조건을 처리한다. " +
        "통신 채널 프로세스 동작 조건 처리 인스턴스 서버 구조.\n",
      "db/policies/safezone.md":
        "---\ntitle: SafeZone 정책\n---\n\n" +
        "# SafeZone 정책\n\n" +
        "SafeZone 내에서는 공격성 스킬이 차단된다. " +
        "보호 구역 안에서 공격 행위는 제한된다.\n",
      "db/systems/combat/damage_formula.md":
        "---\ntitle: 데미지 공식\n---\n\n" +
        "# 데미지 공식\n\n" +
        "최종 데미지는 공격력에서 방어력을 차감한다.\n",
      "db/world/dungeons/dungeon_a/spawn_rules.md":
        "---\ntitle: 던전 A 스폰 규칙\n---\n\n" +
        "# 던전 A 스폰 규칙\n\n" +
        "보스는 60초 간격으로 5곳 랜덤 위치에 스폰된다.\n",
    },
    preSteps: [
      // 4 distinct condition-based-test questions that all happen to hit
      // the infra file via shared "인스턴스 서버" tokens. The scenario is
      // illustrative — in a real project the spam file would be a true
      // infra page repeatedly surfaced by behavior-focused questions.
      {
        label: "Q1: 인스턴스 서버 구조 동작 조건은?",
        query: "인스턴스 서버 구조 동작 조건은?",
        classifierResponse: CLASSIFIER_CBT,
        expected: {
          judgedTypeId: "condition_based_test",
          hitPathsContain: ["db/systems/instance_server/server_structure.md"],
        },
      },
      {
        label: "Q2: 인스턴스 서버 채널 프로세스 처리는?",
        query: "인스턴스 서버 채널 프로세스 처리는?",
        classifierResponse: CLASSIFIER_CBT,
        expected: {
          judgedTypeId: "condition_based_test",
          hitPathsContain: ["db/systems/instance_server/server_structure.md"],
        },
      },
      {
        label: "Q3: 인스턴스 서버 통신 동작은?",
        query: "인스턴스 서버 통신 동작은?",
        classifierResponse: CLASSIFIER_CBT,
        expected: {
          judgedTypeId: "condition_based_test",
          hitPathsContain: ["db/systems/instance_server/server_structure.md"],
        },
      },
      {
        label: "Q4: 인스턴스 서버 동작 조건 처리는?",
        query: "인스턴스 서버 동작 조건 처리는?",
        classifierResponse: CLASSIFIER_CBT,
        expected: {
          judgedTypeId: "condition_based_test",
          hitPathsContain: ["db/systems/instance_server/server_structure.md"],
        },
      },
      // Step 5: a different question that hits safezone.md, NOT the infra
      // file — gives a non-promotion-worthy second pair.
      {
        label: "Q5: SafeZone 보호 구역 차단 규칙은?",
        query: "SafeZone 보호 구역 차단 규칙은?",
        classifierResponse: CLASSIFIER_CBT,
        expected: {
          judgedTypeId: "condition_based_test",
          hitPathsContain: ["db/policies/safezone.md"],
        },
      },
    ],
    patternMinCount: 4,
    promotion: {
      typeId: "condition_based_test",
      path: "db/systems/instance_server/server_structure.md",
      axiomName: "infra_structure",
      axiomFileContains: [
        "applies_to: [condition_based_test]",
        "db/systems/instance_server/server_structure.md",
        "instance 4회 누적",
      ],
    },
    postSteps: [
      // Same Q1 again — after promotion, the axiom's pattern should fire
      // and the infra file should be excluded from the residue.
      {
        label: "Post: same Q1 after axiom promotion",
        query: "인스턴스 서버 구조 동작 조건은?",
        classifierResponse: CLASSIFIER_CBT,
        expected: {
          judgedTypeId: "condition_based_test",
          appliedEntryPatterns: [
            "db/systems/instance_server/server_structure.md",
          ],
        },
      },
    ],
  },
]
