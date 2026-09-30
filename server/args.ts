/**
 * argv parsing for the oc-dash CLI.
 *
 * `node:util`'s parseArgs does the part that is genuinely fiddly and
 * standards-shaped: `--port 4022`, `--port=4022`, `-p 4022`, rejecting an
 * unknown flag, and rejecting `--port` with no value. What it does not do is
 * dispatch subcommands, so that is the whole of the hand-rolled part, and it
 * is small enough to read in one sitting.
 *
 * Parsing is pure and touches no filesystem, so the whole grammar is
 * testable without spawning anything.
 */

import { parseArgs, type ParseArgsOptionsConfig } from "node:util"
import { parsePort } from "./port.js"

export type HelpTopic = "root" | "server" | "start" | "stop" | "status"

/**
 * How this package is run when it is not already on the PATH. It lives here
 * rather than in help.ts because the refusals below have to name the exact
 * replacement command, and a help function is the wrong place to look for a
 * string that has to be copy-pasteable.
 */
export const PACKAGE = "npx @webfueler/oc-dash"

export type Command =
  | { kind: "start"; port: number | null; foreground: boolean }
  | { kind: "stop" }
  | { kind: "status" }
  | { kind: "help"; topic: HelpTopic }
  | { kind: "version" }

export type ParseOutcome =
  | { ok: true; command: Command }
  | { ok: false; message: string; topic: HelpTopic }

const OPTIONS: ParseArgsOptionsConfig = {
  port: { type: "string", short: "p" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
  foreground: { type: "boolean", short: "f" },
}

/** Membership set for the three `server` subcommands; values are unused. */
const SUBCOMMANDS = { start: true, stop: true, status: true } as const

function topicOf(positionals: string[]): HelpTopic {
  if (positionals[0] !== "server") return "root"
  const second = positionals[1]
  return second && second in SUBCOMMANDS ? (second as HelpTopic) : "server"
}

export function parseCommandLine(argv: string[]): ParseOutcome {
  let values: { port?: string; help?: boolean; version?: boolean; foreground?: boolean }
  let positionals: string[]
  let sawTerminator: boolean
  try {
    const parsed = parseArgs({
      args: argv,
      options: OPTIONS,
      allowPositionals: true,
      strict: true,
      tokens: true,
    })
    values = parsed.values as typeof values
    positionals = parsed.positionals
    sawTerminator = parsed.tokens.some((token) => token.kind === "option-terminator")
  } catch (err) {
    // parseArgs' own message is good ("Unknown option '--nope'"); strip the
    // trailing hint about `--` so the usage block below it reads cleanly.
    const message = (err as Error).message.replace(/\s*To specify a positional.*$/s, "").trim()
    return { ok: false, message, topic: "root" }
  }

  const fail = (message: string, topic: HelpTopic = topicOf(positionals)): ParseOutcome => ({
    ok: false,
    message,
    topic,
  })

  // Nothing in this CLI takes a free-standing operand, so `--` has no meaning
  // here. Without this it would be a silent pass-through: `oc-dash -- server`
  // would behave as `oc-dash server`.
  if (sawTerminator) {
    return fail("`--` is not supported: this command takes no free-standing arguments")
  }

  // A port only means something where a port can be chosen.
  const rawPort = values.port
  const port = rawPort === undefined ? null : parsePort(rawPort)
  if (rawPort !== undefined && port === null) {
    return fail(`--port must be an integer between 1 and 65535, got "${rawPort}"`)
  }

  const topic = topicOf(positionals)

  // --help and --version win over dispatch, at every level, so
  // `oc-dash server start --help` is the help for `server start`. The bare
  // word works too: `oc-dash help`, `oc-dash server help`.
  const helpWordAt =
    positionals[0] === "help" ? 1
    : positionals[0] === "server" && positionals[1] === "help" ? 2
    : 0

  if (values.help === true || helpWordAt > 0) {
    // `--help server` narrows the topic, which is why a positional after the
    // flag is fine; `help server` reads as an argument to `help` and is not.
    if (helpWordAt > 0 && positionals.length > helpWordAt) {
      return fail(`help takes no argument, got "${positionals[helpWordAt]}"`, topic)
    }
    return { ok: true, command: { kind: "help", topic } }
  }
  if (values.version === true) {
    return { ok: true, command: { kind: "version" } }
  }

  // No subcommand at all. This used to be a foreground server, which is the
  // one thing it must not be any more: the only question a bare invocation
  // can be asking is what this tool is, and help answers it without binding a
  // port, writing a registry, or needing a terminal to hand back.
  //
  // --port and --foreground need a subcommand, and saying so beats printing
  // help: `oc-dash --port 4022` that silently ignored the flag would look
  // exactly like a server that failed to come up. The message carries the
  // user's own flag through to the command that accepts it, because the
  // people who hit this are the ones with the old invocation in a shell
  // alias and no reason to guess what replaced it.
  if (positionals.length === 0) {
    const orphan: string[] = []
    if (rawPort !== undefined) orphan.push(`--port ${rawPort}`)
    if (values.foreground === true) orphan.push("--foreground")
    if (orphan.length > 0) {
      const flags = orphan.join(" ")
      return fail(
        `${orphan.join(" and ")} ${orphan.length > 1 ? "need" : "needs"} a subcommand.\n` +
          `  To start a server: ${PACKAGE} server start ${flags}`,
      )
    }
    return { ok: true, command: { kind: "help", topic: "root" } }
  }

  if (positionals[0] !== "server") {
    return fail(`unknown command "${positionals[0]}"`)
  }

  if (positionals.length === 1) {
    return { ok: true, command: { kind: "help", topic: "server" } }
  }

  const sub = positionals[1]
  if (!(sub in SUBCOMMANDS)) {
    return fail(
      `unknown command "server ${sub}". Try: start, stop, status`,
      "server",
    )
  }
  if (positionals.length > 2) {
    return fail(`unexpected argument "${positionals[2]}"`, sub as HelpTopic)
  }

  if (sub === "start") {
    return { ok: true, command: { kind: "start", port, foreground: values.foreground === true } }
  }

  // stop and status read the registry; they never choose a port, so accepting
  // one would read as "act on the one on this port" when nothing does.
  if (port !== null) {
    return fail(`--port does not apply to "server ${sub}"`, sub as HelpTopic)
  }
  if (values.foreground === true) {
    return fail(`--foreground does not apply to "server ${sub}"`, sub as HelpTopic)
  }
  if (sub === "stop") return { ok: true, command: { kind: "stop" } }
  return { ok: true, command: { kind: "status" } }
}
