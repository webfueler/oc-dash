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

/**
 * The base model identity: "providerID/id" with the reasoning level (the
 * variant) dropped. Mission 019: the model FILTER ignores the variant, so
 * both the option keys and applyFilters' match work on this base.
 */
export function modelBaseKey(m: ModelRef): string {
  return `${m.providerID}/${m.id}`
}

/**
 * The existing short-form convention (the table chips and the card label):
 * drop the provider prefix, keep the id — "p/m · v" reads as "m · v", so the
 * base key "p/m" reads as "m".
 */
export function modelShortLabel(key: string): string {
  return key.includes("/") ? key.slice(key.indexOf("/") + 1) : key
}

/**
 * State value of the model filter. "" means no model filter; every real
 * option key is its base model ("providerID/id", variant-agnostic), which
 * always contains a "/", so this sentinel cannot collide.
 */
export const NO_MODEL_KEY = "no-model"

export interface ModelOption {
  key: string
  /** Visible label; for real models the short id form (provider dropped). */
  label: string
  count: number
  /** The explicit dashed "no model" bucket for rows without a model. */
  noModel: boolean
}

/**
 * Count the BASE models over the rows, count-desc, with the no-model rows
 * kept as one explicit bucket (Q3a) so the failed "(untitled)" row stays
 * reachable instead of silently dropping out. Mission 019: variants of one
 * model collapse into a single bucket with summed counts.
 */
export function modelOptions(rows: SessionInfo[]): ModelOption[] {
  const counts = new Map<string, number>()
  for (const s of rows) {
    const key = s.model ? modelBaseKey(s.model) : NO_MODEL_KEY
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([key, count]) => ({
      key,
      label: key === NO_MODEL_KEY ? "no model" : modelShortLabel(key),
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

/**
 * Model combobox options: All first, then the base models plus the no-model
 * bucket. Mission 019: the label is the short id (the closed chip's
 * short-form convention), the full base "providerID/id" rides along as the
 * detail and the search text, so the provider prefix stays visible when open
 * and searchable when typed — the same visible-short/hidden-full split the
 * project options use.
 */
export function modelComboOptions(rows: SessionInfo[], allCount: number): ComboOption[] {
  return [
    allEntry(allCount),
    ...modelOptions(rows).map((m) => ({
      key: m.key,
      label: m.label,
      detail: m.noModel ? undefined : m.key,
      count: m.count,
      searchText: m.noModel ? m.label : m.key,
      chip: true,
      dashed: m.noModel,
    })),
  ]
}

/**
 * Mission 020 (always-visible filters): the comboboxes render in every range,
 * so a value picked under one range can face rows where it matches nothing —
 * the Captain's case: a project selected in 7d stays selected under Today,
 * where the walk has no row for it. The option builders above only see the
 * current rows, so the held value would have no option row and the closed
 * chip would fall back to the raw internal key (a full filesystem path, a
 * provider-prefixed base). This appends a synthesized option for the held
 * value when it is missing — same shape and label convention as its builder,
 * count 0, the truthful number for this range — so the closed state always
 * shows either the selected filter or the All/zero state, never a raw key.
 * The open list shows it too (last, count-desc-consistent at 0), where
 * picking All clears and picking the row keeps the value.
 */
export function withStaleOption(
  options: ComboOption[],
  value: string,
  stale: (key: string) => ComboOption,
): ComboOption[] {
  if (!value || options.some((o) => o.key === value)) return options
  return [...options, stale(value)]
}

/** The missing project option: basename shown, full path as detail/search. */
export function staleProjectOption(path: string): ComboOption {
  return {
    key: path,
    label: path.split("/").pop() || path,
    detail: path,
    count: 0,
    searchText: path,
  }
}

/** The missing model option: the 019 short-form chip, count 0. */
export function staleModelOption(key: string): ComboOption {
  const noModel = key === NO_MODEL_KEY
  return {
    key,
    label: noModel ? "no model" : modelShortLabel(key),
    detail: noModel ? undefined : key,
    count: 0,
    searchText: noModel ? "no model" : key,
    chip: true,
    dashed: noModel,
  }
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
      // Mission 019: the match is variant-agnostic — a base "providerID/id"
      // filter selects every reasoning level of that model.
      model === NO_MODEL_KEY ? !s.model : !!s.model && modelBaseKey(s.model) === model,
    )
  return out
}
