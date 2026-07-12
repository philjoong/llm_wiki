export const PAGE_TYPES = ["ui_spec", "feature_spec", "system_spec", "data_spec", "guide", "reference"] as const
export type PageType = (typeof PAGE_TYPES)[number]

export const SECTION_TYPES = ["overview", "ui", "behavior", "flow", "rule", "data", "exception", "example", "history"] as const
export type SectionType = (typeof SECTION_TYPES)[number]

export const ENTITY_TYPES = [
  "concept", "feature", "system", "data", "ui.screen", "ui.modal", "ui.panel", "ui.widget", "ui.action", "ui.content",
] as const
export type EntityType = (typeof ENTITY_TYPES)[number]

export const UI_SCOPES = ["full-screen", "modal", "panel", "overlay", "toast", "widget", "embedded"] as const
export type UiScope = (typeof UI_SCOPES)[number]
export const UI_ANCHORS = ["viewport-center", "top", "bottom", "left", "right", "world-space", "parent-relative"] as const
export type UiAnchor = (typeof UI_ANCHORS)[number]
export const UI_LAYERS = ["base", "overlay", "system"] as const
export type UiLayer = (typeof UI_LAYERS)[number]
export const UI_ASPECTS = ["layout", "content", "interaction", "state"] as const
export type UiAspect = (typeof UI_ASPECTS)[number]

export function isVocabularyValue<T extends readonly string[]>(values: T, value: string): value is T[number] {
  return values.includes(value)
}
