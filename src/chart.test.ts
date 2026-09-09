import { describe, expect, it } from "vitest"
import type { ActivityDay } from "./api"
import { barLayout, chartData, fillDays } from "./chart"

const W = 720
const H = 160

function day(date: string, steps: number): ActivityDay {
  return { date, steps }
}

describe("barLayout", () => {
  it("caps and centers the single-day bar instead of painting the plot", () => {
    const { bars } = barLayout([day("2026-09-09", 10)], { width: W, height: H })
    expect(bars).toHaveLength(1)
    expect(bars[0].w).toBeLessThanOrEqual(48)
    // centered: equal margins on both sides
    expect(bars[0].x + bars[0].w / 2).toBeCloseTo(W / 2, 6)
  })

  it("keeps every bar within the cap on wide slots", () => {
    const days = Array.from({ length: 3 }, (_, i) => day(`2026-09-0${i + 1}`, i + 1))
    const { bars } = barLayout(days, { width: W, height: H })
    for (const b of bars) expect(b.w).toBeLessThanOrEqual(48)
  })

  it("still gives dense ranges a sane bar width", () => {
    const days = Array.from({ length: 38 }, (_, i) => day(`2026-08-0${i + 1}`, i))
    const { bars, slot } = barLayout(days, { width: W, height: H })
    expect(slot).toBeCloseTo(W / 38, 6)
    for (const b of bars) {
      expect(b.w).toBeGreaterThan(0)
      expect(b.w).toBeLessThanOrEqual(slot - 2)
    }
  })

  it("marks zero-step days as visible stubs, not accent bars", () => {
    const { bars } = barLayout([day("2026-09-08", 0), day("2026-09-09", 5)], {
      width: W,
      height: H,
    })
    expect(bars[0].steps).toBe(0)
    expect(bars[0].h).toBe(2)
    expect(bars[0].accent).toBe(false)
    expect(bars[1].accent).toBe(true)
  })

  it("accents only the in-range day when an accent date is given", () => {
    const days = Array.from({ length: 7 }, (_, i) => day(`2026-09-0${i + 3}`, i + 1))
    const { bars } = barLayout(days, { width: W, height: H, accentDate: "2026-09-09" })
    expect(bars.filter((b) => b.accent).map((b) => b.date)).toEqual(["2026-09-09"])
  })

  it("accents everything when no accent date is given", () => {
    const days = [day("2026-09-08", 1), day("2026-09-09", 2)]
    const { bars } = barLayout(days, { width: W, height: H })
    expect(bars.every((b) => b.accent)).toBe(true)
  })
})

describe("chartData context padding", () => {
  const single = [day("2026-09-09", 4)]
  const context = Array.from({ length: 7 }, (_, i) => day(`2026-09-0${i + 3}`, i))

  it("pads Today with the trailing 7 context days", () => {
    const { days, usedContext } = chartData(single, context)
    expect(usedContext).toBe(true)
    expect(days).toHaveLength(7)
    expect(days[6].date).toBe("2026-09-09")
  })

  it("falls back to the range's own activity without context", () => {
    const { days, usedContext } = chartData(single, undefined)
    expect(usedContext).toBe(false)
    expect(days).toEqual(single)
    const empty = chartData(undefined, undefined)
    expect(empty.days).toEqual([])
  })

  it("ignores empty context arrays", () => {
    const { days, usedContext } = chartData(single, [])
    expect(usedContext).toBe(false)
    expect(days).toEqual(single)
  })
})

describe("fillDays", () => {
  it("re-inserts zero-step days that upstream omits", () => {
    const filled = fillDays([
      day("2026-09-05", 168),
      day("2026-09-06", 1691),
      day("2026-09-08", 2278),
      day("2026-09-09", 457),
    ])
    expect(filled.map((d) => d.date)).toEqual([
      "2026-09-05",
      "2026-09-06",
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
    ])
    expect(filled[2]).toEqual({ date: "2026-09-07", steps: 0 })
  })

  it("front-pads to the trailing-7-day window for Today", () => {
    const filled = fillDays(
      [day("2026-09-08", 2278), day("2026-09-09", 457)],
      7,
    )
    expect(filled).toHaveLength(7)
    expect(filled[0].date).toBe("2026-09-03")
    expect(filled[6].date).toBe("2026-09-09")
    expect(filled.slice(0, 5).every((d) => d.steps === 0)).toBe(true)
  })

  it("leaves malformed or pathological series untouched", () => {
    expect(fillDays([])).toEqual([])
    const bad = [{ date: "not-a-date", steps: 3 }]
    expect(fillDays(bad)).toEqual(bad)
    const long = [day("2000-01-01", 1), day("2026-09-09", 2)]
    expect(fillDays(long)).toEqual(long)
  })
})
