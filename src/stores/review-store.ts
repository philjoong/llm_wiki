import { create } from "zustand"
import { normalizeReviewTitle } from "@/lib/review-utils"
import type { SourceRef } from "@/lib/source-ref"
import type { Stage1Section, Stage2Triple } from "@/lib/ingest"
import type { EntityEntry } from "@/lib/entity-dict"

export interface ReviewOption {
  label: string
  action: string // identifier for the action
}

/**
 * Stage 4 modification proposals carry the data needed to render the
 * existing-vs-incoming diff in the review card and resolve the
 * proposal back into the wiki tree.
 *
 * - `targetPath` — the db/ page the user has to decide about
 * - `existingExcerpt` / `incomingExcerpt` — full bodies (frontmatter
 *   stripped is fine; the UI handles truncation). Stored eagerly so the
 *   card can render without extra disk reads.
 * - `incomingDraftPath` — relative path of the parked proposal file
 *   under `pending/_proposals/...`. Approve / Pending / Counterexample
 *   all start by reading or moving this file.
 * - `sourceRefs` — what the incoming raw range was. Used to populate the
 *   commit message trailer when the user resolves the proposal.
 */
export interface ModificationProposal {
  targetPath: string
  existingExcerpt: string
  incomingExcerpt: string
  incomingDraftPath: string
  sourceRefs: SourceRef[]
  /** Stage 1 sections for this page_path, preserved so Stage 2 can run
   *  after the user Approves the proposal. Absent on legacy proposals
   *  (created before the pipeline reorder) and on the re-review path. */
  pendingSections?: Stage1Section[]
}

/**
 * Stage 5 schema proposals carry the data needed to render the
 * "AI wants to create a new Type" UI and resolve the proposal
 * into the graph policy.
 */
export interface SchemaProposal {
  type: "node_type" | "relation_type" | "attribute"
  name: string
  targetNode?: string // for attribute
}

/**
 * One entry per overflow failure from Stage 2 validation.
 * Carries enough info so the review card can offer "create new graph" as an
 * actionable resolution instead of just Dismiss.
 */
export interface OverflowEntry {
  /** The graph that was full. */
  graph: string
  /** The relation types that couldn't be added. */
  newTypes: string[]
  /** The graph's current relation types (the ones it's full of). */
  existingTypes: string[]
  /** Suggested new graph name (e.g. "ui_nav_graph_2"). */
  suggestedGraph: string
  /** Pages that were skipped due to this overflow. */
  affectedPaths: string[]
}

/**
 * One entry per entity-name conflict from checkEntityConflicts(). Groups all
 * triples that used `incomingName` for the same underlying concept so a
 * single card can resolve them together.
 */
export interface EntityConfirmationItem {
  incomingName: string
  candidates: EntityEntry[]
  triples: Stage2Triple[]
  pagePaths: string[]
}

export interface ReviewItem {
  id: string
  type:
    | "contradiction"
    | "duplicate"
    | "missing-page"
    | "confirm"
    | "suggestion"
    | "modification"
    | "schema"
    | "entity_confirmation"
  /**
   * Stage 4 two-step decision tree. Only meaningful for `type:
   * "modification"`. `"primary"` shows [Approve | Merge | Reject];
   * `"rejection-handling"` shows [Discard | Pending | Counterexample]
   * after the user clicks Reject. Other types stay implicitly in a
   * single-stage flow.
   */
  stage?: "primary" | "rejection-handling"
  /** Modification-only payload — the diff data and the parked draft. */
  proposal?: ModificationProposal
  /** Schema-only payload — the new type being proposed. */
  schemaProposal?: SchemaProposal
  /** Overflow-only payload — one entry per overflowed graph. Only present on
   *  suggestion items that come from Stage 2 relation-type overflow. */
  overflowEntries?: OverflowEntry[]
  /** entity_confirmation-only payload — the fuzzy-matched name and the triples that used it. */
  entityConfirmation?: EntityConfirmationItem
  title: string
  description: string
  sourcePath?: string
  affectedPages?: string[]
  options: ReviewOption[]
  resolved: boolean
  resolvedAction?: string
  createdAt: number
}

