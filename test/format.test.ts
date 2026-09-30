import { describe, expect, it } from "vitest"
import { fmtUSD, isoDate, outcomeView } from "../src/format"

/**
 * The project's one money formatter. Its rule was the panel's, picked by hand
 * in the design review and adopted by the dashboard in mission 089, so these
 * assertions are the rule for both surfaces: `test/widget.test.ts` pins that
 * the panel's `fmtMoney` IS this function.
 */
describe("fmtUSD", () => {
  it("prints exactly two decimals at every magnitude", () => {
    expect(fmtUSD(0)).toBe("$0.00")
    expect(fmtUSD(9.5)).toBe("$9.50")
    expect(fmtUSD(0.5)).toBe("$0.50")
    expect(fmtUSD(0.99)).toBe("$0.99")
    expect(fmtUSD(1)).toBe("$1.00")
    expect(fmtUSD(999.99)).toBe("$999.99")
    expect(fmtUSD(1000)).toBe("$1,000.00")
    expect(fmtUSD(1234567.89)).toBe("$1,234,567.89")
  })

  it("bounds a real sub-cent amount instead of rounding it to nothing", () => {
    // A plain 2-decimal cap would print $0.00, which reads as free. The bound
    // says there is an amount and refuses to claim how much.
    expect(fmtUSD(0.0001)).toBe("<$0.01")
    expect(fmtUSD(0.0042)).toBe("<$0.01")
    expect(fmtUSD(0.009999)).toBe("<$0.01")
  })

  it("keeps a genuine zero at $0.00, which is the whole distinction", () => {
    expect(fmtUSD(0)).toBe("$0.00")
    expect(fmtUSD(-0)).toBe("$0.00")
    expect(fmtUSD(0.0042)).not.toBe(fmtUSD(0))
  })

  it("rounds at the cent, which is the precision both surfaces now share", () => {
    expect(fmtUSD(0.4454)).toBe("$0.45")
    expect(fmtUSD(0.0558)).toBe("$0.06")
    expect(fmtUSD(0.0889)).toBe("$0.09")
  })

  it("bounds a negative sub-cent figure with its sign rather than dropping it", () => {
    expect(fmtUSD(-0.0042)).toBe("<-$0.01")
    expect(fmtUSD(-1.5)).toBe("-$1.50")
  })

  it("dashes a figure that is not a number", () => {
    expect(fmtUSD(Number.NaN)).toBe("—")
    expect(fmtUSD(Number.POSITIVE_INFINITY)).toBe("—")
    expect(fmtUSD(Number.NEGATIVE_INFINITY)).toBe("—")
  })
})

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
