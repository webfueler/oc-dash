import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/service"
import type { Endpoint } from "@opencode/client/service"

export interface OpencodeContext {
  client: ReturnType<typeof OpenCode.make>
  endpoint: Endpoint
}

let cached: Promise<OpencodeContext> | null = null

/**
 * Connect to the local opencode service.
 *
 * discover() finds a healthy, registered endpoint without starting anything.
 * ensure() is the fallback and may auto-start a service when none is
 * registered (explicitly allowed by the mission rules). The running service
 * is never stopped or restarted from here.
 */
export function getOpencode(): Promise<OpencodeContext> {
  if (!cached) {
    cached = (async () => {
      let endpoint: Endpoint | undefined
      try {
        endpoint = await Service.discover()
      } catch {
        endpoint = undefined
      }
      if (!endpoint) endpoint = await Service.ensure()
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
