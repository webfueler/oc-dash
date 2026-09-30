/**
 * The exit-code table, exercised through `run()`.
 *
 * `args.test.ts` proves what the parser decides; this proves what the command
 * then does with it, which is the part a user meets: which stream, and which
 * number in `$?`.
 *
 * The whole point of the table is that the two obvious cases do not share a
 * code. A bare `oc-dash` printed help and exits 0, because a question was
 * asked and answered. A mistyped command is a mistake and exits 1, to stderr,
 * because silently doing something else is how people end up with a server
 * they did not start. Every test here also asserts the registry file is still
 * absent afterwards, so "it did not start anything" is proven by the absence
 * of the file rather than by a line of output claiming as much.
 *
 * `XDG_STATE_HOME` is redirected into a fresh temp directory per test, which
 * is what makes "no registry file" observable without touching the real one
 * at ~/.local/state. The env is set before the dynamic imports below, because
 * the root help text has the registry path baked in at module load.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let state = ""
beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), "oc-dash-cli-test-"))
  process.env.XDG_STATE_HOME = state
})
afterEach(() => {
  rmSync(state, { recursive: true, force: true })
})

const { run } = await import("../../server/cli.js")
const { registryPath, readRegistry } = await import("../../server/registry.js")

interface Captured {
  io: { out: (line?: string) => void; err: (line?: string) => void }
  out: string
  err: string
}

function capture(): Captured {
  const out: string[] = []
  const err: string[] = []
  return {
    io: {
      out: (line) => out.push(line ?? ""),
      err: (line) => err.push(line ?? ""),
    },
    get out() {
      return out.join("\n")
    },
    get err() {
      return err.join("\n")
    },
  }
}

/** Every byte the run wrote, for stream-agnostic assertions. */
function all(c: Captured): string {
  return `${c.out}\n${c.err}`
}

/**
 * The registry path's whole directory, which is where anything this CLI could
 * leave behind would have to be. Empty means it wrote nothing at all.
 */
function stateEntries(): string[] {
  return existsSync(state) ? readdirSync(state) : []
}

function writeRawRegistry(contents: string): string {
  const path = registryPath()
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, contents, "utf8")
  return path
}

/** A pid above macOS's default pid_max (99998), so it cannot be in use. */
const DEAD_PID = 999_999

// --------------------------------------------------------------------------

describe("exit code 0: a question was asked and answered", () => {
  it("a bare invocation prints help on stdout, writes nothing, and exits 0", async () => {
    expect(stateEntries()).toEqual([])
    const c = capture()

    const code = await run([], c.io)

    expect(code).toBe(0)
    expect(c.err).toBe("")
    expect(c.out).toContain("USAGE")
    expect(c.out).toContain("npx @webfueler/oc-dash server start")
    // Proven by absence, not by a log line: no file, and no state directory
    // content of any kind, not even the oc-dash/ directory itself.
    expect(existsSync(registryPath())).toBe(false)
    expect(stateEntries()).toEqual([])
  })

  it("a bare invocation and --help are the same bytes and the same code", async () => {
    // The Captain's instruction was that the default should be "the same as
    // --help". Same output with a different exit code would not be the same.
    const bare = capture()
    const flag = capture()
    const word = capture()

    const codes = await Promise.all([
      run([], bare.io),
      run(["--help"], flag.io),
      run(["help"], word.io),
    ])

    expect(codes).toEqual([0, 0, 0])
    expect(bare.out).toBe(flag.out)
    expect(bare.out).toBe(word.out)
    expect(bare.err).toBe(flag.err)
    expect(bare.err).toBe("")
  })

  it("`server` with no subcommand prints the server help and exits 0", async () => {
    const c = capture()
    expect(await run(["server"], c.io)).toBe(0)
    expect(c.err).toBe("")
    expect(c.out).toContain("oc-dash server")
    expect(c.out).toContain("start")
    expect(stateEntries()).toEqual([])
  })

  it("--version prints the manifest version on stdout and exits 0", async () => {
    const c = capture()
    expect(await run(["--version"], c.io)).toBe(0)
    expect(c.err).toBe("")
    expect(c.out.trim()).toMatch(/^\d+\.\d+\.\d+/)
    expect(stateEntries()).toEqual([])
  })
})

describe("exit code 1: the input was a mistake", () => {
  it("an unknown command errors on stderr, with usage, and starts nothing", async () => {
    const c = capture()
    const code = await run(["start"], c.io)

    expect(code).toBe(1)
    expect(c.out).toBe("")
    expect(c.err).toContain("oc-dash: unknown command \"start\"")
    // The usage block is part of the error, not a consolation prize.
    expect(c.err).toContain("USAGE")
    expect(existsSync(registryPath())).toBe(false)
    expect(stateEntries()).toEqual([])
  })

  it("an unknown server subcommand suggests the three real ones", async () => {
    const c = capture()
    expect(await run(["server", "restart"], c.io)).toBe(1)
    expect(c.out).toBe("")
    expect(c.err).toContain("unknown command \"server restart\"")
    expect(c.err).toContain("Try: start, stop, status")
    expect(stateEntries()).toEqual([])
  })

  it("an unknown flag names the flag", async () => {
    const c = capture()
    expect(await run(["--verbose"], c.io)).toBe(1)
    expect(c.out).toBe("")
    expect(c.err).toContain("Unknown option '--verbose'")
    expect(c.err).toContain("USAGE")
    expect(stateEntries()).toEqual([])
  })

  it("a port that is not a port is refused rather than coerced", async () => {
    const c = capture()
    expect(await run(["server", "start", "--port", "abc"], c.io)).toBe(1)
    expect(c.err).toContain("--port must be an integer between 1 and 65535")
    expect(stateEntries()).toEqual([])
  })

  it("a bare --port is refused with the command that replaces it", async () => {
    // The migration case: a shell alias that used to be a foreground server.
    const c = capture()
    const code = await run(["--port", "4022"], c.io)

    expect(code).toBe(1)
    expect(c.out).toBe("")
    expect(c.err).toContain("--port 4022 needs a subcommand")
    expect(c.err).toContain("npx @webfueler/oc-dash server start --port 4022")
    expect(existsSync(registryPath())).toBe(false)
    expect(stateEntries()).toEqual([])
  })
})

