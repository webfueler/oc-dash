import { describe, expect, it } from "vitest"
import { helpText } from "../../server/help.js"
import type { HelpTopic } from "../../server/args.js"
import { DEFAULT_PORT } from "../../server/port.js"
import { registryPath } from "../../server/registry.js"

const TOPICS: HelpTopic[] = ["root", "server", "start", "stop", "status"]

describe("helpText", () => {
  it("has a topic for every command the CLI can dispatch", () => {
    for (const topic of TOPICS) {
      expect(helpText(topic).trim().length).toBeGreaterThan(0)
    }
  })

  it("leads with a usage block, not a paragraph", () => {
    for (const topic of TOPICS) {
      const text = helpText(topic)
      expect(text).toContain("USAGE")
      // The block is near the top, not buried at the end.
      expect(text.indexOf("USAGE")).toBeLessThan(200)
    }
  })

  it("names every subcommand in the root help", () => {
    const root = helpText("root")
    for (const name of ["server start", "server stop", "server status"]) {
      expect(root).toContain(name)
    }
  })

  it("puts the command that starts a server at the top of the root help", () => {
    // The bare command used to start a server, so anyone typing
    // it from memory is the reader this line exists for. It has to be above
    // the port rules and the registry file, not in a section at the bottom.
    const root = helpText("root")
    const line = root.indexOf("npx @webfueler/oc-dash server start")
    expect(line).toBeGreaterThan(-1)
    expect(root.indexOf("PORTS")).toBeGreaterThan(line)
    expect(root.indexOf("THE REGISTRY FILE")).toBeGreaterThan(line)
    // And close enough to the top that a reader who gives up early still sees it.
    expect(line).toBeLessThan(200)
  })

  it("spells out the migration from the old bare command to a subcommand", () => {
    const root = helpText("root")
    expect(root).toMatch(/used to start the server/i)
    // All three replacements, so whichever one they wanted is on the page.
    expect(root).toContain("npx @webfueler/oc-dash server start\n")
    expect(root).toContain("npx @webfueler/oc-dash server start --foreground")
    expect(root).toContain("npx @webfueler/oc-dash server start --port 4022")
    // And it says the safe thing about the new default: nothing started.
    expect(root).toMatch(/nothing started/i)
    expect(root).toMatch(/no\s+port is bound/i)
  })

  it("documents the whole exit-code table, and keeps bare 0 apart from a typo 1", () => {
    const root = helpText("root")
    expect(root).toMatch(/0 {2}did what you asked/)
    expect(root).toMatch(/1 {2}something was wrong/)
    // The distinction worth protecting, stated in the CLI itself.
    expect(root).toMatch(/bare `oc-dash` is 0 and a mistyped command is 1/)
    expect(root).toMatch(/Errors always go to stderr/)
    // status and stop stay 1 on "not running" because scripts branch on them.
    expect(root).toMatch(/server status >\/dev\/null && echo up/)
  })

  it("documents the port precedence and the collision behaviour in the root help", () => {
    const root = helpText("root")
    expect(root).toContain("--port")
    expect(root).toContain("PORT=")
    expect(root).toContain(`3. ${DEFAULT_PORT}`)
    // The complaint was that a fixed port collides; the help has to
    // say what happens when it does, not just what the default is.
    expect(root).toMatch(/busy/i)
    expect(root).toMatch(/next free port|another free one/i)
  })

  it("documents the registry file and its shape in the root help", () => {
    const root = helpText("root")
    expect(root).toContain(registryPath())
    expect(root).toContain('"port": 4021, "pid": 12345,')
    expect(root).toContain('"url": "http://127.0.0.1:4021", "version": "0.1.8"')
  })

  it("tells the reader the background server does not survive logout", () => {
    expect(helpText("root")).toMatch(/log out/)
    expect(helpText("start")).toMatch(/detached|background/i)
  })

  it("explains why stop refuses, and that there is no name-based fallback", () => {
    const stop = helpText("stop")
    expect(stop).toMatch(/pkill -f/)
    expect(stop).toMatch(/refus/i)
    expect(stop).toContain(registryPath())
  })

  it("documents the exit codes for status, since that is the scripting surface", () => {
    expect(helpText("status")).toMatch(/Exits 0 when it is running and 1 when it is not/)
  })

  it("names the registry file on every subcommand help", () => {
    for (const topic of ["server", "start", "stop", "status"] as const) {
      expect(helpText(topic)).toContain(registryPath())
    }
  })

  it("returns no trailing newline, because the writer adds the line break", () => {
    for (const topic of TOPICS) {
      expect(helpText(topic).endsWith("\n")).toBe(false)
    }
  })

  it("keeps every line inside 80 columns", () => {
    // The registry path is the user's home directory, so it is substituted
    // before measuring; a long home is not a help-text bug.
    for (const topic of TOPICS) {
      for (const line of helpText(topic).split("\n")) {
        const shown = line.replace(registryPath(), "<registry>")
        expect(shown.length, `"${shown}" is ${shown.length} columns`).toBeLessThanOrEqual(80)
      }
    }
  })
})
