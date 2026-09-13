import { describe, expect, it } from "vitest"
import type { SessionInfo, TokenUsage } from "./api"
import { allParentIds, buildTree, nextSortState, sortNodes, tokenTotal, type SessionNode } from "./tree"

export function sess(partial: Partial<SessionInfo> & { id: string }): SessionInfo {
  return {
    projectID: "proj",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
    location: { directory: "/tmp/proj" },
    ...partial,
  }
}

describe("tokenTotal", () => {
  it("sums every bucket including cache read and write", () => {
    const t: TokenUsage = {
      input: 10,
      output: 20,
      reasoning: 30,
      cache: { read: 400, write: 500 },
    }
    expect(tokenTotal(t)).toBe(960)
  })

  it("returns 0 for missing usage", () => {
    expect(tokenTotal(undefined)).toBe(0)
  })
})

describe("buildTree", () => {
  it("nests children under their parent", () => {
    const parent = sess({ id: "p" })
    const child = sess({ id: "c", parentID: "p" })
    const tree = buildTree([child, parent])
    expect(tree).toHaveLength(1)
    expect(tree[0].session.id).toBe("p")
    expect(tree[0].children.map((n) => n.session.id)).toEqual(["c"])
  })

  it("promotes orphans whose parent is missing from the list", () => {
    const orphan = sess({ id: "o", parentID: "ghost" })
    const tree = buildTree([orphan])
    expect(tree).toHaveLength(1)
    expect(tree[0].session.id).toBe("o")
    expect(tree[0].children).toHaveLength(0)
  })

  it("supports deep chains: parent, child, grandchild", () => {
    const a = sess({ id: "a" })
    const b = sess({ id: "b", parentID: "a" })
    const c = sess({ id: "c", parentID: "b" })
    const tree = buildTree([c, b, a])
    expect(tree).toHaveLength(1)
    expect(tree[0].children[0].children[0].session.id).toBe("c")
  })

  it("keeps the input list order for roots", () => {
    const first = sess({ id: "first" })
    const second = sess({ id: "second" })
    const tree = buildTree([first, second])
    expect(tree.map((n) => n.session.id)).toEqual(["first", "second"])
  })

  it("breaks parent cycles without losing any session", () => {
    const x = sess({ id: "x", parentID: "y" })
    const y = sess({ id: "y", parentID: "x" })
    const tree = buildTree([x, y])
    // The first cycle member anchors as a root; nothing disappears and the
    // walk terminates.
    const seen: string[] = []
    const walk = (nodes: SessionNode[]): void => {
      for (const n of nodes) {
        seen.push(n.session.id)
        walk(n.children)
      }
    }
    walk(tree)
    expect(seen.sort()).toEqual(["x", "y"])
    expect(tree).toHaveLength(1)
  })

  it("treats a self-referencing session as a root", () => {
    const s = sess({ id: "s", parentID: "s" })
    expect(buildTree([s])).toHaveLength(1)
  })

  it("lists every togglable id for Expand all, at any depth", () => {
    const a = sess({ id: "a" })
    const b = sess({ id: "b", parentID: "a" })
    const c = sess({ id: "c", parentID: "b" })
    const leaf = sess({ id: "leaf" })
    const tree = buildTree([c, b, leaf, a])
    // b has a child (c) even though it is itself a child row.
    expect(allParentIds(tree)).toEqual(["a", "b"])
  })

  it("returns nothing when no session has children", () => {
    expect(allParentIds(buildTree([sess({ id: "x" }), sess({ id: "y" })]))).toEqual([])
    expect(allParentIds(buildTree([]))).toEqual([])
  })
})

