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
   * Additive, Today-only: the trailing 7 days of activity (same shape as
   * `data.activity`) so the chart can show the in-range day in context.
   */
  contextActivity?: ActivityDay[]
  /**
   * Mission 014 (PD Q4a): additive, present only when the request carried
   * project=<id(s)> and the extra upstream stats call(s) succeeded. Each
   * project id is echoed so the client can match the payloads to the filter
   * on screen before trusting their numbers. Mission 026: a list — one
   * payload per requested project id, since a directory can map to more
   * than one.
   */
  projectStats?: ProjectStats[]
}

/**
 * Mission 014 (PD Q4a): the per-project stats payload behind the filtered
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

export interface DashboardUpdate {
  version: string
  latest: string | null
  updateAvailable: boolean
  updateCommand: string
}

export interface HealthResponse {
  ok: boolean
  /**
   * Mission 014: oc-dash's own version and the registry's latest. The real
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
 * Mission 014 (PD Q4a): optional project pass-through. Mission 026: the
 * param carries a comma-separated list of project ids (all the ids behind
 * the directory filter). Existing callers are unaffected — the param is
 * sent only while the card wants project-scoped stats, and /api/summary
 * without it returns exactly the same keys as before.
 */
export function fetchSummary(range: Range, project?: string): Promise<SummaryResponse> {
  const suffix = project ? `&project=${encodeURIComponent(project)}` : ""
  return getJson(`/api/summary?range=${range}${suffix}`)
}

export function fetchSessions(range: Range): Promise<SessionsPayload> {
  return getJson(`/api/sessions?range=${range}`)
}

export function fetchHealth(): Promise<HealthResponse> {
  return getJson("/api/health")
}
