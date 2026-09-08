import { describe, expect, it } from "vitest"
import type { SessionInfo, SessionStatsInfo, TokenUsage } from "./api"
import { sess } from "./tree.test"
import {
  fallbackTotals,
  kpisFromFallback,
  kpisFromStats,
  modelRows,
} from "./summary"

const zeroTokens: TokenUsage = {
  input: 0,
  output: 0,
  reasoning: 0,
  cache: { read: 0, write: 0 },
}

describe("unpriced detection", () => {
  it("flags models with tokens > 0 and cost == 0", () => {
    const stats = {
      models: [
        {
          model: { providerID: "github-copilot", id: "gpt-6-astra" },
          steps: 1,
          tokens: { input: 100, output: 5, reasoning: 0, cache: { read: 50, write: 0 } },
          cost: 0,
        },
      ],
    } as unknown as SessionStatsInfo
    const rows = modelRows(stats)
    expect(rows).toHaveLength(1)
    expect(rows[0].unpriced).toBe(true)
  })

  it("does not flag zero-token, zero-cost models", () => {
    const stats = {
      models: [
        {
          model: { providerID: "github-copilot", id: "gpt-6-astra" },
          steps: 1,
          tokens: zeroTokens,
          cost: 0,
        },
      ],
    } as unknown as SessionStatsInfo
    expect(modelRows(stats)[0].unpriced).toBe(false)
  })

  it("does not flag priced models", () => {
    const stats = {
      models: [
        {
          model: { providerID: "opencode-go", id: "glm-5.3-flash" },
          steps: 2928,
          tokens: { input: 100, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 4.43,
        },
      ],
    } as unknown as SessionStatsInfo
    expect(modelRows(stats)[0].unpriced).toBe(false)
  })

  it("sorts by cost descending and keeps unpriced rows in the list", () => {
    const stats = {
      models: [
        {
          model: { providerID: "a", id: "free" },
          steps: 2,
          tokens: { input: 10, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0,
        },
        {
          model: { providerID: "b", id: "paid" },
          steps: 3,
          tokens: { input: 10, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 1.5,
        },
      ],
    } as unknown as SessionStatsInfo
    const rows = modelRows(stats)
    expect(rows.map((r) => r.id)).toEqual(["paid", "free"])
    expect(rows[1].unpriced).toBe(true)
  })

  it("handles missing stats gracefully", () => {
    expect(modelRows(null)).toEqual([])
    expect(modelRows(undefined)).toEqual([])
  })
})

describe("fallback totals", () => {
  const rows: SessionInfo[] = [
    sess({
      id: "root1",
      cost: 0.5,
      tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 1000, write: 2 } },
    }),
    sess({
      id: "sub1",
      parentID: "root1",
      cost: 0.25,
      tokens: { input: 50, output: 10, reasoning: 1, cache: { read: 500, write: 0 } },
    }),
    sess({
      id: "sub2",
      parentID: "root1",
      cost: 0.125,
      tokens: zeroTokens,
    }),
    sess({ id: "root2", cost: 0.0625, tokens: zeroTokens }),
  ]

  it("sums costs across all rows", () => {
    expect(fallbackTotals(rows).cost).toBeCloseTo(0.9375, 6)
  })

  it("sums token buckets including cache", () => {
    const t = fallbackTotals(rows).tokens
    expect(t.input).toBe(150)
    expect(t.output).toBe(30)
    expect(t.reasoning).toBe(6)
    expect(t.cacheRead).toBe(1500)
    expect(t.cacheWrite).toBe(2)
  })

  it("counts sessions without parentID and subagents with one", () => {
    const t = fallbackTotals(rows)
    expect(t.sessions).toBe(2)
    expect(t.subagents).toBe(2)
  })

  it("reports stats-only fields as null", () => {
    const t = fallbackTotals(rows)
    expect(t.prompts).toBeNull()
    expect(t.steps).toBeNull()
    expect(t.activeDays).toBeNull()
    expect(t.streak).toBeNull()
  })

  it("returns zeros for an empty list", () => {
    const t = fallbackTotals([])
    expect(t.cost).toBe(0)
    expect(t.sessions).toBe(0)
    expect(t.subagents).toBe(0)
  })
})

describe("kpi view models", () => {
  it("maps stats totals and marks the source", () => {
    const k = kpisFromStats({
      range: { from: 0, to: 1 },
      sessions: 14,
      subagents: 75,
      prompts: 82,
      steps: 3628,
      tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
      cost: 5.5416,
      activeDays: 3,
      streak: 2,
      activity: [],
      models: [],
    } as SessionStatsInfo)
    expect(k.source).toBe("stats")
    expect(k.cost).toBeCloseTo(5.5416, 6)
    expect(k.tokens).toBe(15)
    expect(k.sessions).toBe(14)
    expect(k.subagents).toBe(75)
    expect(k.activeDays).toBe(3)
    expect(k.streak).toBe(2)
  })

  it("maps fallback totals and marks the source", () => {
    const k = kpisFromFallback(
      fallbackTotals([
        sess({ id: "a", cost: 1 }),
        sess({ id: "b", parentID: "a", cost: 0.5 }),
      ]),
    )
    expect(k.source).toBe("fallback")
    expect(k.cost).toBeCloseTo(1.5, 6)
    expect(k.sessions).toBe(1)
    expect(k.subagents).toBe(1)
    expect(k.prompts).toBeNull()
    expect(k.steps).toBeNull()
  })
})
