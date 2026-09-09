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

// Mission 014 (PD Q4a): the additive project pass-through's parsing.
describe("parseProjectParam", () => {
  it("keeps a plain project id", () => {
    expect(parseProjectParam("oc-setup")).toBe("oc-setup")
  })

  it("trims surrounding whitespace", () => {
    expect(parseProjectParam("  oc-setup ")).toBe("oc-setup")
  })

  it("treats missing, empty, and whitespace-only as no project", () => {
    expect(parseProjectParam(undefined)).toBeUndefined()
    expect(parseProjectParam(null)).toBeUndefined()
    expect(parseProjectParam("")).toBeUndefined()
    expect(parseProjectParam("   ")).toBeUndefined()
  })

  it("rejects overlong junk instead of truncating into a wrong id", () => {
    expect(parseProjectParam("x".repeat(201))).toBeUndefined()
    expect(parseProjectParam("x".repeat(200))).toBe("x".repeat(200))
  })
})
