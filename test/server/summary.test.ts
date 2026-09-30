import { describe, expect, it } from "vitest"
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
    ).resolves.toEqual({ data: mainStats, contextActivity: weekActivity })
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
    expect(body).toEqual({ data: mainStats })
  })

  it("never makes a context call for ranges that already span days", async () => {
    const calls: ResolvedRange[] = []
    const stats: SummaryStatsFetch = async (range) => {
      calls.push(range)
      return mainStats
    }
    const body = await fetchSummaryBody(stats, { range: week, project: [], context: true })
    expect(calls).toEqual([week])
    expect(body).toEqual({ data: mainStats })
  })

  it("drops only the field when the context call fails", async () => {
    const stats: SummaryStatsFetch = async (range) =>
      range.preset === "today" ? mainStats : Promise.reject(new Error("context upstream down"))
    await expect(
      fetchSummaryBody(stats, { range: today, project: [], context: true }),
    ).resolves.toEqual({ data: mainStats })
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
