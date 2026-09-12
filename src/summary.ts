import type {
  ModelUsage,
  ProjectStats,
  Range,
  SessionInfo,
  SessionStatsInfo,
  SessionsPayload,
  SummaryOk,
  SummaryResponse,
} from "./api"
import { NO_MODEL_KEY, applyFilters, modelBaseKey, modelShortLabel } from "./filters"
import { isoDate } from "./format"
import { tokenTotal } from "./tree"

/** P1 hero label: the range in plain words. */
const RANGE_LABELS: Record<Range, string> = {
  today: "today",
  "7d": "last 7 days",
  "30d": "last 30 days",
  all: "all time",
}

export function rangeLabel(range: Range): string {
  return RANGE_LABELS[range]
}

/**
 * Mission 008 (007's F1): the hero's label must come from the same payload
 * as its value, so the page's primary answer never shows one range's number
 * under another range's label. The label therefore tracks the payload that
 * fed the KPIs — the stats summary when it is healthy, otherwise the session
 * list that degraded mode totals from — and only falls back to the active
 * range when no payload is on screen. During a range switch this keeps the
 * previous range's label over its own numbers until the new payload lands;
 * label and value then flip together in the same render.
 */
export function heroRange(
  summary: SummaryResponse | null | undefined,
  sessions: SessionsPayload | null | undefined,
  active: Range,
): Range {
  if (summary && !summary.degraded) return summary.range.preset
  if (sessions) return sessions.range.preset
  return active
}

/**
 * Mission 008 (007's F2): the Today chart's accent date, derived from the
 * summary payload's own preset instead of the active range state. A stale
 * non-today payload can be on screen right after a switch to Today; gating
 * on the payload keeps the accent matched to the chart's own data (a stale
 * payload renders as a plain chart, never as all bars muted).
 */
export function todayAccentDate(summary?: SummaryOk | null): string | null {
  if (!summary || summary.range.preset !== "today") return null
  const from = summary.data.range.from
  return from == null ? null : isoDate(from)
}

/**
 * P1 hero "≈ $X/day": cost spread over the range length. Omitted for today
 * (the day is still in progress); for "all" the day count comes from the
 * stats window itself.
 */
export function costPerDay(
  cost: number,
  range: Range,
  statsWindow?: { from: number; to: number },
): number | null {
  if (!Number.isFinite(cost)) return null
  if (range === "today") return null
  if (range === "7d") return cost / 7
  if (range === "30d") return cost / 30
  if (!statsWindow || statsWindow.to <= statsWindow.from) return null
  const days = (statsWindow.to - statsWindow.from) / 86_400_000
  return days >= 1 ? cost / days : null
}

export interface ModelRow {
  providerID: string
  id: string
  variant?: string
  steps: number
  tokens: number
  cost: number
  /** tokens > 0 with cost == 0: the provider is unpriced, not free */
  unpriced: boolean
}

/** Normalized, cost-sorted model rows with the unpriced flag applied. */
export function modelRows(stats?: SessionStatsInfo | null): ModelRow[] {
  if (!stats?.models) return []
  return stats.models
    .map((m: ModelUsage) => {
      const tokens = tokenTotal(m.tokens)
      const cost = m.cost ?? 0
      return {
        providerID: m.model?.providerID ?? "?",
        id: m.model?.id ?? "?",
        variant: m.model?.variant,
        steps: m.steps ?? 0,
        tokens,
        cost,
        unpriced: tokens > 0 && cost === 0,
      }
    })
    .sort((a, b) => b.cost - a.cost || b.tokens - a.tokens)
}

export interface FallbackTotals {
  cost: number
  tokens: { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number }
  /** sessions without a parentID */
  sessions: number
  /** sessions with a parentID */
  subagents: number
  prompts: number | null
  steps: number | null
  activeDays: number | null
  streak: number | null
}

/**
 * Totals computed client-side from the raw session list, used when the
 * stats endpoint is unavailable (degraded mode). Per-row costs exclude
 * compaction usage, so these can be slightly lower than stats totals.
 */
