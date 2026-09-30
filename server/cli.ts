/**
 * The oc-dash command line.
 *
 *   oc-dash                         this help, and nothing else (was: foreground)
 *   oc-dash server start            detached, writes the registry
 *   oc-dash server stop             terminates what the registry names
 *   oc-dash server status           is it up, where, which pid
 *
 * A bare `npx oc-dash` used to start the server in the foreground. It no
 * longer starts anything: it prints the help and exits 0, which is what git,
 * npm, docker, kubectl, brew and cargo do with a bare name whether they
 * choose to exit 0 or 1. Exit 0 rather than 1 because the default is meant
 * to be "the same as --help", and identical bytes with a
 * different exit code is a defect in itself. The command that starts a
 * server is named in the first line of that help, because the people who
 * need it are the ones who typed the old invocation from memory.
 *
 * The detach mechanism is a plain `spawn` with `detached: true` and
 * `unref()`. On POSIX that is a `setsid()`: the child gets its own session
 * and process group, so the terminal's SIGHUP on logout never reaches it and
 * it is not in the launcher's process group either. Nothing from macOS is
 * involved, and nothing outside this package is written to disk. The honest
 * cost is that an orphaned child does not survive a logout or a reboot; a
 * launchd agent would survive both, and it was rejected for two reasons.
 *
 *   1. It means writing a plist into ~/Library/LaunchAgents and calling
 *      `launchctl bootstrap`, i.e. mutating the user's login items from a
 *      command that only wanted to look at a dashboard. Uninstalling it has
 *      to be part of `stop`, and a half-removed agent outlives the problem.
 *   2. `KeepAlive` would restart the server on a fresh port every time it
 *      exited, which fights the port fallback: the
 *      whole point is that the port is chosen once and recorded.
 *
 * If surviving logout ever becomes a requirement, a launchd agent is the
 * right answer and belongs on its own, not bolted onto `start`.
 *
 * Exit codes, every one of them deliberate and printed in `--help`:
 *
 *   0  the command did what it was asked. Including a bare `oc-dash`,
 *      `--help` and `server status` finding a running server.
 *   1  something was wrong, or the state was not what the command was for:
 *      an unknown command or flag, a --port that will not parse, a start
 *      that could not finish, a stop that refused to signal, and
 *      `server status` / `server stop` finding nothing running.
 *
 * Those last two are 1 on purpose, even though a bare `oc-dash` is 0: they
 * are predicates over machine state that a script branches on
 * (`server status >/dev/null && echo up`), not requests for orientation.
 */

import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { parseCommandLine, type Command, type HelpTopic } from "./args.js"
import { helpText } from "./help.js"
import { resolvePort } from "./port.js"
import { confirmServicePid, isAlive } from "./procinfo.js"
import {
  appVersion,
  readRegistry,
  registryPath,
  removeRegistry,
  serviceUrl,
} from "./registry.js"

/** How long `server start` waits for the child to publish its registry. */
const READY_TIMEOUT_MS = 10_000
const READY_POLL_MS = 100
/** How long `server stop` waits for a SIGTERM to be honoured. */
const STOP_GRACE_MS = 5_000
const STOP_POLL_MS = 100

/**
 * The server entry point, resolved from this module so the compiled
 * dist-server/cli.js finds its sibling index.js.
 */
const SERVER_ENTRY = new URL("./index.js", import.meta.url)

/**
 * The launcher to re-exec for the detached child. `process.argv[1]` is the
 * script that is actually running, so the child is invoked exactly the way
 * this process was — from an npx cache, a checkout, or a global install.
 */
function launcherPath(): string {
  if (process.argv[1]) return process.argv[1]
  return fileURLToPath(new URL("../bin/oc-dash.js", import.meta.url))
}

export interface Io {
  out(line?: string): void
  err(line?: string): void
}

const CONSOLE: Io = { out: (line) => console.log(line), err: (line) => console.error(line) }

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** True while the pid is still around, without saying anything about what it is. */
async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      process.kill(pid, 0)
    } catch (err) {
      // ESRCH is gone. EPERM means alive and owned by someone else, which is
      // not a state our own child should ever reach.
      if ((err as NodeJS.ErrnoException).code === "ESRCH") return true
      return false
    }
    if (Date.now() >= deadline) return false
    await sleep(STOP_POLL_MS)
  }
}

function showHelp(io: Io, topic: HelpTopic): number {
  io.out(helpText(topic))
  return 0
}

