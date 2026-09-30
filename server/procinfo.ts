/**
 * Proving a recorded pid is still the oc-dash process we
 * started, before anything is signalled.
 *
 * A registry file outlives the process it names. A crash, an unclean exit, a
 * reboot, or a `rm -rf` of a state directory all leave a pid sitting in
 * `$XDG_STATE_HOME/oc-dash/service.json`, and the kernel will hand that
 * number to whatever starts next. Signalling it kills a stranger's program,
 * so `server stop` needs three independent facts before it sends a byte:
 *
 *   1. the pid is alive;
 *   2. its command line is an oc-dash launcher; and
 *   3. that same pid holds the listening socket for the recorded port.
 *
 * (1) alone is worthless, which is the whole reason this module exists.
 * (2) says "some oc-dash", (3) says "this one, on this port", so a stale file
 * that names a running oc-dash from a different start is still refused.
 *
 * Both facts are read from the OS with tools macOS already ships: /bin/ps
 * for the command line and /usr/sbin/lsof for the sockets. That is a
 * deliberate choice over `lsof`-free alternatives -- there is no pure-Node
 * way to read another process's argv, and pulling in a native module to do it
 * would cost a dependency, a build step, and a prebuild for every platform
 * this package publishes to.
 *
 * There is deliberately no name-based kill anywhere in this package. Not as
 * a fallback, not as a "probably fine" second attempt. `pkill -f oc-dash`
 * matches this very command line, the user's editor with the word in a
 * filename, their test runner, and the opencode service that this dashboard
 * depends on. A pid that cannot be confirmed is never signalled; the caller
 * is told why instead.
 *
 * Every failure resolves to "not confirmed", including a missing lsof, an
 * unreadable process table, or a timeout. The check fails closed.
 */

import { spawnSync } from "node:child_process"
import type { ServiceRecord } from "./registry.js"

const LSOF = "/usr/sbin/lsof"
const PS = "/bin/ps"
/** The only address this server ever binds, and the one the registry advertises. */
const LOOPBACK = "127.0.0.1"

/**
 * The launcher, however it was reached: from a checkout, from an npx cache,
 * or through a PATH symlink that a global npm install leaves at
 * /opt/homebrew/bin/oc-dash with no package directory anywhere in it.
 * Anchored at the end so `/opt/bin/oc-dashboard` does not slip through.
 */
const BIN_ENTRY = /(?:^|\/)oc-dash(?:\.js)?$/
/** The compiled server, run directly the way `npm start` does. */
const SERVER_ENTRY = /(?:^|\/)oc-dash\/dist-server\/(?:index|cli|listen)\.js$/

export interface Endpoint {
  host: string
  port: number
}

export interface Identity {
  confirmed: boolean
  pid: number
  /** The command line as the OS reports it; empty when it could not be read. */
  argv: string
  /** Why it is not confirmed. Always set when `confirmed` is false. */
  reason: string
  /** Whatever was observed, so the refusal can show the user the evidence. */
  observed?: string
  /** The sockets the pid is listening on, when they could be read. */
  listening?: Endpoint[]
}

/** Liveness only. Says nothing about identity. */
export function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid < 1) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM means it exists and belongs to someone else, which for our
    // purposes is "alive and definitely not ours".
    return (err as NodeJS.ErrnoException).code === "EPERM"
  }
}

/** The full command line for a pid, or null when it cannot be read. */
export function processArgv(pid: number): string | null {
  const res = spawnSync(PS, ["-p", String(pid), "-o", "args="], {
    encoding: "utf8",
    timeout: 5_000,
  })
  if (res.error || res.status !== 0) return null
  const argv = res.stdout.trim()
  return argv.length > 0 ? argv : null
}

/**
 * True when a command line is running one of this package's entry scripts.
 *
 * This reads the path a process was launched from; it is not the name-based
 * match that `stop` refuses to fall back to. An editor with an oc-dash file
 * open will match here on purpose -- `ps` shows the whole command line, and
 * filtering for "the first argument" would miss a global install's PATH
 * symlink. That case cannot get past the listening-socket check below,
 * which is the gate that makes a confirmation specific to one instance.
 */
export function isOcDashArgv(argv: string): boolean {
  return argv
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .some((token) => BIN_ENTRY.test(token) || SERVER_ENTRY.test(token))
}

/**
 * The TCP sockets a pid is listening on.
 *
 * null means "could not tell" -- lsof missing, refusing to run, timing out.
 * An empty array means "told, and the answer was nothing", which is the
 * answer for a dead pid. Keeping those apart is what lets the caller fail
 * closed without failing on every corpse.
 */
export function listeningEndpoints(pid: number): Endpoint[] | null {
  const res = spawnSync(
    LSOF,
    ["-nP", "-a", "-p", String(pid), "-iTCP", "-sTCP:LISTEN", "-F", "n"],
    { encoding: "utf8", timeout: 5_000 },
  )
  if (res.error) return null
  // lsof exits 1 both for "nothing matched" and for real errors; the errors
  // announce themselves on stderr, so an empty stderr is the clean signal.
  if (res.status !== 0 && res.status !== 1) return null
  if (res.status === 1 && res.stderr.trim().length > 0) return null
  const endpoints: Endpoint[] = []
  for (const line of res.stdout.split("\n")) {
    // With -nP an endpoint reads as n127.0.0.1:4021.
    const match = /^n(\d{1,3}(?:\.\d{1,3}){3}|\*|\[[0-9a-f:]+\]):(\d+)$/i.exec(line.trim())
    if (match) endpoints.push({ host: match[1], port: Number(match[2]) })
  }
  return endpoints
}

/**
 * The gate `server stop` puts in front of every signal. Returns a
 * confirmation only when the pid is alive, is running one of our entry
 * scripts, and holds the loopback listener for the port in the record.
 */
export function confirmServicePid(record: ServiceRecord, selfPid = process.pid): Identity {
  const { pid, port } = record
  const refuse = (reason: string, extra: Partial<Identity> = {}): Identity => ({
    confirmed: false,
    pid,
    argv: extra.argv ?? "",
    reason,
    ...(extra.observed !== undefined ? { observed: extra.observed } : {}),
    ...(extra.listening !== undefined ? { listening: extra.listening } : {}),
  })

  if (pid === selfPid) {
    return refuse("that pid is this oc-dash command itself; refusing to signal it")
  }
  if (!isAlive(pid)) {
    return refuse(`no process is running with pid ${pid}`)
  }

  const argv = processArgv(pid)
  if (argv === null) {
    return refuse(`could not read the command line for pid ${pid}`)
  }
  if (!isOcDashArgv(argv)) {
    return refuse(`pid ${pid} is not an oc-dash process`, { argv, observed: argv })
  }

  const listening = listeningEndpoints(pid)
  if (listening === null) {
    return refuse(`could not read the listening sockets for pid ${pid}`, { argv })
  }
  const bound = listening.filter((e) => e.port === port && e.host === LOOPBACK)
  if (bound.length === 0) {
    const seen = listening.map((e) => `${e.host}:${e.port}`).join(", ")
    return refuse(`pid ${pid} is an oc-dash process but is not listening on ${LOOPBACK}:${port}`, {
      argv,
      listening,
      observed: seen.length > 0 ? seen : "no listening TCP sockets",
    })
  }

  return {
    confirmed: true,
    pid,
    argv,
    reason: `pid ${pid} is oc-dash listening on ${LOOPBACK}:${port}`,
    listening,
  }
}
