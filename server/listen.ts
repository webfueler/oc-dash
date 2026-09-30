/**
 * Binding the HTTP server, with an optional free-port fallback.
 *
 * Every CLI start wants the fallback. The bare
 * `npx oc-dash` used to be the one caller that did not want it, because a
 * fixed 4021 that fails loudly is a behaviour people depended on -- anything
 * hardcoding http://127.0.0.1:4021 in a bookmark or a script kept working.
 * A bare invocation now prints help and binds nothing, so the only way in
 * without a fallback is `npm start` and `npm run dev:server`, which run
 * dist-server/index.js directly with no CLI around them. The branch below is
 * kept for those rather than deleted, since it is their only error message.
 *
 * The retry binds for real rather than probing first. A probe would race
 * with anything else that grabs the port between the probe and the bind; a
 * failed bind cannot race, it is the failure itself.
 */

import { serve, type ServerType } from "@hono/node-server"
import { ephemeralPort } from "./port.js"

const HOSTNAME = "127.0.0.1"
const DEFAULT_ATTEMPTS = 5

/** @hono/node-server names this type internally and does not export it. */
type FetchHandler = Parameters<typeof serve>[0]["fetch"]

export interface Bound {
  /** The port actually bound, which is not the one requested after a fallback. */
  port: number
  server: ServerType
}

function isAddrInUse(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === "EADDRINUSE"
}

/**
 * Bind `requested`, and when `fallback` is set take an unused port and try
 * again on EADDRINUSE. Any other error, or an exhausted attempt budget, is
 * thrown for the caller to report.
 */
export async function listenHttp(
  fetch: FetchHandler,
  requested: number,
  options: { fallback?: boolean; attempts?: number } = {},
): Promise<Bound> {
  const attempts = options.fallback ? Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS) : 1
  let port = requested

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) port = await ephemeralPort(HOSTNAME)
    let server: ServerType | undefined
    try {
      return await new Promise<Bound>((resolve, reject) => {
        server = serve({ fetch, port, hostname: HOSTNAME }, (info) => {
          resolve({ port: info.port, server: server as ServerType })
        })
        server.once("error", reject)
      })
    } catch (err) {
      server?.close()
      if (!isAddrInUse(err) || attempt === attempts - 1) throw err
    }
  }
  throw new Error(`could not bind a port after ${attempts} attempts`)
}
