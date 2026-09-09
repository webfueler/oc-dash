import type { Range, SessionInfo, SessionsPayload, SummaryResponse } from "../api"
import { fmtInt, fmtTokens, fmtUSD } from "../format"
import {
  cardRange,
  costPerDay,
  fallbackTotals,
  filterCardLabel,
  filterCardTier,
  kpisFromFallback,
  projectStatsUsable,
  rangeLabel,
} from "../summary"

/**
 * Mission 014 (PD, Q4a + Q5a): the filtered-totals card. Renders below the
 * hero whenever any filter is active (Q5a) — no state of its own — and
 * recomputes from the payloads the 30-second poll already replaces.
 *
 * Tier 1 (always): cost, tokens, sessions, subagents, client-side from the
 * post-filter session rows via the fallbackTotals pattern.
 *
 * Tier 2 (project filter only, no model filter): prompts · steps and
 * active · streak plus the compaction gap, from the /api/summary response's
 * additive projectStats field (one best-effort upstream call with project=).
 * The echoed project id is checked against the filter on screen before the
 * tiles render, so a stale payload can never dress its numbers as the
 * current filter's. If projectStats is missing — upstream failure or a
 * payload from before the field existed — the card degrades to tier 1 with
 * the honest note, never an error surface.
 */
export function FilterSummaryCard({
  rows,
  directory,
  model,
  summary,
  sessions,
  activeRange,
  projectID,
}: {
  /** The post-filter session rows (the same rows buildTree receives). */
  rows: SessionInfo[]
  directory: string
  model: string
  summary: SummaryResponse | null
  /** The session payload the rows came from; the label range tracks it. */
  sessions: SessionsPayload | null
  /** Fallback label range when no session payload is on screen. */
  activeRange: Range
  /**
   * The project id the tier-2 fetch asked for (null when tier 2 is gated
   * off or not derivable). The response's echoed id must match it before
   * the stats tiles render, so a stale payload from a previous project
   * filter never dresses its numbers as the current filter's.
   */
  projectID: string | null
}) {
  // Tier 1 is the exact fallback pipeline the hero's degraded mode uses:
  // row sums for cost, tokens, sessions, subagents, with the stats-only
  // fields null.
  const kpis = kpisFromFallback(fallbackTotals(rows))
  const labelRange = cardRange(sessions, activeRange)
  const statsWindow =
    summary && !summary.degraded && summary.range.preset === labelRange ? summary.data.range : undefined
  const perDay = costPerDay(kpis.cost, labelRange, statsWindow)

  const wantsTier2 = filterCardTier(directory, model) === "tier2"
  const okSummary = summary && !summary.degraded ? summary : undefined
  const ps = wantsTier2 && projectID != null ? okSummary?.projectStats : undefined
  const tier2 =
    ps && ps.project === projectID && projectStatsUsable(ps.data, kpis.sessions ?? 0, kpis.subagents ?? 0)
      ? ps
      : undefined

  // The compaction gap: the stats total minus the row-derived total, the
  // same delta footnote 1 describes. Only shown when it is positive; a
  // negative gap means drift ran the other way and there is no honest
  // compaction number to print.
  const compaction = tier2 ? tier2.data.cost - kpis.cost : null

  const sub: string[] = []
  if (perDay != null) sub.push(`≈ ${fmtUSD(perDay)}/day`)
  sub.push("excludes compaction usage")

  const label = filterCardLabel(directory, model)
  return (
    <section className="fcard" aria-label="Filtered totals">
      <div className="hero-label">
        Total cost{label ? ` · ${label}` : ""} · {rangeLabel(labelRange)}
      </div>
      <div className="hero-value">{fmtUSD(kpis.cost)}</div>
      <div className="hero-sub">{sub.join(" · ")}</div>
      <div className="statline">
        <div className="stat" title="from the filtered session rows">
          <b>{fmtTokens(kpis.tokens)}</b>
          <span>tokens</span>
        </div>
        <div className="stat" title="from the filtered session rows">
          <b>
            {fmtInt(kpis.sessions)} + {fmtInt(kpis.subagents)}
          </b>
          <span>sessions · subagents</span>
        </div>
        {tier2 && (
          <>
            <div className="stat" title="from the stats endpoint with project=">
              <b>
                {fmtInt(tier2.data.prompts)} / {fmtInt(tier2.data.steps)}
              </b>
              <span>
                prompts · steps <span className="st">stats</span>
              </span>
            </div>
            <div className="stat" title="from the stats endpoint with project=">
              <b>
                {fmtInt(tier2.data.activeDays)} ·{" "}
                {Number.isFinite(tier2.data.streak) ? `${tier2.data.streak}d` : "—"}
              </b>
              <span>
                active · streak <span className="st">stats</span>
              </span>
            </div>
            {compaction != null && compaction > 0 && (
              <div
                className="stat"
                title="stats total minus row-derived total — compaction usage not attributed to any session (footnote 1)"
              >
                <b>{fmtUSD(compaction)}</b>
                <span>
                  compaction <span className="st">stats</span>
                </span>
              </div>
            )}
          </>
        )}
      </div>
      {tier2 ? (
        <p className="fstat">
          tokens, sessions, subagents from the filtered rows · prompts, steps, activity from the stats
          endpoint with project= · compaction excluded, like footnote 1 says
        </p>
      ) : (
        <>
          <p className="note">
            {model
              ? "model-filtered: totals are client-side row sums and exclude compaction usage"
              : "project stats unavailable — totals are client-side row sums and exclude compaction usage"}
          </p>
          {model && (
            <p className="fstat">
              stats-only rows (prompts · steps, activity · streak) hide under a model filter; upstream
              has no model param
            </p>
          )}
        </>
      )}
    </section>
  )
}
