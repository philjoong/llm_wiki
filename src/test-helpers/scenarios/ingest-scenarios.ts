import type { IngestScenario } from "./types"

/**
 * Ingest scenarios drive autoIngest end-to-end. Two LLM responses per
 * scenario (stage 1 analysis, stage 2 generation with FILE + REVIEW blocks).
 *
 * FILE block format (what stage 2 must emit to write a wiki file):
 *   ---FILE: wiki/path/to/page.md---
 *   (file content, usually with YAML frontmatter)
 *   ---END FILE---
 *
 * REVIEW block format (what stage 2 emits to inject a review item):
 *   ---REVIEW: missing-page | Short title---
 *   Description.
 *   OPTIONS: Approve | Skip
 *   PAGES: page1.md, page2.md
 *   ---END REVIEW---
 *
 * Stage 2 may emit arbitrary prose around blocks — the parser only
 * cares about the delimited blocks.
 */

const BASIC_PURPOSE = `# Purpose

This wiki tracks deep-learning research concepts.
`

const BASIC_INDEX = `# Index

## Concepts
- [[attention]]
`

const BASIC_SCHEMA = `# Schema

## wiki/sources/
Each ingested source has a summary page here.

## wiki/concepts/
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
      "wiki/index.md": BASIC_INDEX,
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
    analysisResponse: [
      "## Key Concepts",
      "- Rotary Position Embedding (RoPE): rotates pairs of dimensions",
      "",
      "## Main Arguments",
      "- RoPE naturally supports variable-length contexts",
      "",
      "## Recommendations",
      "- Create wiki/concepts/rope.md",
      "- Create wiki/sources/rope-paper.md",
    ].join("\n"),
    generationResponse: [
      "I'll create one concept page and the source summary.",
      "",
      "---FILE: wiki/concepts/rope.md---",
      "---",
      "title: Rotary Position Embedding",
      "tags: [positional-encoding]",
      "sources: [rope-paper.md]",
      "---",
      "",
      "# Rotary Position Embedding",
      "",
      "RoPE rotates pairs of dimensions in [[attention]] queries and keys",
      "to encode absolute position while preserving relative-position invariance.",
      "---END FILE---",
      "",
      "---FILE: wiki/sources/rope-paper.md---",
      "---",
      "title: \"Source: rope-paper.md\"",
      "sources: [rope-paper.md]",
      "---",
      "",
      "# Source: rope-paper.md",
      "",
      "Paper introducing [[Rotary Position Embedding]].",
      "---END FILE---",
    ].join("\n"),
    expected: {
      writtenPaths: [
        "wiki/concepts/rope.md",
        "wiki/sources/rope-paper.md",
      ],
      fileContains: {
        "wiki/concepts/rope.md": [
          "title: Rotary Position Embedding",
          "[[attention]]",
        ],
        "wiki/sources/rope-paper.md": ["rope-paper.md"],
      },
      reviewsCreated: [],
    },
  },

  // 2. generates-review-items — REVIEW blocks in generation become store items
  {
    name: "generates-review-items",
    description:
      "Stage 2 emits one FILE and two REVIEW blocks (missing-page + " +
      "suggestion). Both reviews must appear in the store after ingest.",
    initialWiki: {
      "purpose.md": BASIC_PURPOSE,
      "schema.md": BASIC_SCHEMA,
      "wiki/index.md": BASIC_INDEX,
    },
    source: {
      path: "raw/sources/flash-attention.md",
      content:
        "# FlashAttention\n\nFlashAttention is an IO-aware exact attention algorithm.\n",
    },
    analysisResponse: "## Key Concepts\n- FlashAttention\n",
    generationResponse: [
      "---FILE: wiki/sources/flash-attention.md---",
      "---",
      "title: \"Source: flash-attention.md\"",
      "sources: [flash-attention.md]",
      "---",
      "",
      "# Source: flash-attention.md",
      "",
      "FlashAttention is mentioned here.",
      "---END FILE---",
      "",
      "---REVIEW: missing-page | FlashAttention---",
      "The source introduces FlashAttention but no dedicated page exists.",
      "OPTIONS: Create page | Skip",
      "PAGES: wiki/sources/flash-attention.md",
      "---END REVIEW---",
      "",
      "---REVIEW: suggestion | Add IO-aware algorithms survey---",
      "Consider a survey page grouping IO-aware attention variants.",
      "---END REVIEW---",
    ].join("\n"),
    expected: {
      writtenPaths: ["wiki/sources/flash-attention.md"],
      reviewsCreated: [
        { type: "missing-page", titleContains: "FlashAttention" },
        { type: "suggestion", titleContains: "IO-aware" },
      ],
    },
  },

  // 3. references-existing-wikilinks — generated pages link to existing pages
  {
    name: "references-existing-wikilinks",
    description:
      "The generated wiki page must include [[attention]] — linking back " +
      "to a page that already exists in the wiki. Runner asserts substring.",
    initialWiki: {
      "purpose.md": BASIC_PURPOSE,
      "schema.md": BASIC_SCHEMA,
      "wiki/index.md": BASIC_INDEX,
      "wiki/attention.md":
        "---\ntitle: Attention\n---\n\n# Attention\n\nThe attention mechanism.\n",
    },
    source: {
      path: "raw/sources/multi-head.md",
      content: "# Multi-Head Attention\n\nParallel attention heads.\n",
    },
    analysisResponse:
      "## Connections to Existing Wiki\n" +
      "- Multi-head attention is a variant of attention — existing [[attention]] page should be linked.\n",
    generationResponse: [
      "---FILE: wiki/concepts/multi-head-attention.md---",
      "---",
      "title: Multi-Head Attention",
      "---",
      "",
      "# Multi-Head Attention",
      "",
      "Multi-head [[attention]] runs several attention layers in parallel.",
      "---END FILE---",
      "",
      "---FILE: wiki/sources/multi-head.md---",
      "---",
      "title: \"Source: multi-head.md\"",
      "---",
      "",
      "# Source: multi-head.md",
      "",
      "Source for multi-head [[attention]].",
      "---END FILE---",
    ].join("\n"),
    expected: {
      writtenPaths: [
        "wiki/concepts/multi-head-attention.md",
        "wiki/sources/multi-head.md",
      ],
      fileContains: {
        "wiki/concepts/multi-head-attention.md": ["[[attention]]"],
      },
    },
  },

  // 4. game-dev/instance-server — Stage 3 decomposition into db/ paths.
  //
  // The source document mixes 4 distinct semantic units that schema.md
  // routes to 4 different db/ subtrees. The Stage 3 ingest pipeline must:
  //   - copy raw → processed_1/instance_server_design.md (passthrough)
  //   - emit one db/ FILE block per semantic unit
  //   - frontmatter `sources` carries `file:` + `range:` pointing back
  //     to the heading of the contributing section
  {
    name: "game-dev/instance-server",
    description:
      "A raw game-dev design doc decomposes into 4 db/ pages plus the " +
      "passthrough copy under processed_1/. Asserts both the file layout " +
      "and the SourceRef shape in each page's frontmatter.",
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
      "Proposed decomposition:",
      "- path: db/systems/instance_server/server_structure.md",
      "  range: ## 1. 서버 구조",
      "- path: db/content/dungeons/dungeon_a/entry_rules.md",
      "  range: ## 2. 던전 A — 입장 규칙",
      "- path: db/content/dungeons/dungeon_a/rewards.md",
      "  range: ## 3. 던전 A — 보상",
      "- path: db/content/dungeons/dungeon_b/spawn_rules.md",
      "  range: ## 4. 던전 B — 스폰 규칙",
    ].join("\n"),
    generationResponse: [
      "---FILE: db/systems/instance_server/server_structure.md---",
      "---",
      "title: 인스턴스 서버 구조",
      "status: draft",
      "sources:",
      "  - file: instance_server_design.md",
      '    range: "## 1. 서버 구조"',
      "---",
      "",
      "# 인스턴스 서버 구조",
      "",
      "채널마다 별도 프로세스로 동작하며, 메인 서버와 gRPC로 통신한다.",
      "---END FILE---",
      "",
      "---FILE: db/content/dungeons/dungeon_a/entry_rules.md---",
      "---",
      "title: 던전 A 입장 규칙",
      "status: draft",
      "sources:",
      "  - file: instance_server_design.md",
      '    range: "## 2. 던전 A — 입장 규칙"',
      "---",
      "",
      "# 던전 A 입장 규칙",
      "",
      "- 레벨 50 이상 입장 가능",
      "- 파티 4인 필수",
      "---END FILE---",
      "",
      "---FILE: db/content/dungeons/dungeon_a/rewards.md---",
      "---",
      "title: 던전 A 보상",
      "status: draft",
      "sources:",
      "  - file: instance_server_design.md",
      '    range: "## 3. 던전 A — 보상"',
      "---",
      "",
      "# 던전 A 보상",
      "",
      "- 클리어 시 골드 1000 + 장비 박스 1개",
      "- 주간 1회 추가 보상",
      "---END FILE---",
      "",
      "---FILE: db/content/dungeons/dungeon_b/spawn_rules.md---",
      "---",
      "title: 던전 B 스폰 규칙",
      "status: draft",
      "sources:",
      "  - file: instance_server_design.md",
      '    range: "## 4. 던전 B — 스폰 규칙"',
      "---",
      "",
      "# 던전 B 스폰 규칙",
      "",
      "- 보스는 60초 간격으로 스폰",
      "- 스폰 위치는 5곳 랜덤",
      "---END FILE---",
    ].join("\n"),
    expected: {
      writtenPaths: [
        "processed_1/instance_server_design.md",
        "db/systems/instance_server/server_structure.md",
        "db/content/dungeons/dungeon_a/entry_rules.md",
        "db/content/dungeons/dungeon_a/rewards.md",
        "db/content/dungeons/dungeon_b/spawn_rules.md",
      ],
      fileContains: {
        "db/content/dungeons/dungeon_a/rewards.md": [
          "title: 던전 A 보상",
          "file: instance_server_design.md",
          "## 3. 던전 A — 보상",
        ],
        "db/systems/instance_server/server_structure.md": [
          "file: instance_server_design.md",
          "gRPC",
        ],
        "processed_1/instance_server_design.md": [
          "# 인스턴스 서버 설계",
          "## 4. 던전 B — 스폰 규칙",
        ],
      },
      reviewsCreated: [],
    },
  },

  // 5. chinese-source — Chinese content flows through to Chinese wiki pages
  {
    name: "chinese-source",
    description:
      "Chinese-language source document; LLM responses in Chinese. " +
      "UTF-8 round-trip through file write must be clean.",
    initialWiki: {
      "purpose.md": "# 用途\n\n深度学习研究笔记。\n",
      "schema.md": BASIC_SCHEMA,
      "wiki/index.md": "# 索引\n\n- [[注意力机制]]\n",
    },
    source: {
      path: "raw/sources/transformer-survey.md",
      content: "# Transformer 综述\n\nTransformer 是一种基于注意力机制的神经网络架构。\n",
    },
    analysisResponse: "## 核心概念\n- Transformer：基于注意力机制的架构\n",
    generationResponse: [
      "---FILE: wiki/concepts/transformer.md---",
      "---",
      "title: Transformer",
      "---",
      "",
      "# Transformer",
      "",
      "Transformer 是一种基于 [[注意力机制]] 的神经网络架构。",
      "---END FILE---",
      "",
      "---FILE: wiki/sources/transformer-survey.md---",
      "---",
      "title: \"Source: transformer-survey.md\"",
      "---",
      "",
      "# Source: transformer-survey.md",
      "",
      "关于 [[Transformer]] 的综述。",
      "---END FILE---",
    ].join("\n"),
    expected: {
      writtenPaths: [
        "wiki/concepts/transformer.md",
        "wiki/sources/transformer-survey.md",
      ],
      fileContains: {
        "wiki/concepts/transformer.md": [
          "title: Transformer",
          "[[注意力机制]]",
        ],
      },
    },
  },
]