/** Bad input: the message, then the usage block for where the user was. */
function usageError(io: Io, message: string, topic: HelpTopic): number {
  io.err(`oc-dash: ${message}\n`)
  io.err(helpText(topic))
  return 1
}

function printNotRunning(io: Io, detail: string): number {
  io.out("oc-dash is not running")
  io.out(`  ${detail}`)
  io.out(`  registry: ${registryPath()}`)
  io.out("  start it with: npx @webfueler/oc-dash server start")
  return 1
}

// --------------------------------------------------------------------------
// server start
// --------------------------------------------------------------------------

async function start(io: Io, port: number | null): Promise<number> {
  const path = registryPath()

  // A registry naming a live oc-dash server is not an obstacle to starting,
  // it is the reason not to: a second server would overwrite the only record
  // of the first.
  const existing = readRegistry(path)
  if (existing.kind === "ok") {
    const identity = confirmServicePid(existing.record)
    if (identity.confirmed) {
      io.err(`oc-dash is already running on ${serviceUrl(existing.record.port)} (pid ${existing.record.pid})`)
      io.out("  stop it first with: npx @webfueler/oc-dash server stop")
      return 1
    }
    io.out(`clearing a registry that no longer names a running server: ${identity.reason}`)
    removeRegistry(path)
  } else if (existing.kind === "malformed" || existing.kind === "unreadable") {
    io.out(`clearing an unusable registry (${existing.reason})`)
    if (!removeRegistry(path)) {
      io.err(`oc-dash: could not remove ${path}; fix or delete it, then start again`)
      return 1
    }
  }

  const requested = resolvePort(port, process.env.PORT)
  const child = spawn(
    process.execPath,
    [launcherPath(), "server", "start", "--foreground", "--port", String(requested)],
    {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, OC_DASH_SERVICE: "1" },
    },
  )
  // detached already put the child in its own session; unref keeps this
  // process free to exit the moment the wait below is done.
  child.unref()

  const deadline = Date.now() + READY_TIMEOUT_MS
  for (;;) {
    // Readiness is "the child published a registry naming its own pid", which
    // a stale file left behind by an earlier run cannot fake.
    const ready = readRegistry(path)
    if (ready.kind === "ok" && ready.record.pid === child.pid) {
      io.out(`oc-dash started in the background on ${serviceUrl(ready.record.port)} (pid ${child.pid})`)
      io.out(`  open ${serviceUrl(ready.record.port)}`)
      io.out(`  registry: ${path}`)
      io.out("  stop it with: npx @webfueler/oc-dash server stop")
      return 0
    }
    if (child.exitCode !== null) {
      io.err(`oc-dash exited before it finished starting (exit code ${child.exitCode}).`)
      io.err("  The dashboard needs a running opencode service. To see why,")
      io.err("  run the same start in the foreground:")
      io.err(`    npx @webfueler/oc-dash server start --foreground --port ${requested}`)
      return 1
    }
    if (Date.now() >= deadline) {
      io.err(`oc-dash did not confirm startup within ${READY_TIMEOUT_MS / 1000} seconds.`)
      io.err("  Run it in the foreground to see the error:")
      io.err(`    npx @webfueler/oc-dash server start --foreground --port ${requested}`)
      return 1
    }
    await sleep(READY_POLL_MS)
  }
}

// --------------------------------------------------------------------------
// server stop
// --------------------------------------------------------------------------

