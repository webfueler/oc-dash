import { describe, expect, it } from "vitest"
import { contextStatsRange, resolveRange } from "./ranges.js"

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
