import type { Range, SessionInfo, SessionsPayload, SummaryResponse } from "../api"
import { fmtInt, fmtTokens, fmtUSD } from "../format"
import {
  cardHeadline,
  cardRange,
  costPerDay,
  fallbackTotals,
  filterCardLabel,
  filterCardTier,
  kpisFromFallback,
  projectStatsUsable,
  rangeLabel,
  rowBasisSub,
  rowSecondaryLine,
  statsBasisSub,
} from "../summary"

/**
 * Mission 014 (PD, Q4a + Q5a): the filtered-totals card. Renders below the
 * hero whenever any filter is active (Q5a) — no state of its own — and
 * recomputes from the payloads the 30-second poll already replaces.
 *
 * Mission 018 (number hierarchy): the session walk returns sessions ACTIVE
 * in the range at full lifetime cost, while the upstream stats count
 * messages CREATED in the range. Wherever the project stats are available
 * (tier 2: project filter, no model filter), the HEADLINE is their cost —
 * the hero-comparable number — and the row-derived sum is demoted to a
 * clearly labeled secondary line below the tiles. Without tier 2 (model
 * filter, both filters, or the stats payload unavailable) the row-derived
 * cost stays the headline and the sub line states its basis. The old
 * compaction tile is gone: with the rows demoted, the stats-minus-rows
 * delta conflates the two bases (window semantics, not just compaction) and
 * no longer tells a true story on its own; the two labeled numbers carry it
 * instead.
 *
 * Tier 2's prompts · steps and active · streak tiles come from the
 * /api/summary response's additive projectStats field (one best-effort
 * upstream call with project=). The echoed project id is checked against
 * the filter on screen before anything renders, so a stale payload can
 * never dress its numbers as the current filter's. If projectStats is
 * missing — upstream failure or a payload from before the field existed —
 * the card degrades to the row-built headline with the honest note, never
 * an error surface.
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

  const wantsTier2 = filterCardTier(directory, model) === "tier2"
  const okSummary = summary && !summary.degraded ? summary : undefined
  const ps = wantsTier2 && projectID != null ? okSummary?.projectStats : undefined
  const tier2 =
    ps && ps.project === projectID && projectStatsUsable(ps.data, kpis.sessions ?? 0, kpis.subagents ?? 0)
      ? ps
      : undefined

  // Mission 018: the headline is the project stats' cost when tier 2
  // renders — the hero-comparable number — and the row sum otherwise. The
  // per-day figure follows whichever payload owns the headline.
  const headline = cardHeadline(tier2, kpis.cost)
  const headlinePerDay = costPerDay(
    headline.cost,
    labelRange,
    tier2 ? tier2.data.range : statsWindow,
  )
  const sub = headline.fromStats ? statsBasisSub(headlinePerDay) : rowBasisSub(headlinePerDay)

  const label = filterCardLabel(directory, model)
  return (
    <section className="fcard" aria-label="Filtered totals">
      <div className="hero-label">
        Total cost{label ? ` · ${label}` : ""} · {rangeLabel(labelRange)}
      </div>
      <div
        className="hero-value"
        title={
          headline.fromStats
            ? "from the stats endpoint with project= · the hero's own basis"
            : "from the filtered session rows · sessions active in range at full session cost"
        }
      >
        {fmtUSD(headline.cost)}
      </div>
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
          </>
        )}
      </div>
      {tier2 ? (
        <>
          <p className="hero-sub">{rowSecondaryLine(kpis.cost)}</p>
          <p className="fstat">
            headline cost from the stats endpoint with project= · tokens, sessions, subagents from the
            filtered session rows · prompts, steps, activity from the stats endpoint
          </p>
        </>
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