export function fallbackTotals(sessions: SessionInfo[]): FallbackTotals {
  const totals: FallbackTotals = {
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    sessions: 0,
    subagents: 0,
    prompts: null,
    steps: null,
    activeDays: null,
    streak: null,
  }
  for (const s of sessions) {
    totals.cost += s.cost ?? 0
    totals.tokens.input += s.tokens?.input ?? 0
    totals.tokens.output += s.tokens?.output ?? 0
    totals.tokens.reasoning += s.tokens?.reasoning ?? 0
    totals.tokens.cacheRead += s.tokens?.cache?.read ?? 0
    totals.tokens.cacheWrite += s.tokens?.cache?.write ?? 0
    if (s.parentID) totals.subagents++
    else totals.sessions++
  }
  return totals
}

export interface Kpis {
  source: "stats" | "fallback"
  cost: number
  tokens: number
  prompts: number | null
  steps: number | null
  sessions: number | null
  subagents: number | null
  activeDays: number | null
  streak: number | null
}

export function kpisFromStats(stats: SessionStatsInfo): Kpis {
  return {
    source: "stats",
    cost: stats.cost,
    tokens: tokenTotal(stats.tokens),
    prompts: stats.prompts,
    steps: stats.steps,
    sessions: stats.sessions,
    subagents: stats.subagents,
    activeDays: stats.activeDays,
    streak: stats.streak,
  }
}

export function kpisFromFallback(totals: FallbackTotals): Kpis {
  return {
    source: "fallback",
    cost: totals.cost,
    tokens:
      totals.tokens.input +
      totals.tokens.output +
      totals.tokens.reasoning +
      totals.tokens.cacheRead +
      totals.tokens.cacheWrite,
    prompts: totals.prompts,
    steps: totals.steps,
    sessions: totals.sessions,
    subagents: totals.subagents,
    activeDays: totals.activeDays,
    streak: totals.streak,
  }
}

/**
 * Mission 014 (PD): pure logic for the filtered-totals card. The component
 * stays presentational; everything the probes and tests can pin lives here.
 */

/** The card's content tier: tier 2 (project stats) or tier 1 (rows only). */
export type FilterCardTier = "tier2" | "tier1"

/**
 * Q4a's gating rule: tier 2 needs a project filter and must NOT have a
 * model filter — upstream has no model param, so the project-scoped stats
 * could not honor the model cut. Both filters active degrades to tier 1.
 */
export function filterCardTier(directory: string, model: string): FilterCardTier {
  return directory && !model ? "tier2" : "tier1"
}

/**
 * The project ids upstream stats counts for a directory filter. Rows carry
 * projectID; Mission 026: ALL distinct ids behind the directory come back,
 * ordered count-desc with first-seen kept on ties (so index 0 is the id the
 * pre-026 single-pick returned). Empty when the filter matches nothing or
 * rows carry no projectID — the project param is then not sent at all.
 */
export function projectIDForDirectory(rows: SessionInfo[], directory: string): string[] {
  if (!directory) return []
  const counts = new Map<string, number>()
  const order: string[] = []
  for (const s of rows) {
    if (s.location?.directory !== directory) continue
    const pid = s.projectID
    if (!pid) continue
    if (!counts.has(pid)) order.push(pid)
    counts.set(pid, (counts.get(pid) ?? 0) + 1)
  }
  // Stable sort: first-seen order survives the count-desc reorder on ties.
  return order.sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))
}

/**
 * The card header's filter descriptor, per the artifact mocks: the project's
 * basename ("oc-setup"), the model's short id form without the variant (the
 * model filter state is the base "providerID/id" since mission 019, and the
 * short-form convention drops the provider prefix; the artifact's card label
 * is not provider-prefixed), "no model" for the no-model bucket. Empty when
 * no filter is set.
 */
export function filterCardLabel(directory: string, model: string): string {
  const parts: string[] = []
  if (directory) parts.push(directory.split("/").pop() || directory)
  if (model) parts.push(model === NO_MODEL_KEY ? "no model" : modelShortLabel(model))
  return parts.join(" · ")
}

/**
 * Label protection for the card, copied from the hero's mechanism
 * (heroRange, 008's F1): the card's numbers come from the session rows, so
 * its range label tracks the session payload's own preset and only falls
 * back to the active range when no payload is on screen.
 */
