import type { ModelUsage, Range, SessionInfo, SessionStatsInfo } from "./api"
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
