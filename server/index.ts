import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import { Hono } from "hono"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { errorMessage, getOpencode, ocGetJson, type OpencodeContext } from "./opencode.js"
import { contextStatsRange, localTimezone, parseProjectParam, parseRangePreset, resolveRange } from "./ranges.js"
import { compareVersions } from "./version.js"
import { walkSessions, type RawPage } from "./walk.js"

const PAGE_LIMIT = 100
const PORT = Number(process.env.PORT) || 4021

// Absolute paths so the server works from any working directory (npx runs
// the launcher from wherever the user happens to be).
const DIST_ROOT = fileURLToPath(new URL("../dist", import.meta.url))
const DIST_INDEX = fileURLToPath(new URL("../dist/index.html", import.meta.url))

// Mission 014: the update check. oc-dash's own version is read from the
// manifest one level up (readFileSync sidesteps a bare JSON import, which
// tsconfig.server.json's rootDir: "server" forbids; the URL resolves from
// server/, dist-server/, and the published package alike). The registry's
// latest rides on a small in-memory cache so no request ever waits on the
// network, and every failure is swallowed (the /api/summary degraded
// pattern). A checkout carries a .git entry at the package root and
// published packages never do; when that signal is ambiguous the payload
// falls back to the package command.
let APP_VERSION = "unknown"
try {
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version?: unknown }
  if (typeof pkg.version === "string") APP_VERSION = pkg.version
} catch {
  // Best effort: an unreadable manifest only costs the version label.
}

const UPDATE_COMMAND = existsSync(new URL("../.git", import.meta.url))
  ? "git pull --ff-only && npm install"
  : "npx @webfueler/oc-dash@latest"

const REGISTRY_DIST_TAGS = "https://registry.npmjs.org/-/package/@webfueler%2Foc-dash/dist-tags"
const UPDATE_CACHE_MS = 6 * 60 * 60 * 1000
const UPDATE_RETRY_MS = 5 * 60 * 1000

let updateCache: { latest: string | null; expiresAt: number } | null = null

/** Best-effort registry read; any failure is null, never an error surface. */
async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch(REGISTRY_DIST_TAGS, { signal: AbortSignal.timeout(5_000) })
    if (!res.ok) return null
    const body = (await res.json()) as { latest?: unknown }
    return typeof body.latest === "string" ? body.latest : null
  } catch {
    return null
  }
}

/**
 * The cached answer, refreshed in the background when cold or stale.
 * Successful answers live 6 hours, failures retry after 5 minutes, and the
 * caller always gets the value on hand so /api/health never blocks on it.
 */
function latestPublishedVersion(): string | null {
  if (!updateCache || Date.now() >= updateCache.expiresAt) {
    updateCache = { latest: updateCache?.latest ?? null, expiresAt: Date.now() + UPDATE_RETRY_MS }
    void fetchLatestVersion().then((latest) => {
      updateCache = { latest, expiresAt: Date.now() + (latest ? UPDATE_CACHE_MS : UPDATE_RETRY_MS) }
    })
  }
  return updateCache.latest
}

const app = new Hono()

/** One page of GET /api/session, via the typed client with a raw-fetch fallback. */
async function listPage(oc: OpencodeContext, cursor?: string): Promise<RawPage> {
  try {
    const page = await oc.client.session.list({ limit: PAGE_LIMIT, cursor })
    return page as unknown as RawPage
  } catch {
    const params = new URLSearchParams({ limit: String(PAGE_LIMIT) })
    if (cursor) params.set("cursor", cursor)
    return (await ocGetJson(oc, `/api/session?${params}`)) as RawPage
  }
}

/**
 * session.stats via the typed client with a raw-fetch fallback.
 * Mission 014 (PD Q4a): an optional project pass-through — the upstream
 * param already exists (project id); only the per-project tier-2 call
 * sends it, the hero's main stats call never does.
 */
async function statsCall(
  oc: OpencodeContext,
  range: { from?: number; to?: number },
  tz: string,
  project?: string,
): Promise<unknown> {
  try {
    return await oc.client.session.stats({
      from: range.from,
      to: range.to,
      timezone: tz,
      tools: "summary",
      ...(project ? { project } : {}),
    })
  } catch {
    const params = new URLSearchParams({ timezone: tz, tools: "summary" })
    if (range.from != null) params.set("from", String(range.from))
    if (range.to != null) params.set("to", String(range.to))
    if (project) params.set("project", project)
    return await ocGetJson(oc, `/api/session/stats?${params}`)
  }
}

app.get("/api/health", async (c) => {
  const latest = latestPublishedVersion()
  const dashboard = {
    version: APP_VERSION,
    latest,
    updateAvailable: latest !== null && compareVersions(latest, APP_VERSION) > 0,
    updateCommand: UPDATE_COMMAND,
  }
  try {
    const oc = await getOpencode()
    const body = (await ocGetJson(oc, "/api/health")) as {
      healthy?: boolean
      version?: string
    } | null
    return c.json({
      ok: true,
      dashboard,
      service: {
        url: oc.endpoint.url,
        healthy: body?.healthy === true,
        version: body?.version ?? null,
      },
    })
  } catch (err) {
    return c.json({
      ok: true,
      dashboard,
      service: {
        url: null,
        healthy: false,
        version: null,
        error: errorMessage(err),
      },
    })
  }
})

