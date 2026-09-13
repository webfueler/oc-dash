import { useCallback, useEffect, useMemo, useState } from "react"
import type {
  DashboardUpdate,
  HealthResponse,
  ModelNames,
  Range,
  SessionsPayload,
  SummaryResponse,
} from "./api"
import { fetchHealth, fetchModelNames, fetchSessions, fetchSummary } from "./api"
import { ActivityChart } from "./components/ActivityChart"
import { FilterCombobox } from "./components/FilterCombobox"
import { FilterSummaryCard } from "./components/FilterSummaryCard"
import { KpiHeader } from "./components/KpiHeader"
import { ModelsTable } from "./components/ModelsTable"
import { RangeTabs } from "./components/RangeTabs"
import { SessionsTable } from "./components/SessionsTable"
import { applyFilters, modelComboOptions, projectComboOptions, staleModelOption, staleProjectOption, withStaleOption } from "./filters"
import { modelRows, projectIDForDirectory, todayAccentDate } from "./summary"
import {
  applyTheme,
  browserStorage,
  persistTheme,
  readStoredTheme,
  THEME_CHOICES,
  type ThemeChoice,
} from "./theme"
import { allParentIds, buildTree, nextSortState, sortNodes, type SortKey, type SortState } from "./tree"

const POLL_MS = 30_000

