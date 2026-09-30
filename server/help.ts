/**
 * `--help` text, one block per subcommand.
 *
 * The instructions live in the CLI, so this is a
 * usage block rather than a paragraph, and every subcommand has its own. A
 * parser library would have supplied the layout; none of them supply the
 * content, which is the part anyone actually reads.
 *
 * The root block is also the migration notice. A bare `npx oc-dash` used to
 * start a server, so anyone who typed it from memory is about to get
 * something they did not ask for and may not understand; the line naming
 * the replacement sits in the first three lines of the block, before the
 * port rules and the registry file, because that is the only part a
 * returning user reads.
 */

import { DEFAULT_PORT } from "./port.js"
import { PACKAGE, type HelpTopic } from "./args.js"
import { registryPath } from "./registry.js"

/** `cmd  description`, padded as pairs so the columns cannot drift. */
function rows(pairs: [string, string][]): string[] {
  const width = Math.max(...pairs.map(([cmd]) => cmd.length))
  return pairs.map(([cmd, description]) => `  ${cmd.padEnd(width)}  ${description}`)
}

function header(title: string, usage: string[]): string[] {
  return [title, "", "USAGE", ...usage]
}

const ROOT = [
  ...header("oc-dash — a local dashboard for opencode2 cost, tokens and subagent spend.", [
    // The migration line, first, because the person who typed the old bare
    // `npx oc-dash` is reading top to bottom and will not reach the bottom.
    `  To start the dashboard:  ${PACKAGE} server start`,
    "",
    ...rows([
      ["oc-dash server start", "start it in the background"],
      ["oc-dash server start --foreground", "start it here, Ctrl-C to stop"],
      ["oc-dash server status", "is it running, and where"],
      ["oc-dash server stop", "stop the background instance"],
      ["oc-dash", "this help, nothing started"],
    ]),
    "",
    "  Add --port <n> to server start to choose the port yourself.",
    "",
    "  Same arguments via npx, nothing to install first:",
    `    ${PACKAGE} <arguments>`,
  ]),
  "",
  "IF YOU USED TO RUN JUST `npx oc-dash`",
  "  That used to start the server in this terminal. It no longer starts",
  "  anything: with no arguments it prints this help and exits 0, which is",
  "  what it now does instead of guessing. Nothing is written to disk and no",
  "  port is bound, so it is safe to run and safe to put in a script.",
  "",
  "  Run one of these instead:",
  "",
  `    ${PACKAGE} server start`,
  "      starts it in the background and returns to the prompt",
  "",
  `    ${PACKAGE} server start --foreground`,
  "      keeps it in this terminal, the way the bare command used to",
  "",
  `    ${PACKAGE} server start --port 4022`,
  "      and the old `PORT=4022` prefix becomes --port 4022",
  "",
  "PORTS",
  `  Default ${DEFAULT_PORT}. Resolution order, highest first:`,
  "    1. --port <n>          e.g. --port 4022",
  "    2. PORT=<n> in the environment",
  `    3. ${DEFAULT_PORT}`,
  "",
  "  If the port is busy, `server start` takes the next free port and",
  "  records where it landed. Read the real port from `server status` or",
  "  from the registry file rather than assuming " + DEFAULT_PORT + ".",
  "",
  "  Nothing is pinned any more, so a bookmark or script pointing at",
  `  http://127.0.0.1:${DEFAULT_PORT} can be wrong. That is the tradeoff for a`,
  "  command that starts up when you meant to read about it.",
  "",
  "THE REGISTRY FILE",
  `  ${registryPath()}`,
  "",
  '  { "port": 4021, "pid": 12345,',
  '    "url": "http://127.0.0.1:4021", "version": "0.1.8" }',
  "",
  "  Written when `server start` succeeds, deleted on a clean `server stop`.",
  "  This is also how the oc-dashbar menu bar app finds the server.",
  "",
  "WHEN THE BACKGROUND SERVER STOPS",
  "  A background server is an ordinary process, so it ends when you log out",
  "  and it does not come back after a reboot. Run `server start` again. If",
  "  you want it to survive logout, use a login item that calls the same",
  "  command.",
  "",
  "EXIT CODES",
  "  0  did what you asked. That includes a bare `oc-dash`, `--help`, and",
  "     `server status` finding a server running.",
  "  1  something was wrong, or the state was not what the command was for:",
  "     an unknown command or flag, a --port that is not a port, a start",
  "     that could not finish, a stop that refused to signal, and",
  "     `server status` or `server stop` finding nothing running.",
  "",
  "  A bare `oc-dash` is 0 and a mistyped command is 1, and that difference",
  "  is deliberate. You asked what this tool is and it told you; a typo is a",
  "  mistake, so it goes to stderr and says so. Errors always go to stderr,",
  "  help and results always go to stdout.",
  "",
  "  `server status` and `server stop` are 1 on \"not running\" because they",
  "  are predicates a script branches on, not requests for orientation:",
  "",
  `    ${PACKAGE} server status >/dev/null && echo up`,
  "",
  "MORE",
  ...rows([
    ["oc-dash server --help", "the server subcommands in detail"],
    ["oc-dash --version", "the installed version"],
  ]),
  "",
]

