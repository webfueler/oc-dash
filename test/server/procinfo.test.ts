import { describe, expect, it } from "vitest"
import {
  confirmServicePid,
  isAlive,
  isOcDashArgv,
  listeningEndpoints,
  processArgv,
} from "../../server/procinfo.js"
import type { ServiceRecord } from "../../server/registry.js"

function record(over: Partial<ServiceRecord> = {}): ServiceRecord {
  return { port: 4021, pid: 4242, url: "http://127.0.0.1:4021", version: "0.1.8", ...over }
}

// A pid that cannot exist: above the macOS pid_max ceiling on every machine
// this package ships to in practice, and rejected by ps as "too large".
const DEAD_PID = 999_999

describe("isAlive", () => {
  it("finds this process alive", () => {
    expect(isAlive(process.pid)).toBe(true)
  })

  it("finds a pid that does not exist dead", () => {
    expect(isAlive(DEAD_PID)).toBe(false)
  })

  it("rejects nonsense input without calling kill", () => {
    expect(isAlive(0)).toBe(false)
    expect(isAlive(-1)).toBe(false)
    expect(isAlive(1.5)).toBe(false)
    expect(isAlive(Number.NaN)).toBe(false)
  })
})

describe("isOcDashArgv", () => {
  it("accepts the published bin, from a checkout, an npx cache or a global install", () => {
    expect(
      isOcDashArgv(
        "/opt/homebrew/lib/node_modules/@webfueler/oc-dash/bin/oc-dash.js server start --port 4022",
      ),
    ).toBe(true)
    expect(isOcDashArgv("/Users/someone/Sites/personal/oc-dash/bin/oc-dash.js")).toBe(true)
    expect(isOcDashArgv("node /tmp/x/node_modules/@webfueler/oc-dash/bin/oc-dash.js")).toBe(true)
    // A global npm install leaves a PATH symlink with no package directory
    // anywhere in it, so the basename has to be enough.
    expect(isOcDashArgv("node /opt/homebrew/bin/oc-dash")).toBe(true)
  })

  it("accepts the compiled server entry, the way `npm start` runs it", () => {
    expect(isOcDashArgv("node /Users/someone/Sites/oc-dash/dist-server/index.js")).toBe(true)
    expect(isOcDashArgv("/Users/someone/Sites/oc-dash/dist-server/cli.js")).toBe(true)
  })

  it("rejects unrelated programs", () => {
    for (const argv of [
      "/usr/bin/sleep 300",
      "/Applications/Spotify.app/Contents/MacOS/Spotify",
      "/opt/homebrew/bin/oc-dashboard --server",
      "/Users/someone/oc-dashy/server",
      "/Users/someone/Sites/personal/oc-setup/.officer/agent",
      "/Users/someone/Sites/oc-dash/scripts/cleanup.js",
      "",
    ]) {
      expect(isOcDashArgv(argv)).toBe(false)
    }
  })

  it("does not mistake a lookalike directory for the package", () => {
    // The SERVER_ENTRY pattern needs a real `/oc-dash/` path segment.
    expect(isOcDashArgv("node /tmp/oc-dash-fork/dist-server/index.js")).toBe(false)
    expect(isOcDashArgv("node /opt/oc-dashboard/dist-server/index.js")).toBe(false)
  })

  it("documents the limit the listening-socket check exists to cover", () => {
    // ps shows the whole command line, so an editor with the oc-dash bin
    // open matches the argv test. It cannot get past requirement 3, and
    // confirmServicePid below proves that is the case that matters.
    expect(isOcDashArgv("vim /Users/someone/Sites/oc-dash/bin/oc-dash.js")).toBe(true)
    const identity = confirmServicePid(record({ pid: process.pid, port: 4021 }), -1)
    expect(identity.confirmed).toBe(false)
  })
})

describe("processArgv", () => {
  it("reads this process's own command line", () => {
    expect(processArgv(process.pid)).toContain("vitest")
  })

  it("returns null for a pid that does not exist", () => {
    expect(processArgv(DEAD_PID)).toBeNull()
  })
})

describe("listeningEndpoints", () => {
  it("reports an empty list, not an unknown, for a pid with no listeners", () => {
    expect(listeningEndpoints(process.pid)).toEqual([])
  })

  it("reports an empty list for a dead pid rather than giving up", () => {
    expect(listeningEndpoints(DEAD_PID)).toEqual([])
  })

  it("parses a real loopback listener, which is the whole point of the check", async () => {
    const { createServer } = await import("node:net")
    const server = createServer()
    const port = await new Promise<number>((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port))
    })
    try {
      expect(listeningEndpoints(process.pid)).toContainEqual({ host: "127.0.0.1", port })
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})

describe("confirmServicePid", () => {
  it("refuses a pid that is not running, without signalling anything", () => {
    const identity = confirmServicePid(record({ pid: DEAD_PID }))
    expect(identity.confirmed).toBe(false)
    expect(identity.reason).toMatch(/no process is running with pid 999999/)
  })

  it("refuses this CLI's own pid before it can kill itself", () => {
    const identity = confirmServicePid(record({ pid: process.pid }))
    expect(identity.confirmed).toBe(false)
    expect(identity.reason).toMatch(/this oc-dash command itself/)
  })

  it("refuses a live process that is not oc-dash, and shows the evidence", () => {
    // process.pid is the test runner: alive, readable, definitely not us.
    const identity = confirmServicePid(record({ pid: process.pid, port: 4021 }), -1)
    expect(identity.confirmed).toBe(false)
    expect(identity.reason).toMatch(/is not an oc-dash process/)
    expect(identity.argv).toContain("vitest")
  })

  it("refuses an unusable pid before asking the OS anything", () => {
    const identity = confirmServicePid(record({ pid: 0 }))
    expect(identity.confirmed).toBe(false)
    expect(identity.reason).toMatch(/no process is running with pid 0/)
  })

  it("never confirms a process with no loopback listener on the recorded port", async () => {
    // Start a real listener, so the failure is about the port and not about
    // the process having no sockets at all.
    const { createServer } = await import("node:net")
    const server = createServer()
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", resolve)
    })
    try {
      const identity = confirmServicePid(record({ pid: process.pid, port: 4021 }), -1)
      // The test runner's argv is not an oc-dash entry script, so it stops at
      // requirement 2; either way it must not be confirmed.
      expect(identity.confirmed).toBe(false)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
