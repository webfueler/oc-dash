import type { ModelNames, SessionInfo } from "../api"
import { fmtInt, fmtTokens, fmtUSD, outcomeView, relTime } from "../format"
import { modelBaseKey, modelDisplayName } from "../filters"
import type { SessionNode } from "../tree"

/**
 * P2/P3/P4: the tree ships collapsed (an id is visible-expanded only when it
 * is in `expanded`); the parent row itself is the disclosure — click or
 * Enter/Space — with the "N subagents · M tokens · last activity" sub-line
 * as the only affordance. No caret, no tree column.
 */
export function SessionsTable({
  nodes,
  expanded,
  onToggle,
  names,
}: {
  nodes: SessionNode[]
  expanded: ReadonlySet<string>
  onToggle: (id: string) => void
  /** Mission 044: providerID/id -> display name; missing keys keep the raw id. */
  names?: ModelNames
}) {
  if (nodes.length === 0) return <p className="empty">No sessions in this range.</p>
  return (
    <table className="sessions">
      <thead>
        <tr>
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
      <tbody>{nodes.flatMap((n) => rows(n, 0, expanded, onToggle, names))}</tbody>
    </table>
  )
}

function rows(
  node: SessionNode,
  depth: number,
  expanded: ReadonlySet<string>,
  onToggle: (id: string) => void,
  names?: ModelNames,
): React.ReactElement[] {
  const out = [row(node, depth, expanded, onToggle, names)]
  if (expanded.has(node.session.id)) {
    for (const child of node.children) out.push(...rows(child, depth + 1, expanded, onToggle, names))
  }
  return out
}

function row(
  node: SessionNode,
  depth: number,
  expanded: ReadonlySet<string>,
  onToggle: (id: string) => void,
  names?: ModelNames,
): React.ReactElement {
  const s: SessionInfo = node.session
  const hasChildren = node.children.length > 0
  const isOpen = hasChildren && expanded.has(s.id)
  const indent = 34 + Math.max(0, depth - 1) * 18
  const model = s.model
  // Mission 044: the visible chip is the /api/model display name (the raw id
  // when the map has no entry — today's exact label); the hover title keeps
  // the raw provider/id and variant reachable.
  const fullModel = model
    ? `${model.providerID}/${model.id}${model.variant ? ` · ${model.variant}` : ""}`
    : undefined
  const shortModel = model
    ? `${modelDisplayName(modelBaseKey(model), names)}${model.variant ? ` · ${model.variant}` : ""}`
    : undefined
  const tokenTip = s.tokens
    ? `input ${fmtInt(s.tokens.input)} · output ${fmtInt(s.tokens.output)} · reasoning ${fmtInt(s.tokens.reasoning)} · cache read ${fmtInt(s.tokens.cache?.read)} · cache write ${fmtInt(s.tokens.cache?.write)}`
    : undefined
  const desc = hasChildren
    ? `${node.descendants} ${node.descendants === 1 ? "subagent" : "subagents"} · ${fmtTokens(node.inclTokens)} tokens · ${relTime(s.time?.updated)}`
    : depth === 0
      ? `no subagents · ${relTime(s.time?.updated)}`
      : undefined
  const outcome = outcomeView(s.outcome)
  const titleStyle = depth > 0 ? { paddingLeft: `${indent}px`, ["--indent" as string]: `${indent}px` } : undefined
  return (
    <tr
      className={`${s.parentID ? "child-row" : "root-row"}${hasChildren ? " togglable" : ""}`}
      aria-expanded={hasChildren ? isOpen : undefined}
      tabIndex={hasChildren ? 0 : undefined}
      onClick={hasChildren ? () => onToggle(s.id) : undefined}
      onKeyDown={
        hasChildren
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                onToggle(s.id)
              }
            }
          : undefined
      }
    >
      <td className="title" title={s.title ?? undefined} style={titleStyle}>
        {s.title ?? "(untitled)"}
        {desc && <div className="desc">{desc}</div>}
      </td>
      <td>{s.agent ?? "—"}</td>
      <td className="model">
        {model ? (
          <span className="mchip" title={fullModel}>
            {shortModel}
          </span>
        ) : (
          <span className="dim">—</span>
        )}
      </td>
      <td className="num">{fmtUSD(node.ownCost)}</td>
      <td className="num" title="own cost plus the cost of all descendants">
        {hasChildren ? (
          <>
            <span className="money">{fmtUSD(node.inclCost)}</span>{" "}
            <span className="dim">({node.descendants})</span>
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
        {outcome === "check" && (
          <span className="check" title="succeeded">
            ✓
          </span>
        )}
        {outcome === "badge" && s.outcome && <span className={`badge ${s.outcome}`}>{s.outcome}</span>}
        {outcome === "dim" && <span className="dim">—</span>}
      </td>
    </tr>
  )
}
