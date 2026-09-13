import { beforeEach, describe, expect, it, vi } from "vitest"
import { modelNames, parseModelNames, resetModelNamesCache } from "./models.js"

// Mission 044: the /api/model payload shape from the live service (mission
// 043's report), trimmed to the fields the parse reads.
const MODEL_ENTRY = {
  id: "deepseek-flash",
  modelID: "deepseek-flash",
  providerID: "deepseek",
  name: "DeepSeek V4.1 Flash",
}

const oc = { endpoint: { url: "http://127.0.0.1:41111" } } as never

// ocGetJson is the only network touch; stub it per test.
vi.mock("./opencode.js", () => ({
  ocGetJson: vi.fn(),
  errorMessage: (err: unknown) => String(err),
}))

import { ocGetJson } from "./opencode.js"

const getJson = vi.mocked(ocGetJson)

describe("parseModelNames", () => {
  it("maps providerID/id to the display name", () => {
    expect(parseModelNames([MODEL_ENTRY])).toEqual({
      "deepseek/deepseek-flash": "DeepSeek V4.1 Flash",
    })
  })

  it("unwraps the { data: [...] } wrapper the promise client can produce", () => {
    expect(parseModelNames({ data: [MODEL_ENTRY] })).toEqual({
      "deepseek/deepseek-flash": "DeepSeek V4.1 Flash",
    })
  })

  it("drops entries missing the provider, id, or name", () => {
    const entries = [
      MODEL_ENTRY,
      { id: "no-provider", name: "No Provider" },
      { providerID: "p", name: "No Id" },
      { providerID: "p", id: "no-name" },
      { providerID: "p", id: "", name: "" },
      null,
      "junk",
    ]
    expect(parseModelNames(entries)).toEqual({
      "deepseek/deepseek-flash": "DeepSeek V4.1 Flash",
    })
  })

  it("returns an empty map for a non-array, wrapper-less payload", () => {
    expect(parseModelNames(undefined)).toEqual({})
    expect(parseModelNames(null)).toEqual({})
    expect(parseModelNames({ data: "not-an-array" })).toEqual({})
    expect(parseModelNames({ unexpected: true })).toEqual({})
  })

  it("drops a whitespace-only name and stores a padded name trimmed", () => {
    expect(parseModelNames([{ ...MODEL_ENTRY, id: "blank", name: "   " }])).toEqual({})
    expect(parseModelNames([{ ...MODEL_ENTRY, id: "padded", name: "  DeepSeek V4.1 Flash  " }])).toEqual({
      "deepseek/padded": "DeepSeek V4.1 Flash",
    })
  })
})

describe("modelNames (cached server lookup)", () => {
  beforeEach(() => {
    resetModelNamesCache()
    getJson.mockReset()
  })

  it("fetches /api/model once and returns the parsed map", async () => {
    getJson.mockResolvedValue([MODEL_ENTRY])
    expect(await modelNames(oc)).toEqual({
      "deepseek/deepseek-flash": "DeepSeek V4.1 Flash",
    })
    expect(getJson).toHaveBeenCalledTimes(1)
    expect(getJson).toHaveBeenCalledWith(oc, "/api/model")
  })

  it("serves the second call from the cache without a refetch", async () => {
    getJson.mockResolvedValue([MODEL_ENTRY])
    await modelNames(oc)
    expect(await modelNames(oc)).toEqual({
      "deepseek/deepseek-flash": "DeepSeek V4.1 Flash",
    })
    expect(getJson).toHaveBeenCalledTimes(1)
  })

  it("degrades to an empty map on any fetch failure", async () => {
    getJson.mockRejectedValue(new Error("GET /api/model -> 500"))
    expect(await modelNames(oc)).toEqual({})
  })

  it("retries after a failure once the short retry window passes", async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(0)
      getJson.mockRejectedValueOnce(new Error("boom"))
      getJson.mockResolvedValue([MODEL_ENTRY])
      expect(await modelNames(oc)).toEqual({})
      // The failure is cached only for the short retry window, not the
      // success TTL: past it, the next call refetches.
      vi.setSystemTime(5 * 60 * 1000 + 1)
      expect(await modelNames(oc)).toEqual({
        "deepseek/deepseek-flash": "DeepSeek V4.1 Flash",
      })
      expect(getJson).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
