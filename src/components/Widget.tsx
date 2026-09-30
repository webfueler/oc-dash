import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ModelNames, Range, SessionsPayload, SummaryResponse } from "../api"
import { fetchModelNames, fetchSessions, fetchSummary } from "../api"
import {
  MODELS_HEAD_TITLE,
  WIDGET_MODEL_ROWS,
  WIDGET_POLL_MS,
  WIDGET_QUIT_ARM_MS,
  WIDGET_QUIT_IDLE,
  WIDGET_QUIT_SENT_TEXT,
  WIDGET_QUIT_URL,
  WIDGET_RANGES,
  WIDGET_RANGE_LABELS,
  WIDGET_SESSION_ROWS,
  WIDGET_START_ARM_MS,
  WIDGET_START_IDLE,
  WIDGET_START_SENT_TEXT,
  WIDGET_START_URL,
  gapTitle,
  persistWidgetRange,
  readWidgetRange,
  sessionsHeadTitle,
  widgetAtRange,
  widgetGap,
  widgetHero,
  widgetModels,
  widgetOfflineActions,
  widgetQuitDisarm,
  widgetQuitElapsed,
  widgetQuitPress,
  widgetQuitView,
  widgetRefreshText,
  widgetSessions,
  widgetStartDisarm,
  widgetStartElapsed,
  widgetStartPress,
  widgetStartSends,
  widgetStartSettled,
  widgetStats,
  widgetStorage,
  widgetSurfaceFacts,
  widgetSurfaceLine,
  widgetSurfaceRequested,
  type WidgetModelRow,
  type WidgetQuit,
  type WidgetSessionRow,
  type WidgetStart,
} from "../widget"

/**
 * The compact menu bar panel, designed for 340x420, with the range selector
 * and the vibrancy ground.
 *
 * Deliberately NOT the dashboard's App with pieces removed. It is a separate
 * mount with its own state, its own fetches, and its own stylesheet, so
 * nothing here can change what `/` renders.
 *
 * Four differences from the dashboard's shape, all load-bearing:
 *
 * - Its own 30s timer with no visibility gate. A closed popover is not
 *   `document.visibilityState === "visible"`, so the dashboard's loop stops
 *   the moment the panel closes. This one keeps polling.
 * - No filters, no theme control, no activity chart. At this size each would
 *   cost more rows than it earns.
 * - One piece of state for the range and the payload it labels. See below.
 * - A failed fetch clears the payload rather than keeping the last good
 *   one. A glanceable panel has no banner to explain a number that might
 *   be minutes old, so a failure is a dash now and a number in 30 seconds.
 *
 * It does call /api/sessions, which the dashboard also calls
 * every 30 seconds. There is no per-session row in the summary payload, so
 * a sessions table cannot be built without it.
 */

/**
 * The range and the two payloads that range produced, as one object.
 *
 * This is the whole of the atomicity mechanism and it is deliberately not
 * three separate `useState` calls. The exactness rule says a figure
 * must never sit under the wrong range's name, and the range label that used
 * to guarantee it is gone, so the coupling has to come
 * from the code instead. One state object plus `widgetAtRange` gives it three
 * separate guarantees:
 *
 * 1. The selector and the payload land in the same `setState`, so there is no
 *    render in which the cap has moved and the rows have not.
 * 2. `widgetAtRange` re-checks the payload's OWN `range.preset` — the value
 *    the server resolved and echoed, not the string on the cap — and renders
 *    a mismatch as nothing at all. So even an out-of-order response, a
 *    hand-edited state object, or a server that resolved the range differently
 *    cannot put one range's numbers under another range's name.
 * 3. The previous range's rows are dropped rather than held: the state object
 *    is replaced, so there is no frame where the old rows are on screen under
 *    the new cap. `sessionsLoading` is what the panel shows instead, which is
 *    an honest "the list is on its way" rather than yesterday's list.
 *
 * The cost of this choice is a blank panel for the few hundred milliseconds a
 * range switch takes at the wide ranges. `all` is a 792ms round trip, so the
 * honest version of the blank is a stated one.
 */
