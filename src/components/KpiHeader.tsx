import type { SummaryResponse, SessionsPayload } from "../api"
import { fmtInt, fmtTokens, fmtUSD } from "../format"
import { fallbackTotals, kpisFromFallback, kpisFromStats, type Kpis } from "../summary"

const CARDS: { key: keyof Kpis; label: string; fmt: (v: number | null) => string }[] = [
  { key: "cost", label: "Total cost", fmt: (v) => (v == null ? "—" : fmtUSD(v)) },
  { key: "tokens", label: "Total tokens", fmt: (v) => (v == null ? "—" : fmtTokens(v)) },
  { key: "prompts", label: "Prompts", fmt: fmtInt },
  { key: "steps", label: "Steps", fmt: fmtInt },
  { key: "sessions", label: "Sessions", fmt: fmtInt },
  { key: "subagents", label: "Subagents", fmt: fmtInt },
  { key: "activeDays", label: "Active days", fmt: fmtInt },
  { key: "streak", label: "Streak", fmt: (v) => (v == null ? "—" : `${v}d`) },
]

export function KpiHeader({
  summary,
  sessions,
}: {
  summary: SummaryResponse | null
  sessions: SessionsPayload | null
}) {
  let kpis: Kpis | null = null
  if (summary && !summary.degraded) {
    kpis = kpisFromStats(summary.data)
  } else if (sessions) {
    kpis = kpisFromFallback(fallbackTotals(sessions.data))
  }
  if (!kpis) return null
  return (
    <section className="kpis" aria-label="Totals">
      {kpis.source === "fallback" && (
        <div className="badge warn">
          stats unavailable — totals computed from session rows (compaction usage not included)
        </div>
      )}
      <div className="kpi-grid">
        {CARDS.map((c) => (
          <div className="kpi" key={c.key}>
            <div className="kpi-value">{c.fmt(kpis![c.key] as number | null)}</div>
            <div className="kpi-label">{c.label}</div>
          </div>
        ))}
      </div>
    </section>
  )
}
