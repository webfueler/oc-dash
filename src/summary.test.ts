import { describe, expect, it } from "vitest"
import type {
  Range,
  SessionInfo,
  SessionStatsInfo,
  SessionsPayload,
  SummaryDegraded,
  SummaryOk,
  TokenUsage,
} from "./api"
import { sess } from "./tree.test"
import {
  costPerDay,
  fallbackTotals,
  heroRange,
  kpisFromFallback,
  kpisFromStats,
  modelRows,
  rangeLabel,
  todayAccentDate,
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

describe("P1 hero mapping", () => {
  it("labels every range", () => {
    expect(rangeLabel("today")).toBe("today")
    expect(rangeLabel("7d")).toBe("last 7 days")
    expect(rangeLabel("30d")).toBe("last 30 days")
    expect(rangeLabel("all")).toBe("all time")
  })

  it("spreads cost over 7 and 30 days", () => {
    expect(costPerDay(7, "7d")).toBeCloseTo(1, 6)
    expect(costPerDay(3, "30d")).toBeCloseTo(0.1, 6)
  })

  it("omits the per-day figure for today", () => {
    expect(costPerDay(7, "today")).toBeNull()
  })

  it("derives the day count from the stats window for all", () => {
    const window = { from: 0, to: 5 * 86_400_000 }
    expect(costPerDay(10, "all", window)).toBeCloseTo(2, 6)
  })

  it("omits the per-day figure for all without a usable stats window", () => {
    expect(costPerDay(10, "all")).toBeNull()
    expect(costPerDay(10, "all", { from: 5, to: 5 })).toBeNull()
    expect(costPerDay(10, "all", { from: 10, to: 5 })).toBeNull()
  })

  it("treats non-finite cost as unpriced rather than a number", () => {
    expect(costPerDay(Number.NaN, "7d")).toBeNull()
  })
})

/** Minimal healthy summary envelope for one preset; data fields are dummies. */
const statsOk = (preset: Range): SummaryOk => ({
  degraded: false,
  range: { preset },
  timezone: "UTC",
  data: {
    range: { from: 0, to: 1 },
    sessions: 1,
    subagents: 0,
    prompts: 0,
    steps: 0,
    tokens: zeroTokens,
    cost: 1,
    activeDays: 1,
    streak: 1,
    activity: [],
    models: [],
  },
})

describe("mission 008: hero label and payload in lockstep", () => {
  const degraded = (preset: Range): SummaryDegraded => ({
    degraded: true,
    range: { preset },
    timezone: "UTC",
    reason: "stats unavailable",
  })
  const sessionsFor = (preset: Range): SessionsPayload => ({
    range: { preset },
    count: 1,
    pages: 1,
    truncated: false,
    data: [sess({ id: "s1" })],
  })

  it("labels the hero from the summary payload, not the active range", () => {
    // A switch to 7d while the 30d payload is still on screen: the hero must
    // keep describing the numbers it shows (007's F1).
    expect(heroRange(statsOk("30d"), sessionsFor("7d"), "7d")).toBe("30d")
    expect(heroRange(statsOk("7d"), sessionsFor("7d"), "30d")).toBe("7d")
  })

  it("agrees with the active range once the payloads settle", () => {
    expect(heroRange(statsOk("7d"), sessionsFor("7d"), "7d")).toBe("7d")
    expect(heroRange(statsOk("today"), sessionsFor("today"), "today")).toBe("today")
  })

  it("falls back to the session list's preset in degraded mode", () => {
    // Degraded totals come from the session rows, so that payload owns the label.
    expect(heroRange(degraded("today"), sessionsFor("7d"), "today")).toBe("7d")
  })

  it("follows the session list when no summary has landed", () => {
    expect(heroRange(null, sessionsFor("30d"), "7d")).toBe("30d")
  })

  it("falls back to the active range when no payload is available", () => {
    expect(heroRange(null, null, "all")).toBe("all")
    expect(heroRange(degraded("7d"), null, "7d")).toBe("7d")
  })
})

describe("mission 008: today accent from the payload's own preset", () => {
  // Local noon on a fixed date, so isoDate is timezone-independent.
  const from = new Date(2026, 8, 9, 12).getTime()

  it("accents the in-range day of a today payload", () => {
    const s = statsOk("today")
    s.data.range = { from, to: from + 1 }
    expect(todayAccentDate(s)).toBe("2026-09-09")
  })

  it("never accents a non-today payload, even one with a window", () => {
    // 007's F2: a stale non-today summary resolving while the Today tab is
    // active used to yield an accent date matching no bar (all bars muted).
    for (const preset of ["7d", "30d", "all"] as Range[]) {
      const s = statsOk(preset)
      s.data.range = { from, to: from + 1 }
      expect(todayAccentDate(s)).toBeNull()
    }
  })

  it("returns null without a window start or without a payload", () => {
    const s = statsOk("today")
    s.data.range = { to: from } as unknown as SessionStatsInfo["range"]
    expect(todayAccentDate(s)).toBeNull()
    expect(todayAccentDate(undefined)).toBeNull()
    expect(todayAccentDate(null)).toBeNull()
  })
})
