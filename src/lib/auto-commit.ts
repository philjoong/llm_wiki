export interface SourceRefLite {
  file: string
  range?: string
}

export function formatModificationMessage(
  action: string,
  targetPath: string,
  sourceRef: SourceRefLite,
): string {
  const range = sourceRef.range ? `:${sourceRef.range}` : ""
  return `modification: ${action} ${targetPath}\n\nSource: ${sourceRef.file}${range}\nResolved-by: ${action}`
}