const SERVER = [
  ...header("oc-dash server — control the dashboard process", [
    `  ${PACKAGE} server <start|stop|status> [options]`,
  ]),
  "",
  "SUBCOMMANDS",
  "  start      start the server detached and return to the prompt",
  "  stop       stop the running instance and remove the registry file",
  "  status     report whether it is running, on which port, with which pid",
  "",
  `  ${PACKAGE} server start --help`,
  `  ${PACKAGE} server stop --help`,
  `  ${PACKAGE} server status --help`,
  "",
  "Run `oc-dash --help` for ports, the registry file and exit codes.",
  "",
]

const START = [
  ...header("oc-dash server start — start the server in the background", [
    `  ${PACKAGE} server start [--port <n>]`,
    `  ${PACKAGE} server start --port 4022`,
    `  ${PACKAGE} server start --foreground`,
  ]),
  "",
  "OPTIONS",
  "  -p, --port <n>    port to try. Falls back to $PORT, then to " + DEFAULT_PORT + ".",
  "  -f, --foreground  stay attached to this terminal. Still picks a free",
  "                    port and still writes the registry file; only the",
  "                    detaching is skipped. Useful under a process",
  "                    supervisor, or for watching the log.",
  "",
  "WHAT IT DOES",
  "  1. If a server is already registered and running, it refuses and tells",
  "     you, rather than starting a second one nobody can find.",
  "  2. Spawns itself in a new session, so it survives the shell that ran it.",
  "  3. Waits until the new server writes the registry file, then prints the",
  "     port and pid and returns. If it never comes up in 10 seconds it says",
  "     so instead of hanging.",
  "",
  "BUSY PORTS",
  "  If the port you asked for is taken, the server takes another free one and",
  `  records it. The registry exists so an unpredictable port is harmless:`,
  "  read the real port from `server status`, or straight out of the file.",
  "",
  "  Pass --port if you need a specific port, and be aware that it will move",
  "  under you when something else is already listening there.",
  "",
  "EXAMPLES",
  ...rows([
    [`${PACKAGE} server start`, "# background, 4021 if free"],
    [`${PACKAGE} server start --port 4022`, "# try 4022 first"],
    [`PORT=4022 ${PACKAGE} server start`, "# via the environment"],
    [`${PACKAGE} server status`, "# where did it land?"],
    [`${PACKAGE} server stop`, "# shut it down"],
  ]),
  "",
]

const STOP = [
  ...header("oc-dash server stop — stop the running instance", [
    `  ${PACKAGE} server stop`,
  ]),
  "",
  "WHAT IT DOES",
  "  Reads the registry file, checks that the pid in it really is an oc-dash",
  "  process listening on the port in the file, sends it SIGTERM, waits for it",
  "  to go away, then deletes the registry file.",
  "",
  "WHY IT IS PICKY",
  "  A registry file can outlive the process it names: a crash, a reboot or an",
  "  unclean exit all leave a pid behind, and the operating system will hand",
  "  that number to whatever starts next. Killing whatever now holds that pid",
  "  would take out somebody else's program, so `stop` verifies two things",
  "  before it signals anything:",
  "",
  "    1. the process's command line is an oc-dash launcher, and",
  "    2. that same process is listening on the port in the registry.",
  "",
  "  If either fails it refuses, prints what it found, and sends nothing.",
  "  There is no name-based kill fallback (`pkill -f`, `killall`) anywhere in",
  "  this command: matching on a name would also match your editor, your test",
  "  runner, and the opencode service this dashboard reads from.",
  "",
  "  A registry whose pid is gone is reported as stale and removed; nothing is",
  "  signalled in that case.",
  "",
  "EXAMPLES",
  ...rows([
    [`${PACKAGE} server stop`, "# stop whatever is registered"],
    [`${PACKAGE} server status`, "# check first if you are not sure"],
  ]),
  "",
]

const STATUS = [
  ...header("oc-dash server status — is the dashboard running?", [
    `  ${PACKAGE} server status`,
  ]),
  "",
  "REPORTS",
  "  whether a server is registered, which port it is on, which pid, and the",
  "  version it is running.",
  "",
  "  Exits 0 when it is running and 1 when it is not, including when the",
  "  registry file exists but its pid is gone. Safe to use in a script:",
  "",
  `    ${PACKAGE} server status >/dev/null && echo up`,
  "",
  "  A pid it cannot confirm is reported as unconfirmed rather than as a",
  "  running server. That is the same check `server stop` makes before it",
  "  signals anything.",
  "",
  "EXAMPLES",
  `  ${PACKAGE} server status`,
  "",
]

const REGISTRY_NOTE = `Registry file: ${registryPath()}`

/**
 * The help for one topic, with no trailing newline: `Io.out` writes a line.
 */
export function helpText(topic: HelpTopic): string {
  const body =
    topic === "server" ? SERVER
    : topic === "start" ? START
    : topic === "stop" ? STOP
    : topic === "status" ? STATUS
    : ROOT
  const lines = [...body]
  // Every subcommand help ends up naming the file it acts on, which is the one
  // thing a confused user needs and the one thing they cannot guess. Each
  // block already ends with a blank line to splice onto.
  if (topic !== "root" && !lines.some((line) => line.startsWith("Registry file:"))) {
    lines.splice(lines.length - 1, 0, "", REGISTRY_NOTE)
  }
  return lines.join("\n").replace(/\n+$/, "")
}
