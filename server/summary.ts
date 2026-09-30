import { contextStatsRange, type ResolvedRange } from "./ranges.js"

/**
 * The upstream stats fetch /api/summary is built on: a resolved window and
 * the optional project id. The route binds it to the discovered client and
 * the request's timezone; tests inject a fake to pin the call ordering.
 */
export type SummaryStatsFetch = (range: ResolvedRange, project?: string) => Promise<unknown>

/** The fields /api/summary spreads after its `degraded`, `range` and `timezone`. */
export interface SummaryBody {
  data: unknown
  /** Today only: the trailing 7 days behind the chart's muted context days. */
  contextActivity?: unknown
  /** One entry per requested project id whose call succeeded, in request order. */
  projectStats?: { project: string; data: unknown }[]
}

/** The typed client answers with the payload; a raw fetch wraps it in `data`. */
function unwrap(raw: unknown): unknown {
  return (raw as { data?: unknown } | null)?.data ?? raw
}

/** The shape check the main payload has always carried. */
function isMainStats(data: unknown): boolean {
  return (
    Boolean(data) &&
    typeof data === "object" &&
    typeof (data as { cost?: unknown }).cost === "number" &&
    Array.isArray((data as { models?: unknown }).models)
  )
}

/** The weaker check the per-project payloads have always used. */
function hasCost(data: unknown): boolean {
  return (
    Boolean(data) &&
    typeof data === "object" &&
    typeof (data as { cost?: unknown }).cost === "number"
  )
}

/**
 * Every upstream call /api/summary makes, plus the shape checks.
 *
 * The extras are created before the main call is awaited, so nothing here
 * serialises them: Today asks for two windows (its own and the trailing 7
 * days behind the Activity chart's context days) and both requests are in
 * flight together. A test pins the creation order, because the old order
 * awaited the main call first and made Today pay both windows end to end.
 *
 * The overlap is not a latency guarantee: the 2.0.x service ran stats calls
 * one at a time when this was measured, so Today's default path costs about
 * the sum of its two windows either way. Removing the call the panel does
 * not need is what the opt-out does, and that is the measured win.
 *
 * A failed extra is swallowed (a null project entry, an omitted context
 * field) so it can only cost its own field, never the response. The main
 * call is not swallowed: its failure is the route's degraded arm, and an
 * unexpected main payload throws the error the route used to raise inline.
 */
export async function fetchSummaryBody(
  stats: SummaryStatsFetch,
  options: { range: ResolvedRange; project: string[]; context: boolean },
): Promise<SummaryBody> {
  const { range, project, context } = options
  // Started first, awaited last: each extra runs alongside the main call.
  const projectCalls = project.map((id) => stats(range, id).catch(() => null))
  // `context: false` is the panel's opt-out. The second call exists only for
  // Today, and only for the chart that plots its activity.
  const ctxRange = context ? contextStatsRange(range.preset) : null
  const ctxCall = ctxRange ? stats(ctxRange).catch(() => undefined) : undefined

  const data = unwrap(await stats(range))
  if (!isMainStats(data)) throw new Error("unexpected /api/session/stats payload shape")

  const projectStats: { project: string; data: unknown }[] = []
  if (projectCalls.length > 0) {
    const settled = await Promise.all(projectCalls)
    for (let i = 0; i < settled.length; i++) {
      const pData = unwrap(settled[i])
      // The project id rides along so the client can verify the field
      // belongs to the filter currently on screen before trusting it.
      if (hasCost(pData)) projectStats.push({ project: project[i], data: pData })
    }
  }

  let contextActivity: unknown
  if (ctxCall) {
    const ctxData = unwrap(await ctxCall)
    const act = (ctxData as { activity?: unknown } | null)?.activity
    if (Array.isArray(act)) contextActivity = act
  }

  return {
    data,
    ...(contextActivity !== undefined ? { contextActivity } : {}),
    ...(projectStats.length > 0 ? { projectStats } : {}),
  }
}
