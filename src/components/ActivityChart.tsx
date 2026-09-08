import { fmtInt } from "../format"
import type { ActivityDay } from "../api"

const W = 720
const H = 160

/** Inline SVG bar chart of steps per day. No chart library. */
export function ActivityChart({ activity }: { activity?: ActivityDay[] }) {
  const data = activity ?? []
  if (data.length === 0) return <p className="empty">No activity in this range.</p>
  const max = Math.max(...data.map((d) => d.steps), 1)
  const bw = W / data.length
  const labelEvery = Math.max(1, Math.ceil(data.length / 8))
  return (
    <svg
      className="activity"
      viewBox={`0 0 ${W} ${H + 22}`}
      role="img"
      aria-label={`Steps per day, peak ${fmtInt(max)}`}
    >
      <text x={0} y={12} className="tick">
        {fmtInt(max)} steps max
      </text>
      {data.map((d, i) => {
        const h = d.steps > 0 ? Math.max(2, (d.steps / max) * (H - 20)) : 0
        return (
          <g key={d.date}>
            {h > 0 && (
              <rect
                x={i * bw + 1}
                y={H - h}
                width={Math.max(1, bw - 2)}
                height={h}
                className="bar"
                rx={2}
              >
                <title>{`${d.date}: ${fmtInt(d.steps)} steps`}</title>
              </rect>
            )}
            {i % labelEvery === 0 && (
              <text x={i * bw + bw / 2} y={H + 16} textAnchor="middle" className="tick">
                {d.date.slice(5)}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}
