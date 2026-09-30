import { describe, expect, it } from "vitest"
import { parseCommandLine } from "../../server/args.js"

function command(argv: string[]) {
  const parsed = parseCommandLine(argv)
  if (!parsed.ok) throw new Error(`expected ${JSON.stringify(argv)} to parse, got: ${parsed.message}`)
  return parsed.command
}

function failure(argv: string[]) {
  const parsed = parseCommandLine(argv)
  if (parsed.ok) throw new Error(`expected ${JSON.stringify(argv)} to fail, got ${parsed.command.kind}`)
  return parsed
}

describe("parseCommandLine: no subcommand", () => {
  it("bare argv is the root help, not a serve", () => {
    // A bare invocation used to be a foreground server; it is
    // now exactly `--help`, so the two have to be indistinguishable here.
    expect(command([])).toEqual({ kind: "help", topic: "root" })
    expect(command([])).toEqual(command(["--help"]))
    expect(command([])).toEqual(command(["help"]))
  })

  it("a bare flag with no subcommand is refused, naming the replacement", () => {
    // Refusing beats printing help here: `oc-dash --port 4022` that quietly
    // ignored the port would be indistinguishable from a server that never
    // came up. The flag comes back in the suggested command so an old shell
    // alias is fixable by reading the error.
    const port = failure(["--port", "4022"])
    expect(port.message).toMatch(/--port 4022 needs a subcommand/)
    expect(port.message).toContain("npx @webfueler/oc-dash server start --port 4022")
    expect(port.topic).toBe("root")

    const foreground = failure(["--foreground"])
    expect(foreground.message).toMatch(/--foreground needs a subcommand/)
    expect(foreground.message).toContain(
      "npx @webfueler/oc-dash server start --foreground",
    )
  })

  it("keeps both orphan flags in the suggestion when both are given", () => {
    const both = failure(["--port", "4022", "--foreground"])
    expect(both.message).toMatch(/--port 4022 and --foreground need a subcommand/)
    expect(both.message).toContain(
      "npx @webfueler/oc-dash server start --port 4022 --foreground",
    )
  })

  it("still reports an unusable port as a bad port, not as an orphan flag", () => {
    // The port is checked before the subcommand, so the error names the
    // actual problem rather than complaining about a missing subcommand.
    expect(failure(["--port", "abc"]).message).toMatch(/--port must be an integer/)
    expect(failure(["--port", "abc"]).message).not.toMatch(/subcommand/)
  })
})

describe("parseCommandLine: the server subcommands", () => {
  it("start, stop and status", () => {
    expect(command(["server", "start"])).toEqual({ kind: "start", port: null, foreground: false })
    expect(command(["server", "stop"])).toEqual({ kind: "stop" })
    expect(command(["server", "status"])).toEqual({ kind: "status" })
  })

  it("start takes a port in every spelling parseArgs accepts", () => {
    for (const argv of [
      ["server", "start", "--port", "4022"],
      ["server", "start", "--port=4022"],
      ["server", "start", "-p", "4022"],
      ["server", "start", "-p4022"],
    ]) {
      expect(command(argv)).toEqual({ kind: "start", port: 4022, foreground: false })
    }
  })

  it("start takes --foreground", () => {
    expect(command(["server", "start", "--foreground"])).toEqual({
      kind: "start",
      port: null,
      foreground: true,
    })
  })

  it("`server` on its own shows the server help rather than running anything", () => {
    expect(command(["server"])).toEqual({ kind: "help", topic: "server" })
  })
})

describe("parseCommandLine: help and version at every level", () => {
  it("help names the deepest recognised topic", () => {
    expect(command(["server", "--help"])).toEqual({ kind: "help", topic: "server" })
    expect(command(["server", "start", "--help"])).toEqual({ kind: "help", topic: "start" })
    expect(command(["server", "stop", "--help"])).toEqual({ kind: "help", topic: "stop" })
    expect(command(["server", "status", "--help"])).toEqual({ kind: "help", topic: "status" })
    // `--port 4022 --help` must still be help, not a start on 4022.
    expect(command(["server", "start", "--port", "4022", "--help"])).toEqual({
      kind: "help",
      topic: "start",
    })
  })

  it("short flags work", () => {
    expect(command(["-h"])).toEqual({ kind: "help", topic: "root" })
    expect(command(["server", "status", "-h"])).toEqual({ kind: "help", topic: "status" })
    expect(command(["--version"])).toEqual({ kind: "version" })
    expect(command(["-v"])).toEqual({ kind: "version" })
    expect(command(["server", "start", "--version"])).toEqual({ kind: "version" })
  })

  it("the word help works like the flag", () => {
    expect(command(["help"])).toEqual({ kind: "help", topic: "root" })
    expect(command(["server", "help"])).toEqual({ kind: "help", topic: "server" })
  })

  it("help takes no argument, as a word; --help does", () => {
    expect(failure(["help", "server"]).message).toMatch(/help takes no argument/)
    expect(failure(["server", "help", "stop"]).message).toMatch(/help takes no argument/)
  })
})

describe("parseCommandLine: refusals", () => {
  it("rejects an unknown top-level command", () => {
    expect(failure(["start"]).message).toMatch(/unknown command "start"/)
  })

  it("rejects an unknown server subcommand and suggests the real ones", () => {
    expect(failure(["server", "restart"]).message).toMatch(
      /unknown command "server restart"\. Try: start, stop, status/,
    )
  })

  it("rejects extra arguments", () => {
    expect(failure(["server", "stop", "now"]).message).toMatch(/unexpected argument "now"/)
    expect(failure(["server", "status", "--port", "4022"]).message).toMatch(
      /--port does not apply to "server status"/,
    )
    expect(failure(["server", "stop", "--foreground"]).message).toMatch(
      /--foreground does not apply to "server stop"/,
    )
  })

  it("rejects an unusable port instead of coercing it", () => {
    expect(failure(["server", "start", "--port", "abc"]).message).toMatch(
      /--port must be an integer between 1 and 65535, got "abc"/,
    )
    expect(failure(["server", "start", "--port", "0"]).message).toMatch(/--port must be/)
    expect(failure(["server", "start", "--port", "70000"]).message).toMatch(/--port must be/)
    expect(failure(["server", "start", "--port"]).message).toMatch(/argument missing/)
  })

  it("rejects an unknown option", () => {
    expect(failure(["--verbose"]).message).toMatch(/Unknown option '--verbose'/)
    expect(failure(["server", "start", "--detach"]).message).toMatch(/Unknown option '--detach'/)
  })

  it("points at the usage block for where the user was", () => {
    expect(failure(["server", "stop", "now"]).topic).toBe("stop")
    expect(failure(["server", "restart"]).topic).toBe("server")
    expect(failure(["--verbose"]).topic).toBe("root")
    // An unknown top-level word has no subcommand help of its own.
    expect(failure(["start"]).topic).toBe("root")
  })

  it("rejects a `--` terminator instead of silently passing it through", () => {
    // This CLI takes no free-standing operands, so `--` can only ever be a
    // mistake: `oc-dash -- server` must not behave as `oc-dash server`.
    expect(failure(["--", "server"]).message).toMatch(/`--` is not supported/)
    expect(failure(["server", "stop", "--", "now"]).message).toMatch(/`--` is not supported/)
    expect(failure(["--"]).message).toMatch(/`--` is not supported/)
  })

  it("lets `--help` narrow the topic, which `help` as a word does not", () => {
    expect(command(["--help", "server"])).toEqual({ kind: "help", topic: "server" })
    expect(command(["--help", "server", "stop"])).toEqual({ kind: "help", topic: "stop" })
  })
})
