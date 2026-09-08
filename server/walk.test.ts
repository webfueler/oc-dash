import { describe, expect, it } from "vitest"
import { MAX_PAGES, walkSessions, type FetchPage, type RawPage } from "./walk.js"

function row(id: string, updated: number): unknown {
  return { id, time: { created: updated - 1000, updated } }
}

function page(rows: unknown[], next: string | null = null): RawPage {
  return { data: rows, cursor: { previous: null, next } }
}

/** Serves pages by numeric cursor (page 0 for no cursor) and records fetches. */
function stubPages(pages: RawPage[]): { fetch: FetchPage; fetched: number[] } {
  const fetched: number[] = []
  const fetch: FetchPage = async (cursor) => {
    const index = cursor === undefined ? 0 : Number(cursor)
    if (!Number.isInteger(index) || index < 0 || index >= pages.length) {
      throw new Error(`stub has no page for cursor ${String(cursor)}`)
    }
    fetched.push(index)
    return pages[index]
  }
  return { fetch, fetched }
}

const ids = (rows: unknown[]): string[] => rows.map((r) => (r as { id: string }).id)

describe("walkSessions", () => {
  it("drops the stale tail of a boundary page and stops there", async () => {
    // The regression case for M1: page 0 straddles the range start. The
    // stale rows must not reach the output, and the walk must stop at
    // this page (its raw oldest falls below the range start).
    const from = 1000
    const { fetch, fetched } = stubPages([
      page([row("r3000", 3000), row("r2000", 2000), row("r1000", 1000), row("r500", 500)], "1"),
      page([row("r900", 900), row("r800", 800)]),
    ])
    const result = await walkSessions(from, fetch)
    expect(ids(result.rows)).toEqual(["r3000", "r2000", "r1000"])
    expect(result.rows).toHaveLength(3)
    expect(result.pages).toBe(1)
    expect(result.truncated).toBe(false)
    expect(fetched).toEqual([0])
  })

  it("keeps the boundary row exactly at the range start", async () => {
    const from = 1000
    const { fetch } = stubPages([page([row("r1000", 1000), row("r999", 999)])])
    const result = await walkSessions(from, fetch)
    expect(ids(result.rows)).toEqual(["r1000"])
    expect(result.pages).toBe(1)
  })

  it("keeps walking while pages are fully in range, then stops on the straddler", async () => {
    const from = 1000
    const { fetch, fetched } = stubPages([
      page([row("r5000", 5000), row("r4000", 4000)], "1"),
      page([row("r3000", 3000), row("r1500", 1500), row("r900", 900)], "2"),
      page([row("r800", 800)]),
    ])
    const result = await walkSessions(from, fetch)
    expect(ids(result.rows)).toEqual(["r5000", "r4000", "r3000", "r1500"])
    expect(result.pages).toBe(2)
    expect(result.truncated).toBe(false)
    expect(fetched).toEqual([0, 1])
  })

  it("pushes nothing for an all-stale page and still stops the walk", async () => {
    // Pins the order of operations: the stop decision must come from the
    // raw page. Computing it from filtered rows would leave oldest at
    // Infinity, never stop, and keep fetching older pages.
    const from = 1000
    const { fetch, fetched } = stubPages([
      page([row("r500", 500), row("r400", 400)], "1"),
      page([row("r300", 300)]),
    ])
    const result = await walkSessions(from, fetch)
    expect(result.rows).toEqual([])
    expect(result.pages).toBe(1)
    expect(result.truncated).toBe(false)
    expect(fetched).toEqual([0])
  })

  it("keeps every row and walks to the end when no range is set", async () => {
    const { fetch, fetched } = stubPages([
      page([row("r5000", 5000), row("r4000", 4000)], "1"),
      page([row("r900", 900), row("r800", 800)], "2"),
      page([row("r100", 100)]),
    ])
    const result = await walkSessions(null, fetch)
    expect(ids(result.rows)).toEqual(["r5000", "r4000", "r900", "r800", "r100"])
    expect(result.pages).toBe(3)
    expect(result.truncated).toBe(false)
    expect(fetched).toEqual([0, 1, 2])
  })

  it("stops at the page cap and reports truncated", async () => {
    const pages = Array.from({ length: 4 }, (_, i) =>
      page([row(`r${i}`, 9000 - i)], i < 3 ? String(i + 1) : null),
    )
    const { fetch, fetched } = stubPages(pages)
    const result = await walkSessions(null, fetch, 3)
    expect(result.pages).toBe(3)
    expect(result.truncated).toBe(true)
    expect(fetched).toEqual([0, 1, 2])
    expect(ids(result.rows)).toEqual(["r0", "r1", "r2"])
    expect(MAX_PAGES).toBe(50)
  })

  it("drops rows without a numeric time.updated when a range is set, keeps them for all", async () => {
    const noTime = { id: "rUnknown", time: { created: 0 } }
    const { fetch } = stubPages([page([noTime, row("r2000", 2000)])])
    const ranged = await walkSessions(1000, fetch)
    expect(ids(ranged.rows)).toEqual(["r2000"])
    const all = await walkSessions(null, fetch)
    expect(ids(all.rows)).toEqual(["rUnknown", "r2000"])
  })
})