export function cardRange(sessions: SessionsPayload | null | undefined, active: Range): Range {
  return sessions ? sessions.range.preset : active
}

/**
 * Mission 014: the tier-2 zeros guard. Upstream answers an unknown project
 * id with an all-zero stats payload rather than an error (verified live),
 * so a project-scoped payload claiming no sessions at all while the walked
 * rows show some is treated as unavailable — the card degrades to tier 1
 * with the note instead of printing a fake zero spend.
 */
export function projectStatsUsable(
  stats: { sessions: number; subagents: number } | null | undefined,
  rowSessions: number,
  rowSubagents: number,
): boolean {
  if (!stats) return false
  return stats.sessions + stats.subagents > 0 || rowSessions + rowSubagents === 0
}

/**
 * Mission 026: the filtered card's money, resolved per active filter
 * combination from the message-level stats engine the hero already rides.
 *
 * - Model filter only: the GLOBAL stats payload's models[] row matching
 *   providerID + modelID, variant-agnostic (all variants summed). No
 *   directory axis, so the exclusivity cut does not apply here.
 * - Directory filter: per-project stats totals, one payload per project id
 *   behind the directory, costs summed — but ONLY when every id is
 *   exclusive to the directory (mission 028 below).
 * - Directory AND model: the per-project models[] rows, summed across that
 *   directory's project ids, under the same exclusivity gate.
 *
 * Mission 028 (H1): upstream scopes stats by project id, not by directory,
 * so a payload for an id that also has sessions in another directory
 * carries that other directory's money. An id is EXCLUSIVE to the directory
 * iff every walked row carrying it belongs to the directory. Directory
 * money is all-or-nothing: every id exclusive AND the walk not truncated,
 * or the WHOLE money falls back to the labeled row sum — never a mix of
 * exact and fallback shares.
 *
 * Fallbacks stay honest: when the stats route cannot serve the combination
 * (window mismatch, failed fetch, missing payload or models[] array, a
 * zeros-guard failure, a non-exclusive id, a truncated walk) the value is
 * the existing client-side row sum and `source` is "fallback" — the
 * component must label it approximate. When the stats payload has NO
 * matching models[] row while session rows DO match the filter, `conflict`
 * is set and the money falls back: the two sources disagree and neither
 * number may be shown silently.
 */
export interface CardMoney {
  cost: number
  /** "stats" = message-level exact; "fallback" = row sum, label approximate */
  source: "stats" | "fallback"
  /** stats served no models[] row for this model while session rows claim it */
  conflict: boolean
}

export interface CardMoneyInput {
  directory: string
  /** Base model key "providerID/id" (variant-agnostic), NO_MODEL_KEY, or "" */
  model: string
  /** The post-filter session rows — the fallback sum and conflict evidence */
  rows: SessionInfo[]
  /** The session payload the rows came from; fixes the row-walk window */
  sessions: SessionsPayload | null | undefined
  /** The healthy global stats payload, undefined when degraded/missing */
  summary: SummaryOk | undefined
  /** Per-project stats payloads for the directory's ids, when fetched */
  projectStats: ProjectStats[] | undefined
  /** ALL project ids behind the directory (projectIDForDirectory) */
  projectIDs: string[]
}

/**
 * The stats models[] cost for one base model: variant-agnostic — every
 * matching row (all reasoning levels) is summed. Returns null when the
 * models[] array is missing or carries no row for the model; a matched row
 * costing $0 is a real zero and returns 0.
 */
function statsModelCost(
  models: ModelUsage[] | undefined,
  model: string,
): number | null {
  if (!Array.isArray(models)) return null
  let total = 0
  let matched = false
  for (const m of models) {
    if (!m.model) continue
    if (modelBaseKey({ providerID: m.model.providerID, id: m.model.id }) === model) {
      matched = true
      total += m.cost ?? 0
    }
  }
  return matched ? total : null
}

