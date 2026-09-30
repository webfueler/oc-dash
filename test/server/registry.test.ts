import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  appVersion,
  readRegistry,
  registryPath,
  removeRegistry,
  serviceMode,
  serviceUrl,
  writeRegistry,
} from "../../server/registry.js"

// Every case gets its own temp dir. Nothing here touches the real
// ~/.local/state, and nothing is written inside the repository.
const scratchDirs: string[] = []
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "oc-dash-registry-"))
  scratchDirs.push(dir)
  return dir
}

afterEach(() => {
  while (scratchDirs.length > 0) {
    rmSync(scratchDirs.pop() as string, { recursive: true, force: true })
  }
})

describe("registryPath", () => {
  it("follows XDG_STATE_HOME when it is set", () => {
    expect(registryPath({ XDG_STATE_HOME: "/tmp/state" })).toBe("/tmp/state/oc-dash/service.json")
  })

  it("falls back to ~/.local/state when it is unset", () => {
    const expected = join(process.env.HOME ?? "", ".local", "state", "oc-dash", "service.json")
    expect(registryPath({})).toBe(expected)
  })

  it("is the shape @opencode/client uses for its own service file", () => {
    // Same rule, one directory over: the client reads
    // $XDG_STATE_HOME/opencode/service.json and we read
    // $XDG_STATE_HOME/oc-dash/service.json.
    expect(registryPath({ XDG_STATE_HOME: "/x" }).replace("/oc-dash/", "/opencode/")).toBe(
      "/x/opencode/service.json",
    )
  })
})

describe("serviceUrl", () => {
  it("composes the url from the port", () => {
    expect(serviceUrl(4021)).toBe("http://127.0.0.1:4021")
  })
})

describe("writeRegistry / readRegistry", () => {
  it("writes port, pid, url and version", () => {
    const path = join(scratch(), "service.json")
    const written = writeRegistry({ port: 4022, pid: 4242 }, path)
    expect(written).toEqual({
      port: 4022,
      pid: 4242,
      url: "http://127.0.0.1:4022",
      version: appVersion(),
    })
    // The file itself is the contract the oc-dashbar twin reads.
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      port: 4022,
      pid: 4242,
      url: "http://127.0.0.1:4022",
      version: appVersion(),
    })
  })

  it("carries this package's real version, not a placeholder", () => {
    expect(appVersion()).toMatch(/^\d+\.\d+\.\d+/)
  })

  it("round-trips", () => {
    const path = join(scratch(), "service.json")
    writeRegistry({ port: 4021, pid: 7 }, path)
    const read = readRegistry(path)
    expect(read.kind).toBe("ok")
    if (read.kind !== "ok") throw new Error("unreachable")
    expect(read.record).toEqual({ port: 4021, pid: 7, url: "http://127.0.0.1:4021", version: appVersion() })
  })

  it("leaves no temp file behind", () => {
    const dir = scratch()
    const path = join(dir, "service.json")
    writeRegistry({ port: 4021, pid: 7 }, path)
    writeRegistry({ port: 4022, pid: 8 }, path)
    expect(readFileSync(path, "utf8")).not.toContain(".tmp")
    expect(dir).not.toMatch(/\.tmp$/)
  })

  it("recomposes url from port, so a doctored file cannot disagree with itself", () => {
    const path = join(scratch(), "service.json")
    writeFileSync(path, JSON.stringify({ port: 4021, pid: 7, url: "http://evil.example", version: "0.0.0" }))
    const read = readRegistry(path)
    if (read.kind !== "ok") throw new Error(`expected ok, got ${read.kind}`)
    expect(read.record.url).toBe("http://127.0.0.1:4021")
    expect(read.record.version).toBe("0.0.0")
  })

  it("reports a missing file as missing", () => {
    expect(readRegistry(join(scratch(), "nope.json")).kind).toBe("missing")
  })

  it("reports a malformed file as malformed, not missing", () => {
    const path = join(scratch(), "service.json")
    writeFileSync(path, "{not json")
    expect(readRegistry(path).kind).toBe("malformed")
  })

  it("refuses records with an unusable port or pid", () => {
    const path = join(scratch(), "service.json")
    for (const body of [
      { port: "4021", pid: 1 },
      { port: 4021, pid: "1" },
      { port: 0, pid: 1 },
      { port: 4021, pid: -1 },
      { port: 4021.5, pid: 1 },
      { port: 4021 },
      { pid: 1 },
      [],
      "nope",
      null,
    ]) {
      writeFileSync(path, JSON.stringify(body))
      expect(readRegistry(path).kind).toBe("malformed")
    }
  })

  it("tolerates a missing version, which is informational", () => {
    const path = join(scratch(), "service.json")
    writeFileSync(path, JSON.stringify({ port: 4021, pid: 7 }))
    const read = readRegistry(path)
    if (read.kind !== "ok") throw new Error("unreachable")
    expect(read.record.version).toBe("unknown")
  })
})

describe("removeRegistry", () => {
  it("removes an existing file and reports true", () => {
    const path = join(scratch(), "service.json")
    writeRegistry({ port: 4021, pid: 7 }, path)
    expect(removeRegistry(path)).toBe(true)
    expect(readRegistry(path).kind).toBe("missing")
  })

  it("is idempotent: removing an absent file is true and does not throw", () => {
    expect(removeRegistry(join(scratch(), "nope.json"))).toBe(true)
  })
})

describe("serviceMode", () => {
  it("is on only for an explicit 1", () => {
    expect(serviceMode({ OC_DASH_SERVICE: "1" })).toBe(true)
    expect(serviceMode({})).toBe(false)
    expect(serviceMode({ OC_DASH_SERVICE: "0" })).toBe(false)
    expect(serviceMode({ OC_DASH_SERVICE: "true" })).toBe(false)
  })
})
