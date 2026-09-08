import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import { Hono } from "hono"
import { errorMessage, getOpencode, ocGetJson, type OpencodeContext } from "./opencode.js"
import { localTimezone, parseRangePreset, resolveRange } from "./ranges.js"
import { walkSessions, type RawPage } from "./walk.js"

const PAGE_LIMIT = 100
const PORT = Number(process.env.PORT) || 4021

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

/** session.stats via the typed client with a raw-fetch fallback. */
async function statsCall(
  oc: OpencodeContext,
  range: { from?: number; to?: number },
  tz: string,
): Promise<unknown> {
  try {
    return await oc.client.session.stats({
      from: range.from,
      to: range.to,
      timezone: tz,
      tools: "summary",
    })
  } catch {
    const params = new URLSearchParams({ timezone: tz, tools: "summary" })
    if (range.from != null) params.set("from", String(range.from))
    if (range.to != null) params.set("to", String(range.to))
    return await ocGetJson(oc, `/api/session/stats?${params}`)
  }
}

app.get("/api/health", async (c) => {
  try {
    const oc = await getOpencode()
    const body = (await ocGetJson(oc, "/api/health")) as {
      healthy?: boolean
      version?: string
    } | null
    return c.json({
      ok: true,
      service: {
        url: oc.endpoint.url,
        healthy: body?.healthy === true,
        version: body?.version ?? null,
      },
    })
  } catch (err) {
    return c.json({
      ok: true,
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
  try {
    const oc = await getOpencode()
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
    return c.json({ degraded: false, range, timezone: tz, data })
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
app.use("*", serveStatic({ root: "./dist" }))
app.get("*", serveStatic({ path: "./dist/index.html" }))

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`oc-dash listening on http://localhost:${info.port}`)
})
