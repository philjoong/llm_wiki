/** Stable source provenance stored in v2 Markdown frontmatter. */
export interface SourceRef {
  file: string
  range?: string
}

export function serializeSourceRef(ref: SourceRef) {
  return ref.range ? `${ref.file}:${ref.range}` : ref.file
}

export function sourceRefKey(ref: SourceRef) {
  return `${ref.file.trim().toLowerCase()}|${(ref.range ?? "").trim().toLowerCase()}`
}
