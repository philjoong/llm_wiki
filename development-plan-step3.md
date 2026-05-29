# Development Plan - Step 3: Raw Data Injection & MD Conversion (Completed)

## Objective
Support various document formats (PDF, DOCX, HTML, etc.), convert them to Markdown (MD) files, and store them in the project repository with Git tracking.

## Requirements (Completed)
- Support file upload/injection for multiple formats (PDF, DOCX, HTML, MD).
- Convert non-MD files to clean Markdown.
- Store results under the project's `raw/sources/` directory to maintain the established project structure.
- **Git Integration:** Automatically commit newly added or converted files to the current project branch.
- Ensure project isolation: Files are stored within the specific `${projectPath}/raw/sources`.

## Implementation Details

### 1. UI & Activity Integration
- **Sources View:** Updated `src/components/sources/sources-view.tsx` with enhanced import capabilities.
- **Activity Tracking:** Added `"import"` type to `ActivityItem` in `src/stores/activity-store.ts`.
- **Feedback:** Integrated real-time activity updates during file and folder imports to provide visual progress to the user.

### 2. Conversion & Processing
- **HTML-to-MD:** Created `src/lib/html-convert.ts` using `@mozilla/readability` for content extraction and `turndown` for Markdown conversion.
- **Office & PDF:** Utilized existing Rust-based extractors (PDFium for PDF, `docx-rs` for DOCX, `calamine` for XLSX) via the `preprocessFile` command.
- **unified Flow:** Implemented a unified import pipeline in `SourcesView.tsx` that routes files to appropriate converters based on extension.

### 3. Storage & Version Control
- **Directory Structure:** Files are saved to `${projectPath}/raw/sources`, while original binaries are archived in `${projectPath}/raw/originals` (gitignored).
- **Auto-Commit:** Automated `gitCommit` after successful import/conversion.
  - Commit message format: `ingest: add <filename> (<type>)`
  - Ensures relative paths are used for repository-wide consistency.

## Verification
- **Inference Test:** Verified that PDF, DOCX, and HTML files are correctly converted to readable `.md` files in `raw/sources/`.
- **Git Check:** Confirmed that imported files are automatically committed and appear in the branch history.
- **Isolation Check:** Verified that files stay within the selected project's directory.
- **Encoding Check:** Confirmed preservation of multi-language content (Korean, etc.) through the extraction process.
