import { describe, expect, it } from "vitest"
import type { SessionInfo, TokenUsage } from "./api"
import { buildTree, tokenTotal, type SessionNode } from "./tree"

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
