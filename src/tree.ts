import type { SessionInfo, TokenUsage } from "./api"

export interface SessionNode {
  session: SessionInfo
  children: SessionNode[]
  ownCost: number
  ownTokens: number
  /** own + all descendants, at any nesting depth */
  inclCost: number
  inclTokens: number
  /** number of descendants at any depth */
  descendants: number
}

/** Every node id that has children, at any depth — the "Expand all" set. */
export function allParentIds(nodes: Iterable<SessionNode>): string[] {
  const ids: string[] = []
  const walk = (list: SessionNode[]): void => {
    for (const n of list) {
      if (n.children.length > 0) {
        ids.push(n.session.id)
        walk(n.children)
      }
    }
  }
  walk([...nodes])
  return ids
}

/** Sum of every token bucket, cache read and write included. */
export function tokenTotal(t?: TokenUsage): number {
  if (!t) return 0
  return (
    (t.input ?? 0) +
    (t.output ?? 0) +
    (t.reasoning ?? 0) +
    (t.cache?.read ?? 0) +
    (t.cache?.write ?? 0)
  )
}

/**
 * Nest child sessions (parentID) under their parents. Sessions whose parent
 * is missing from the list, or that sit on a parent cycle, are promoted to
 * roots. Children keep the input list order.
 */
export function buildTree(sessions: SessionInfo[]): SessionNode[] {
  const byId = new Map<string, SessionInfo>()
  for (const s of sessions) byId.set(s.id, s)

  const childrenOf = new Map<string, SessionInfo[]>()
  const roots: SessionInfo[] = []
  for (const s of sessions) {
    const parent = s.parentID
    if (parent && parent !== s.id && byId.has(parent)) {
      const siblings = childrenOf.get(parent) ?? []
      siblings.push(s)
      childrenOf.set(parent, siblings)
    } else {
      roots.push(s)
    }
  }

  const nodes = new Map<string, SessionNode>()
  const visited = new Set<string>()

  const make = (s: SessionInfo): SessionNode => {
    const existing = nodes.get(s.id)
    if (existing) return existing
    visited.add(s.id)
    const kids = (childrenOf.get(s.id) ?? [])
      .filter((k) => !visited.has(k.id))
      .map(make)
    const ownCost = s.cost ?? 0
    const ownTokens = tokenTotal(s.tokens)
    let inclCost = ownCost
    let inclTokens = ownTokens
    for (const k of kids) {
      inclCost += k.inclCost
      inclTokens += k.inclTokens
    }
    const descendants = kids.reduce((acc, k) => acc + 1 + k.descendants, 0)
    const node: SessionNode = {
      session: s,
      children: kids,
      ownCost,
      ownTokens,
      inclCost,
      inclTokens,
      descendants,
    }
    nodes.set(s.id, node)
    return node
  }

  const rootNodes = roots.map(make)
  // Recovery for parent cycles: anything the DFS could not reach from a root
  // becomes a root itself so no session disappears from the table.
  for (const s of sessions) {
    if (!visited.has(s.id)) rootNodes.push(make(s))
  }
  return rootNodes
}

/**
 * Mission 058: the sortable Sessions columns. Each key maps to the value its
 * column displays — Own cost -> `ownCost`, Incl. subagents -> `inclCost`,
 * Tokens -> `ownTokens`. `inclTokens` only rides along in a parent's
 * sub-line, so it is deliberately not a basis.
 */
export type SortKey = "own" | "incl" | "tokens"

/** The active column and direction; `null` state means no sort (base order). */
export interface SortState {
  key: SortKey
  dir: "asc" | "desc"
}

const SORT_VALUE: Record<SortKey, (n: SessionNode) => number> = {
  own: (n) => n.ownCost,
  incl: (n) => n.inclCost,
  tokens: (n) => n.ownTokens,
}

/**
 * Mission 058: one header activation's transition — default -> ascending ->
 * descending -> default. A different column starts at ascending, which also
 * returns the previous column to default (the state holds one column).
 */
export function nextSortState(current: SortState | null, key: SortKey): SortState | null {
  if (!current || current.key !== key) return { key, dir: "asc" }
  return current.dir === "asc" ? { key, dir: "desc" } : null
}

/** Tiebreak: `time.updated` descending, a missing timestamp last, ties stable. */
function compareUpdated(a: SessionNode, b: SessionNode): number {
  const av: number | undefined = a.session.time?.updated
  const bv: number | undefined = b.session.time?.updated
  if (av === bv) return 0
  if (av === undefined) return 1
  if (bv === undefined) return -1
  return bv - av
}

/**
 * Mission 058: the Sessions table's column sort. `null` state returns the
 * post-filter tree untouched — the default base (input) order. Otherwise
 * roots and siblings at every level order by the chosen column's displayed
 * value, ascending or descending, with `time.updated` descending as the
 * tiebreak. Returns new arrays and new node objects; the memoized tree is
 * never mutated, so expansion state and rendered values stay consistent.
 */
export function sortNodes(nodes: SessionNode[], state: SortState | null): SessionNode[] {
  if (!state) return nodes
  const value = SORT_VALUE[state.key]
  const sign = state.dir === "asc" ? 1 : -1
  const compare = (a: SessionNode, b: SessionNode): number => {
    // 0 (and any NaN, which JSON numbers cannot produce) falls through to
    // the tiebreak.
    const diff = (value(a) - value(b)) * sign
    if (diff) return diff
    return compareUpdated(a, b)
  }
  const sortLevel = (list: SessionNode[]): SessionNode[] =>
    [...list].sort(compare).map((n) => ({ ...n, children: sortLevel(n.children) }))
  return sortLevel(nodes)
}
