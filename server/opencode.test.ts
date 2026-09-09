import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  discover: vi.fn(),
  ensure: vi.fn(),
  headers: vi.fn(),
  make: vi.fn(),
}))

vi.mock("@opencode/client/service", () => ({
  Service: { discover: mocks.discover, ensure: mocks.ensure, headers: mocks.headers },
}))
vi.mock("@opencode/client", () => ({
  OpenCode: { make: mocks.make },
}))

// getOpencode caches its result at module level, so every test gets a
// fresh module instance.
async function freshModule() {
  return await import("./opencode.js")
}

describe("getOpencode service policy", () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.discover.mockReset()
    mocks.ensure.mockReset()
    mocks.headers.mockReset()
    mocks.make.mockReset()
  })

  it("connects to a discovered endpoint and never calls ensure()", async () => {
    const endpoint = { url: "http://127.0.0.1:41111", auth: undefined }
    const clientStub = {}
    mocks.discover.mockResolvedValue(endpoint)
    mocks.make.mockReturnValue(clientStub)
    const { getOpencode } = await freshModule()
    const oc = await getOpencode()
    expect(oc.endpoint).toBe(endpoint)
    expect(oc.client).toBe(clientStub)
    expect(mocks.ensure).not.toHaveBeenCalled()
  })

  it("rejects with NoServiceError when nothing is registered and never calls ensure()", async () => {
    mocks.discover.mockResolvedValue(undefined)
    const { getOpencode, NoServiceError } = await freshModule()
    const err = await getOpencode().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NoServiceError)
    expect((err as Error).message).toContain("no healthy registered opencode service")
    expect(mocks.ensure).not.toHaveBeenCalled()
  })

  it("carries discover's own failure as the reason", async () => {
    mocks.discover.mockRejectedValue(new Error("boom"))
    const { getOpencode, NoServiceError } = await freshModule()
    const err = await getOpencode().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NoServiceError)
    expect((err as Error).message).toContain("boom")
  })
})