export function cardMoney(input: CardMoneyInput): CardMoney {
  const fallback: CardMoney = {
    cost: fallbackTotals(input.rows).cost,
    source: "fallback",
    conflict: false,
  }
  const summary = input.summary
  // The card never renders without a filter, but an unfiltered call is row
  // money by definition.
  if (!input.directory && !input.model) return fallback
  // No stats payload, or its window does not match the session payload on
  // screen (a range switch mid-flight): never mix windows in one number.
  if (!summary) return fallback
  if (input.sessions && summary.range.preset !== input.sessions.range.preset) return fallback
  // The "no model" bucket is not a model — stats has no row for it.
  if (input.model === NO_MODEL_KEY) return fallback

  if (!input.directory) {
    // Model filter only: the global payload's models[] row.
    const stats = summary.data
    const walk = fallbackTotals(input.sessions?.data ?? [])
    if (!projectStatsUsable(stats, walk.sessions, walk.subagents)) return fallback
    const cost = statsModelCost(stats.models, input.model)
    if (cost == null) {
      // Row absent: if session rows claim this model the two sources
      // disagree — surface the conflict via fallback; if nothing claims it,
      // message-level $0 is the exact truth.
      if (input.rows.length > 0) return { ...fallback, conflict: true }
      return { cost: 0, source: "stats", conflict: false }
    }
    return { cost, source: "stats", conflict: false }
  }

  // Directory branches: every project id behind the directory must have a
  // usable payload, or the combination is not served.
  const ids = input.projectIDs
  if (ids.length === 0) return fallback
  // Mission 028 (H1): the exclusivity cut, before any payload is trusted.
  // A truncated walk (or no walk payload at all, so the truncation flag is
  // not visible) counts as non-exclusive: the id set itself could be
  // incomplete and the walked rows are not the whole story.
  if (!input.sessions || input.sessions.truncated) return fallback
  const walkRows = input.sessions.data
  for (const id of ids) {
    for (const row of walkRows) {
      if (row.projectID === id && row.location?.directory !== input.directory) return fallback
    }
  }
  const byId = new Map((input.projectStats ?? []).map((p) => [p.project, p.data]))
  const dirRows = applyFilters(input.sessions?.data ?? [], input.directory, "")
  for (const id of ids) {
    const data = byId.get(id)
    // Missing payload: the fetch failed or the shape check dropped it.
    if (!data) return fallback
    // Zeros guard PER payload, against that project's own walked rows.
    const own = fallbackTotals(dirRows.filter((r) => r.projectID === id))
    if (!projectStatsUsable(data, own.sessions, own.subagents)) return fallback
  }

  if (!input.model) {
    // Directory only: the payloads' exact totals, summed.
    let total = 0
    for (const id of ids) total += byId.get(id)!.cost
    return { cost: total, source: "stats", conflict: false }
  }

  // Directory AND model: the per-project models[] rows, summed across ids.
  let total = 0
  for (const id of ids) {
    const data = byId.get(id)!
    // The whole models[] array missing: the payload cannot honor the cut.
    if (!Array.isArray(data.models)) return fallback
    const cost = statsModelCost(data.models, input.model)
    if (cost == null) {
      if (input.rows.length > 0) return { ...fallback, conflict: true }
      continue
    }
    total += cost
  }
  return { cost: total, source: "stats", conflict: false }
}

/**
 * Mission 028 (M1): the card's money sub-line. Every note must be TRUE of
 * the number it accompanies. Stats money is message-level: it excludes
 * compaction usage and never sees the session rows' upstream cost drift.
 * The row sum is directory-correct but session-level: it includes
 * compaction usage and upstream session_v2 drift, and its model labels are
 * each session's last model — so a fallback under a model filter names that
 * misattribution, and a directory fallback names the compaction inclusion
 * instead. The fallback lines never claim "excludes compaction usage".
 */
export function moneySubLine(money: CardMoney, model: string): string {
  if (money.source === "stats") return "excludes compaction usage"
  return model ? "approximate — sessions' last model" : "approximate — includes compaction usage"
}

/**
 * Mission 028 (M1): the money clause for the card's note paragraphs, same
 * discipline as moneySubLine — true of the number it accompanies, on every
 * path.
 */
export function moneyNote(money: CardMoney, model: string): string {
  if (money.source === "stats") {
    return model
      ? "cost is message-level exact from the stats endpoint — excludes compaction usage"
      : "money from the stats endpoint (message-level), excludes compaction usage"
  }
  return model
    ? "cost is the approximate row sum (sessions' last model)"
    : "money is the approximate row sum (includes compaction usage)"
}
