import { useCallback, useEffect, useMemo, useState } from "react"
import type { HealthResponse, Range, SessionsPayload, SummaryResponse } from "./api"
import { fetchHealth, fetchSessions, fetchSummary } from "./api"
import { ActivityChart } from "./components/ActivityChart"
import { KpiHeader } from "./components/KpiHeader"
import { ModelsTable } from "./components/ModelsTable"
import { RangeTabs } from "./components/RangeTabs"
import { SessionsTable } from "./components/SessionsTable"
import { isoDate } from "./format"
import { modelRows } from "./summary"
import { allParentIds, buildTree } from "./tree"

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
  // P2: collapsed every load; a parent id lands here only once it is expanded.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())

  // P2: switching range collapses the tree again.
  const changeRange = useCallback((r: Range) => {
    setRange(r)
    setExpanded(new Set())
  }, [])

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

  const toggleRow = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const expandAll = useCallback(() => {
    setExpanded(new Set(allParentIds(tree)))
  }, [tree])

  const collapseAll = useCallback(() => {
    setExpanded(new Set())
  }, [])

  const treeHasParents = useMemo(() => allParentIds(tree).length > 0, [tree])

  const models = useMemo(
    () => (summary && !summary.degraded ? modelRows(summary.data) : []),
    [summary],
  )
  const okSummary = summary && !summary.degraded ? summary : undefined
  const activity = okSummary?.data.activity
  const contextActivity = okSummary?.contextActivity
  // Today's chart accents the in-range day (local midnight from the stats window).
  const accentDate =
    range === "today" && okSummary?.data.range.from != null ? isoDate(okSummary.data.range.from) : null

  return (
    <div className="app">
      <header className="topbar">
        <h1>oc-dash</h1>
        <RangeTabs range={range} onChange={changeRange} />
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
          <KpiHeader summary={summary} sessions={sessions} range={range} />
          {summary?.degraded && (
            <div className="badge warn degraded-note">
              stats endpoint unavailable ({summary.reason}) — showing totals derived from the
              session list instead
            </div>
          )}

          <section>
            <div className="section-head">
              <h2>Sessions</h2>
              <div className="section-tools">
                {treeHasParents && (
                  <div className="tree-controls" role="group" aria-label="Tree expansion">
                    <button type="button" onClick={expandAll}>
                      Expand all
                    </button>
                    <button type="button" onClick={collapseAll}>
                      Collapse all
                    </button>
                  </div>
                )}
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
            </div>
            {sessions?.truncated && (
              <p className="badge warn">
                session list truncated at 50 pages — older sessions may be missing
              </p>
            )}
            <SessionsTable nodes={tree} expanded={expanded} onToggle={toggleRow} />
          </section>

          <section>
            <h2>Models</h2>
            <ModelsTable rows={models} />
          </section>

          <section>
            <h2>Activity</h2>
            <ActivityChart activity={activity} contextActivity={contextActivity} accentDate={accentDate} />
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