describe("recursive rollup", () => {
  it("includes own cost plus all descendants at any depth", () => {
    const a = sess({ id: "a", cost: 1 })
    const b = sess({ id: "b", parentID: "a", cost: 2 })
    const c = sess({ id: "c", parentID: "b", cost: 4 })
    const tree = buildTree([c, b, a])
    expect(tree[0].ownCost).toBe(1)
    expect(tree[0].inclCost).toBe(7) // 1 + 2 + 4
    expect(tree[0].descendants).toBe(2)
    expect(tree[0].children[0].inclCost).toBe(6) // 2 + 4
    expect(tree[0].children[0].descendants).toBe(1)
  })

  it("rolls tokens the same way", () => {
    const a = sess({
      id: "a",
      tokens: { input: 100, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    })
    const b = sess({
      id: "b",
      parentID: "a",
      tokens: { input: 0, output: 200, reasoning: 0, cache: { read: 1000, write: 0 } },
    })
    const tree = buildTree([b, a])
    expect(tree[0].ownTokens).toBe(100)
    expect(tree[0].inclTokens).toBe(1300) // 100 + 1200
  })

  it("leaves leaves unchanged", () => {
    const leaf = sess({ id: "leaf", cost: 3, tokens: { input: 7, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } })
    const tree = buildTree([leaf])
    expect(tree[0].inclCost).toBe(3)
    expect(tree[0].inclTokens).toBe(7)
    expect(tree[0].descendants).toBe(0)
  })

  it("sums across multiple child branches", () => {
    const parent = sess({ id: "p", cost: 1 })
    const c1 = sess({ id: "c1", parentID: "p", cost: 2 })
    const c2 = sess({ id: "c2", parentID: "p", cost: 3 })
    const gc = sess({ id: "gc", parentID: "c2", cost: 4 })
    const tree = buildTree([c1, gc, c2, parent])
    expect(tree[0].inclCost).toBe(10)
    expect(tree[0].descendants).toBe(3)
  })

  it("exceeds own cost when subagents spend more", () => {
    const parent = sess({ id: "p", cost: 0.6948 })
    const child = sess({ id: "c", parentID: "p", cost: 1.5 })
    const tree = buildTree([child, parent])
    expect(tree[0].inclCost).toBeCloseTo(2.1948, 6)
    expect(tree[0].inclCost).toBeGreaterThan(tree[0].ownCost)
  })
})

const tok = (input: number): TokenUsage => ({
  input,
  output: 0,
  reasoning: 0,
  cache: { read: 0, write: 0 },
})

/** Pre-order ids, the order the table walks (children follow their parent). */
const idsOf = (nodes: SessionNode[]): string[] => {
  const out: string[] = []
  const walk = (list: SessionNode[]): void => {
    for (const n of list) {
      out.push(n.session.id)
      walk(n.children)
    }
  }
  walk(nodes)
  return out
}

describe("sortNodes", () => {
  /**
   * Mission 058: the fixture separates all three keys — own, incl, and
   * tokens orders all differ — and `a`'s subagent carries tokens so the
   * token basis cannot be swapped for the `inclTokens` rollup (100 vs 1100).
   *   ownCost:   a=1  < c=3  < b=5
   *   inclCost:  c=3  < b=5  < a=11
   *   ownTokens: c=50 < a=100 < b=500
   */
  const threeRoots = () =>
    buildTree([
      sess({ id: "a", cost: 1, tokens: tok(100) }),
      sess({ id: "b", cost: 5, tokens: tok(500) }),
      sess({ id: "c", cost: 3, tokens: tok(50) }),
      sess({ id: "ax", parentID: "a", cost: 10, tokens: tok(1000) }),
    ])

  it("orders Own cost both ways by ownCost", () => {
    expect(idsOf(sortNodes(threeRoots(), { key: "own", dir: "asc" }))).toEqual([
      "a",
      "ax",
      "c",
      "b",
    ])
    expect(idsOf(sortNodes(threeRoots(), { key: "own", dir: "desc" }))).toEqual([
      "b",
      "c",
      "a",
      "ax",
    ])
  })

  it("orders Incl. subagents both ways by inclCost", () => {
    expect(idsOf(sortNodes(threeRoots(), { key: "incl", dir: "asc" }))).toEqual([
      "c",
      "b",
      "a",
      "ax",
    ])
    expect(idsOf(sortNodes(threeRoots(), { key: "incl", dir: "desc" }))).toEqual([
      "a",
      "ax",
      "b",
      "c",
    ])
  })

  it("orders Tokens both ways by ownTokens, not the inclTokens rollup", () => {
    expect(idsOf(sortNodes(threeRoots(), { key: "tokens", dir: "asc" }))).toEqual([
      "c",
      "a",
      "ax",
      "b",
    ])
    expect(idsOf(sortNodes(threeRoots(), { key: "tokens", dir: "desc" }))).toEqual([
      "b",
      "a",
      "ax",
      "c",
    ])
  })

  it("breaks value ties by time.updated descending, missing last, stable on full ties", () => {
    const older = sess({ id: "older", cost: 2, time: { created: 0, updated: 100 } })
    const newer = sess({ id: "newer", cost: 2, time: { created: 0, updated: 300 } })
    // The API type requires `updated`, but payload rows can omit it.
    const missing = sess({
      id: "missing",
      cost: 2,
      time: { created: 0, updated: undefined as unknown as number },
    })
    const alsoMissing = sess({
      id: "alsomissing",
      cost: 2,
      time: { created: 0, updated: undefined as unknown as number },
    })
    const nodes = buildTree([older, newer, missing, alsoMissing])
    // The tiebreak is direction-independent: newer first, then older, then
    // both missing rows in their base (input) order.
    expect(idsOf(sortNodes(nodes, { key: "own", dir: "asc" }))).toEqual([
      "newer",
      "older",
      "missing",
      "alsomissing",
    ])
    expect(idsOf(sortNodes(nodes, { key: "own", dir: "desc" }))).toEqual([
      "newer",
      "older",
      "missing",
      "alsomissing",
    ])
  })

  it("orders siblings under every parent, not just the roots", () => {
    const p = sess({ id: "p" })
    const cLight = sess({ id: "cl", parentID: "p", cost: 1 })
    const cHeavy = sess({ id: "ch", parentID: "p", cost: 5 })
    const gcA = sess({ id: "ga", parentID: "cl", cost: 2 })
    const gcB = sess({ id: "gb", parentID: "cl", cost: 8 })
    const nodes = buildTree([cHeavy, gcB, gcA, cLight, p])
    expect(idsOf(sortNodes(nodes, { key: "own", dir: "asc" }))).toEqual(["p", "cl", "ga", "gb", "ch"])
    expect(idsOf(sortNodes(nodes, { key: "own", dir: "desc" }))).toEqual(["p", "ch", "cl", "gb", "ga"])
  })

  it("returns new arrays and node objects and leaves the input tree alone", () => {
    const nodes = threeRoots()
    const sorted = sortNodes(nodes, { key: "incl", dir: "asc" })
    expect(idsOf(sorted)).toEqual(["c", "b", "a", "ax"])
    // The memoized tree keeps its base order and its identity.
    expect(idsOf(nodes)).toEqual(["a", "ax", "b", "c"])
    const sortedA = sorted.find((n) => n.session.id === "a")
    const baseA = nodes.find((n) => n.session.id === "a")
    expect(sorted).not.toBe(nodes)
    expect(sortedA).not.toBe(baseA)
    expect(sortedA?.children).not.toBe(baseA?.children)
    expect(sortedA?.children[0]).not.toBe(baseA?.children[0])
    // Session rows themselves are shared, not cloned.
    expect(sortedA?.session).toBe(baseA?.session)
  })

  it("keeps the base order untouched in the default null state", () => {
    const nodes = buildTree([sess({ id: "second" }), sess({ id: "first" })])
    expect(sortNodes(nodes, null)).toBe(nodes)
    expect(idsOf(sortNodes(nodes, null))).toEqual(["second", "first"])
  })
})

describe("nextSortState", () => {
  it("cycles default -> ascending -> descending -> default", () => {
    const first = nextSortState(null, "own")
    expect(first).toEqual({ key: "own", dir: "asc" })
    const second = nextSortState(first, "own")
    expect(second).toEqual({ key: "own", dir: "desc" })
    expect(nextSortState(second, "own")).toBeNull()
  })

  it("starts a different column at ascending and replaces the previous one", () => {
    expect(nextSortState({ key: "own", dir: "desc" }, "tokens")).toEqual({
      key: "tokens",
      dir: "asc",
    })
    expect(nextSortState(null, "incl")).toEqual({ key: "incl", dir: "asc" })
  })
})
