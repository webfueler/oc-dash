import { describe, expect, it } from "vitest"
import { isoDate, outcomeView } from "./format"

describe("outcomeView", () => {
  it("collapses successes to a dim check", () => {
    expect(outcomeView("succeeded")).toBe("check")
  })

  it("keeps failures and interruptions loud", () => {
    expect(outcomeView("failed")).toBe("badge")
    expect(outcomeView("interrupted")).toBe("badge")
  })

  it("renders missing outcomes as a dim dash", () => {
    expect(outcomeView(undefined)).toBe("dim")
  })
})

describe("isoDate", () => {
  it("formats a local calendar date as YYYY-MM-DD", () => {
    // 2026-09-09 12:34 UTC — the local date depends on the machine tz, so
    // compare against the same components read back from the Date.
    const ms = Date.UTC(2026, 8, 9, 12, 34)
    const d = new Date(ms)
    const p = (n: number): string => String(n).padStart(2, "0")
    const expected = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    expect(isoDate(ms)).toBe(expected)
  })

  it("zero-pads months and days", () => {
    // Construct a local date directly so the expectation is tz-independent.
    const d = new Date(2026, 0, 5)
    expect(isoDate(d.getTime())).toBe("2026-01-05")
  })
})