interface ReviewState {
  items: ReviewItem[]
  addItem: (item: Omit<ReviewItem, "id" | "resolved" | "createdAt">) => void
  addItems: (items: Omit<ReviewItem, "id" | "resolved" | "createdAt">[]) => void
  setItems: (items: ReviewItem[]) => void
  resolveItem: (id: string, action: string) => void
  /**
   * Stage 4: flip a `modification` review from `"primary"` to
   * `"rejection-handling"` without resolving it. The card stays open
   * but its action set switches to [Discard | Pending | Counterexample].
   */
  transitionToRejectionHandling: (id: string) => void
  dismissItem: (id: string) => void
  clearResolved: () => void
}

let counter = 0

export const useReviewStore = create<ReviewState>((set) => ({
  items: [],

  addItem: (item) =>
    set((state) => ({
      items: [
        ...state.items,
        {
          ...item,
          id: `review-${++counter}`,
          resolved: false,
          createdAt: Date.now(),
        },
      ],
    })),

  addItems: (items) =>
    set((state) => {
      // De-dupe against pending items with same type + normalized title (all
      // 5 types — bulk ingest can re-surface the same contradiction/confirm
      // from multiple files).
      // Merge affectedPages / sourcePath instead of duplicating.
      // Modification items skip the dedupe path: each proposal is tied to
      // a distinct parked draft (incomingDraftPath) and merging two of them
      // would silently lose one of the parked files. Two raw ingests that
      // both target the same db/ page must surface as two cards.
      const result = [...state.items]
      const keyFor = (t: string, title: string) => `${t}::${normalizeReviewTitle(title)}`

      // Build index of existing items for fast lookup.
      // schema items: dedupe against ALL (resolved or not) so re-sync doesn't
      // re-surface proposals the user already approved/rejected.
      // Other non-modification types: dedupe against pending only.
      const pendingIndex = new Map<string, number>()
      result.forEach((it, idx) => {
        if (it.type === "modification" || it.type === "entity_confirmation") return
        if (it.type === "schema" || !it.resolved) {
          pendingIndex.set(keyFor(it.type, it.title), idx)
        }
      })

      for (const incoming of items) {
        if (incoming.type === "modification" || incoming.type === "entity_confirmation") {
          // Always append — never merge.
          result.push({
            ...incoming,
            id: `review-${++counter}`,
            resolved: false,
            createdAt: Date.now(),
            stage: incoming.stage ?? "primary",
          })
          continue
        }
        const k = keyFor(incoming.type, incoming.title)
        const existingIdx = pendingIndex.get(k)

        if (existingIdx !== undefined) {
          // Merge into existing
          const old = result[existingIdx]
          const mergedPages = Array.from(new Set([...(old.affectedPages ?? []), ...(incoming.affectedPages ?? [])]))
          result[existingIdx] = {
            ...old,
            description: incoming.description || old.description, // prefer newer description
            sourcePath: incoming.sourcePath ?? old.sourcePath,
            affectedPages: mergedPages.length > 0 ? mergedPages : undefined,
          }
        } else {
          const newItem = {
            ...incoming,
            id: `review-${++counter}`,
            resolved: false,
            createdAt: Date.now(),
          }
          result.push(newItem)
          pendingIndex.set(k, result.length - 1)
        }
      }

      return { items: result }
    }),

  setItems: (items) => set({ items }),

  resolveItem: (id, action) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.id === id ? { ...item, resolved: true, resolvedAction: action } : item
      ),
    })),

  transitionToRejectionHandling: (id) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.id === id && item.type === "modification" && !item.resolved
          ? { ...item, stage: "rejection-handling" }
          : item
      ),
    })),

  dismissItem: (id) =>
    set((state) => ({
      items: state.items.filter((item) => item.id !== id),
    })),

  clearResolved: () =>
    set((state) => ({
      items: state.items.filter((item) => !item.resolved),
    })),
}))
