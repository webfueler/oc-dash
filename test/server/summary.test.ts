import { describe, expect, it } from "vitest"
import { fmtUSD } from "../../server/money.js"
import type { ResolvedRange } from "../../server/ranges.js"
import { fetchSummaryBody, type SummaryStatsFetch } from "../../server/summary.js"

/**
 * The /api/summary upstream calls. The ordering test is the one that pins
 * the Today fix: the context call has to be created before the main call is
 * awaited, or Today pays the trailing-7-day window serially and ends up the
 * slowest range despite having the smallest one.
 */

const today: ResolvedRange = { preset: "today", from: 1_000, to: 2_000 }
const week: ResolvedRange = { preset: "7d", from: 0, to: 2_000 }

const mainStats = { cost: 9.5, models: [], activity: [{ date: "2026-09-30", steps: 3 }] }
const weekActivity = [
  { date: "2026-09-24", steps: 1 },
  { date: "2026-09-30", steps: 3 },
]
const ctxStats = { cost: 12, models: [], activity: weekActivity }

describe("fetchSummaryBody", () => {
  it("starts the context call before it awaits the main one", async () => {
    const order: string[] = []
    const stats: SummaryStatsFetch = async (range) => {
      order.push(range.preset)
      return range.preset === "today" ? mainStats : ctxStats
    }
    await fetchSummaryBody(stats, { range: today, project: [], context: true })
    // Created in this order; each creation starts its own request.
    expect(order).toEqual(["7d", "today"])
  })

  it("keeps the context call in flight while the main call is pending", async () => {
    let mainSettled = false
    let overlapped = false
    const stats: SummaryStatsFetch = async (range) => {
      if (range.preset !== "today") {
        overlapped = !mainSettled
        return ctxStats
      }
      await new Promise((resolve) => setTimeout(resolve, 5))
      mainSettled = true
      return mainStats
    }
    const body = await fetchSummaryBody(stats, { range: today, project: [], context: true })
    expect(overlapped).toBe(true)
    expect(body.contextActivity).toEqual(weekActivity)
  })

  it("returns the stats payload and Today's context activity", async () => {
    const calls: ResolvedRange[] = []
    const stats: SummaryStatsFetch = async (range) => {
      calls.push(range)
      return range.preset === "today" ? mainStats : ctxStats
    }
    await expect(
      fetchSummaryBody(stats, { range: today, project: [], context: true }),
    ).resolves.toEqual({ data: mainStats, costText: "$9.50", contextActivity: weekActivity })
    expect(calls).toHaveLength(2)
  })

  it("skips the context call and omits the field when the caller opts out", async () => {
    const calls: ResolvedRange[] = []
    const stats: SummaryStatsFetch = async (range) => {
      calls.push(range)
      return mainStats
    }
    const body = await fetchSummaryBody(stats, { range: today, project: [], context: false })
    expect(calls).toEqual([today])
    expect("contextActivity" in body).toBe(false)
    expect(body).toEqual({ data: mainStats, costText: "$9.50" })
  })

  it("never makes a context call for ranges that already span days", async () => {
    const calls: ResolvedRange[] = []
    const stats: SummaryStatsFetch = async (range) => {
      calls.push(range)
      return mainStats
    }
    const body = await fetchSummaryBody(stats, { range: week, project: [], context: true })
    expect(calls).toEqual([week])
    expect(body).toEqual({ data: mainStats, costText: "$9.50" })
  })

  it("drops only the field when the context call fails", async () => {
    const stats: SummaryStatsFetch = async (range) =>
      range.preset === "today" ? mainStats : Promise.reject(new Error("context upstream down"))
    await expect(
      fetchSummaryBody(stats, { range: today, project: [], context: true }),
    ).resolves.toEqual({ data: mainStats, costText: "$9.50" })
  })

  it("starts the project calls before the main one and drops the failures", async () => {
    const order: string[] = []
    const stats: SummaryStatsFetch = async (range, project) => {
      order.push(project ?? `main:${range.preset}`)
      if (project === "p2") throw new Error("no such project")
      return project ? { cost: 1, models: [], project } : mainStats
    }
    const body = await fetchSummaryBody(stats, {
      range: week,
      project: ["p1", "p2"],
      context: false,
    })
    expect(order).toEqual(["p1", "p2", "main:7d"])
    expect(body.projectStats).toEqual([
      { project: "p1", data: { cost: 1, models: [], project: "p1" } },
    ])
  })

  it("throws the same shape error for an unexpected main payload", async () => {
    const stats: SummaryStatsFetch = async () => ({ nope: true })
    await expect(
      fetchSummaryBody(stats, { range: week, project: [], context: false }),
    ).rejects.toThrow("unexpected /api/session/stats payload shape")
  })
})

