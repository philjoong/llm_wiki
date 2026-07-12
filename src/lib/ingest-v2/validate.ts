import type { IngestPlan } from "./plan"

const isSafeV2Path = (path: string) => path.startsWith("db/") && !path.startsWith("/") && !/^[A-Za-z]:/.test(path) && !/[\x00-\x1f]/.test(path) && !path.replace(/\\/g, "/").split("/").includes("..")

export function validateIngestPlan(plan: IngestPlan): void {
  if (!/^[A-Za-z0-9-]+$/.test(plan.operationId) || plan.pages.length === 0) throw new Error("VALIDATION_FAILED: invalid ingest operation")
  const paths = new Set<string>()
  const pageIds = new Set<string>()
  const sectionIds = new Set<string>()
  for (const document of plan.pages) {
    if (!isSafeV2Path(document.relativePath)) throw new Error(`VALIDATION_FAILED: unsafe page path '${document.relativePath}'`)
    if (paths.has(document.relativePath) || pageIds.has(document.page.pageId)) throw new Error("VALIDATION_FAILED: duplicate page in plan")
    paths.add(document.relativePath); pageIds.add(document.page.pageId)
    for (const section of document.sections) {
      if (section.pageId !== document.page.pageId || sectionIds.has(section.sectionId)) throw new Error("VALIDATION_FAILED: invalid section ownership")
      sectionIds.add(section.sectionId)
    }
  }
  for (const assertion of plan.assertions) {
    if (!pageIds.has(assertion.pageId) || !sectionIds.has(assertion.sectionId)) throw new Error("VALIDATION_FAILED: assertion evidence is outside the ingest plan")
    if (!assertion.graphId || !assertion.subjectName.trim() || !assertion.objectName.trim() || !/^[A-Z][A-Z0-9_]*$/.test(assertion.predicate)) throw new Error("VALIDATION_FAILED: invalid ingest assertion")
  }
}
