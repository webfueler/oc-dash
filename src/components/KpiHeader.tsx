import type { Range, SessionsPayload, SummaryResponse } from "../api"
import { fmtInt, fmtTokens, fmtUSD } from "../format"
import {
  costPerDay,
  fallbackTotals,
  heroRange,
  kpisFromFallback,
  kpisFromStats,
  rangeLabel,
  type Kpis,
} from "../summary"

/**
 * P1: one hero card for the number the dashboard exists to show, with the
 * other stats demoted to a compact strip. Works in degraded mode too — the
 * fallback badge rides on the hero and the strip shows the fallback totals.
 * Mission 008 (007's F1): the range label comes from the same payload as the
 * value (heroRange), so a range switch never shows the new label over the
 * previous range's numbers — both flip together when the fetch lands.
 */
export function KpiHeader({
  summary,
  sessions,
  range,
}: {
  summary: SummaryResponse | null
  sessions: SessionsPayload | null
  range: Range
}) {
  let kpis: Kpis | null = null
  if (summary && !summary.degraded) {
    kpis = kpisFromStats(summary.data)
  } else if (sessions) {
    kpis = kpisFromFallback(fallbackTotals(sessions.data))
  }
  if (!kpis) return null
  const labelRange = heroRange(summary, sessions, range)
  const statsWindow = summary && !summary.degraded ? summary.data.range : undefined
  const perDay = costPerDay(kpis.cost, labelRange, statsWindow)
  const sub: string[] = []
  if (perDay != null) sub.push(`≈ ${fmtUSD(perDay)}/day`)
  if (kpis.subagents != null) sub.push(`includes ${fmtInt(kpis.subagents)} subagent sessions`)
  return (
    <section className="kpis" aria-label="Totals">
      <div className="hero-kpi">
        <div className="hero-main">
          <div className="hero-label">Total cost · {rangeLabel(labelRange)}</div>
          <div className="hero-value">{fmtUSD(kpis.cost)}</div>
          {sub.length > 0 && <div className="hero-sub">{sub.join(" · ")}</div>}
          {kpis.source === "fallback" && (
            <div className="badge warn">
              stats unavailable — totals computed from session rows (includes compaction usage)
            </div>
          )}
        </div>
        <div className="statline">
          <div className="stat">
            <b>{fmtTokens(kpis.tokens)}</b>
            <span>tokens</span>
          </div>
          <div className="stat">
            <b>
              {fmtInt(kpis.prompts)} / {fmtInt(kpis.steps)}
            </b>
            <span>prompts · steps</span>
          </div>
          <div className="stat">
            <b>
              {fmtInt(kpis.sessions)} + {fmtInt(kpis.subagents)}
            </b>
            <span>sessions · subagents</span>
          </div>
          <div className="stat">
            <b>
              {fmtInt(kpis.activeDays)} · {kpis.streak == null ? "—" : `${kpis.streak}d`}
            </b>
            <span>active · streak</span>
          </div>
        </div>
      </div>
    </section>
  )
}
