export type Range = "today" | "7d" | "30d" | "all"

export interface ResolvedRange {
  preset: Range
  from?: number
  to?: number
}

export interface TokenUsage {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

export interface ModelRef {
  providerID: string
  id: string
  variant?: string
}

export interface SessionInfo {
  id: string
  parentID?: string
  projectID?: string
  agent?: string
  model?: ModelRef
  cost: number
  tokens: TokenUsage
  outcome?: "succeeded" | "failed" | "interrupted"
  time: { created: number; updated: number; idle?: number; viewed?: number }
  title?: string
  location: { directory: string }
}

export interface ActivityDay {
  date: string
  steps: number
}

export interface ModelUsage {
  model: ModelRef
  steps: number
  tokens: TokenUsage
  cost: number
}

export interface SessionStatsInfo {
  range: { from: number; to: number }
  sessions: number
  subagents: number
  prompts: number
  steps: number
  tokens: TokenUsage
  cost: number
  activeDays: number
  streak: number
  activity: ActivityDay[]
  models: ModelUsage[]
}

export interface SummaryOk {
  degraded: false
  range: ResolvedRange
  timezone: string
  data: SessionStatsInfo
  /**
   * Additive: `data.cost` as the already formatted string, from the project's
   * one formatter. A caller that renders the money uses this rather than
   * rounding the number itself, because Intl.NumberFormat rounds ties away from
   * zero and Swift's String(format:) and NumberFormatter do not reproduce it.
   * Absent on `SummaryDegraded`, where there is no cost to format.
   *
   * `"$0.00"` means a zero cost, which an unpriced model also produces. Pair it
   * with `data.tokens` before reading it as a statement that money was counted.
   */
  costText: string
  /**
   * Additive, Today-only: the trailing 7 days of activity (same shape as
   * `data.activity`) so the chart can show the in-range day in context.
   */
  contextActivity?: ActivityDay[]
  /**
   * Additive, present only when the request carried
   * project=<id(s)> and the extra upstream stats call(s) succeeded. Each
   * project id is echoed so the client can match the payloads to the filter
   * on screen before trusting their numbers. A list — one
   * payload per requested project id, since a directory can map to more
   * than one.
   */
  projectStats?: ProjectStats[]
}

/**
 * The per-project stats payload behind the filtered
 * card's tier-2 tiles. Same stats shape as `data`, scoped to one project.
 */
export interface ProjectStats {
  project: string
  data: SessionStatsInfo
}

export interface SummaryDegraded {
  degraded: true
  range: ResolvedRange
  timezone: string
  reason: string
}

export type SummaryResponse = SummaryOk | SummaryDegraded

export interface SessionsPayload {
  range: ResolvedRange
  count: number
  pages: number
  truncated: boolean
  data: SessionInfo[]
}

/**
 * providerID/id -> display name, from the server's /api/model
 * lookup. Missing keys (or the whole map) mean the raw-id fallback labels.
 */
export type ModelNames = Record<string, string>

export interface DashboardUpdate {
  version: string
  latest: string | null
  updateAvailable: boolean
  updateCommand: string
}

export interface HealthResponse {
  ok: boolean
  /**
   * oc-dash's own version and the registry's latest. The real
   * server always sends it; the client's fabricated unreachable-fallback
   * below omits it, so the update notice treats it as optional.
   */
  dashboard?: DashboardUpdate
  service: {
    url: string | null
    healthy: boolean
    version: string | null
    error?: string
  }
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`${path} responded ${res.status}`)
  return (await res.json()) as T
}

/**
 * Additive, optional arguments for /api/summary. Both keep the payload
 * every existing caller gets unless they are explicitly set: `project`
 * only ever adds the per-project field, and `context` defaults to on.
 */
export interface SummaryOptions {
  /**
   * Comma-separated project ids for the filtered card. The param is sent
   * only while the card wants project-scoped stats, so callers that do not
   * pass it request exactly the same keys as before.
   */
  project?: string
  /**
   * false asks the server to skip the Today-only trailing-7-day stats call
   * that feeds `contextActivity`. The compact panel passes it because it
   * renders no chart; the dashboard leaves it on and its Activity chart
   * plots the field. Absent means on.
   */
  context?: boolean
}

export function fetchSummary(
  range: Range,
  options: SummaryOptions = {},
): Promise<SummaryResponse> {
  const project = options.project ? `&project=${encodeURIComponent(options.project)}` : ""
  const context = options.context === false ? "&context=none" : ""
  return getJson(`/api/summary?range=${range}${project}${context}`)
}

export function fetchSessions(range: Range): Promise<SessionsPayload> {
  return getJson(`/api/sessions?range=${range}`)
}

/**
 * The display-name map. The route wraps it as `{ names: {...} }`
 * and answers `{ names: {} }` on failure; an empty map is a valid payload,
 * not an error — the label helpers fall back.
 */
export async function fetchModelNames(): Promise<ModelNames> {
  const body = await getJson<{ names?: ModelNames }>("/api/model-names")
  return body.names ?? {}
}

export function fetchHealth(): Promise<HealthResponse> {
  return getJson("/api/health")
}
