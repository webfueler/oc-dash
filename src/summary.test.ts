import { describe, expect, it } from "vitest"
import type {
  ModelUsage,
  ProjectStats,
  Range,
  SessionInfo,
  SessionStatsInfo,
  SessionsPayload,
  SummaryDegraded,
  SummaryOk,
  TokenUsage,
} from "./api"
import { NO_MODEL_KEY, applyFilters } from "./filters"
import { sess } from "./tree.test"
import type { CardMoney, CardMoneyInput } from "./summary"
import {
  cardMoney,
  cardRange,
  costPerDay,
  fallbackTotals,
  filterCardLabel,
  filterCardTier,
  heroRange,
  kpisFromFallback,
  kpisFromStats,
  modelRows,
  moneyNote,
  moneySubLine,
  projectIDForDirectory,
  projectStatsUsable,
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

// Mission 014 (PD): the filtered-totals card's pure logic.
describe("mission 014: filter card gating (tier 2 needs project and no model)", () => {
  it("enables tier 2 for a project filter alone", () => {
    expect(filterCardTier("/tmp/proj", "")).toBe("tier2")
  })

  it("hides tier 2 for a model filter alone", () => {
    expect(filterCardTier("", "p/m")).toBe("tier1")
  })

  it("hides tier 2 when both filters are active", () => {
    // Upstream cannot apply the model cut, so the project stats would lie.
    expect(filterCardTier("/tmp/proj", "p/m")).toBe("tier1")
  })

  it("treats the no-model bucket as a model filter", () => {
    expect(filterCardTier("/tmp/proj", NO_MODEL_KEY)).toBe("tier1")
    expect(filterCardTier("", NO_MODEL_KEY)).toBe("tier1")
  })

  it("keeps tier 1 (not tier 2) when no filter is set", () => {
    expect(filterCardTier("", "")).toBe("tier1")
  })
})

describe("mission 014: project ids derived from the rows", () => {
  it("returns the directory's project ids, most common first", () => {
    const dirRows: SessionInfo[] = [
      sess({ id: "a", projectID: "proj" }),
      sess({ id: "b", projectID: "proj" }),
      sess({ id: "c", projectID: "other" }),
    ]
    expect(projectIDForDirectory(dirRows, "/tmp/proj")).toEqual(["proj", "other"])
  })

  it("counts only the directory's own rows", () => {
    const dirRows: SessionInfo[] = [
      sess({ id: "a", projectID: "proj" }),
      sess({ id: "b", projectID: "elsewhere", location: { directory: "/tmp/other" } }),
    ]
    expect(projectIDForDirectory(dirRows, "/tmp/proj")).toEqual(["proj"])
  })

  it("keeps the first seen order on a tie", () => {
    const dirRows: SessionInfo[] = [
      sess({ id: "a", projectID: "first" }),
      sess({ id: "b", projectID: "second" }),
    ]
    expect(projectIDForDirectory(dirRows, "/tmp/proj")).toEqual(["first", "second"])
  })

  it("returns every id behind a multi-id directory (mission 026)", () => {
    const dirRows: SessionInfo[] = [
      sess({ id: "a", projectID: "p1" }),
      sess({ id: "b", projectID: "p2" }),
      sess({ id: "c", projectID: "p1" }),
      sess({ id: "d", projectID: "p2" }),
    ]
    expect(projectIDForDirectory(dirRows, "/tmp/proj")).toEqual(["p1", "p2"])
  })

  it("returns empty when the filter matches nothing or rows lack the id", () => {
    expect(projectIDForDirectory([sess({ id: "a", projectID: "proj" })], "/tmp/nowhere")).toEqual([])
    const noID = sess({ id: "a" })
    delete (noID as { projectID?: string }).projectID
    expect(projectIDForDirectory([noID], "/tmp/proj")).toEqual([])
  })

  it("returns empty for no filter at all", () => {
    expect(projectIDForDirectory([sess({ id: "a", projectID: "proj" })], "")).toEqual([])
  })

  it("ignores stray rows without a project id while counting the rest", () => {
    const mixed: SessionInfo[] = [
      sess({ id: "a", projectID: "proj" }),
      sess({ id: "b", projectID: "proj" }),
    ]
    delete (mixed[1] as { projectID?: string }).projectID
    expect(projectIDForDirectory(mixed, "/tmp/proj")).toEqual(["proj"])
  })
})

describe("mission 014: filter card label", () => {
  it("uses the project basename, not the full path", () => {
    expect(filterCardLabel("/Users/joaosantos/Sites/personal/oc-setup", "")).toBe("oc-setup")
  })

  it("uses the model's short id form, no provider and no variant (mission 019)", () => {
    expect(filterCardLabel("", "opencode-go/glm-5.3-flash")).toBe("glm-5.3-flash")
  })

  it("renders the no-model bucket as 'no model'", () => {
    expect(filterCardLabel("", NO_MODEL_KEY)).toBe("no model")
  })

  it("joins both filters when both are active", () => {
    expect(filterCardLabel("/tmp/proj", "p/m")).toBe("proj · m")
  })

  it("is empty when no filter is set", () => {
    expect(filterCardLabel("", "")).toBe("")
  })

  it("uses the display name when the map has it, the short id otherwise (mission 044)", () => {
    expect(
      filterCardLabel("/tmp/proj", "opencode-go/glm-5.3-flash", {
        "opencode-go/glm-5.3-flash": "GLM 5.3 Flash",
      }),
    ).toBe("proj · GLM 5.3 Flash")
    expect(
      filterCardLabel("", "opencode-go/glm-5.3-flash", {
        "github-copilot/gpt-5.6-luna": "GPT 5.6 Luna",
      }),
    ).toBe("glm-5.3-flash")
    expect(filterCardLabel("", NO_MODEL_KEY, { "no-model": "bogus" })).toBe("no model")
  })
})

describe("mission 014: card label range tracks the rows' payload", () => {
  const sessionsFor = (preset: Range): SessionsPayload => ({
    range: { preset },
    count: 1,
    pages: 1,
    truncated: false,
    data: [sess({ id: "s1" })],
  })

  it("labels the card from the session payload, not the active range", () => {
    expect(cardRange(sessionsFor("30d"), "7d")).toBe("30d")
  })

  it("agrees with the active range once the payloads settle", () => {
    expect(cardRange(sessionsFor("7d"), "7d")).toBe("7d")
  })

  it("falls back to the active range when no payload is on screen", () => {
    expect(cardRange(null, "all")).toBe("all")
  })
})

describe("mission 014: tier-2 zeros guard", () => {
  it("accepts a payload that counts sessions", () => {
    expect(projectStatsUsable({ sessions: 15, subagents: 114 }, 129, 100)).toBe(true)
  })

  it("accepts zeros only when the rows themselves show none", () => {
    expect(projectStatsUsable({ sessions: 0, subagents: 0 }, 0, 0)).toBe(true)
    expect(projectStatsUsable({ sessions: 0, subagents: 0 }, 129, 100)).toBe(false)
  })

  it("treats a missing payload as unusable", () => {
    expect(projectStatsUsable(undefined, 129, 100)).toBe(false)
    expect(projectStatsUsable(null, 0, 0)).toBe(false)
  })
})

describe("mission 014: tier-1 totals come from the filtered rows", () => {
  // Two directories, two model triples, one subagent, so every filter
  // combination moves the numbers.
  const rows: SessionInfo[] = [
    sess({
      id: "r1",
      cost: 1,
      tokens: { input: 100, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
      model: { providerID: "p", id: "m", variant: "max" },
    }),
    sess({
      id: "r2",
      cost: 0.5,
      tokens: { input: 40, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
      model: { providerID: "p", id: "m", variant: "default" },
    }),
    sess({
      id: "s1",
      parentID: "r1",
      cost: 0.25,
      tokens: { input: 10, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
      model: { providerID: "p", id: "m", variant: "max" },
      location: { directory: "/tmp/other" },
    }),
  ]

  it("sums only the project filter's rows, subagents included", () => {
    const k = kpisFromFallback(fallbackTotals(applyFilters(rows, "/tmp/proj", "")))
    expect(k.cost).toBeCloseTo(1.5, 6)
    expect(k.tokens).toBe(155)
    expect(k.sessions).toBe(2)
    expect(k.subagents).toBe(0)
  })

  it("sums both variants' rows under the base model filter, across directories", () => {
    const k = kpisFromFallback(fallbackTotals(applyFilters(rows, "", "p/m")))
    expect(k.cost).toBeCloseTo(1.75, 6)
    expect(k.tokens).toBe(166)
    expect(k.sessions).toBe(2)
    expect(k.subagents).toBe(1)
  })

  it("sums the intersection when both filters are active", () => {
    const k = kpisFromFallback(fallbackTotals(applyFilters(rows, "/tmp/proj", "p/m")))
    expect(k.cost).toBeCloseTo(1.5, 6)
    expect(k.tokens).toBe(155)
    expect(k.sessions).toBe(2)
    expect(k.subagents).toBe(0)
  })

  it("keeps the stats-only fields null in every case", () => {
    for (const [dir, model] of [
      ["/tmp/proj", ""],
      ["", "p/m"],
      ["/tmp/proj", "p/m"],
    ] as const) {
      const k = kpisFromFallback(fallbackTotals(applyFilters(rows, dir, model)))
      expect(k.prompts).toBeNull()
      expect(k.steps).toBeNull()
      expect(k.activeDays).toBeNull()
      expect(k.streak).toBeNull()
    }
  })

  it("sums to zeros when the filters match nothing", () => {
    const k = kpisFromFallback(fallbackTotals(applyFilters(rows, "/tmp/nowhere", "")))
    expect(k.cost).toBe(0)
    expect(k.tokens).toBe(0)
    expect(k.sessions).toBe(0)
    expect(k.subagents).toBe(0)
  })
})

/**
 * Mission 026: the card-money resolver. Fixtures model the live shapes
 * from missions 024/025: a global stats payload with per-variant models[]
 * rows, and per-project payloads whose totals and rows can each be zeroed,
 * scoped, or missing.
 */

const mStats = (over: Partial<SessionStatsInfo> = {}): SessionStatsInfo => ({
  range: { from: 0, to: 1 },
  sessions: 2,
  subagents: 1,
  prompts: 3,
  steps: 4,
  tokens: zeroTokens,
  cost: 3,
  activeDays: 1,
  streak: 1,
  activity: [],
  models: [],
  ...over,
})

const mUsage = (
  providerID: string,
  id: string,
  variant: string | undefined,
  cost: number,
): ModelUsage => ({
  model: { providerID, id, variant },
  steps: 1,
  tokens: { input: 10, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  cost,
})

const mOk = (preset: Range, data: SessionStatsInfo): SummaryOk => ({
  degraded: false,
  range: { preset },
  timezone: "UTC",
  data,
})

const mSessions = (preset: Range, rows: SessionInfo[]): SessionsPayload => ({
  range: { preset },
  count: rows.length,
  pages: 1,
  truncated: false,
  data: rows,
})

const mProject = (project: string, data: SessionStatsInfo): ProjectStats => ({ project, data })

function mInput(over: Partial<CardMoneyInput>): CardMoneyInput {
  return {
    directory: "",
    model: "",
    rows: [],
    sessions: null,
    summary: undefined,
    projectStats: undefined,
    projectIDs: [],
    ...over,
  }
}

describe("mission 026: card money — model filter only", () => {
  const walk = [
    sess({ id: "a", cost: 1.25, model: { providerID: "p", id: "m", variant: "high" } }),
    sess({ id: "b", cost: 0.4, model: { providerID: "p", id: "m", variant: "max" } }),
    sess({ id: "c", cost: 9, model: { providerID: "p", id: "other" } }),
  ]
  const summary = mOk(
    "7d",
    mStats({
      models: [
        mUsage("p", "m", "high", 1.25),
        mUsage("p", "m", "max", 0.5),
        mUsage("p", "other", undefined, 9),
      ],
    }),
  )

  it("reads the global models[] row, all variants summed", () => {
    const r = cardMoney(
      mInput({
        model: "p/m",
        rows: [walk[0], walk[1]],
        sessions: mSessions("7d", walk),
        summary,
      }),
    )
    expect(r).toEqual({ cost: 1.75, source: "stats", conflict: false })
  })

  it("falls back with a conflict when stats has no row but sessions claim the model", () => {
    // The $0-vs-sessions edge: the models[] array exists but carries no row
    // for p/m, while the walk shows two sessions labeled p/m. Neither
    // number may show silently.
    const noRow = mOk("7d", mStats({ models: [mUsage("p", "other", undefined, 9)] }))
    const r = cardMoney(
      mInput({
        model: "p/m",
        rows: [walk[0], walk[1]],
        sessions: mSessions("7d", walk),
        summary: noRow,
      }),
    )
    expect(r).toEqual({ cost: 1.65, source: "fallback", conflict: true })
  })

  it("returns exact $0 when stats has no row and no session claims the model", () => {
    const noRow = mOk("7d", mStats({ models: [mUsage("p", "other", undefined, 9)] }))
    const r = cardMoney(
      mInput({
        model: "p/m",
        rows: [],
        sessions: mSessions("7d", [walk[2]]),
        summary: noRow,
      }),
    )
    expect(r).toEqual({ cost: 0, source: "stats", conflict: false })
  })

  it("falls back when the global payload fails the zeros guard", () => {
    const empty = mOk("7d", mStats({ sessions: 0, subagents: 0, cost: 0, models: [] }))
    const r = cardMoney(
      mInput({
        model: "p/m",
        rows: [walk[0]],
        sessions: mSessions("7d", walk),
        summary: empty,
      }),
    )
    expect(r.source).toBe("fallback")
  })

  it("falls back for the no-model bucket — stats has no row for it", () => {
    const r = cardMoney(
      mInput({
        model: NO_MODEL_KEY,
        rows: [sess({ id: "x", cost: 0.2 })],
        sessions: mSessions("7d", walk),
        summary,
      }),
    )
    expect(r).toEqual({ cost: 0.2, source: "fallback", conflict: false })
  })

  it("falls back when the payload's window does not match the session payload", () => {
    const r = cardMoney(
      mInput({
        model: "p/m",
        rows: [walk[0]],
        sessions: mSessions("7d", walk),
        summary: mOk("30d", mStats({ models: [mUsage("p", "m", "high", 5)] })),
      }),
    )
    expect(r.source).toBe("fallback")
  })
})

describe("mission 026: card money — directory filter only", () => {
  const walk = [
    sess({ id: "a", cost: 1, projectID: "p1" }),
    sess({ id: "b", cost: 2, projectID: "p1" }),
    sess({ id: "c", cost: 4, projectID: "p2" }),
  ]

  it("sums one project payload for a single-id directory", () => {
    const r = cardMoney(
      mInput({
        directory: "/tmp/proj",
        rows: [walk[0], walk[1]],
        sessions: mSessions("7d", walk),
        summary: mOk("7d", mStats()),
        projectStats: [mProject("p1", mStats({ cost: 2.5 }))],
        projectIDs: ["p1"],
      }),
    )
    expect(r).toEqual({ cost: 2.5, source: "stats", conflict: false })
  })

  it("sums both payloads for a two-id directory", () => {
    const r = cardMoney(
      mInput({
        directory: "/tmp/proj",
        rows: walk,
        sessions: mSessions("7d", walk),
        summary: mOk("7d", mStats()),
        projectStats: [
          mProject("p1", mStats({ cost: 2.5 })),
          mProject("p2", mStats({ cost: 1.25 })),
        ],
        projectIDs: ["p1", "p2"],
      }),
    )
    expect(r).toEqual({ cost: 3.75, source: "stats", conflict: false })
  })

  it("falls back when a payload is missing (fetch failure)", () => {
    const r = cardMoney(
      mInput({
        directory: "/tmp/proj",
        rows: walk,
        sessions: mSessions("7d", walk),
        summary: mOk("7d", mStats()),
        projectStats: [mProject("p1", mStats({ cost: 2.5 }))],
        projectIDs: ["p1", "p2"],
      }),
    )
    expect(r).toEqual({ cost: 7, source: "fallback", conflict: false })
  })

  it("applies the zeros guard per payload, not to the sum", () => {
    // p2's payload claims zero sessions while the walk shows one for p2 —
    // that payload is broken, so the whole combination degrades to the row
    // sum even though p1's payload looks fine.
    const r = cardMoney(
      mInput({
        directory: "/tmp/proj",
        rows: walk,
        sessions: mSessions("7d", walk),
        summary: mOk("7d", mStats()),
        projectStats: [
          mProject("p1", mStats({ cost: 2.5 })),
          mProject("p2", mStats({ cost: 0, sessions: 0, subagents: 0 })),
        ],
        projectIDs: ["p1", "p2"],
      }),
    )
    expect(r).toEqual({ cost: 7, source: "fallback", conflict: false })
  })

  it("treats a single all-zero payload as a failed fetch when its rows show sessions", () => {
    // The per-payload guard (024 follow-up caveat): an all-zero payload
    // means the fetch or scope failed — never a real $0 while the walk
    // shows sessions for that id.
    const r = cardMoney(
      mInput({
        directory: "/tmp/proj",
        rows: [walk[0], walk[1]],
        sessions: mSessions("7d", [walk[0], walk[1]]),
        summary: mOk("7d", mStats()),
        projectStats: [mProject("p1", mStats({ cost: 0, sessions: 0, subagents: 0 }))],
        projectIDs: ["p1"],
      }),
    )
    expect(r).toEqual({ cost: 3, source: "fallback", conflict: false })
  })

  it("falls back when no ids could be derived for the directory", () => {
    const r = cardMoney(
      mInput({
        directory: "/tmp/proj",
        rows: [sess({ id: "a", cost: 1 })],
        sessions: mSessions("7d", [sess({ id: "a", cost: 1 })]),
        summary: mOk("7d", mStats()),
        projectIDs: [],
      }),
    )
    expect(r.source).toBe("fallback")
  })
})

describe("mission 026: card money — directory AND model", () => {
  const walk = [
    sess({ id: "a", cost: 1, projectID: "p1", model: { providerID: "p", id: "m" } }),
    sess({ id: "b", cost: 4, projectID: "p2", model: { providerID: "p", id: "m" } }),
  ]

  it("sums the per-project models[] rows across ids", () => {
    const r = cardMoney(
      mInput({
        directory: "/tmp/proj",
        model: "p/m",
        rows: walk,
        sessions: mSessions("7d", walk),
        summary: mOk("7d", mStats()),
        projectStats: [
          mProject("p1", mStats({ cost: 9, models: [mUsage("p", "m", "high", 1.25), mUsage("p", "m", "max", 0.5)] })),
          mProject("p2", mStats({ cost: 9, models: [mUsage("p", "m", "default", 0.25)] })),
        ],
        projectIDs: ["p1", "p2"],
      }),
    )
    expect(r).toEqual({ cost: 2, source: "stats", conflict: false })
  })

  it("falls back when a payload's whole models[] array is missing", () => {
    const r = cardMoney(
      mInput({
        directory: "/tmp/proj",
        model: "p/m",
        rows: walk,
        sessions: mSessions("7d", walk),
        summary: mOk("7d", mStats()),
        projectStats: [
          mProject("p1", mStats({ models: [mUsage("p", "m", "high", 1.25)] })),
          // models[] absent entirely — the payload cannot honor the cut.
          mProject("p2", { ...mStats(), models: undefined } as unknown as SessionStatsInfo),
        ],
        projectIDs: ["p1", "p2"],
      }),
    )
    expect(r).toEqual({ cost: 5, source: "fallback", conflict: false })
  })

  it("falls back with a conflict when no payload has the row but sessions claim it", () => {
    const r = cardMoney(
      mInput({
        directory: "/tmp/proj",
        model: "p/m",
        rows: walk,
        sessions: mSessions("7d", walk),
        summary: mOk("7d", mStats()),
        projectStats: [
          mProject("p1", mStats({ models: [mUsage("p", "other", undefined, 3)] })),
          mProject("p2", mStats({ models: [mUsage("p", "other", undefined, 3)] })),
        ],
        projectIDs: ["p1", "p2"],
      }),
    )
    expect(r).toEqual({ cost: 5, source: "fallback", conflict: true })
  })

  it("returns exact $0 when no payload has the row and no session claims it", () => {
    const other = [sess({ id: "a", cost: 3, projectID: "p1", model: { providerID: "p", id: "other" } })]
    const r = cardMoney(
      mInput({
        directory: "/tmp/proj",
        model: "p/m",
        rows: [],
        sessions: mSessions("7d", other),
        summary: mOk("7d", mStats()),
        projectStats: [
          mProject("p1", mStats({ models: [mUsage("p", "other", undefined, 3)] })),
          mProject("p2", mStats({ models: [] })),
        ],
        projectIDs: ["p1", "p2"],
      }),
    )
    expect(r).toEqual({ cost: 0, source: "stats", conflict: false })
  })

  it("falls back for the no-model bucket under a directory", () => {
    const r = cardMoney(
      mInput({
        directory: "/tmp/proj",
        model: NO_MODEL_KEY,
        rows: walk,
        sessions: mSessions("7d", walk),
        summary: mOk("7d", mStats()),
        projectStats: [mProject("p1", mStats({ cost: 2.5 }))],
        projectIDs: ["p1"],
      }),
    )
    expect(r.source).toBe("fallback")
  })
})

/**
 * Mission 028 (H1): the exclusivity cut. The live shape that broke 026:
 * project `global` carries sessions in TWO directories (swimsquid and the
 * personal directory), so its stats payload is not the personal directory's
 * money. Fixtures mirror the real ids and money from mission 027.
 */
describe("mission 028: exclusivity cut — shared ids fall back", () => {
  const personal = "/Users/joaosantos/Sites/personal"
  const swimsquid = "/Users/joaosantos/Sites/personal/swimsquid"
  // All-time walk: global spans both directories, 2f8a is personal-only.
  const walk = [
    sess({ id: "swim1", cost: 60, projectID: "global", location: { directory: swimsquid } }),
    sess({ id: "swim2", cost: 8, projectID: "global", location: { directory: swimsquid } }),
    sess({ id: "pers1", cost: 0.131, projectID: "global", location: { directory: personal } }),
    sess({ id: "pers2", cost: 0.058, projectID: "2f8a", location: { directory: personal } }),
  ]
  const summary = mOk("all", mStats({ cost: 68.59 }))
  const payloads = [
    mProject("global", mStats({ cost: 68.5315, sessions: 3 })),
    mProject("2f8a", mStats({ cost: 0.0584, sessions: 1 })),
  ]

  it("personal dir-only shows the labeled row sum, never the $68.59 payload sum", () => {
    const r = cardMoney(
      mInput({
        directory: personal,
        rows: [walk[2], walk[3]],
        sessions: mSessions("all", walk),
        summary,
        projectStats: payloads,
        projectIDs: ["global", "2f8a"],
      }),
    )
    expect(r.source).toBe("fallback")
    expect(r.conflict).toBe(false)
    expect(r.cost).toBeCloseTo(0.189, 6)
  })

  it("swimsquid 7d cannot render the $0.131 foreign money as exact", () => {
    // The 7d walk holds only the personal row — but it carries `global`,
    // the same id swimsquid maps to, so the payload is contaminated.
    const r = cardMoney(
      mInput({
        directory: swimsquid,
        rows: [walk[2]],
        sessions: mSessions("7d", [walk[2]]),
        summary: mOk("7d", mStats({ cost: 0.131 })),
        projectStats: [mProject("global", mStats({ cost: 0.13109852, sessions: 1 }))],
        projectIDs: ["global"],
      }),
    )
    expect(r.source).toBe("fallback")
  })

  it("one shared id degrades the whole directory money — no partial mixing", () => {
    // p1 is exclusive, p2 is shared. The card must not sum p1's exact
    // payload with anything: the whole money is the labeled row sum.
    const mixed = [
      sess({ id: "a", cost: 1, projectID: "p1" }),
      sess({ id: "b", cost: 2, projectID: "p2", location: { directory: "/tmp/other" } }),
      sess({ id: "c", cost: 4, projectID: "p2" }),
    ]
    const r = cardMoney(
      mInput({
        directory: "/tmp/proj",
        rows: [mixed[0], mixed[2]],
        sessions: mSessions("7d", mixed),
        summary: mOk("7d", mStats()),
        projectStats: [mProject("p1", mStats({ cost: 1 })), mProject("p2", mStats({ cost: 6 }))],
        projectIDs: ["p1", "p2"],
      }),
    )
    expect(r).toEqual({ cost: 5, source: "fallback", conflict: false })
  })

  it("gates on the walk's truncated flag for directory-active money", () => {
    const base = {
      directory: personal,
      rows: [walk[2], walk[3]],
      summary,
      projectStats: payloads,
      projectIDs: ["global", "2f8a"],
    }
    // Even an all-exclusive id set cannot be trusted when the walk stopped
    // early: rows in another directory may exist unseen.
    const exclusiveWalk = [
      sess({ id: "a", cost: 1, projectID: "p1" }),
      sess({ id: "b", cost: 2, projectID: "p1" }),
    ]
    const truncatedExclusive = {
      directory: "/tmp/proj",
      rows: exclusiveWalk,
      summary: mOk("all", mStats()),
      projectStats: [mProject("p1", mStats({ cost: 3 }))],
      projectIDs: ["p1"],
    }
    expect(cardMoney(mInput({ ...base, sessions: { ...mSessions("all", walk), truncated: true } })).source).toBe(
      "fallback",
    )
    expect(
      cardMoney(
        mInput({
          ...truncatedExclusive,
          sessions: { ...mSessions("all", exclusiveWalk), truncated: true },
        }),
      ).source,
    ).toBe("fallback")
    // dir+model is gated the same way.
    expect(
      cardMoney(mInput({ ...base, model: "p/m", sessions: { ...mSessions("all", walk), truncated: true } })).source,
    ).toBe("fallback")
  })

  it("falls back when no walk payload is on screen (truncation flag invisible)", () => {
    const r = cardMoney(
      mInput({
        directory: "/tmp/proj",
        rows: [sess({ id: "a", cost: 1, projectID: "p1" })],
        sessions: null,
        summary: mOk("7d", mStats()),
        projectStats: [mProject("p1", mStats({ cost: 1 }))],
        projectIDs: ["p1"],
      }),
    )
    expect(r.source).toBe("fallback")
  })

  it("checks the whole walk, not just the filtered rows", () => {
    // dir+model: the foreign row carries another model, so it is filtered
    // out of `rows` — but it still shares the id, so the payload is not the
    // directory's money for that model either.
    const walkMixed = [
      sess({ id: "a", cost: 1, projectID: "p1", model: { providerID: "p", id: "m" } }),
      sess({
        id: "b",
        cost: 9,
        projectID: "p1",
        model: { providerID: "p", id: "other" },
        location: { directory: "/tmp/other" },
      }),
    ]
    const r = cardMoney(
      mInput({
        directory: "/tmp/proj",
        model: "p/m",
        rows: [walkMixed[0]],
        sessions: mSessions("7d", walkMixed),
        summary: mOk("7d", mStats()),
        projectStats: [mProject("p1", mStats({ models: [mUsage("p", "m", undefined, 5)] }))],
        projectIDs: ["p1"],
      }),
    )
    expect(r.source).toBe("fallback")
  })
})

describe("mission 028: exclusive ids keep exact stats money", () => {
  it("oc-setup dir-only and dir+model stay exact (its id is exclusive)", () => {
    const oc = "/Users/joaosantos/Sites/personal/oc-setup"
    const walk = [
      sess({
        id: "s1",
        cost: 1,
        projectID: "a853",
        model: { providerID: "opencode-go", id: "glm-5.3" },
        location: { directory: oc },
      }),
      sess({ id: "s2", cost: 2, projectID: "a853", location: { directory: oc } }),
    ]
    const payloads = [
      mProject(
        "a853",
        mStats({ cost: 30.606578665, models: [mUsage("opencode-go", "glm-5.3", "high", 4.74372348)] }),
      ),
    ]
    const base = {
      directory: oc,
      rows: walk,
      sessions: mSessions("all", walk),
      summary: mOk("all", mStats()),
      projectStats: payloads,
      projectIDs: ["a853"],
    }
    expect(cardMoney(mInput(base))).toEqual({
      cost: 30.606578665,
      source: "stats",
      conflict: false,
    })
    expect(cardMoney(mInput({ ...base, model: "opencode-go/glm-5.3" }))).toEqual({
      cost: 4.74372348,
      source: "stats",
      conflict: false,
    })
  })

  it("an id whose every walked row is in the directory is exclusive, even multi-row", () => {
    const walk = [
      sess({ id: "a", cost: 1, projectID: "p1" }),
      sess({ id: "b", cost: 2, projectID: "p1" }),
      sess({ id: "c", cost: 4, projectID: "p2", location: { directory: "/tmp/other" } }),
    ]
    const r = cardMoney(
      mInput({
        directory: "/tmp/proj",
        rows: [walk[0], walk[1]],
        sessions: mSessions("7d", walk),
        summary: mOk("7d", mStats()),
        projectStats: [mProject("p1", mStats({ cost: 3 }))],
        projectIDs: ["p1"],
      }),
    )
    expect(r).toEqual({ cost: 3, source: "stats", conflict: false })
  })

  it("model-only money ignores the walk's truncation flag", () => {
    const walk = [
      sess({ id: "a", cost: 1.25, model: { providerID: "p", id: "m", variant: "high" } }),
      sess({ id: "b", cost: 0.4, model: { providerID: "p", id: "m", variant: "max" } }),
    ]
    const r = cardMoney(
      mInput({
        model: "p/m",
        rows: walk,
        sessions: { ...mSessions("7d", walk), truncated: true },
        summary: mOk("7d", mStats({ models: [mUsage("p", "m", "high", 1.25), mUsage("p", "m", "max", 0.5)] })),
      }),
    )
    expect(r).toEqual({ cost: 1.75, source: "stats", conflict: false })
  })
})

describe("mission 028: note discipline (M1)", () => {
  const exact: CardMoney = { cost: 1, source: "stats", conflict: false }
  const approx: CardMoney = { cost: 1, source: "fallback", conflict: false }

  it("the stats path may claim compaction exclusion truthfully", () => {
    expect(moneySubLine(exact, "")).toContain("excludes compaction usage")
    expect(moneyNote(exact, "")).toContain("excludes compaction usage")
    expect(moneyNote(exact, "p/m")).toContain("excludes compaction usage")
  })

  it("the fallback path never claims 'excludes compaction usage'", () => {
    for (const model of ["", "p/m"]) {
      expect(moneySubLine(approx, model)).not.toContain("excludes compaction")
      expect(moneyNote(approx, model)).not.toContain("excludes compaction")
      expect(moneySubLine(approx, model)).toContain("approximate")
      expect(moneyNote(approx, model)).toContain("approximate")
    }
  })

  it("the directory fallback names compaction inclusion, not last-model labels", () => {
    expect(moneySubLine(approx, "")).toContain("includes compaction usage")
    expect(moneyNote(approx, "")).toContain("includes compaction usage")
  })

  it("the model fallback names the last-model misattribution", () => {
    expect(moneySubLine(approx, "p/m")).toContain("sessions' last model")
    expect(moneyNote(approx, "p/m")).toContain("sessions' last model")
  })
})
