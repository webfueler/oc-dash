import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchModelNames, fetchSummary } from "../src/api"

/**
 * The seam: fetchModelNames must unwrap the
 * route's { names: {...} } envelope. Storing the envelope itself as the map
 * left every label
 * surface dead.
 */
describe("fetchModelNames", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("unwraps the { names: {...} } envelope from /api/model-names", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ names: { "deepseek/deepseek-flash": "DeepSeek V4.1 Flash" } }), {
          status: 200,
        }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await expect(fetchModelNames()).resolves.toEqual({
      "deepseek/deepseek-flash": "DeepSeek V4.1 Flash",
    })
    expect(fetchMock).toHaveBeenCalledWith("/api/model-names")
  })

  it("returns an empty map for a degraded `{ names: {} }` or a body with no names", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ names: {} }), { status: 200 })),
    )
    await expect(fetchModelNames()).resolves.toEqual({})

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
    )
    await expect(fetchModelNames()).resolves.toEqual({})
  })
})

/**
 * The URL /api/summary is asked for. The dashboard's call must stay the
 * exact string it always sent; only the panel opts out of the context call,
 * and only through the documented param.
 */
describe("fetchSummary", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubSummary(calls: string[]): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        calls.push(String(url))
        return new Response(
          JSON.stringify({
            degraded: false,
            range: { preset: "today" },
            timezone: "UTC",
            data: { cost: 0, models: [] },
          }),
          { status: 200 },
        )
      }),
    )
  }

  it("sends the plain URL the dashboard has always sent", async () => {
    const calls: string[] = []
    stubSummary(calls)
    await fetchSummary("today")
    expect(calls).toEqual(["/api/summary?range=today"])
  })

  it("keeps the project param's position and encoding", async () => {
    const calls: string[] = []
    stubSummary(calls)
    await fetchSummary("30d", { project: "p1,p2" })
    expect(calls).toEqual(["/api/summary?range=30d&project=p1%2Cp2"])
  })

  it("carries context=none only when context is explicitly false", async () => {
    const calls: string[] = []
    stubSummary(calls)
    await fetchSummary("today", { context: false })
    await fetchSummary("today", { context: true })
    await fetchSummary("today")
    expect(calls).toEqual([
      "/api/summary?range=today&context=none",
      "/api/summary?range=today",
      "/api/summary?range=today",
    ])
  })
})
