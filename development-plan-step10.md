# Development Plan - Step 10: Question Types (YAML)

## Objective
Support specialized question types defined in YAML, allowing users to perform CRUD on these types and get structured answers.

## Requirements
- Question types stored in YAML.
- LLM must answer based on the keys defined in the YAML template.
- UI for CRUD on question types.
- Convert one existing MD question type to YAML for testing.

## Implementation Details

### 1. YAML Schema & Migration
- Define the format: `name`, `description`, `fields` (keys the LLM should fill), `prompt_template`.
- **Migration:** Convert existing 12+ Markdown files in `schema/question_types/` to the new YAML format. Update `src/lib/question-types.ts` and `src/lib/classify-question.ts` to support YAML.
- **Storage:** Store system-default question types in `schema/question_types/` and allow project-specific overrides in `.llm-wiki/question-types/` within the project root.

### 2. CRUD UI
- A dedicated settings or library page for "Question Types".
- List, Edit, Create, Delete YAML files.
- Ensure changes are tracked by Git and SQLite VC (Step 6).

### 3. Execution Logic
- When a user selects a question type:
  - Load the YAML.
  - Construct a prompt asking the LLM to output a JSON/YAML response matching the fields.
  - Display the structured result in the UI.

## Verification Plan
- **YAML Conversion:** Convert `balance_simulation.md` to `balance_simulation.yaml`.
- **Execution Test:** Select "Balance Simulation", ask a question, and verify the LLM provides answers for all defined keys.
- **CRUD Test:** Create a new custom question type and use it immediately.
