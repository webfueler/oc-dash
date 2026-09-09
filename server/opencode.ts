import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/service"
import type { Endpoint } from "@opencode/client/service"
import { homedir } from "node:os"
import { join } from "node:path"

export interface OpencodeContext {
  client: ReturnType<typeof OpenCode.make>
  endpoint: Endpoint
}

/** No healthy registered opencode service answered discovery. */
export class NoServiceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "NoServiceError"
  }
}

let cached: Promise<OpencodeContext> | null = null

/**
 * The registration file @opencode/client reads during discovery
 * ($XDG_STATE_HOME/opencode/service.json by default). Only used to make
 * the failure message concrete; discovery itself stays in the client.
 */
function registrationFile(): string {
  const state = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state")
  return join(state, "opencode", "service.json")
}

/**
 * Connect to the local opencode service.
 *
 * Discover-only: find a healthy, registered endpoint without starting,
 * stopping, or restarting anything. ensure() is deliberately not used,
 * so oc-dash can never spawn or terminate a service. When nothing
 * healthy is registered, getOpencode() rejects with a NoServiceError
 * that carries the reason; the server's startup check turns it into the
 * friendly guidance and a non-zero exit.
 *
 * The discovered endpoint is cached for the process lifetime: if the
 * service later restarts on a different port, the dashboard degrades
 * until it is restarted.
 */
export function getOpencode(): Promise<OpencodeContext> {
  if (!cached) {
    cached = (async () => {
      let endpoint: Endpoint | undefined
      try {
        endpoint = await Service.discover()
      } catch (err) {
        throw new NoServiceError(`could not check the opencode service registration (${errorMessage(err)})`)
      }
      if (!endpoint) {
        throw new NoServiceError(`no healthy registered opencode service (looked at ${registrationFile()})`)
      }
      const client = OpenCode.make({
        baseUrl: endpoint.url,
        headers: Service.headers(endpoint),
      })
      return { client, endpoint }
    })()
    // Forget a failed connection so the next request can retry discovery.
    cached.catch(() => {
      cached = null
    })
  }
  return cached
}

/** Raw GET against the service with its auth headers attached. */
export async function ocFetch(oc: OpencodeContext, path: string): Promise<Response> {
  return fetch(oc.endpoint.url + path, {
    headers: Service.headers(oc.endpoint),
  })
}

/** Raw GET that parses JSON and throws on non-2xx. */
export async function ocGetJson(oc: OpencodeContext, path: string): Promise<unknown> {
  const res = await ocFetch(oc, path)
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`)
  return res.json()
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
