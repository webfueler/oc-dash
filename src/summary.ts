import type {
  ModelUsage,
  Range,
  SessionInfo,
  SessionStatsInfo,
  SessionsPayload,
  SummaryOk,
  SummaryResponse,
} from "./api"
import { NO_MODEL_KEY } from "./filters"
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
 * The project id upstream stats counts for a directory filter. Rows carry
 * projectID; the most common one among the directory's rows wins (ties keep
 * the first seen). Null when the filter matches nothing or rows carry no
 * projectID — the tier-2 param is then not sent at all.
 */
export function projectIDForDirectory(rows: SessionInfo[], directory: string): string | null {
  if (!directory) return null
  const counts = new Map<string, number>()
  let best: string | null = null
  let bestCount = 0
  for (const s of rows) {
    if (s.location?.directory !== directory) continue
    const pid = s.projectID
    if (!pid) continue
    const n = (counts.get(pid) ?? 0) + 1
    counts.set(pid, n)
    if (n > bestCount) {
      best = pid
      bestCount = n
    }
  }
  return best
}

/**
 * The card header's filter descriptor, per the artifact mocks: the project's
 * basename ("oc-setup"), the model's short "id · variant" form (the full
 * triple is provider-prefixed; the artifact's card label is not), "no model"
 * for the no-model bucket. Empty when no filter is set.
 */
export function filterCardLabel(directory: string, model: string): string {
  const parts: string[] = []
  if (directory) parts.push(directory.split("/").pop() || directory)
  if (model)
    parts.push(
      model === NO_MODEL_KEY ? "no model" : model.includes("/") ? model.slice(model.indexOf("/") + 1) : model,
    )
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