export function App() {
  const [range, setRange] = useState<Range>("7d")
  const [summary, setSummary] = useState<SummaryResponse | null>(null)
  const [sessions, setSessions] = useState<SessionsPayload | null>(null)
  // Mission 044: providerID/id -> display name for the model label surfaces.
  // An empty map (or a failed fetch, which keeps the current value) means the
  // raw-id fallback labels; the filter semantics never touch it.
  const [modelNames, setModelNames] = useState<ModelNames>({})
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [sessionsError, setSessionsError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [directory, setDirectory] = useState<string>("")
  // Mission 013 (PC), 019 granularity: the model filter — a base
  // "providerID/id" key (the reasoning variant ignored) or "" for all, with
  // the same client-side post-filter semantics as `directory` (range
  // switches keep it, like the project filter).
  const [model, setModel] = useState<string>("")
  // P2: collapsed every load; a parent id lands here only once it is expanded.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  // Mission 058: the Sessions column sort, one column at a time; `null` is
  // the default (base input order). `changeRange` leaves it alone, so the
  // choice survives range switches like the filters do.
  const [sort, setSort] = useState<SortState | null>(null)

  // Mission 015 (PB): the stored theme choice. The pre-paint script in
  // index.html already applied it to <html> before first paint; React just
  // mirrors it so the control's active segment matches what is on screen.
  const [theme, setTheme] = useState<ThemeChoice>(() => readStoredTheme(browserStorage()))

  // Mission 014 (PD Q4a) + 026: project pass-through. Whenever a directory
  // filter is active (with or without a model filter — the per-project
  // models[] rows also feed the card's money under directory+model), the
  // request carries project=<id[,id...]> for ALL project ids behind the
  // directory. The derived string is stable across polls, so ordinary
  // refreshes add no extra fetches and the refresh identity stays put.
  const cardProjectsParam = useMemo(() => {
    if (!directory) return ""
    return projectIDForDirectory(sessions?.data ?? [], directory).join(",")
  }, [sessions, directory])

  // Mission 026: the array form the card consumes (payload matching, money).
  const cardProjectIDs = useMemo(
    () => (cardProjectsParam ? cardProjectsParam.split(",") : []),
    [cardProjectsParam],
  )

  // P2: switching range collapses the tree again.
  const changeRange = useCallback((r: Range) => {
    setRange(r)
    setExpanded(new Set())
  }, [])

  // Mission 015 (PB): the pre-paint script already applied the stored choice;
  // this effect keeps <html> in step from here on (idempotent on mount, live
  // on change). No matchMedia listener anywhere: system mode stays
  // attribute-free, so the OS media query re-themes natively on OS flips.
  useEffect(() => {
    applyTheme(document.documentElement, theme)
  }, [theme])

  const changeTheme = useCallback((t: ThemeChoice) => {
    setTheme(t)
    persistTheme(browserStorage(), t)
  }, [])

  const refresh = useCallback(async () => {
    const [r1, r2, r3, r4] = await Promise.allSettled([
      fetchSummary(range, cardProjectsParam || undefined),
      fetchSessions(range),
      fetchHealth(),
      fetchModelNames(),
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
    // Mission 044: best-effort name map. A rejected fetch keeps the
    // previously loaded map; the server's degraded 200 (`{ names: {} }`)
    // arrives as an empty map and replaces it, so labels fall back to the
    // raw ids until the next successful fetch. No error surface.
    if (r4.status === "fulfilled") setModelNames(r4.value)
    setUpdatedAt(new Date())
    setLoaded(true)
  }, [range, cardProjectsParam])

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

  // Mission 013 (PA/PC), 020 always-visible: combobox options derived from
  // the same rows the old select used — live counts over the visible range,
  // All first with the payload count. withStaleOption re-adds a held filter
  // value the current range has no rows for (7d pick faced with Today), so
  // the always-rendered control shows the selected filter with a truthful
  // 0 count instead of the raw key.
  const projectFilterOptions = useMemo(
    () =>
      withStaleOption(
        projectComboOptions(sessions?.data ?? [], sessions?.count ?? 0),
        directory,
        staleProjectOption,
      ),
    [sessions, directory],
  )
  const modelFilterOptions = useMemo(
    () =>
      withStaleOption(
        modelComboOptions(sessions?.data ?? [], sessions?.count ?? 0, modelNames),
        model,
        (key) => staleModelOption(key, modelNames),
      ),
    [sessions, model, modelNames],
  )

  // Mission 013 (PC) + 014 (PD): directory AND model compose in this memo,
  // model applied after directory, both before buildTree so the tree
  // reflects the intersection and a filtered-out parent cannot visibly
  // promote its children. Hero, Models table, and chart stay global — the
  // filtered-totals card below is what follows the filters, fed by these
  // same rows.
  const filteredRows = useMemo(
    () => applyFilters(sessions?.data ?? [], directory, model),
    [sessions, directory, model],
  )
  const tree = useMemo(() => buildTree(filteredRows), [filteredRows])
  // Mission 058: the same post-filter tree, ordered while a column is
  // active; `null` keeps the base order, so the page loads default.
  const sortedTree = useMemo(() => sortNodes(tree, sort), [tree, sort])

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

  // Mission 058: a header activation cycles its column default -> ascending
  // -> descending -> default; picking another column starts there at
  // ascending and drops the previous one.
  const cycleSort = useCallback((key: SortKey) => {
    setSort((prev) => nextSortState(prev, key))
  }, [])

  const treeHasParents = useMemo(() => allParentIds(tree).length > 0, [tree])

  const models = useMemo(
    () => (summary && !summary.degraded ? modelRows(summary.data) : []),
    [summary],
  )
  const okSummary = summary && !summary.degraded ? summary : undefined
  const activity = okSummary?.data.activity
  const contextActivity = okSummary?.contextActivity
  // Today's chart accents the in-range day (local midnight from the stats
  // window). Mission 008 (007's F2): gated on the payload's own preset, not
  // the active range state, so a stale non-today payload that is still on
  // screen after a switch to Today renders as a plain chart instead of
  // accenting a date that matches no bar (which muted every bar).
  const accentDate = todayAccentDate(okSummary)

  return (
    <div className="app">
      <header className="topbar">
        <h1>oc-dash</h1>
        <span className="app-version dim">v{__APP_VERSION__}</span>
        <RangeTabs range={range} onChange={changeRange} />
        <ThemeTabs theme={theme} onChange={changeTheme} />
        <span className="updated dim">
          {updatedAt ? `updated ${updatedAt.toLocaleTimeString()}` : ""}
        </span>
      </header>

      <HealthBanner health={health} />
      <UpdateNotice dashboard={health?.dashboard} />

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
          {/* Mission 023: the filter row lives in a fixed slot after the
              hero/KPI area, ahead of the conditional card, so picking or
              clearing a filter never moves the row vertically. Mission 020:
              both comboboxes render ALWAYS on the same rule as before —
              one directory, zero directories, or a held filter matching
              nothing in this range all keep the controls on screen. */}
          <div className="filters-row" role="group" aria-label="Filters">
            <div className="filter">
              Project{" "}
              <FilterCombobox
                ariaLabel="Filter projects"
                placeholder="Filter projects…"
                options={projectFilterOptions}
                value={directory}
                onChange={setDirectory}
              />
            </div>
            <div className="filter">
              Model{" "}
              <FilterCombobox
                ariaLabel="Filter models"
                placeholder="Filter models…"
                options={modelFilterOptions}
                value={model}
                onChange={setModel}
                align="right"
              />
            </div>
          </div>
          {/* Mission 014 (PD, Q5a): the filtered card renders whenever any
              filter is active, no dismiss state of its own; it recomputes
              from the poll's payloads. The hero above stays global. Slot
              per Mission 023: below the fixed filter row, above the
              Sessions section. */}
          {(directory !== "" || model !== "") && (
            <FilterSummaryCard
              rows={filteredRows}
              directory={directory}
              model={model}
              summary={summary}
              sessions={sessions}
              activeRange={range}
              projectIDs={cardProjectIDs}
              names={modelNames}
            />
          )}

          <section>
            <div className="section-head">
              <h2>Sessions</h2>
              <div className="section-tools">
                {/* Mission 023: the two filter comboboxes moved up to the
                    fixed .filters-row slot after the hero/KPI area (Mission
                    020's always-visible rule unchanged, just relocated);
                    the head keeps the expand/collapse controls only. */}
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
              </div>
            </div>
            {sessions?.truncated && (
              <p className="badge warn">
                session list truncated at 50 pages — older sessions may be missing
              </p>
            )}
            <SessionsTable
              nodes={sortedTree}
              expanded={expanded}
              onToggle={toggleRow}
              names={modelNames}
              sort={sort}
              onSort={cycleSort}
            />
          </section>

          <section>
            <h2>Models</h2>
            <ModelsTable rows={models} names={modelNames} />
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

const UPDATE_DISMISS_KEY = "oc-dash.update-dismissed"

/**
 * Mission 014: the dismissible update notice, below the health banner. It
 * renders only when /api/health says a newer version is published, and the
 * dismissal is keyed to that version so a later release can surface again.
 * Reload is the action that actually picks up a checkout update, because
 * the SPA keeps its loaded JS until the page reloads.
 */
function UpdateNotice({ dashboard }: { dashboard?: DashboardUpdate }) {
  const storage = browserStorage()
  const latest = dashboard?.latest ?? null
  const [dismissed, setDismissed] = useState<string | null>(() => {
    try {
      return storage?.getItem(UPDATE_DISMISS_KEY) ?? null
    } catch {
      return null
    }
  })
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle")
  if (!dashboard?.updateAvailable || !latest || dismissed === latest) return null

  const dismiss = () => {
    try {
      storage?.setItem(UPDATE_DISMISS_KEY, latest)
    } catch {
      // Storage unavailable: the dismissal lasts for this session only.
    }
    setDismissed(latest)
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(dashboard.updateCommand)
      setCopied("copied")
    } catch {
      setCopied("failed")
    }
  }
  const copyLabel =
    copied === "copied" ? "copied" : copied === "failed" ? "copy failed" : "copy update command"

  return (
    <div className="update-notice">
      <span className="up" aria-hidden>
        ↑
      </span>
      <span>
        oc-dash v{latest} is available (running v{dashboard.version})
      </span>
      <code className="update-command">{dashboard.updateCommand}</code>
      <button type="button" onClick={() => void copy()}>
        {copyLabel}
      </button>
      <button type="button" onClick={() => window.location.reload()}>
        reload
      </button>
      <button type="button" onClick={dismiss}>
        dismiss
      </button>
    </div>
  )
}

// Mission 015 (PB): the 3-segment system | dark | light control, in the
// topbar next to the range tabs. It reuses oc-dash's own segmented language
// (.tabs/.tab/.active) verbatim — same border, radius, and accent active
// state, which stays visible in all three themes. Active segment per the
// artifact's three control-state mocks.
function ThemeTabs({ theme, onChange }: { theme: ThemeChoice; onChange: (t: ThemeChoice) => void }) {
  return (
    <div className="tabs" role="group" aria-label="Theme">
      {THEME_CHOICES.map((t) => (
        <button
          key={t}
          type="button"
          className={t === theme ? "tab active" : "tab"}
          aria-pressed={t === theme}
          onClick={() => onChange(t)}
        >
          {t}
        </button>
      ))}
    </div>
  )
}
