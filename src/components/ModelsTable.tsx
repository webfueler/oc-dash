import { fmtInt, fmtTokens, fmtUSD } from "../format"
import type { ModelRow } from "../summary"
import type { ModelNames } from "../api"

export function ModelsTable({ rows, names }: { rows: ModelRow[]; names?: ModelNames }) {
  if (rows.length === 0) return <p className="empty">No model usage in this range.</p>
  return (
    <table className="models">
      <thead>
        <tr>
          <th>Model</th>
          <th className="num">Steps</th>
          <th className="num">Tokens</th>
          <th className="num">Cost</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => {
          const base = `${m.providerID}/${m.id}`
          // Mission 044: the visible name is the /api/model display name when
          // mapped, today's raw "providerID/id · variant" otherwise; the raw
          // form stays reachable as the hover title and the row key.
          const full = `${base}${m.variant ? ` · ${m.variant}` : ""}`
          // Fallback is the full raw base, not the short form: HEAD rendered
          // "providerID/id · variant" before mission 044.
          const name = `${names?.[base] || base}${m.variant ? ` · ${m.variant}` : ""}`
          return (
            <tr key={full}>
              <td className="model" title={full}>
                {name}
                {m.unpriced && (
                  <span className="badge warn unpriced" title="Tokens were spent but the provider reports no price data">
                    unpriced
                  </span>
                )}
              </td>
              <td className="num">{fmtInt(m.steps)}</td>
              <td className="num">{fmtTokens(m.tokens)}</td>
              <td className="num">{fmtUSD(m.cost)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
