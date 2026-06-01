# Development Plan - Step 10: Question Types (YAML) [COMPLETE]

## Objective
Support specialized question types defined in YAML, allowing users to perform CRUD on these types and get structured answers.

## Status
- [x] Question types stored in YAML.
- [x] LLM answers based on keys defined in YAML.
- [x] UI for CRUD on question types.
- [x] Migrated all existing MD question types to YAML.

## Implementation Details

### 1. YAML Schema & Migration
- **Schema:** Defined in `src/lib/question-types.ts`. Fields: `name`, `description`, `fields` (Map of key -> desc), `prompt_template`, `zero_residue_meaning`.
- **Migration:** Converted all 12 Markdown files in `schema/question_types/` to YAML. Removed legacy `.md` files.
- **Parsing:** Integrated `js-yaml`. Loader handles three levels: App defaults (`schema/`), Project-specific (`question_types/`), and User overrides (`.llm-wiki/question-types/`).

### 2. CRUD UI
- **Question Types Section:** Located in Settings → Question Types.
- **Functionality:** 
    - Lists all detected types with ID/source badges.
    - Full YAML editor for creating and editing types.
    - Saving an edit creates a user override in `.llm-wiki/question-types/`.
    - Deletion support for user/overridden files.

### 3. Execution Logic
- **Search Integration:** `runExcludeSearch` now handles classification and applies exclusions (patterns/axioms) to prune the candidate space before searching.
- **Structured Prompting:** `ChatPanel.tsx` detects the judged question type. If it has a `promptTemplate`, it replaces placeholders (`{{context}}`, `{{question}}`, etc.) and instructs the LLM to output JSON.
- **Visualization:** `ChatMessage.tsx` detects JSON responses and renders them as styled description lists (DL/DT/DD) instead of raw text, enhancing clarity for structured data.

## Verification
- [x] **YAML Migration:** Verified loader reads all migrated YAML files correctly.
- [x] **Execution:** Tested "Balance Simulation" and verified the LLM provides JSON matching the fields, rendered as a structured list.
- [x] **CRUD:** Created a custom type "Custom QA" via settings and confirmed it appears in the classifier and chat.
