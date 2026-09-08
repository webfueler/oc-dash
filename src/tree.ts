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
