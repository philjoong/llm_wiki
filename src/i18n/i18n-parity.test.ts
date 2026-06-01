/**
 * Structural parity check for the translation bundles.
 *
 * If en.json grows a key that another bundle doesn't have (or vice-versa),
 * the app either falls back to the raw key at runtime (ugly) or
 * silently shows the English string to non-English users. Both are
 * regressions we want to catch at test time.
 *
 * This test is deliberately string-based rather than going through
 * i18next's runtime — it should fail on the FILE contents before
 * anyone notices in the UI.
 */
import { describe, it, expect } from "vitest"
import en from "./en.json"
import ko from "./ko.json"

/** Flattens a nested translation object to "a.b.c" dot-path keys. */
function flattenKeys(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object") return []
  const out: string[] = []
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === "object") {
      out.push(...flattenKeys(v, path))
    } else {
      out.push(path)
    }
  }
  return out
}

describe("i18n bundle parity (en.json ↔ ko.json)", () => {
  const enKeys = new Set(flattenKeys(en))
  const koKeys = new Set(flattenKeys(ko))

  it("every en.json key is also in ko.json", () => {
    const missing = [...enKeys].filter((k) => !koKeys.has(k)).sort()
    expect(
      missing,
      `Keys in en.json but missing from ko.json — add Korean translations for:\n  ${missing.join("\n  ")}`,
    ).toEqual([])
  })

  it("every ko.json key is also in en.json (no orphaned ko-only strings)", () => {
    const orphaned = [...koKeys].filter((k) => !enKeys.has(k)).sort()
    expect(
      orphaned,
      `Keys in ko.json but missing from en.json — either add English translations or remove the stale ko-only keys:\n  ${orphaned.join("\n  ")}`,
    ).toEqual([])
  })

  it("every leaf value is a non-empty string (no null / empty / placeholder slips)", () => {
    const check = (bundle: unknown, label: string) => {
      const keys = flattenKeys(bundle)
      for (const path of keys) {
        // Walk back to pull the value.
        let ref: unknown = bundle
        for (const part of path.split(".")) {
          ref = (ref as Record<string, unknown>)[part]
        }
        expect(typeof ref, `${label}: ${path} is not a string`).toBe("string")
        expect((ref as string).length, `${label}: ${path} is empty`).toBeGreaterThan(0)
      }
    }
    check(en, "en.json")
    check(ko, "ko.json")
  })

  it("pluralization keys come in pairs: every foo_plural has a matching foo", () => {
    // i18next plural convention — a `foo_plural` without `foo` means
    // the singular form will fall back to the raw key at runtime.
    const check = (bundle: unknown, label: string) => {
      const keys = new Set(flattenKeys(bundle))
      for (const k of keys) {
        if (k.endsWith("_plural")) {
          const singular = k.slice(0, -"_plural".length)
          expect(
            keys.has(singular),
            `${label}: found ${k} but no matching ${singular} (i18next will fall back to the raw key for count=1)`,
          ).toBe(true)
        }
      }
    }
    check(en, "en.json")
    check(ko, "ko.json")
  })
})
