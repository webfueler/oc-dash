/**
 * Port selection for the oc-dash CLI.
 *
 * Precedence, highest first:
 *
 *   1. `--port <n>` on the command line
 *   2. the `PORT` environment variable, which the server has always honoured
 *   3. 4021
 *
 * Parsing is strict on purpose. A port is an integer in 1..65535; anything
 * else is a mistake worth surfacing rather than a value worth coercing. The
 * old server line was `Number(process.env.PORT) || 4021`, which silently
 * swallowed `PORT=abc` and happily passed `PORT=70000` down to the socket
 * layer. Both now resolve to the default instead, which is the same answer
 * the old line gave for `abc` and a saner one for the out-of-range value.
 */

import { createServer } from "node:net"

export const DEFAULT_PORT = 4021
export const PORT_MIN = 1
export const PORT_MAX = 65535

/** The port to try, or null when the value is not a usable port number. */
export function parsePort(value: string | number | undefined | null): number | null {
  if (value === undefined || value === null) return null
  const text = String(value).trim()
  if (!/^\d+$/.test(text)) return null
  const port = Number(text)
  return port >= PORT_MIN && port <= PORT_MAX ? port : null
}

/**
 * `--port` beats `PORT` beats 4021. A `--port` that failed validation never
 * reaches here; callers reject it first so this stays a pure precedence rule.
 */
export function resolvePort(cliPort: number | null, envPort: string | undefined): number {
  if (cliPort !== null) return cliPort
  return parsePort(envPort) ?? DEFAULT_PORT
}

/** An unused TCP port, taken from the kernel and released again. */
export function ephemeralPort(host = "127.0.0.1"): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once("error", reject)
    probe.listen(0, host, () => {
      const address = probe.address()
      if (address === null || typeof address === "string") {
        probe.close(() => reject(new Error("could not read an ephemeral port")))
        return
      }
      const { port } = address
      probe.close(() => resolve(port))
    })
  })
}
