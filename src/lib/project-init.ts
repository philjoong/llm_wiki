import { copyFile, createDirectory, writeFile } from "@/commands/fs"
import { gitInit } from "@/commands/git"

/**
 * System prefix directories the ingest pipeline writes into. These must
 * always exist by the time any ingest runs, regardless of what the
 * user-selected schema.md says. ingest's sandbox check
 * (`isSafeIngestPath`) trusts these prefixes, so the bootstrap step
 * here is what makes that trust safe.
 *
 * Stage 8 additions (search side): `question_types/` plus the three
 * `exclusions/<level>/` subtrees. The `exclusions/` parent is created
 * implicitly by `create_dir_all`; its two seed markdown files
 * (`exclusion_schema.md`, `promotion_rules.md`) are written below.
 */
export const SYSTEM_PREFIX_DIRS = [
  "db",
  "processed_1",
  "pending",
  "counterexamples",
  "question_types",
  "exclusions/by_question_type",
  "exclusions/axioms",
  "exclusions/instances",
] as const

/**
 * Seed for `exclusions/exclusion_schema.md` — written once at project
 * bootstrap. Plain markdown, freely editable. The system does not parse
 * this file beyond the existence check; it documents the coordinate
 * system that Stage 9~11 code implements.
 */
export const EXCLUSION_SCHEMA_SEED = `# 배제 좌표계

검색 시작 시 후보 공간을 축소하는 정적 배제 규칙의 좌표계와 적용 순서.
사람이 자유 편집 가능한 plain markdown — 시스템은 이 파일을 직접 파싱하지 않는다.

## 좌표계

배제 규칙은 단일 축 — **질문 유형(question_type)** 위에 묶인다.
질문 본문/키워드 기반의 동적 배제는 두지 않는다 (IDEA.md §2.4 참조).

## 적용 시점

검색 시작 직후 정확히 1회.

\`\`\`
초기 후보 공간 (전체 2차 산출물)
  ↓ [1] 질문 유형 판정 → typeId
  ↓ [2] axiom(applies_to ⊇ {typeId}) + by_question_type/<typeId>.md 적용
줄어든 후보 공간 = 탐색 시작 상태
\`\`\`

## 충돌 규칙

- **axiom > pattern**: 동일 path가 axiom과 pattern 양쪽에서 매칭되면 axiom 근거를
  우선 기록한다. 결과(배제 자체)는 동일하므로 트레이싱 표기만 다르다.
- **archived 제외**: \`archived: true\`로 마킹된 entry는 적용에서 제외. 파일은
  보존되어 git 이력으로 추적된다.
- **누락된 path 무시**: pattern이 매칭한 path가 실제 db/ 트리에 없으면 조용히
  통과한다(에러 아님).
`

/**
 * Seed for `exclusions/promotion_rules.md`. Stage 13's promotion code
 * parses this file with default fallbacks, so the file may be edited or
 * deleted without breaking the pipeline.
 */
export const PROMOTION_RULES_SEED = `# 승격 규칙

instance(Level 1) → pattern(Level 2) → axiom(Level 3) 승격 기준.
사람이 자유 편집 가능한 plain markdown. 값을 바꾸면 다음 promotion 분석부터 반영된다.

## 임계값 (default)

- \`pattern_min_count: 5\` — 동일 (typeId, path) 쌍이 instance에 5회 누적되면
  pattern 후보로 노출
- \`axiom_min_patterns: 3\` — 동일 path가 3개 이상의 typeId에서 pattern으로
  등록되면 axiom 후보
- \`freshness_days: 90\` — axiom의 \`last_validated_at\`이 이 일수를 초과하면
  stale 마킹

## 자동 승격 금지

승격은 자동으로 일어나지 않는다. **빈도는 신호일 뿐 사람의 명시적 승인이 필수**다.
자동 승격은 잘못된 배제를 굳히는 위험이 있다 (IDEA.md §2.6).

## 흐름

1. 검색 1회마다 instance가 \`exclusions/instances/<YYYY-MM>/\` 아래 자동 기록.
2. promotion view에서 임계값을 넘은 후보가 카드로 노출.
3. 사람이 [Promote to Pattern] / [Promote to Axiom] / [Dismiss] 결정.
4. 대상 파일 entry 추가 + 인용된 instance 출처 기록 + git commit.

dismiss된 후보는 \`.llm-wiki/promotion-dismissals.jsonl\`에 기록되어 같은 후보가
다시 임계값을 넘어도 재노출되지 않는다.
`

export interface InitProjectOptions {
  projectPath: string
  schemaSourcePath: string
  purposeMarkdown: string
}

/**
 * Bootstrap a freshly created project directory: ensure the four
 * system-prefix directories exist with `.gitkeep` markers, copy the
 * user-selected schema file in as `schema.md`, and write the
 * user-entered purpose markdown as `purpose.md`.
 *
 * Empty `purposeMarkdown` is allowed (writes a 0-byte purpose.md).
 * Domain-specific subdirectories under `db/...` are not created here —
 * the ingest pipeline emits them on demand based on schema.md content.
 *
 * After files are on disk, `gitInit` runs to create the `.git` repo
 * and an initial commit covering the bootstrap files.
 */
export async function initProject({
  projectPath,
  schemaSourcePath,
  purposeMarkdown,
}: InitProjectOptions): Promise<void> {
  const pp = projectPath.replace(/\/+$/, "")

  for (const dir of SYSTEM_PREFIX_DIRS) {
    const dirPath = `${pp}/${dir}`
    await createDirectory(dirPath)
    await writeFile(`${dirPath}/.gitkeep`, "")
  }

  await writeFile(`${pp}/exclusions/exclusion_schema.md`, EXCLUSION_SCHEMA_SEED)
  await writeFile(`${pp}/exclusions/promotion_rules.md`, PROMOTION_RULES_SEED)

  await copyFile(schemaSourcePath, `${pp}/schema.md`)
  await writeFile(`${pp}/purpose.md`, purposeMarkdown)

  await gitInit(pp)
}
