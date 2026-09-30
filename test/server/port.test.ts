import { describe, expect, it } from "vitest"
import { DEFAULT_PORT, ephemeralPort, parsePort, resolvePort } from "../../server/port.js"

describe("parsePort", () => {
  it("accepts ports in range", () => {
    expect(parsePort("4021")).toBe(4021)
    expect(parsePort("1")).toBe(1)
    expect(parsePort("65535")).toBe(65535)
    expect(parsePort(" 4022 ")).toBe(4022)
    expect(parsePort(4023)).toBe(4023)
  })

  it("rejects everything that is not an integer in 1..65535", () => {
    for (const bad of [
      undefined,
      null,
      "",
      "   ",
      "abc",
      "0",
      "65536",
      "70000",
      "-1",
      "4022.5",
      "4 022",
      "0x10",
      "+4022",
      "4022abc",
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(parsePort(bad as string)).toBeNull()
    }
  })
})

describe("resolvePort precedence", () => {
  it("prefers --port over PORT and the default", () => {
    expect(resolvePort(4022, "5000")).toBe(4022)
  })

  it("falls back to PORT when there is no --port", () => {
    expect(resolvePort(null, "5000")).toBe(5000)
  })

  it("falls back to the default when neither is usable", () => {
    expect(resolvePort(null, undefined)).toBe(DEFAULT_PORT)
    expect(resolvePort(null, "")).toBe(DEFAULT_PORT)
    // The old `Number(process.env.PORT) || 4021` line also landed here.
    expect(resolvePort(null, "abc")).toBe(DEFAULT_PORT)
    expect(resolvePort(null, "0")).toBe(DEFAULT_PORT)
    // New: an out-of-range PORT falls back instead of reaching the socket
    // layer, where it used to fail with an opaque errno.
    expect(resolvePort(null, "70000")).toBe(DEFAULT_PORT)
  })
})

describe("ephemeralPort", () => {
  it("hands back an unused port", async () => {
    const port = await ephemeralPort()
    expect(port).toBeGreaterThan(0)
    expect(port).toBeLessThanOrEqual(65535)
  })

  it("hands back a port that can actually be bound", async () => {
    const port = await ephemeralPort()
    const { createServer } = await import("node:net")
    const server = createServer()
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(port, "127.0.0.1", resolve)
    })
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
})
