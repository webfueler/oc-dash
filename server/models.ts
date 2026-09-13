import { ocGetJson, type OpencodeContext } from "./opencode.js"

/** Mission 044: providerID/id -> display name, served to the label surfaces. */
export type ModelNames = Record<string, string>

/**
 * Pure parse of the opencode2 service's GET /api/model payload into the
 * providerID/id -> name map. Entries missing any of the three fields — or
 * carrying an empty or whitespace-only name — drop out, so the client's
 * fallback (the raw id) never receives a blank or wrong label. Accepts both
 * the raw array and the { data: [...] } wrapper the promise client can
 * produce.
 */
export function parseModelNames(payload: unknown): ModelNames {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const wrapped = payload as { data?: unknown }
    if (Array.isArray(wrapped.data)) payload = wrapped.data
  }
  if (!Array.isArray(payload)) return {}
  const names: ModelNames = {}
  for (const entry of payload) {
    if (!entry || typeof entry !== "object") continue
    const { providerID, id, name } = entry as {
      providerID?: unknown
      id?: unknown
      name?: unknown
    }
    if (typeof providerID !== "string" || typeof id !== "string" || typeof name !== "string") {
      continue
    }
    // Trim before the non-empty check so a whitespace-only name can never
    // reach the label surfaces as a blank; surrounding whitespace on a real
    // name is noise, so the trimmed value is what gets stored.
    const trimmed = name.trim()
    if (!providerID || !id || !trimmed) continue
    names[`${providerID}/${id}`] = trimmed
  }
  return names
}

// The model catalog is static for the life of a service, so a success lives
// an hour and a failure retries sooner — the update-check pattern
// (index.ts:43-44): the caller never waits on a cold fetch more than once
// per window, and any failure degrades to an empty map (raw-id labels).
const MODEL_NAMES_TTL_MS = 60 * 60 * 1000
const MODEL_NAMES_RETRY_MS = 5 * 60 * 1000

let cache: { names: ModelNames; expiresAt: number } | null = null

/**
 * The cached name map. One /api/model fetch per TTL window, never per
 * request; any failure is an empty map so every label surface falls back to
 * today's raw-id behavior.
 */
export async function modelNames(oc: OpencodeContext): Promise<ModelNames> {
  if (cache && Date.now() < cache.expiresAt) return cache.names
  let names: ModelNames
  let ttl: number
  try {
    names = parseModelNames(await ocGetJson(oc, "/api/model"))
    ttl = MODEL_NAMES_TTL_MS
  } catch {
    names = {}
    ttl = MODEL_NAMES_RETRY_MS
  }
  cache = { names, expiresAt: Date.now() + ttl }
  return names
}

/** Test seam: forget the module-level cache. */
export function resetModelNamesCache(): void {
  cache = null
}