app.get("/api/summary", async (c) => {
  const preset = parseRangePreset(c.req.query("range") ?? "7d")
  if (!preset) {
    return c.json({ error: 'range must be one of "today", "7d", "30d", "all"' }, 400)
  }
  const range = resolveRange(preset)
  const tz = localTimezone()
  // Mission 014 (PD Q4a): additive project param. When present, ONE extra
  // best-effort upstream stats call with project=<id> feeds the filtered
  // card's tier-2 tiles. Fired in parallel with the main call so the hero's
  // latency is untouched; on failure it resolves to undefined and the field
  // is omitted (the contextActivity pattern), never an error surface.
  const project = parseProjectParam(c.req.query("project")) ?? []
  try {
    const oc = await getOpencode()
    // Mission 026: one best-effort upstream stats call per project id behind
    // the directory filter, all fired in parallel with the main call so the
    // hero's latency is untouched. A failed call drops out of the list; the
    // field is omitted when none succeed (never an error surface).
    const projectCalls = project.map((id) => statsCall(oc, range, tz, id).catch(() => null))
    const raw = await statsCall(oc, range, tz)
    // The promise client returns SessionStatsInfo directly; a raw fetch
    // returns { data: SessionStatsInfo }. Normalize both.
    const data = (raw as { data?: unknown })?.data ?? raw
    if (
      !data ||
      typeof data !== "object" ||
      typeof (data as { cost?: unknown }).cost !== "number" ||
      !Array.isArray((data as { models?: unknown }).models)
    ) {
      throw new Error("unexpected /api/session/stats payload shape")
    }
    const projectStats: { project: string; data: unknown }[] = []
    if (projectCalls.length > 0) {
      const settled = await Promise.all(projectCalls)
      for (let i = 0; i < settled.length; i++) {
        const pRaw = settled[i]
        const pData = (pRaw as { data?: unknown } | null)?.data ?? pRaw
        if (
          pData &&
          typeof pData === "object" &&
          typeof (pData as { cost?: unknown }).cost === "number"
        ) {
          // The project id rides along so the client can verify the field
          // belongs to the filter currently on screen before trusting it.
          projectStats.push({ project: project[i], data: pData })
        }
      }
    }
    // Additive, Today-only: trailing 7 days of activity so the chart can
    // render the in-range day next to muted context days. Fired in parallel
    // with the main stats call (mission 008, 007's F4) so Today pays one
    // upstream round-trip instead of two serial ones. Still best effort: a
    // failed context call resolves to undefined and the field is omitted.
    let contextActivity: unknown
    const ctxRange = contextStatsRange(preset)
    const ctxCall = ctxRange ? statsCall(oc, ctxRange, tz).catch(() => undefined) : undefined
    if (ctxCall) {
      const ctxRaw = await ctxCall
      const ctxData = (ctxRaw as { data?: unknown } | null)?.data ?? ctxRaw
      const act = (ctxData as { activity?: unknown } | null)?.activity
      if (Array.isArray(act)) contextActivity = act
    }
    return c.json({
      degraded: false,
      range,
      timezone: tz,
      data,
      ...(contextActivity !== undefined ? { contextActivity } : {}),
      ...(projectStats.length > 0 ? { projectStats } : {}),
    })
  } catch (err) {
    // Degraded marker instead of an error page when stats are unavailable.
    return c.json({ degraded: true, range, timezone: tz, reason: errorMessage(err) })
  }
})

app.get("/api/sessions", async (c) => {
  const preset = parseRangePreset(c.req.query("range") ?? "7d")
  if (!preset) {
    return c.json({ error: 'range must be one of "today", "7d", "30d", "all"' }, 400)
  }
  const range = resolveRange(preset)
  try {
    const oc = await getOpencode()
    const walk = await walkSessions(range.from ?? null, (cursor) => listPage(oc, cursor))
    return c.json({
      range,
      count: walk.rows.length,
      pages: walk.pages,
      truncated: walk.truncated,
      data: walk.rows,
    })
  } catch (err) {
    return c.json({ error: `opencode service request failed: ${errorMessage(err)}` }, 502)
  }
})

// Built frontend (production). API routes above take precedence.
app.use("*", serveStatic({ root: DIST_ROOT }))
app.get("*", serveStatic({ path: DIST_INDEX }))

/**
 * Discover-only policy: the dashboard needs a healthy registered opencode
 * service before it starts. It never starts, stops, or restarts one, so
 * when nothing answers the discovery probe, print guidance and quit.
 */
async function checkServiceAtStartup(): Promise<void> {
  try {
    await getOpencode()
  } catch (err) {
    console.error(`${errorMessage(err)}

No running opencode service was found. The dashboard reads everything
from the opencode2 service over HTTP, so opencode must be installed and
a service must be running. Start the service, then run oc-dash again:

    opencode serve --service

If you don't have opencode yet, install it with:

    curl -fsSL https://opencode.ai/install | bash

More options: https://opencode.ai`)
    process.exit(1)
  }
}

await checkServiceAtStartup()

const server = serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" }, (info) => {
  console.log(`oc-dash listening on http://0.0.0.0:${info.port}`)
})

server.on("error", (err) => {
  if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
    console.error(`port ${PORT} is in use, try PORT=${PORT + 1} npx @webfueler/oc-dash`)
    process.exit(1)
  }
  throw err
})
