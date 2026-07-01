import type { IngestScenario } from "./types"

/**
 * Ingest scenarios drive autoIngest end-to-end.
 *
 * Stage 1 now decides page_path per section and emits verbatim source
 * text directly — sections with a page_path go straight to Stage 3
 * (buildFileBlocksFromSections), which builds FILE content from the
 * section body/frontmatter without a second LLM call. `analysisResponse`
 * therefore uses the SECTION delimiter format:
 *
 *   ---SECTION: source_range | db/path/to/page.md---
 *   (verbatim source text for this section)
 *   ---END SECTION---
 *
 * `generationResponse` is legacy (Stage 2 FILE/REVIEW block format) and is
 * only consumed when a section has no page_path — leave it "" for
 * scenarios where every section carries one.
 */

const BASIC_PURPOSE = `# Purpose

This wiki tracks deep-learning research concepts.
`

const BASIC_INDEX = `# Index

## Concepts
- [[attention]]
`

const BASIC_SCHEMA = `# Schema

## db/sources/
Each ingested source has a summary page here.

## db/concepts/
Each concept gets its own page.
`

export const ingestScenarios: IngestScenario[] = [
  // 1. basic-new-source — new concept wiki page + source summary, no reviews
  {
    name: "basic-new-source",
    description:
      "Stage 2 emits a single concept page + a source summary page. No " +
      "REVIEW blocks. The runner must see both files on disk and zero " +
      "reviews in the store.",
    initialWiki: {
      "purpose.md": BASIC_PURPOSE,
      "schema.md": BASIC_SCHEMA,
      "db/index.md": BASIC_INDEX,
    },
    source: {
      path: "raw/sources/rope-paper.md",
      content: [
        "# Rotary Position Embedding",
        "",
        "Rotary Position Embedding (RoPE) encodes positional information by",
        "rotating pairs of dimensions in query and key vectors. It naturally",
        "supports variable-length contexts and is now standard in LLMs.",
      ].join("\n"),
    },
    // Stage 1 now decides page_path directly and emits verbatim source text
    // per SECTION — there is no separate Stage 2 "generation" call when
    // every section carries a page_path, so this scenario's file content
    // comes entirely from buildFileBlocksFromSections(), not from LLM prose.
    analysisResponse: [
      "---SECTION: Rotary Position Embedding | db/concepts/rope.md---",
      "RoPE rotates pairs of dimensions in [[attention]] queries and keys",
      "to encode absolute position while preserving relative-position invariance.",
      "---END SECTION---",
      "",
      "---SECTION: Source: rope-paper.md | db/sources/rope-paper.md---",
      "Paper introducing [[Rotary Position Embedding]].",
      "---END SECTION---",
    ].join("\n"),
    generationResponse: "",
    expected: {
      writtenPaths: [
        "db/concepts/rope.md",
        "db/sources/rope-paper.md",
      ],
      fileContains: {
        "db/concepts/rope.md": [
          "title: Rotary Position Embedding",
          "[[attention]]",
        ],
        "db/sources/rope-paper.md": ["rope-paper.md"],
      },
      // No graph policy is seeded for this scenario, so Stage 2 (graph
      // assignment) has no managed graphs to assign triples to — it
      // reports back a "no graph assignments produced" suggestion. This
      // is orthogonal to what this scenario actually tests (file writing).
      reviewsCreated: [
        { type: "suggestion", titleContains: "no graph assignments produced" },
      ],
    },
  },

  // 2. references-existing-wikilinks — generated pages link to existing pages
  {
    name: "references-existing-wikilinks",
    description:
      "The generated wiki page must include [[attention]] — linking back " +
      "to a page that already exists in the wiki. Runner asserts substring.",
    initialWiki: {
      "purpose.md": BASIC_PURPOSE,
      "schema.md": BASIC_SCHEMA,
      "db/index.md": BASIC_INDEX,
      "db/attention.md":
        "---\ntitle: Attention\n---\n\n# Attention\n\nThe attention mechanism.\n",
    },
    source: {
      path: "raw/sources/multi-head.md",
      content: "# Multi-Head Attention\n\nParallel attention heads.\n",
    },
    analysisResponse: [
      "---SECTION: Multi-Head Attention | db/concepts/multi-head-attention.md---",
      "Multi-head [[attention]] runs several attention layers in parallel.",
      "---END SECTION---",
      "",
      "---SECTION: Source: multi-head.md | db/sources/multi-head.md---",
      "Source for multi-head [[attention]].",
      "---END SECTION---",
    ].join("\n"),
    generationResponse: "",
    expected: {
      writtenPaths: [
        "db/concepts/multi-head-attention.md",
        "db/sources/multi-head.md",
      ],
      fileContains: {
        "db/concepts/multi-head-attention.md": ["[[attention]]"],
      },
      // No graph policy seeded — Stage 2 reports "no graph assignments
      // produced" rather than actually assigning triples. See scenario 1.
      reviewsCreated: [
        { type: "suggestion", titleContains: "no graph assignments produced" },
      ],
    },
  },

  // 3. game-dev/instance-server — Stage 3 decomposition into db/ paths.
  //
  // The source document mixes 4 distinct semantic units that schema.md
  // routes to 4 different db/ subtrees. The ingest pipeline must:
  //   - emit one db/ FILE block per semantic unit
  //   - frontmatter `sources` carries `file:` + `range:` pointing back
  //     to the heading of the contributing section
  // (1차 가공 happens at import time now and produces raw/sources/<name>.md
  //  before ingest runs, so there is no separate processed_1 step.)
  {
    name: "game-dev/instance-server",
    description:
      "A raw game-dev design doc decomposes into 4 db/ pages. Asserts " +
      "both the file layout and the SourceRef shape in each page's " +
      "frontmatter.",
    initialWiki: {
      "purpose.md": "# Purpose\n\nGame-dev design wiki for an MMORPG.\n",
      "schema.md":
        "# Schema (excerpt)\n\n" +
        "- db/systems/instance_server/server_structure.md\n" +
        "- db/content/dungeons/{dungeon_id}/entry_rules.md\n" +
        "- db/content/dungeons/{dungeon_id}/rewards.md\n" +
        "- db/content/dungeons/{dungeon_id}/spawn_rules.md\n",
    },
    source: {
      path: "raw/instance_server_design.md",
      content: [
        "# 인스턴스 서버 설계",
        "",
        "## 1. 서버 구조",
        "- 인스턴스 서버는 채널마다 별도 프로세스로 동작.",
        "- 메인 서버와 gRPC로 통신.",
        "",
        "## 2. 던전 A — 입장 규칙",
        "- 레벨 50 이상 입장 가능.",
        "- 파티 4인 필수.",
        "",
        "## 3. 던전 A — 보상",
        "- 클리어 시 골드 1000 + 장비 박스 1개.",
        "- 주간 1회 추가 보상.",
        "",
        "## 4. 던전 B — 스폰 규칙",
        "- 보스는 60초 간격으로 스폰.",
        "- 스폰 위치는 5곳 랜덤.",
      ].join("\n"),
    },
    analysisResponse: [
      "---SECTION: ## 1. 서버 구조 | db/systems/instance_server/server_structure.md---",
      "채널마다 별도 프로세스로 동작하며, 메인 서버와 gRPC로 통신한다.",
      "---END SECTION---",
      "",
      "---SECTION: ## 2. 던전 A — 입장 규칙 | db/content/dungeons/dungeon_a/entry_rules.md---",
      "- 레벨 50 이상 입장 가능",
      "- 파티 4인 필수",
      "---END SECTION---",
      "",
      "---SECTION: ## 3. 던전 A — 보상 | db/content/dungeons/dungeon_a/rewards.md---",
      "- 클리어 시 골드 1000 + 장비 박스 1개",
      "- 주간 1회 추가 보상",
      "---END SECTION---",
      "",
      "---SECTION: ## 4. 던전 B — 스폰 규칙 | db/content/dungeons/dungeon_b/spawn_rules.md---",
      "- 보스는 60초 간격으로 스폰",
      "- 스폰 위치는 5곳 랜덤",
      "---END SECTION---",
    ].join("\n"),
    generationResponse: "",
    expected: {
      writtenPaths: [
        "db/systems/instance_server/server_structure.md",
        "db/content/dungeons/dungeon_a/entry_rules.md",
        "db/content/dungeons/dungeon_a/rewards.md",
        "db/content/dungeons/dungeon_b/spawn_rules.md",
      ],
      fileContains: {
        "db/content/dungeons/dungeon_a/rewards.md": [
          "file: instance_server_design.md",
          "## 3. 던전 A — 보상",
          "골드 1000",
        ],
        "db/systems/instance_server/server_structure.md": [
          "file: instance_server_design.md",
          "gRPC",
        ],
      },
      // No graph policy seeded — Stage 2 reports "no graph assignments
      // produced" rather than actually assigning triples. See scenario 1.
      reviewsCreated: [
        { type: "suggestion", titleContains: "no graph assignments produced" },
      ],
    },
  },

  // 4. chinese-source — Chinese content flows through to Chinese wiki pages
  {
    name: "chinese-source",
    description:
      "Chinese-language source document; LLM responses in Chinese. " +
      "UTF-8 round-trip through file write must be clean.",
    initialWiki: {
      "purpose.md": "# 用途\n\n深度学习研究笔记。\n",
      "schema.md": BASIC_SCHEMA,
      "db/index.md": "# 索引\n\n- [[注意力机制]]\n",
    },
    source: {
      path: "raw/sources/transformer-survey.md",
      content: "# Transformer 综述\n\nTransformer 是一种基于注意力机制的神经网络架构。\n",
    },
    analysisResponse: [
      "---SECTION: Transformer | db/concepts/transformer.md---",
      "Transformer 是一种基于 [[注意力机制]] 的神经网络架构。",
      "---END SECTION---",
      "",
      "---SECTION: Source: transformer-survey.md | db/sources/transformer-survey.md---",
      "关于 [[Transformer]] 的综述。",
      "---END SECTION---",
    ].join("\n"),
    generationResponse: "",
    expected: {
      writtenPaths: [
        "db/concepts/transformer.md",
        "db/sources/transformer-survey.md",
      ],
      fileContains: {
        "db/concepts/transformer.md": [
          "title: Transformer",
          "[[注意力机制]]",
        ],
      },
      // No graph policy seeded — Stage 2 reports "no graph assignments
      // produced" rather than actually assigning triples. See scenario 1.
      reviewsCreated: [
        { type: "suggestion", titleContains: "no graph assignments produced" },
      ],
    },
  },
]
