import { describe, expect, it } from "vitest"
import { contextStatsRange, parseProjectParam, resolveRange } from "./ranges.js"

describe("contextStatsRange", () => {
  it("gives Today the trailing 7 days as chart context", () => {
    const now = new Date("2026-09-09T12:00:00")
    const ctx = contextStatsRange("today", now)
    expect(ctx).not.toBeNull()
    const direct = resolveRange("7d", now)
    expect(ctx!.from).toBe(direct.from)
    expect(ctx!.to).toBe(direct.to)
  })

  it("adds no context for ranges that already span days", () => {
    const now = new Date("2026-09-09T12:00:00")
    expect(contextStatsRange("7d", now)).toBeNull()
    expect(contextStatsRange("30d", now)).toBeNull()
    expect(contextStatsRange("all", now)).toBeNull()
  })
})

// Mission 014 (PD Q4a) + 026: the additive project pass-through's parsing.
describe("parseProjectParam", () => {
  it("keeps a plain project id, as a one-element list", () => {
    expect(parseProjectParam("oc-setup")).toEqual(["oc-setup"])
  })

  it("trims surrounding whitespace", () => {
    expect(parseProjectParam("  oc-setup ")).toEqual(["oc-setup"])
  })

  it("treats missing, empty, and whitespace-only as no project", () => {
    expect(parseProjectParam(undefined)).toBeUndefined()
    expect(parseProjectParam(null)).toBeUndefined()
    expect(parseProjectParam("")).toBeUndefined()
    expect(parseProjectParam("   ")).toBeUndefined()
  })

  it("rejects overlong junk instead of truncating into a wrong id", () => {
    // Mission 028 (L1): the cap is 4096 chars — the old 200 predated id
    // lists and would reject five real 40-hex ids plus separators.
    expect(parseProjectParam("x".repeat(4097))).toBeUndefined()
    expect(parseProjectParam("x".repeat(4096))).toEqual(["x".repeat(4096)])
  })

  it("accepts a realistic long id list (mission 028 L1)", () => {
    const five = Array.from({ length: 5 }, (_, i) => `${i}`.repeat(40)).join(",")
    expect(parseProjectParam(five)).toHaveLength(5)
  })

  it("splits a comma-separated list, trimming and deduping in order (mission 026)", () => {
    expect(parseProjectParam("p1,p2")).toEqual(["p1", "p2"])
    expect(parseProjectParam(" p1 , p2 ,p1")).toEqual(["p1", "p2"])
  })

  it("drops empty segments", () => {
    expect(parseProjectParam("p1,,p2,")).toEqual(["p1", "p2"])
  })

  it("rejects absurd list lengths", () => {
    const many = Array.from({ length: 11 }, (_, i) => `p${i}`).join(",")
    expect(parseProjectParam(many)).toBeUndefined()
    const ten = Array.from({ length: 10 }, (_, i) => `p${i}`).join(",")
    expect(parseProjectParam(ten)).toHaveLength(10)
  })
})
