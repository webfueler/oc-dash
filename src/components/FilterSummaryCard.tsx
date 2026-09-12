import type { Range, SessionInfo, SessionsPayload, SummaryResponse } from "../api"
import { fmtInt, fmtTokens, fmtUSD } from "../format"
import {
  cardMoney,
  cardRange,
  costPerDay,
  fallbackTotals,
  filterCardLabel,
  filterCardTier,
  kpisFromFallback,
  moneyNote,
  moneySubLine,
  projectStatsUsable,
  rangeLabel,
} from "../summary"

/**
 * Mission 014 (PD, Q4a + Q5a): the filtered-totals card. Renders below the
 * hero whenever any filter is active (Q5a) — no state of its own — and
 * recomputes from the payloads the 30-second poll already replaces.
 *
 * Row tiles (always): tokens, sessions, subagents, client-side from the
 * post-filter session rows via the fallbackTotals pattern.
 *
 * Mission 026: the MONEY is resolved by cardMoney from the message-level
 * stats engine — the global payload's models[] row under a model filter,
 * the per-project payload totals under a directory filter, the per-project
 * models[] rows under directory+model. Mission 028 (H1): the directory
 * money is exact only when every project id behind the directory is
 * exclusive to it and the walk is not truncated; otherwise the whole money
 * is the row sum. Fallback money is visibly labeled approximate (the "≈" on
 * the value plus the sub line); a stats-row-absent-vs-sessions-labeled
 * disagreement surfaces as a conflict note instead of either number showing
 * silently. Mission 028 (M1): every note and sub-line is true of the number
 * it accompanies — stats money excludes compaction usage, the row sum
 * includes it plus upstream drift.
 *
 * Tier-2 tiles (project filter only, no model filter): prompts · steps and
 * active · streak plus the compaction gap, from the /api/summary response's
 * projectStats payload for the directory's primary project id. The echoed
 * project id is checked against the filter on screen before the tiles
 * render, so a stale payload can never dress its numbers as the current
 * filter's. If projectStats is missing — upstream failure or a payload
 * from before the field existed — the card degrades to tier 1 with the
 * honest note, never an error surface.
 */
export function FilterSummaryCard({
  rows,
  directory,
  model,
  summary,
  sessions,
  activeRange,
  projectIDs,
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
   * ALL project ids behind the directory filter (mission 026 — a
   * directory can map to more than one), empty when none. The per-project
   * stats payloads are matched against these ids; index 0 is the primary
   * id whose payload feeds the tier-2 tiles.
   */
  projectIDs: string[]
}) {
  // Tier 1 is the exact fallback pipeline the hero's degraded mode uses:
  // row sums for tokens, sessions, subagents, with the stats-only fields
  // null. The MONEY comes from cardMoney (mission 026) — exact when the
  // stats route serves the combination, the row sum labeled approximate
  // when it cannot.
  const kpis = kpisFromFallback(fallbackTotals(rows))
  const labelRange = cardRange(sessions, activeRange)
  const okSummary = summary && !summary.degraded ? summary : undefined
  const money = cardMoney({
    directory,
    model,
    rows,
    sessions,
    summary: okSummary,
    projectStats: okSummary?.projectStats,
    projectIDs,
  })
  const exact = money.source === "stats"
  const statsWindow =
    summary && !summary.degraded && summary.range.preset === labelRange ? summary.data.range : undefined
  const perDay = costPerDay(money.cost, labelRange, statsWindow)

  const wantsTier2 = filterCardTier(directory, model) === "tier2"
  const primaryProjectID = projectIDs[0] ?? null
  const ps =
    wantsTier2 && primaryProjectID != null
      ? okSummary?.projectStats?.find((p) => p.project === primaryProjectID)
      : undefined
  const tier2 =
    ps && projectStatsUsable(ps.data, kpis.sessions ?? 0, kpis.subagents ?? 0) ? ps : undefined

  // The compaction gap: the stats total minus the row-derived total, the
  // same delta footnote 1 describes. Only shown when it is positive; a
  // negative gap means drift ran the other way and there is no honest
  // compaction number to print.
  const compaction = tier2 ? tier2.data.cost - kpis.cost : null

  const sub: string[] = []
  if (perDay != null) sub.push(`≈ ${fmtUSD(perDay)}/day`)
  // Mission 028 (M1): the sub-line comes from the shared helper so the copy
  // is pinned by tests — true of the number it accompanies on every path.
  sub.push(moneySubLine(money, model))

  const label = filterCardLabel(directory, model)
  return (
    <section className="fcard" aria-label="Filtered totals">
      <div className="hero-label">
        Total cost{label ? ` · ${label}` : ""} · {rangeLabel(labelRange)}
      </div>
      <div className="hero-value">
        {!exact && "≈ "}
        {fmtUSD(money.cost)}
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
          tokens, sessions, subagents from the filtered rows · {moneyNote(money, "")} ·{" "}
          prompts, steps, activity from the stats endpoint with project=
        </p>
      ) : (
        <>
          <p className="note">
            {model
              ? exact
                ? `model-filtered: ${moneyNote(money, model)} · tokens, sessions, subagents from the filtered rows`
                : `model-filtered: stats could not serve this cut — ${moneyNote(money, model)}`
              : `project stats unavailable — ${moneyNote(money, "")}`}
          </p>
          {model && (
            <p className="fstat">
              stats-only tiles (prompts · steps, activity · streak) hide under a model filter
            </p>
          )}
        </>
      )}
      {money.conflict && (
        <p className="note">
          conflict: the stats endpoint reports no usage for this model while{" "}
          {fmtInt(rows.length)} filtered session {rows.length === 1 ? "row is" : "rows are"}{" "}
          labeled it — showing the row sum as approximate
        </p>
      )}
    </section>
  )
}
