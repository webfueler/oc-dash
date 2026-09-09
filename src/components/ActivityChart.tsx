import { fmtInt } from "../format"
import type { ActivityDay } from "../api"
import { barLayout, chartData, fillDays } from "../chart"

const W = 720
const H = 160
const TOP_PAD = 20
const GRID_FRACTIONS = [0.25, 0.5, 0.75]

/**
 * Inline SVG bar chart of steps per day. No chart library. P5: bars are
 * width-capped and slot-centered, dotted gridlines mark 25/50/75%, zero-step
 * days stay visible as stubs, and Today renders the trailing 7 days with the
 * in-range day accented.
 */
export function ActivityChart({
  activity,
  contextActivity,
  accentDate,
}: {
  activity?: ActivityDay[]
  contextActivity?: ActivityDay[]
  accentDate?: string | null
}) {
  const { days: windowDays, usedContext } = chartData(activity, contextActivity)
  if (windowDays.length === 0) return <p className="empty">No activity in this range.</p>
  // Today shows the trailing 7 days; every range re-inserts zero-step days
  // that upstream omits so gaps stay visible.
  const days = fillDays(windowDays, usedContext ? 7 : undefined)
  const layout = barLayout(days, { width: W, height: H, topPad: TOP_PAD, accentDate: accentDate ?? null })
  const labelEvery = Math.max(1, Math.ceil(days.length / 8))
  return (
    <svg
      className="activity"
      viewBox={`0 0 ${W} ${H + 22}`}
      role="img"
      aria-label={`Steps per day, peak ${fmtInt(layout.max)}`}
    >
      <text x={0} y={12} className="tick">
        {fmtInt(layout.max)} steps max
      </text>
      {GRID_FRACTIONS.map((f) => (
        <line key={f} x1={0} y1={H - f * (H - TOP_PAD)} x2={W} y2={H - f * (H - TOP_PAD)} className="grid" />
      ))}
      {layout.bars.map((b, i) => (
        <g key={b.date}>
          <rect
            x={b.x}
            y={H - b.h}
            width={b.w}
            height={b.h}
            rx={2}
            className={b.steps === 0 ? "bar zero" : b.accent ? "bar" : "bar muted"}
          >
            <title>{`${b.date}: ${fmtInt(b.steps)} steps`}</title>
          </rect>
          {i % labelEvery === 0 && (
            <text x={b.x + b.w / 2} y={H + 16} textAnchor="middle" className="tick">
              {b.date.slice(5)}
            </text>
          )}
        </g>
      ))}
    </svg>
  )
}
