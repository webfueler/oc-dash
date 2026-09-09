import type { ModelRef, SessionInfo } from "./api"

/**
 * Mission 013 (PA/PC): pure option derivation and filter composition for the
 * filter-row comboboxes. FilterCombobox owns the rendering; this module keeps
 * the testable logic — option lists derived from session rows, the hidden
 * full-path search match, and the directory AND model composition that runs
 * inside the tree memo before buildTree.
 */

/** One project choice: the basename is shown, the FULL path is searchable. */
export interface DirectoryOption {
  path: string
  basename: string
  count: number
}

/**
 * Count sessions per directory over the rows, count-desc — the extracted
 * form of the old `directories` memo (App.tsx:82-89).
 */
export function directoryOptions(rows: SessionInfo[]): DirectoryOption[] {
  const counts = new Map<string, number>()
  for (const s of rows) {
    const d = s.location?.directory
    if (d) counts.set(d, (counts.get(d) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([path, count]) => ({ path, basename: path.split("/").pop() || path, count }))
    .sort((a, b) => b.count - a.count)
}

/** "providerID/id · variant" — the same string the table chips carry. */
export function modelFullLabel(m: ModelRef): string {
  return `${m.providerID}/${m.id}${m.variant ? ` · ${m.variant}` : ""}`
}

/**
 * State value of the model filter. "" means no model filter; every real
 * option key is its full triple ("providerID/id · variant"), which always
 * contains a "/", so this sentinel cannot collide.
 */
export const NO_MODEL_KEY = "no-model"

export interface ModelOption {
  key: string
  /** Visible label; for real models this is the full triple itself. */
  label: string
  count: number
  /** The explicit dashed "no model" bucket for rows without a model. */
  noModel: boolean
}

/**
 * Count the model triples over the rows, count-desc, with the no-model rows
 * kept as one explicit bucket (Q3a) so the failed "(untitled)" row stays
 * reachable instead of silently dropping out.
 */
export function modelOptions(rows: SessionInfo[]): ModelOption[] {
  const counts = new Map<string, number>()
  for (const s of rows) {
    const key = s.model ? modelFullLabel(s.model) : NO_MODEL_KEY
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([key, count]) => ({
      key,
      label: key === NO_MODEL_KEY ? "no model" : key,
      count,
      noModel: key === NO_MODEL_KEY,
    }))
    .sort((a, b) => b.count - a.count)
}

/** One listbox row for FilterCombobox. */
export interface ComboOption {
  /** Stable value stored in filter state; "" is the All entry. */
  key: string
  /** Primary row text and the closed value. */
  label: string
  /** Secondary dim text: the full path for projects. */
  detail?: string
  count: number
  /**
   * Hidden text the search query matches: the FULL path, not just the
   * basename (the artifact's "pers" example matches both directories).
   */
  searchText: string
  /** Render the label as a model chip, like the sessions-table chips. */
  chip?: boolean
  /** Dashed chip styling for the explicit "no model" entry. */
  dashed?: boolean
  /** Always listed, never filtered out by the query: the All entry. */
  pinned?: boolean
}

function allEntry(allCount: number): ComboOption {
  return { key: "", label: "All", count: allCount, searchText: "", pinned: true }
}

/** Project combobox options: All first, then one row per directory. */
export function projectComboOptions(rows: SessionInfo[], allCount: number): ComboOption[] {
  return [
    allEntry(allCount),
    ...directoryOptions(rows).map((d) => ({
      key: d.path,
      label: d.basename,
      detail: d.path,
      count: d.count,
      searchText: d.path,
    })),
  ]
}

/** Model combobox options: All first, then the triples plus the no-model bucket. */
export function modelComboOptions(rows: SessionInfo[], allCount: number): ComboOption[] {
  return [
    allEntry(allCount),
    ...modelOptions(rows).map((m) => ({
      key: m.key,
      label: m.label,
      count: m.count,
      searchText: m.label,
      chip: true,
      dashed: m.noModel,
    })),
  ]
}

/**
 * Directory AND model in one pass, model applied after directory, both
 * before buildTree so a filtered-out parent cannot visibly promote its
 * children (tree.ts). No fetch ever carries these filters — this is the
 * post-filter of the already-fetched payload, exactly like the old
 * single-directory memo.
 */
export function applyFilters(
  rows: SessionInfo[],
  directory: string,
  model: string,
): SessionInfo[] {
  let out = rows
  if (directory) out = out.filter((s) => s.location?.directory === directory)
  if (model)
    out = out.filter((s) =>
      model === NO_MODEL_KEY ? !s.model : !!s.model && modelFullLabel(s.model) === model,
    )
  return out
}
