import { useState } from "react"
import type { SessionInfo } from "../api"
import { fmtInt, fmtTokens, fmtUSD, relTime } from "../format"
import type { SessionNode } from "../tree"

export function SessionsTable({ nodes }: { nodes: SessionNode[] }) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  if (nodes.length === 0) return <p className="empty">No sessions in this range.</p>
  return (
    <table className="sessions">
      <thead>
        <tr>
          <th className="tree-col" aria-label="Nesting" />
          <th>Session</th>
          <th>Agent</th>
          <th>Model</th>
          <th className="num">Own cost</th>
          <th className="num">Incl. subagents</th>
          <th className="num">Tokens</th>
          <th>Last activity</th>
          <th>Outcome</th>
        </tr>
      </thead>
      <tbody>
        {nodes.flatMap((n) => rows(n, 0, collapsed, toggle))}
      </tbody>
    </table>
  )
}

function rows(
  node: SessionNode,
  depth: number,
  collapsed: ReadonlySet<string>,
  toggle: (id: string) => void,
): React.ReactElement[] {
  const out = [row(node, depth, collapsed, toggle)]
  if (!collapsed.has(node.session.id)) {
    for (const child of node.children) out.push(...rows(child, depth + 1, collapsed, toggle))
  }
  return out
}

function row(
  node: SessionNode,
  depth: number,
  collapsed: ReadonlySet<string>,
  toggle: (id: string) => void,
): React.ReactElement {
  const s: SessionInfo = node.session
  const hasChildren = node.children.length > 0
  const isOpen = hasChildren && !collapsed.has(s.id)
  const model = s.model
    ? `${s.model.providerID}/${s.model.id}${s.model.variant ? ` · ${s.model.variant}` : ""}`
    : "—"
  const tokenTip = s.tokens
    ? `input ${fmtInt(s.tokens.input)} · output ${fmtInt(s.tokens.output)} · reasoning ${fmtInt(s.tokens.reasoning)} · cache read ${fmtInt(s.tokens.cache?.read)} · cache write ${fmtInt(s.tokens.cache?.write)}`
    : undefined
  return (
    <tr className={s.parentID ? "child-row" : "root-row"}>
      <td className="tree-col" style={{ paddingLeft: `${8 + depth * 18}px` }}>
        {hasChildren ? (
          <button
            type="button"
            className="chevron"
            aria-expanded={isOpen}
            aria-label={isOpen ? "Collapse subagents" : "Expand subagents"}
            onClick={() => toggle(s.id)}
          >
            {isOpen ? "▾" : "▸"}
          </button>
        ) : null}
      </td>
      <td className="title" title={s.title ?? undefined}>
        {s.title ?? "(untitled)"}
      </td>
      <td>{s.agent ?? "—"}</td>
      <td className="model" title={model}>
        {model}
      </td>
      <td className="num">{fmtUSD(node.ownCost)}</td>
      <td className="num" title="own cost plus the cost of all descendants">
        {hasChildren ? (
          <>
            {fmtUSD(node.inclCost)} <span className="dim">({node.descendants})</span>
          </>
        ) : (
          <span className="dim">—</span>
        )}
      </td>
      <td className="num" title={tokenTip}>
        {fmtTokens(node.ownTokens)}
      </td>
      <td>{relTime(s.time?.updated)}</td>
      <td>
        {s.outcome ? <span className={`badge ${s.outcome}`}>{s.outcome}</span> : <span className="dim">—</span>}
      </td>
    </tr>
  )
}
