import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchModelNames } from "./api"

/**
 * Mission 047: the seam mission 044 missed. fetchModelNames must unwrap the
 * route's { names: {...} } envelope — mission 046's review found every label
 * surface dead because the client stored the envelope itself as the map.
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
