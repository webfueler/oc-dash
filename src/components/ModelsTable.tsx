import { fmtInt, fmtTokens, fmtUSD } from "../format"
import type { ModelRow } from "../summary"

export function ModelsTable({ rows }: { rows: ModelRow[] }) {
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
          const name = `${m.providerID}/${m.id}${m.variant ? ` · ${m.variant}` : ""}`
          return (
            <tr key={name}>
              <td className="model" title={name}>
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