async function stop(io: Io): Promise<number> {
  const path = registryPath()
  const read = readRegistry(path)

  if (read.kind === "missing") {
    return printNotRunning(io, "there is no registry file, so nothing was ever started")
  }
  if (read.kind === "malformed" || read.kind === "unreadable") {
    io.err(`oc-dash: the registry at ${path} is unusable (${read.reason}).`)
    io.err("  Refusing to guess which process that meant. Nothing was signalled.")
    io.err(`  Remove it yourself if it is wrong:  rm ${path}`)
    return 1
  }

  const { record } = read
  const identity = confirmServicePid(record)

  // A pid that is gone is not a safety problem, it is a cleanup problem.
  if (!identity.confirmed && !isAlive(record.pid)) {
    io.out(`oc-dash is not running; removing a stale registry (no process with pid ${record.pid})`)
    removeRegistry(path)
    io.out(`  removed ${path}`)
    return 1
  }

  if (!identity.confirmed) {
    io.err(`oc-dash: refusing to signal pid ${record.pid}. ${identity.reason}.`)
    if (identity.argv) io.err(`  its command line is: ${identity.argv}`)
    if (identity.observed) io.err(`  observed: ${identity.observed}`)
    io.err(`  registry: ${path}`)
    io.err("")
    io.err("  A pid in a registry file outlives the process it named: the operating")
    io.err("  system will hand that number to whatever starts next, and killing that")
    io.err("  would take out an unrelated program. oc-dash also has no name-based")
    io.err("  fallback (pkill -f, killall) because a name match would hit your")
    io.err("  editor, your test runner, and the opencode service this reads from.")
    io.err("")
    io.err("  Nothing was signalled. If this really is a stale registry, remove it:")
    io.err(`    rm ${path}`)
    return 1
  }

  process.kill(record.pid, "SIGTERM")
  const gone = await waitForExit(record.pid, STOP_GRACE_MS)
  if (!gone) {
    io.err(`oc-dash: pid ${record.pid} is still running ${STOP_GRACE_MS / 1000} seconds after SIGTERM.`)
    io.err(`  It is confirmed oc-dash on port ${record.port}, so this is not a recycled pid.`)
    io.err("  Not escalating to SIGKILL on its own; if you need to:")
    io.err(`    kill -9 ${record.pid}`)
    return 1
  }

  // The child removes the file itself on a clean SIGTERM. This covers the
  // case where it was killed hard enough not to, and only touches a record
  // still naming the pid we just stopped.
  const after = readRegistry(path)
  if (after.kind === "ok" && after.record.pid === record.pid) {
    removeRegistry(path)
    io.out(`removed a registry the server did not clean up itself: ${path}`)
  }
  io.out(`stopped oc-dash on ${serviceUrl(record.port)} (pid ${record.pid})`)
  return 0
}

// --------------------------------------------------------------------------
// server status
// --------------------------------------------------------------------------

function status(io: Io): number {
  const path = registryPath()
  const read = readRegistry(path)

  if (read.kind === "missing") {
    return printNotRunning(io, "there is no registry file")
  }
  if (read.kind === "malformed" || read.kind === "unreadable") {
    io.err(`oc-dash: the registry at ${path} is unusable (${read.reason}).`)
    io.err("  Refusing to guess which process that meant.")
    return 1
  }

  const { record } = read
  const identity = confirmServicePid(record)
  if (!identity.confirmed) {
    if (!isAlive(record.pid)) {
      return printNotRunning(io, `the registry is stale: no process with pid ${record.pid}`)
    }
    io.err(`oc-dash: the registry names pid ${record.pid}, which is not a confirmed oc-dash server.`)
    io.err(`  ${identity.reason}.`)
    if (identity.argv) io.err(`  its command line is: ${identity.argv}`)
    io.err(`  registry: ${path}`)
    io.err("")
    io.err("  Reporting it as running would be a guess, so this exits 1. If the")
    io.err("  registry is stale, clear it with: npx @webfueler/oc-dash server stop")
    return 1
  }

  io.out("oc-dash is running")
  io.out(`  url     ${serviceUrl(record.port)}`)
  io.out(`  pid     ${record.pid}`)
  io.out(`  version ${record.version}`)
  io.out(`  file    ${path}`)
  return 0
}

// --------------------------------------------------------------------------
// entry point
// --------------------------------------------------------------------------

/** The server, in this terminal. Only `server start --foreground` reaches it. */
async function serve(): Promise<number> {
  await import(SERVER_ENTRY.href)
  // index.js holds the event loop open for the life of the server; reaching
  // here means it exited on its own.
  return 0
}

export async function run(argv: string[], io: Io = CONSOLE): Promise<number> {
  const parsed = parseCommandLine(argv)
  if (!parsed.ok) return usageError(io, parsed.message, parsed.topic)
  const command: Command = parsed.command

  switch (command.kind) {
    case "help":
      return showHelp(io, command.topic)
    case "version":
      io.out(appVersion())
      return 0
    case "start":
      if (command.foreground) {
        // The detached child, and anyone who wants the log in front of them.
        // Everything service-shaped is switched on here so index.js stays a
        // plain server: it only ever reads these two variables.
        process.env.OC_DASH_SERVICE = "1"
        process.env.PORT = String(resolvePort(command.port, process.env.PORT))
        return serve()
      }
      return start(io, command.port)
    case "stop":
      return stop(io)
    case "status":
      return status(io)
  }
}
