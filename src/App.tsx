import { useCallback, useEffect, useMemo, useState } from "react"
import type { HealthResponse, Range, SessionsPayload, SummaryResponse } from "./api"
import { fetchHealth, fetchSessions, fetchSummary } from "./api"
import { ActivityChart } from "./components/ActivityChart"
import { KpiHeader } from "./components/KpiHeader"
import { ModelsTable } from "./components/ModelsTable"
import { RangeTabs } from "./components/RangeTabs"
import { SessionsTable } from "./components/SessionsTable"
import { modelRows } from "./summary"
import { buildTree } from "./tree"

const POLL_MS = 30_000

export function App() {
  const [range, setRange] = useState<Range>("7d")
  const [summary, setSummary] = useState<SummaryResponse | null>(null)
  const [sessions, setSessions] = useState<SessionsPayload | null>(null)
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [sessionsError, setSessionsError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [directory, setDirectory] = useState<string>("")

  const refresh = useCallback(async () => {
    const [r1, r2, r3] = await Promise.allSettled([
      fetchSummary(range),
      fetchSessions(range),
      fetchHealth(),
    ])
    if (r1.status === "fulfilled") {
      setSummary(r1.value)
      setSummaryError(null)
    } else {
      setSummaryError(String(r1.reason instanceof Error ? r1.reason.message : r1.reason))
    }
    if (r2.status === "fulfilled") {
      setSessions(r2.value)
      setSessionsError(null)
    } else {
      setSessionsError(String(r2.reason instanceof Error ? r2.reason.message : r2.reason))
    }
    if (r3.status === "fulfilled") setHealth(r3.value)
    else
      setHealth({
        ok: true,
        service: { url: null, healthy: false, version: null, error: "dashboard backend unreachable" },
      })
    setUpdatedAt(new Date())
    setLoaded(true)
  }, [range])

  useEffect(() => {
    // All setState calls in refresh() happen after `await`, so nothing here
    // renders synchronously or cascades.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [refresh])

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh()
    }, POLL_MS)
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh()
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      window.clearInterval(id)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [refresh])

  const directories = useMemo(() => {
    const counts = new Map<string, number>()
    for (const s of sessions?.data ?? []) {
      const d = s.location?.directory
      if (d) counts.set(d, (counts.get(d) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [sessions])

  const tree = useMemo(() => {
    const data = sessions?.data ?? []
    const filtered = directory ? data.filter((s) => s.location?.directory === directory) : data
    return buildTree(filtered)
  }, [sessions, directory])

  const models = useMemo(
    () => (summary && !summary.degraded ? modelRows(summary.data) : []),
    [summary],
  )
  const activity = summary && !summary.degraded ? summary.data.activity : undefined

  return (
    <div className="app">
      <header className="topbar">
        <h1>oc-dash</h1>
        <RangeTabs range={range} onChange={setRange} />
        <span className="updated dim">
          {updatedAt ? `updated ${updatedAt.toLocaleTimeString()}` : ""}
        </span>
      </header>

      <HealthBanner health={health} />

      {summaryError && (
        <div className="error" role="alert">
          <span>Summary failed to load: {summaryError}</span>
          <button type="button" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      )}
      {sessionsError && (
        <div className="error" role="alert">
          <span>Sessions failed to load: {sessionsError}</span>
          <button type="button" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      )}

      {!loaded && <p className="loading">Loading…</p>}

      {loaded && (
        <>
          <KpiHeader summary={summary} sessions={sessions} />
          {summary?.degraded && (
            <div className="badge warn degraded-note">
              stats endpoint unavailable ({summary.reason}) — showing totals derived from the
              session list instead
            </div>
          )}

          <section>
            <div className="section-head">
              <h2>Sessions</h2>
              {directories.length > 1 && (
                <label className="filter">
                  Project{" "}
                  <select value={directory} onChange={(e) => setDirectory(e.target.value)}>
                    <option value="">All ({sessions?.count ?? 0})</option>
                    {directories.map(([d, n]) => (
                      <option key={d} value={d} title={d}>
                        {d.split("/").pop() || d} ({n})
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            {sessions?.truncated && (
              <p className="badge warn">
                session list truncated at 50 pages — older sessions may be missing
              </p>
            )}
            <SessionsTable nodes={tree} />
          </section>

          <section>
            <h2>Models</h2>
            <ModelsTable rows={models} />
          </section>

          <section>
            <h2>Activity</h2>
            <ActivityChart activity={activity} />
          </section>

          <footer className="footnotes">
            <ol>
              <li>
                KPI totals come from the stats endpoint and include compaction usage not
                attributed to any session, so they can exceed the sum of session rollups.
              </li>
              <li>
                Costs are list-price estimates (models.dev data) and undercount unpriced
                providers; models flagged “unpriced” burn real tokens but report zero cost.
              </li>
            </ol>
          </footer>
        </>
      )}
    </div>
  )
}

function HealthBanner({ health }: { health: HealthResponse | null }) {
  if (!health) return null
  const svc = health.service
  return (
    <div className={`health ${svc.healthy ? "ok" : "bad"}`}>
      <span className="dot" aria-hidden />
      {svc.healthy
        ? `opencode service healthy · ${svc.url ?? "unknown url"}${svc.version ? ` · v${svc.version}` : ""}`
        : `opencode service unreachable${svc.error ? ` — ${svc.error}` : ""}`}
    </div>
  )
}
