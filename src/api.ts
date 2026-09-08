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

export interface HealthResponse {
  ok: boolean
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

export function fetchSummary(range: Range): Promise<SummaryResponse> {
  return getJson(`/api/summary?range=${range}`)
}

export function fetchSessions(range: Range): Promise<SessionsPayload> {
  return getJson(`/api/sessions?range=${range}`)
}

export function fetchHealth(): Promise<HealthResponse> {
  return getJson("/api/health")
}