describe("exit code 1: the state was not what the command was for", () => {
  it("`server status` with no registry answers on stdout and exits 1", async () => {
    // An answer to a question, not an error: stdout, because the human asked,
    // and 1, because the exit code is the truth value a script branches on.
    const c = capture()
    const code = await run(["server", "status"], c.io)

    expect(code).toBe(1)
    expect(c.err).toBe("")
    expect(c.out).toContain("oc-dash is not running")
    expect(c.out).toContain("npx @webfueler/oc-dash server start")
  })

  it("`server status` on a registry whose pid is gone says stale and exits 1", async () => {
    writeRawRegistry(JSON.stringify({ port: 4022, pid: DEAD_PID, version: "0.0.0" }))
    const c = capture()

    expect(await run(["server", "status"], c.io)).toBe(1)
    expect(c.out).toContain(`the registry is stale: no process with pid ${DEAD_PID}`)
    // Read-only: status never removes a registry, only stop does.
    expect(existsSync(registryPath())).toBe(true)
  })

  it("`server status` on an unusable registry errors on stderr and exits 1", async () => {
    writeRawRegistry("{ not json")
    const c = capture()

    expect(await run(["server", "status"], c.io)).toBe(1)
    expect(c.out).toBe("")
    expect(c.err).toContain("is unusable")
    expect(existsSync(registryPath())).toBe(true)
  })

  it("`server stop` with no registry exits 1 and says how to start one", async () => {
    const c = capture()
    expect(await run(["server", "stop"], c.io)).toBe(1)
    expect(c.out).toContain("oc-dash is not running")
    expect(c.out).toContain("nothing was ever started")
  })

  it("`server stop` on an unusable registry refuses and signals nothing", async () => {
    writeRawRegistry("{ not json")
    const c = capture()

    expect(await run(["server", "stop"], c.io)).toBe(1)
    expect(c.err).toContain("is unusable")
    expect(c.err).toContain("Nothing was signalled")
    expect(existsSync(registryPath())).toBe(true)
  })

  it("`server stop` on a live pid that is not oc-dash refuses to signal it", async () => {
    // pid 1 is alive and is not ours, so the three-fact check has to fail
    // closed. If this test ever fails by killing the machine's init, the
    // check in procinfo.ts has regressed and something far worse has too.
    writeRawRegistry(JSON.stringify({ port: 4022, pid: 1, version: "0.0.0" }))
    const c = capture()

    expect(await run(["server", "stop"], c.io)).toBe(1)
    expect(c.err).toContain("refusing to signal pid 1")
    expect(c.err).toContain("Nothing was signalled")
    // Still there, because refusing means not touching it.
    expect(readRegistry(registryPath()).kind).toBe("ok")
  })
})

describe("the two obvious cases stay apart", () => {
  it("bare is help on stdout and 0; a typo is stderr and 1", async () => {
    const bare = capture()
    const typo = capture()
    const bareCode = await run([], bare.io)
    const typoCode = await run(["server", "stat"], typo.io)

    expect(bareCode).toBe(0)
    expect(typoCode).toBe(1)
    expect(bareCode).not.toBe(typoCode)
    // Different streams, so `oc-dash > /dev/null` shows the human the error.
    expect(bare.out.length).toBeGreaterThan(0)
    expect(bare.err).toBe("")
    expect(typo.out).toBe("")
    expect(typo.err.length).toBeGreaterThan(0)
  })

  it("no bare or misspelled invocation leaves a registry behind", async () => {
    for (const argv of [[], ["--help"], ["--version"], ["nope"], ["server", "nope"], ["--nope"]]) {
      const c = capture()
      await run(argv, c.io)
      expect(existsSync(registryPath()), `${JSON.stringify(argv)} wrote a registry`).toBe(false)
      expect(stateEntries(), `${JSON.stringify(argv)} wrote to the state dir`).toEqual([])
    }
  })

  it("every stream the CLI writes is either help or a sentence, never a bare trace", async () => {
    // A smoke test over the whole table: nothing throws, the code is always
    // one of the two, and no stack trace leaks into either stream. Each argv
    // here is one that cannot spawn a server.
    for (const argv of [[], ["--help"], ["server"], ["--version"], ["nope"], ["--nope"]]) {
      const c = capture()
      const code = await run(argv, c.io)
      expect([0, 1], `${JSON.stringify(argv)} exited ${code}`).toContain(code)
      expect(all(c), JSON.stringify(argv)).not.toMatch(/at .*\.ts:\d+/)
    }
  })
})