interface WidgetState {
  range: Range
  summary: SummaryResponse | null
  sessions: SessionsPayload | null
  /** True from a range change until that range's payloads land. */
  loading: boolean
  unreachable: boolean
  updatedAt: number | null
  /** False until the first settle at all, so the footer can say "loading". */
  loaded: boolean
  /**
   * The clock, as the last settle saw it, and the reason it is state rather
   * than `Date.now()` at render: `relTime` needs a `now`, and reading the clock
   * during render is an impure read that makes the panel's own text depend on
   * when React happened to schedule the frame. It moves with `updatedAt` and
   * with the poll, which is exactly as often as the text it formats can change
   * anyway. 0 until the first settle, where it is unreachable: with
   * `updatedAt` null the footer prints nothing at any clock.
   */
  now: number
}

export function Widget() {
  // The stored range, read once on mount. `localStorage` through the
  // testable wrapper in widget.ts; the fallback is `today`, which is also the
  // dashboard's own default and the range the panel shipped on.
  const [state, setState] = useState<WidgetState>(() => ({
    range: readWidgetRange(widgetStorage()) ?? "today",
    summary: null,
    sessions: null,
    loading: true,
    unreachable: false,
    updatedAt: null,
    loaded: false,
    now: 0,
  }))
  // The display-name map, for the model row labels. Best effort:
  // a rejected fetch keeps the map on hand, and the server's `{ names: {} }`
  // answers as an empty map, which falls the labels back to the short ids.
  // It is range-independent, so it survives every range change by design.
  const [names, setNames] = useState<ModelNames>({})

  // The offline path's spawn control. Declared here rather than
  // with the quit control's state further down because `refresh` is what ends a
  // sent request, and the reset has to happen where a settle lands rather than in
  // an effect watching for one.
  const [start, setStart] = useState<WidgetStart>(WIDGET_START_IDLE)

  // The surface diagnostic, off unless `?surface=1`. It is read
  // one frame after mount rather than during render, because it measures this
  // component's own painted box and a rect taken mid-render is not the rect the
  // reader sees. The state stays null when it is off and the footer prints
  // nothing at all in that case, so the shipped panel is unchanged.
  const [surface, setSurface] = useState<string | null>(null)
  useEffect(() => {
    if (!widgetSurfaceRequested(window.location.search)) return
    const id = window.requestAnimationFrame(() => {
      setSurface(widgetSurfaceLine(widgetSurfaceFacts()))
    })
    return () => window.cancelAnimationFrame(id)
  }, [])

  // A monotonic counter. `all` at 792ms is slower than a fast range switch, so
  // two refreshes can be in flight at once, and the older one must not win.
  // Without it, clicking 30d and then All can land All's payload first and
  // then let 30d's stale response overwrite it — which `widgetAtRange` would
  // then correctly render as nothing, so the panel would show a dash on a
  // range whose data did arrive. The counter discards the stale response
  // instead of discarding the data with it.
  const seq = useRef(0)
  // The range the reader is on, readable from a timer callback without the
  // timer being torn down and re-armed on every change. A range switch that
  // re-created the interval would reset the 30s cadence, so the popover would
  // never poll at all if the reader worked in it.
  const current = useRef<Range>(state.range)

  const refresh = useCallback(async (range: Range) => {
    const mine = ++seq.current
    const now = Date.now()
    const [r1, r2, r3] = await Promise.allSettled([
      // The panel renders no chart, so it opts out of the Today-only
      // trailing-7-day call that feeds the dashboard's contextActivity: one
      // upstream round trip per poll instead of two.
      fetchSummary(range, { context: false }),
      fetchSessions(range),
      fetchModelNames(),
    ])
    // A newer refresh started while these were in flight. Its results are the
    // ones on screen; these are for a range the reader is no longer on.
    if (mine !== seq.current) return
    if (r3.status === "fulfilled") setNames(r3.value)
    // A settle is the only thing that ends a sent start request, and
    // this is where one lands. If the dashboard answered, `unreachable` goes false
    // below and the offline block unmounts with the request still in it; if it did
    // not, the control goes back to resting, which is the panel's first honest
    // "that did not work". Not an effect watching `updatedAt`: this is the settle
    // itself, it is already after an await so it cannot cascade, and it needs no
    // clock of its own. `armed` is left alone on purpose, because a poll lands
    // every 30 seconds whether anyone is reading or not.
    setStart((s) => widgetStartSettled(s))
    setState((s) => ({
      ...s,
      range,
      summary: r1.status === "fulfilled" ? r1.value : null,
      sessions: r2.status === "fulfilled" ? r2.value : null,
      loading: false,
      unreachable: r1.status === "rejected" || r2.status === "rejected",
      // `now` and `updatedAt` come from the clock this refresh started with, not
      // from a second `Date.now()` after the awaits: three round trips on `all`
      // are 792ms apart, so the footer could otherwise read "updated just now"
      // for a settle that began before the previous one printed.
      updatedAt: now,
      loaded: true,
      now,
    }))
  }, [])

  // Mount, and every range change: fetch now, not on the next 30s tick.
  // Refetch immediately rather than waiting, because
  // the alternative is up to 30 seconds of a cap the reader just moved onto with
  // no data under it.
  useEffect(() => {
    // Every setState call in refresh() happens after `await`, so nothing here
    // renders synchronously or cascades. No eslint-disable is needed for that,
    // which is why the earlier eslint-disable is gone: the range now comes from a
    // ref, so this effect depends on `state.range` only as a trigger and does
    // not read the state it is reacting to.
    void refresh(current.current)
  }, [refresh, state.range])

  useEffect(() => {
    // No visibility check, unlike App.tsx: the panel keeps its numbers warm
    // whether or not the popover is on screen. The range comes from a ref so
    // this interval is created once and never reset by a range change.
    const id = window.setInterval(() => {
      void refresh(current.current)
    }, WIDGET_POLL_MS)
    return () => window.clearInterval(id)
  }, [refresh])

  // The quit control's state. Three phases and nothing else, all
  // of it derived in widget.ts so the arm window is pinned by tests in the
  // node environment rather than by a screenshot. `WIDGET_QUIT_IDLE` is a
  // module constant, so no lazy initializer is needed and `useState`'s argument
  // is not a function that React would call with the previous state.
  const [quit, setQuit] = useState<WidgetQuit>(WIDGET_QUIT_IDLE)

  // The arm expires on its own. One timer, re-created only when the phase
  // changes: `setQuit` in the callback rather than `setQuit("idle")` so the
  // expiry is decided by the same pure function the tests exercise, and so a
  // timer that fires late (a throttled webview) still lands on the phase that
  // function returns for the clock it actually sees.
  useEffect(() => {
    if (quit.phase !== "armed") return
    const id = window.setTimeout(() => {
      setQuit((q) => widgetQuitElapsed(q, Date.now()))
    }, WIDGET_QUIT_ARM_MS)
    return () => window.clearTimeout(id)
  }, [quit])

  const pressQuit = useCallback(() => {
    const next = widgetQuitPress(quit, Date.now())
    // The URL goes out here, and NOT inside the updater. React runs updaters
    // twice under StrictMode to surface impure ones, and a quit request is the
    // last thing that should ever be sent twice because a dev build is on.
    if (next.phase === "sent" && quit.phase === "armed") {
      // The handoff. The page cannot terminate the app, so it emits
      // the intent as a navigation and widget.ts's WIDGET_QUIT_URL names
      // exactly what the shell has to match. If no shell does, this fails
      // silently and `next.phase === "sent"` is the panel's only honest claim:
      // a request went out. Nothing here waits to see whether it worked,
      // because nothing here could.
      window.location.assign(WIDGET_QUIT_URL)
    }
    setQuit(next)
  }, [quit])

  // Pointer-out and range-change both disarm. The pointer case is the one that
  // actually prevents the accident: arming means pointing at the control, so
  // once the pointer is somewhere else the reader is doing something else and
  // the next click belongs to that.
  const disarmQuit = useCallback(() => setQuit((q) => widgetQuitDisarm(q)), [])

  // The offline path's two controls. The spawn's state machine is
  // the quit control's, in a shorter window and with one extra rule, all of it in widget.ts so
  // the node tests can reach it; this is the wiring and nothing else. Its state
  // is declared with the other state at the top, because `refresh` is what ends a
  // sent request.

  // Same arm expiry as the quit control's, on the same terms: one timer, re-made
  // only when the phase changes, and decided by the same pure function the tests
  // exercise so a late timer still lands on the phase that function returns for
  // the clock it actually sees.
  useEffect(() => {
    if (start.phase !== "armed") return
    const id = window.setTimeout(() => {
      setStart((s) => widgetStartElapsed(s, Date.now()))
    }, WIDGET_START_ARM_MS)
    return () => window.clearTimeout(id)
  }, [start])

  const pressStart = useCallback(() => {
    const next = widgetStartPress(start, Date.now())
    // The URL goes out here and NOT inside the updater, for the quit control's
    // reason: React
    // runs updaters twice under StrictMode to surface impure ones, and a spawn
    // request is not something a dev build should be able to send twice.
    if (widgetStartSends(start, next)) {
      // The handoff, and the same one the quit control makes. The page
      // cannot spawn a process, so it emits the intent as a navigation and
      // widget.ts's WIDGET_START_URL names exactly what the shell has to match.
      // `widgetStartSends` is the whole of the emission rule and it lives beside
      // the state machine rather than here, because "once per armed intent,
      // never on the first press" is a rule nothing should be able to drift.
      window.location.assign(WIDGET_START_URL)
    }
    setStart(next)
  }, [start])

  const disarmStart = useCallback(() => setStart((s) => widgetStartDisarm(s)), [])

  // "Try again": one press, the panel's own fetch, the same range it is already
  // showing. No arm, because nothing outside this page happens and a request
  // with no effect cannot spoil anything a stray click would spoil.
  const retry = useCallback(() => {
    void refresh(current.current)
  }, [refresh])

  const changeRange = useCallback((next: Range) => {
    if (next === current.current) return
    current.current = next
    disarmQuit()
    disarmStart()
    persistWidgetRange(widgetStorage(), next)
    // The payload is cleared in the same update that moves the cap, so the
    // previous range's rows are gone from this render onwards rather than
    // being visible until the new ones arrive. `loading` is what the panel
    // shows in their place.
    setState((s) => ({
      ...s,
      range: next,
      summary: null,
      sessions: null,
      loading: true,
    }))
  }, [disarmQuit, disarmStart])

  const { summary, sessions } = useMemo(
    () => widgetAtRange({ range: state.range, summary: state.summary, sessions: state.sessions }),
    [state.range, state.summary, state.sessions],
  )

  const hero = useMemo(() => widgetHero(summary), [summary])
  const stats = useMemo(() => widgetStats(summary), [summary])
  const models = useMemo(() => widgetModels(summary, names, WIDGET_MODEL_ROWS), [summary, names])
  const sessionRows = useMemo(() => widgetSessions(sessions, WIDGET_SESSION_ROWS), [sessions])
  const gap = useMemo(() => widgetGap(summary, sessionRows), [summary, sessionRows])
  // One sentence, computed once, handed to the three places it is needed.
  // No `title` is invented from a format at render time.
  const gapSentence = useMemo(() => gapTitle(gap), [gap])
  // The footer's left slot. It holds the timestamp when the panel
  // is healthy and the failure sentence when it is not, and it prints the time
  // in EXACTLY ONE place on the panel: the top strip gave this up when the
  // footer arrived, because two copies of a freshness claim cannot both be the
  // live one. `widgetRefreshText` is the only function that decides the words,
  // so the "unreachable" branch cannot drift from the hero's own degraded rule.
  // Sent as the request rather than shown on the hero: this is a panel-wide
  // condition (either endpoint rejected), not a property of one payload.
  const refreshText = widgetRefreshText({
    updatedAt: state.updatedAt,
    unreachable: state.unreachable,
    now: state.now,
  })
  const quitView = useMemo(() => widgetQuitView(quit), [quit])
  // Null while the dashboard answers, and the two controls when it
  // does not. One function decides it, and it is the same one the tests assert
  // is null in the healthy state, so "no start control when the server is up"
  // cannot become a reading of this markup.
  const offline = useMemo(() => widgetOfflineActions(state.unreachable, start), [state.unreachable, start])
  // The window and the basis, in the panel's own words, from the same
  // `rangeLabel` the hero's removed label used. The range
  // label is gone from under the cost because the selector names the range; the
  // sessions header cell still has to say that a row is a session's own total
  // rather than the window's share of it, or the table re-opens the misreading
  // the gap exists for.
  const sessionsTitle = useMemo(
    () => sessionsHeadTitle(state.range, gap),
    [state.range, gap],
  )

  return (
    <div className="widget">
      <nav className="w-range" role="group" aria-label="Range">
        {WIDGET_RANGES.map((r) => (
          <button
            key={r}
            type="button"
            className={`w-seg${r === state.range ? " is-on" : ""}`}
            aria-pressed={r === state.range}
            onClick={() => changeRange(r)}
          >
            {WIDGET_RANGE_LABELS[r]}
          </button>
        ))}
      </nav>

      {/* The timestamp moved out of here and into the footer. The
          title stays, because the header is what says which app this popover
          belongs to, and the strip is the one place with room for it at 340px. */}
      <header className="w-top">
        <span className="w-title">oc-dash</span>
      </header>

      <section className="w-hero" aria-label="Total cost">
        {/* A dash is not money: it stays dim so it cannot be read as a
            figure, let alone a green one. The cost carries the gap in its
            tooltip, which is one of the three places it is reachable from. */}
        <div className="w-hero-value">
          {/* The gap rides on the FIGURE, not on the row around it. The
              annotation says "hero value", and the design artifact put the title on
              the element that holds the number too; putting it on the wrapper
              would make the hover target wider than the thing it describes. */}
          <span className={`w-hero-num${hero.exact ? "" : " dim"}`} title={gapSentence ?? undefined}>
            {hero.cost}
          </span>
          {/* Annotation 2: the stat strip sits to the RIGHT of
              the cost number, on the same row. */}
          {stats ? (
            <span className="w-stats">
              <span className="w-stat">
                <b>{stats.tokens}</b> tokens
              </span>
              <span className="w-stat">
                <b>{stats.sessions}</b> sessions
              </span>
              <span className="w-stat">
                <b>{stats.subagents}</b> subagents
              </span>
            </span>
          ) : (
            <span className="w-stats dim">
              {state.loading ? "loading…" : "no stats totals"}
            </span>
          )}
        </div>
        {hero.degraded && <div className="w-note warn">stats unavailable ({hero.reason})</div>}
      </section>

      <section aria-label="Sessions">
        {/* Annotation 4: the sessions section head is gone from the flow, and
            with it the range label under the hero. The row-cut count stays ON
            SCREEN in the table's own header line, because a count nobody can
            see is a count that does not exist; the window and the basis move
            into that cell's title. */}
        {!sessionRows.exact ? (
          <p className="w-empty">{state.loading ? "Loading sessions…" : "Sessions unavailable."}</p>
        ) : sessionRows.rows.length === 0 ? (
          <p className="w-empty">No sessions in this range.</p>
        ) : (
          <table className="w-table">
            <thead>
              <tr>
                <th title={sessionsTitle}>
                  Session
                  {sessionRows.remaining > 0 && (
                    <span className="w-cut"> +{sessionRows.remaining} more</span>
                  )}
                </th>
                <th className="num">Cost</th>
                <th className="num">Tokens</th>
              </tr>
            </thead>
            <tbody>
              {sessionRows.rows.map((r) => (
                <SessionRow key={r.id} row={r} />
              ))}
            </tbody>
          </table>
        )}
        {/* Both the count and the truncation flag are exact: how many root
            sessions the panel left out, and whether the server's walk hit
            its 50-page cap, in which case the list itself is incomplete
            and a count of what is missing would be a guess. */}
        {sessionRows.truncated && (
          <p className="w-note warn">list truncated — older sessions may be missing</p>
        )}
      </section>

      <section aria-label="Models">
        {/* Annotation 5: same shape here. The share denominator was the third
            fact the two heads carried between them, and it moves into the
            MODEL header cell's title rather than back onto the screen. */}
        {!models.exact ? (
          <p className="w-empty">No model totals.</p>
        ) : models.rows.length === 0 ? (
          <p className="w-empty">No model usage in this range.</p>
        ) : (
          <table className="w-table">
            <thead>
              <tr>
                <th title={MODELS_HEAD_TITLE}>
                  Model
                  {models.remaining > 0 && <span className="w-cut"> +{models.remaining} more</span>}
                </th>
                <th className="num">Cost</th>
                <th className="num">Share</th>
              </tr>
            </thead>
            <tbody>
              {models.rows.map((m) => (
                <ModelRow key={m.key} row={m} />
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* The two controls the panel offers when the dashboard does
          not answer, and NOTHING at all when it does — `offline` is null from
          the moment a fetch lands, so there is no button to press and nothing to
          emit in the state where a start would be wrong.

          Its own row, above the footnote, for the reasons on `.w-actions`: the
          bar is 320px wide and already holds the status sentence and Quit, and
          the offline panel is 240.84px short of 420 with this row in it. */}
      {offline && (
        <div className="w-actions">
          {/* "Try again" is the panel's re-fetch with no ceremony: one press runs the
              panel's own fetch on the range it is already showing. It has no arm
              because it has nothing to spoil — nothing outside this page moves —
              and it has no "checking…" label either, because the panel already
              ruled that out for itself: `widgetRefreshText` suppresses the
              timestamp on a rejected fetch rather than narrate the attempt, and a
              label that flickered for the 80ms a refused connection takes would
              be the same error one level up.

              A real `<button type="button">` for the same reason as the quit
              control: in the tab order,
              Space and Enter activate it, no key handling added here. */}
          <button
            type="button"
            className="w-retry"
            aria-label={offline.retry.ariaLabel}
            onClick={retry}
          >
            {offline.retry.label}
          </button>

          {/* The spawn. Same ceremony as the quit control and a shorter window:
              arm, then send, never on the first press. `aria-live` on the button
              and not on a second region beside it, because the state change IS
              this element's own accessible name changing, which is what
              VoiceOver reads and what a screen reader announces from anywhere
              else on the panel would say twice.

              `aria-disabled` rather than `disabled` in the sent phase, for the
              quit control's
              reason: the state the reader most needs to hear about is the one
              `disabled` would silence. The press is a no-op anyway, because
              `widgetStartPress` hands a sent state back untouched and
              `widgetStartSends` is false from it.

              Disarm on pointer-out, not on blur, for the quit control's
              reason: blur fires
              when a keyboard user tabs away, which is what they must be able to
              do to press it a second time. */}
          <button
            type="button"
            className={`w-start${offline.start.armed ? " is-armed" : ""}${
              offline.start.sent ? " is-sent" : ""
            }`}
            aria-label={offline.start.ariaLabel}
            aria-live="polite"
            aria-disabled={offline.start.disabled || undefined}
            onClick={pressStart}
            onPointerLeave={disarmStart}
          >
            {offline.start.label}
          </button>
        </div>
      )}

      {/* The clause that used to sit here read "The hero
          and the session rows are measured differently, so they can
          differ". It replaced a worse sentence naming
          compaction as the one cause, and it was the right next step for the
          wrong reason: it cannot be wrong about the number above it,
          but it also cannot be checked against it. The gap is computed
          exactly and named in three `title` attributes (hero value, sessions
          header cell, and this footnote), so this sentence would be the panel
          describing in 9px what
          it has already measured in money.

          What stays is the unpriced-provider clause, which the dashboard's
          footnote has and this one did not, and which the live data made
          concrete: the only model in the
          summary payload burns 1,134,924 tokens at a cost of zero. It
          prints only when the payload really carries such a model, and it
          says what an unpriced model IS rather than claiming it is the
          reason the two figures disagree, because in that data it is not
          the whole reason and the gap exists to say so numerically. */}
      {/* The footnote kept its own element, its own class and
          its own words, and the footer is a sibling above it rather than a
          wrapper around it, so nothing about the footnote's wording changed. Its
          `title` still carries the gap sentence. */}
      <footer className="w-foot dim" title={gapSentence ?? undefined}>
        List-price estimates.
        {models.anyUnpriced && " Unpriced models burn tokens at no cost."}
        {!state.loaded && " loading…"}
        {/* The one-run surface diagnostic, and only when
            `?surface=1` asked for it. The page cannot see the popover window,
            so this line deliberately reports the page's own half and names the
            half a shell log line has to answer. */}
        {surface && ` ${surface}`}
      </footer>

      {/* The quit row. Refresh on the left, the control on the
          right, and nothing else in it. */}
      <div className="w-bar">
        {/* The timestamp's new home, and after a request is sent
            the one honest sentence about it. The request state takes the slot
            over rather than appearing beside the timestamp, because a panel
            showing "updated 4s ago" next to "quit requested" invites the
            reading that the app is still running happily, which is a claim
            about a process this page cannot see either way. */}
        {/* `--text` rather than `--dim` in the sent state, so the one line that
            says "something happened and it may not have worked" is not the
            quietest ink on the panel. Both tokens are ones the contrast sweep
            already
            measured at this size.

            The same takeover applies to the start request, and the same
            `is-sent` ink, rather than a third thing in this slot. While a start
            is outstanding the slot says so INSTEAD of "dashboard unreachable",
            because the outstanding request is the fact that matters and printing
            both would put two claims about the dashboard in the one place the
            panel has for making one. Quit wins if both are somehow sent: a panel
            whose app is on its way out has nothing left to start. */}
        <span
          className={`w-updated dim${quitView.sent || offline?.start.sent ? " is-sent" : ""}`}
        >
          {quitView.sent
            ? WIDGET_QUIT_SENT_TEXT
            : offline?.start.sent
              ? WIDGET_START_SENT_TEXT
              : refreshText}
        </span>

        {/* A real `<button type="button">`, so it is in the tab order and
            Space/Enter activate it with no key handling of any kind added here.
            Measured: it is the fifth tab stop on the panel, after the four range
            segments, and reachable with Tab alone.

            `aria-label` rather than `aria-describedby`: the label is the state
            ("Confirm quit") and the sentence a screen reader needs to know that
            pressing it again ends the app, and that the app then has to be
            relaunched by hand, is not something a 43px label can carry.

            `aria-live="polite"` ON THE BUTTON, and not a separate status region
            beside it. The state change IS this element's own accessible name
            changing, so announcing it from the element the reader is already on
            is what VoiceOver reads, and a second live region would say the same
            thing twice. It has to be the button rather than the footer text
            because the footer's left slot is also where the timestamp lives, and
            a live region that re-announced "updated 4m ago" every thirty seconds
            would be worse than no announcement at all.

            `aria-disabled` rather than `disabled` in the sent phase: `disabled`
            takes the control out of the tab order and stops several screen
            readers announcing name changes on it, so the state the reader most
            needs to hear is the one that would go quiet. The press is a no-op
            anyway, because widgetQuitPress returns a sent state untouched.

            Disarm on pointer-out, not on blur. Blur fires when the reader tabs
            away, which would kill the confirmation for exactly the keyboard user
            the real `<button>` was added for: moving focus is what they must do
            to press it a second time. The pointer is the case that needs the
            guard, because leaving with the mouse is the sequence that produces a
            stray confirm, and the arm window already covers the walk-away case. */}
        <button
          type="button"
          className={`w-quit${quitView.armed ? " is-armed" : ""}${quitView.sent ? " is-sent" : ""}`}
          aria-label={quitView.ariaLabel}
          aria-live="polite"
          aria-disabled={quitView.disabled || undefined}
          onClick={pressQuit}
          onPointerLeave={disarmQuit}
        >
          {quitView.label}
        </button>
      </div>
    </div>
  )
}

/**
 * Two fields on one line: the project, then the session's own title. The
 * title attribute carries the full title, which 340px cannot show inline.
 */
function SessionRow({ row }: { row: WidgetSessionRow }) {
  return (
    <tr>
      <td className="w-label" title={row.title}>
        <span className="w-project">{row.project}</span>
        <span className="w-sub">{row.title}</span>
      </td>
      <td className="num">{row.costText}</td>
      <td className="num">{row.tokensText}</td>
    </tr>
  )
}

/**
 * The share cell's tint is the bar; the percentage beside it is the value.
 * Both come from widget.ts, which computes the share over every model row
 * in the payload rather than the ones that fit.
 */
function ModelRow({ row }: { row: WidgetModelRow }) {
  return (
    <tr>
      <td className="w-label model" title={row.full}>
        <span className="w-project">{row.name}</span>
        {row.unpriced && <span className="w-chip warn">unpriced</span>}
      </td>
      <td className="num">{row.costText}</td>
      <td className="num w-share" style={{ "--share": `${row.sharePct}%` } as React.CSSProperties}>
        {row.shareText}
      </td>
    </tr>
  )
}