/**
 * `costText`: the money as the finished string.
 *
 * Every assertion here is on the string, never on a parsed number, because the
 * string is the contract. The menu bar shell prints what this route sends and
 * does no arithmetic of its own, so a change to any digit here is a change to
 * what the user reads in their menu bar.
 */
describe("costText", () => {
  const costOf = async (cost: number): Promise<string> => {
    const stats: SummaryStatsFetch = async () => ({ cost, models: [] })
    const body = await fetchSummaryBody(stats, { range: week, project: [], context: false })
    return body.costText
  }

  it("formats a known cost through the project's one formatter", async () => {
    await expect(costOf(9.5)).resolves.toBe("$9.50")
    await expect(costOf(7.5559303280000005)).resolves.toBe("$7.56")
    await expect(costOf(1000)).resolves.toBe("$1,000.00")
    await expect(costOf(170.23707184240106)).resolves.toBe("$170.24")
  })

  it("rounds ties away from zero, which is why the server sends the string", async () => {
    // The reason this field exists. Swift's String(format:) and NumberFormatter
    // would give "$0.45" and "$0.06" here, not the project's answer, so a shell
    // that reformatted the number would print money the user never spent.
    await expect(costOf(0.4454)).resolves.toBe("$0.45")
    await expect(costOf(0.0558)).resolves.toBe("$0.06")
    await expect(costOf(0.0889)).resolves.toBe("$0.09")
    await expect(costOf(-0.4454)).resolves.toBe("-$0.45")
  })

  it("reads $0.00 for an unpriced range, the same string an empty one gets", async () => {
    // The Captain's own live case: 287,804,591 tokens today, cost 0, because
    // the model's provider publishes no price. Tokens are not part of this
    // function's input, so unpriced and no-activity are the same string and
    // only `data.tokens` tells them apart. Pinned so a future change cannot
    // quietly start presenting one as the other.
    await expect(costOf(0)).resolves.toBe("$0.00")
    await expect(costOf(-0)).resolves.toBe("$0.00")
  })

  it("prints <$0.01 rather than rounding a real amount to $0.00", async () => {
    await expect(costOf(0.0042)).resolves.toBe("<$0.01")
    await expect(costOf(-0.0042)).resolves.toBe("<-$0.01")
  })

  it("agrees with fmtUSD on every fixture in this file's payloads", async () => {
    // The identity the whole decision rests on: the route's string is the
    // panel's string. If someone ever writes a second formatter here, this
    // goes red rather than the menu bar drifting from the panel by a cent.
    for (const cost of [9.5, 0, -0, 0.0042, 7.5559303280000005, 1000]) {
      await expect(costOf(cost)).resolves.toBe(fmtUSD(cost))
    }
  })

  it("keeps costText consistent with the numeric cost beside it", async () => {
    const stats: SummaryStatsFetch = async () => ({ cost: 42.4242, models: [] })
    const body = await fetchSummaryBody(stats, { range: week, project: [], context: false })
    const data = body.data as { cost: number }
    expect(body.costText).toBe("$42.42")
    // Additive only: the number every existing consumer reads is untouched.
    expect(data.cost).toBe(42.4242)
  })

  it("carries the string on Today's context call too, unchanged", async () => {
    const stats: SummaryStatsFetch = async (range) =>
      range.preset === "today" ? mainStats : ctxStats
    const body = await fetchSummaryBody(stats, { range: today, project: [], context: true })
    expect(body.costText).toBe("$9.50")
  })
})
