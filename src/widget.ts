import type {
  ModelNames,
  Range,
  SessionInfo,
  SessionsPayload,
  SummaryResponse,
} from "./api"
import { fmtInt, fmtTokens, relTime } from "./format"
import { modelDisplayName } from "./filters"
import { kpisFromStats, modelRows, rangeLabel, type ModelRow } from "./summary"
import { buildTree, type SessionNode } from "./tree"

/**
 * The pure view model behind the compact menu bar widget.
 *
 * Everything the 340x420 panel renders is derived here, so the numbers are
 * pinned by ordinary vitest tests in the node environment (no DOM) and the
 * component stays presentational, the same split the rest of the project
 * uses. The rules below are the project exactness rule applied at panel
 * size: a degraded or missing payload yields a dash and no rows, never the
 * last good figure; a figure whose basis differs from the hero is labelled
 * where it is shown; where the two figures disagree, the disagreement is
 * measured exactly and reachable on hover; a truncated list says how much
 * it left out and says that the list itself is incomplete; a column of
 * percentages adds up to the number it claims.
 *
 * The range selector brought three things with it. All three are
 * here rather than in the component, because each is a rule with a wrong
 * answer rather than a matter of taste: `widgetAtRange`, which is where the
 * exactness rule lives now that the hero's range label is gone; `fmtMoney`,
 * the panel's own money formatter, which the dashboard deliberately does not
 * share; and the selector's strings, so the segment labels and the sessions
 * header tooltip are pinned by tests rather than by a screenshot.
 *
 * The footer took the timestamp off the top strip and
 * put it in one place: `widgetRefreshText` is now the only thing that decides
 * how the panel says when it last refreshed, and `WIDGET_QUIT_URL` is the one
 * string the shell has to match to let the page ask for a quit. The arm, its
 * expiry and the sentence that refuses to claim an unobservable quit are here
 * for the same reason as everything above: the project's tests run in node
 * with no DOM, so a rule that lives only in the component is a rule nothing
 * can check.
 *
 * The offline path is the first thing the panel offers
 * that needs a shell to do anything. `WIDGET_START_URL` is the second verb the
 * shell has to match, the spawn control reuses the quit control's arm-then-send
 * ceremony with
 * a shorter window because a wrong start is not a wrong quit, and
 * `widgetOfflineActions` is where the panel's own limit is written down: it can
 * see that the dashboard did not answer and it cannot see why, so it offers a
 * re-fetch and a start side by side and lets the reader pick.
 */

/** The panel's poll cadence: the project convention (App.tsx's POLL_MS). */
export const WIDGET_POLL_MS = 30_000

/** Rows each table shows before it reports the rest. */
export const WIDGET_SESSION_ROWS = 4
export const WIDGET_MODEL_ROWS = 4

// ---------------------------------------------------------------------------
// Money, the panel's own formatter
// ---------------------------------------------------------------------------

const PANEL_USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/**
 * USD for the panel: always two decimals, with `<$0.01` for a real amount
 * under a cent.
 *
 * This is deliberately NOT `fmtUSD` in `src/format.ts`, which switches to four
 * decimals below $1 and is shared with the full dashboard. The panel formats
 * its own money, and the two disagree on a sub-cent figure on purpose:
 * whether the two surfaces should be unified is an open decision, not an
 * oversight.
 *
 * The bound is the part that matters. Capping at two decimals on its own would
 * turn a real $0.0001 into "$0.00", which reads as free, and that is the exact
 * defect this bound exists to prevent. So a non-zero amount under a
 * cent prints `<$0.01`, a bound and not a claim, and a genuine zero still
 * prints `$0.00` — which is how a reader can tell a free session from a
 * sub-cent one, and the reason the distinction has to survive the cap.
 *
 * `<$0.01` is one character shorter than the `$0.4454` it replaces, so the cap
 * narrows the money column rather than widening it (measured: 66px, unclipped).
 */
export function fmtMoney(n: number): string {
  if (!Number.isFinite(n)) return "—"
  const abs = Math.abs(n)
  // `n === 0` rather than `abs < 0.01`, so a genuine zero and Intl's "-$0.00"
  // for a negative zero both land on "$0.00".
  if (n === 0) return "$0.00"
  if (abs < 0.01) return n < 0 ? "<-$0.01" : "<$0.01"
  return PANEL_USD.format(n)
}

// ---------------------------------------------------------------------------
// The range selector and the payload it labels: one piece of state
// ---------------------------------------------------------------------------

/** Segment order, left to right, the order macOS shows a range control in. */
export const WIDGET_RANGES: readonly Range[] = ["today", "7d", "30d", "all"]

/**
 * The four segment labels. Fixed strings rather than `rangeLabel`, because
 * `rangeLabel` is the long form ("last 30 days") for prose and these have to
 * fit four across a 320px content box.
 */
export const WIDGET_RANGE_LABELS: Record<Range, string> = {
  today: "Today",
  "7d": "7 Days",
  "30d": "30 Days",
  all: "All",
}

/**
 * Where the selected range is kept across a popover close.
 *
 * `localStorage`, one key of its own. The dashboard already persists the theme
 * choice there (`src/theme.ts`), so the panel is not introducing a new storage
 * dependency, only a new key: `oc-dash:widget-range`, and the panel reads
 * nothing else. Module state was not an option, because the webview is
 * rebuilt when the popover closes and a naive `useState("today")` would
 * silently reset the user's choice; the query string is not one either,
 * because the shell owns the URL.
 */
export const WIDGET_RANGE_KEY = "oc-dash:widget-range"

/**
 * The stored range, or null when nothing usable is stored.
 *
 * Null rather than a fallback to `today`, so the component can tell "the
 * user has never chosen" from "the user chose today" and leave the
 * selector on today either way. A tampered or stale value lands on null
 * instead of stranding the panel on a range the payload does not carry.
 */
export function widgetRangeFrom(raw: string | null | undefined): Range | null {
  return WIDGET_RANGES.includes(raw as Range) ? (raw as Range) : null
}

/**
 * `window.localStorage`, or null when there is no window or storage is
 * blocked on access. Copied in shape from theme.ts's `browserStorage`, because
 * the panel must not import the dashboard's module to read one value: the two
 * surfaces share no code by design (see widget.css's header).
 */
export function widgetStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage
  } catch {
    return null
  }
}

export function readWidgetRange(
  storage: Pick<Storage, "getItem"> | null | undefined,
): Range | null {
  if (!storage) return null
  try {
    return widgetRangeFrom(storage.getItem(WIDGET_RANGE_KEY))
  } catch {
    return null
  }
}

/** Persist the choice; blocked or full storage keeps it live for the session. */
export function persistWidgetRange(
  storage: Pick<Storage, "setItem"> | null | undefined,
  range: Range,
): void {
  if (!storage) return
  try {
    storage.setItem(WIDGET_RANGE_KEY, range)
  } catch {
    // Storage unavailable: the panel is already showing the new range.
  }
}

/**
 * The surface diagnostic, and the honest limit of what a page can
 * say about it.
 *
 * The question this exists for is why the panel looks solid, and the answer
 * is not knowable from here. Whether the popover window is painting its own
 * ground is a fact
 * about an `NSWindow`, and no page-side API reaches it: there is no bridge in
 * `window`, `navigator.getDisplayMedia` is not exposed to a WKWebView, and
 * reading the page's own composited pixels is impossible because
 * `drawImage(document.body)` throws. This was measured, not assumed. So this
 * function deliberately reports what the page CAN establish and names the one
 * fact it cannot, rather than printing a guess that would read as an answer.
 *
 * What it can establish is still worth one run, because each of these is a
 * precondition for the alpha change having any visible effect at all:
 *
 * - `view` and `page`: the webview's own size against the page's own painted
 *   ground. If `.widget` is not the full webview there is a page-drawn edge
 *   inside the popover, which is the other half of the complaint.
 * - `glass`: the alpha actually in force, read from the computed style rather
 *   than from the file, so a stale bundle is visible as a stale number.
 * - `bdf`: whether `backdrop-filter` survived the engine AND what it computed
 *   to. `active` with a transparent page means it is sampling an empty backdrop
 *   and the blur is inert, which is the expected state and is worth stating
 *   rather than leaving implied.
 */
export interface WidgetSurfaceFacts {
  /** The webview's own size, in CSS pixels. */
  view: [number, number]
  /** `.widget`'s painted box: x, y, width, height. */
  page: [number, number, number, number]
  /** `.widget`'s computed background, verbatim, so the alpha is readable. */
  glass: string
  /** `backdrop-filter`'s computed value, or "none" if the engine dropped it. */
  bdf: string
  /** True when the engine supports the prefixed spelling too. */
  prefixed: boolean
  /** `.widget`'s computed `border-radius`, which must be 0px for one surface. */
  radius: string
}

/** Reads the facts above. Null outside a browser, like `widgetStorage()`. */
export function widgetSurfaceFacts(): WidgetSurfaceFacts | null {
  if (typeof document === "undefined" || typeof window === "undefined") return null
  const el = document.querySelector(".widget")
  if (!el) return null
  const cs = getComputedStyle(el)
  const r = el.getBoundingClientRect()
  const px = (n: number) => Math.round(n * 100) / 100
  // widget.css ships the prefixed declaration too, and the panel runs in a
  // WKWebView, so the prefixed spelling is the one that can be live there. It
  // is absent from the DOM lib's CSSStyleDeclaration, hence the cast; reading
  // it is the point rather than an optimisation.
  const prefixedValue = (cs as unknown as Record<string, string>).webkitBackdropFilter
  return {
    view: [window.innerWidth, window.innerHeight],
    page: [px(r.x), px(r.y), px(r.width), px(r.height)],
    glass: cs.backgroundColor,
    bdf: cs.backdropFilter || prefixedValue || "none",
    prefixed: typeof CSS !== "undefined" && CSS.supports("-webkit-backdrop-filter", "blur(1px)"),
    radius: cs.borderTopLeftRadius,
  }
}

/**
 * The one line, for the panel's footer when the surface diagnostic is asked
 * for. `window=` is the fact this page cannot reach, and it is printed as
 * `unreadable-here` on purpose: a shell log line has to answer it, and a reader
 * comparing the two needs to know which half came from where.
 */
export function widgetSurfaceLine(f: WidgetSurfaceFacts | null): string {
  if (!f) return "surface: no document"
  const [vx, vy] = f.view
  const [px, py, pw, ph] = f.page
  return (
    `surface: page ${pw}x${ph} at ${px},${py} in a ${vx}x${vy} webview · ` +
    `glass ${f.glass} · backdrop-filter ${f.bdf}` +
    `${f.prefixed ? " (prefixed supported)" : " (prefixed unsupported)"} · ` +
    `radius ${f.radius} · popover window isOpaque unreadable-here`
  )
}

/**
 * The diagnostic is opt-in through the query string, which the shell already
 * owns: `Config.resolvedWidgetURL` reads `OC_DASHBAR_URL`, so it can be turned
 * on by pointing that at `.../widget?surface=1` with no code change and no
 * rebuild. Off by default so the shipped panel is unchanged.
 */
export function widgetSurfaceRequested(search: string | null | undefined): boolean {
  if (!search) return false
  try {
    return new URLSearchParams(search).get("surface") === "1"
  } catch {
    return false
  }
}

export interface WidgetRangeState {
  /** The range the selector is on. */
  range: Range
  summary: SummaryResponse | null
  sessions: SessionsPayload | null
}

/**
 * The payloads the panel may render for `state.range`, either one of them
 * nulled out when it is not that range's own.
 *
 * This is where the exactness rule now lives. It used to be enforced by the
 * hero's range label, which took the preset off the payload that fed the
 * number, so a figure could never sit under another range's name. That label
 * is gone, because the selector already names the range, so the
 * guarantee had to move into the code and this is it: both payloads are
 * checked against the payload's OWN `range.preset`, which the server resolves
 * and echoes, not against the string the selector happens to be showing.
 *
 * The failure it prevents is concrete. A range change drops the previous
 * payload's rows in the same render that moves the selector, so the panel
 * never shows today's rows under "Last 30 days"; and a fetch that resolved
 * out of order cannot leave one range's numbers under another range's name,
 * because a mismatched pair renders as a dash rather than as a figure. What
 * the panel loses in that case is the figure, which is the right thing to
 * lose.
 */
export function widgetAtRange(state: WidgetRangeState): {
  summary: SummaryResponse | null
  sessions: SessionsPayload | null
} {
  return {
    summary:
      state.summary && state.summary.range.preset === state.range ? state.summary : null,
    sessions:
      state.sessions && state.sessions.range.preset === state.range ? state.sessions : null,
  }
}

// ---------------------------------------------------------------------------
// Hero: the window's money, the one number the panel exists to show
// ---------------------------------------------------------------------------

export interface WidgetHero {
  /** fmtMoney of the stats total, or "—" when no healthy payload is on screen. */
  cost: string
  /**
   * True only when a healthy payload produced `cost`. The component uses
   * it to stop printing the dash in the money colour, where at 27px it
   * reads as a green rule rather than as an absent value.
   */
  exact: boolean
  /** The payload answered but with degraded: true. */
  degraded: boolean
  reason: string | null
}

/**
 * The headline. There is no range label on it any more: the selector names the
 * range, and `widgetAtRange` is what stops a figure from being read as another
 * range's. A degraded payload — or none at all — gives a dash, so a failure
 * never leaves yesterday's figure sitting under today's selector.
 */
export function widgetHero(summary: SummaryResponse | null): WidgetHero {
  if (summary && !summary.degraded) {
    return {
      cost: fmtMoney(summary.data.cost),
      exact: true,
      degraded: false,
      reason: null,
    }
  }
  return {
    cost: "—",
    exact: false,
    degraded: Boolean(summary?.degraded),
    reason: summary?.degraded ? summary.reason : null,
  }
}

// ---------------------------------------------------------------------------
// Stat strip: the rest of the stats totals, same payload, same basis
// ---------------------------------------------------------------------------

export interface WidgetStats {
  tokens: string
  sessions: string
  subagents: string
}

/**
 * The compact strip under the hero. Null when no healthy payload is on
 * screen: the component then drops the strip instead of printing a row of
 * stale numbers beside a dashed hero.
 *
 * Three fields, not five. Prompts and steps were computed here but rendered
 * by nothing; at 340px they would have cost width
 * the money columns need, so they went with the fix rather than staying as
 * dead weight the only test kept alive.
 */
export function widgetStats(summary: SummaryResponse | null): WidgetStats | null {
  if (!summary || summary.degraded) return null
  const k = kpisFromStats(summary.data)
  return {
    tokens: fmtTokens(k.tokens),
    sessions: fmtInt(k.sessions),
    subagents: fmtInt(k.subagents),
  }
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface WidgetSessionRow {
  id: string
  /** The project's basename — the same label the dashboard's filter shows. */
  project: string
  /** The session's own title, verbatim, for the second line. */
  title: string
  /** own cost plus every descendant's, matching the dashboard's rollup. */
  cost: number
  tokens: number
  costText: string
  tokensText: string
  subagents: number
}

export interface WidgetSessions {
  rows: WidgetSessionRow[]
  /** Root sessions not shown because the panel is out of room. */
  remaining: number
  /** The server's walk hit its 50-page cap: the list is incomplete. */
  truncated: boolean
  /**
   * False when there is no sessions payload on screen, which is also what a
   * rejected fetch leaves behind. The component needs this to tell an empty
   * table (the server answered, there is nothing in the window) from an
   * unread one (nothing is known), which is WidgetModels.exact's job on the
   * other table. Without it a failed fetch prints a sentence about the
   * user's day that the panel has no basis for.
   */
  exact: boolean
  /**
   * The rolled-up cost of EVERY root the payload carries, the rows on
   * screen and the ones the panel left out. This is the session-list
   * figure, and it is the whole payload's sum for the same reason
   * WidgetModels.total is the whole payload's sum: a difference taken from
   * the four rows that happened to fit would be a claim about a list the
   * panel never finished reading. `remaining > 0` therefore costs this
   * figure nothing, and only `truncated` does.
   */
  total: number
}

/**
 * The project's basename, the short label the dashboard's project filter
 * already uses. A session with no directory shows a dash rather than an
 * invented name.
 */
export function projectLabel(session: SessionInfo): string {
  const dir = session.location?.directory
  if (!dir) return "—"
  return dir.split("/").pop() || dir
}

/**
 * The top sessions by rolled-up cost.
 *
 * Roots only: subagent sessions roll up into their parents, and at 340px
 * there is no room for a nested tree. Each
 * row therefore shows `inclCost`/`inclTokens` — own plus every descendant —
 * and the sessions table's header cell names the two things that makes true,
 * in a tooltip: the rows are the sessions TOUCHED in the window, and the money
 * beside each one is that session's total, not the window's share of it.
 * (The head used to say "top by cost" under a hero labelled
 * "Total cost · today", which reads as though the top row were today's largest
 * spender. It is the largest spender ever, among the sessions touched today,
 * and that reading was measured wrong on a real machine.
 * The head itself is gone now, and so is the label that named the
 * window — the selector names it now and `sessionsHeadTitle` names it again
 * for anyone who asks.)
 *
 * Ordering is rolled-up cost descending, then tokens, then most recently
 * updated, so the tiebreak never depends on the walk's input order.
 */
export function widgetSessions(
  sessions: SessionsPayload | null,
  limit: number = WIDGET_SESSION_ROWS,
): WidgetSessions {
  if (!sessions) return { rows: [], remaining: 0, truncated: false, exact: false, total: 0 }
  const nodes = buildTree(sessions.data)
  const total = nodes.reduce((acc, n) => acc + n.inclCost, 0)
  const top = [...nodes]
    .sort(
      (a, b) =>
        b.inclCost - a.inclCost ||
        b.inclTokens - a.inclTokens ||
        (b.session.time?.updated ?? 0) - (a.session.time?.updated ?? 0),
    )
    .slice(0, Math.max(0, limit))
  return {
    rows: top.map((n) => toSessionRow(n)),
    remaining: Math.max(0, nodes.length - top.length),
    truncated: sessions.truncated,
    exact: true,
    total,
  }
}

function toSessionRow(n: SessionNode): WidgetSessionRow {
  const s = n.session
  return {
    id: s.id,
    project: projectLabel(s),
    title: s.title ?? "(untitled)",
    cost: n.inclCost,
    tokens: n.inclTokens,
    costText: fmtMoney(n.inclCost),
    tokensText: fmtTokens(n.inclTokens),
    subagents: n.descendants,
  }
}

// ---------------------------------------------------------------------------
// The gap between the two figures, printed instead of described
// ---------------------------------------------------------------------------

export interface WidgetGap {
  /**
   * The session rollup minus the stats total: the same subtraction
   * FilterSummaryCard does, where it is called the compaction gap. Signed,
   * so which figure is bigger is a fact here rather than an inference from
   * the wording.
   */
  delta: number
  /** |delta| through fmtMoney: the number the panel names on hover. */
  amountText: string
  /** Which of the two figures carries the difference. */
  higher: "rows" | "hero"
  /** The words after the number, so the component stays presentational. */
  where: string
  /** Both figures as the panel prints money, for the line's tooltip. */
  rowsText: string
  heroText: string
}

/**
 * The difference between the hero and the session rollup, or null when
 * there is nothing honest to print.
 *
 * The panel's hero and its session table are measured differently, and the
 * panel used to say so in words: the old footnote read "measured
 * differently, so they can differ", which cannot be wrong about the number
 * above it and therefore teaches the reader nothing they could not already
 * see. FilterSummaryCard on the dashboard prints the same difference as a
 * number, and this is that number. It is a subtraction of two figures the
 * panel already displays, so the one thing it can be is wrong about is the
 * arithmetic, and the arithmetic is pinned by tests.
 *
 * The gap no longer takes a line of its
 * own. It is still computed, exactly as before, and `gapTitle` still names
 * both figures it subtracted; it is reachable in three
 * `title` attributes and nowhere else. A reader who never hovers sees a panel
 * that does not mention its own disagreement, which is a deliberate reversal
 * and is recorded as one rather than dressed up.
 *
 * Four cases print nothing, each for a different reason:
 *
 * - No summary, or a degraded one. The hero is a dash; a difference
 *   between a dash and a figure is not a gap.
 * - No sessions payload, so there is no row figure to compare with.
 * - A truncated walk. The row total is then a partial sum and the
 *   difference is an artefact of the walk having stopped, so it would be
 *   printed as a gap between two figures when one of them is a floor. The
 *   truncation warning underneath the table says what is actually true.
 * - The two figures agreeing. Then there is no gap, and the panel says
 *   nothing rather than printing $0.00 where the reader can already see
 *   the agreement.
 *
 * `remaining > 0` does NOT suppress it: `WidgetSessions.total` is the sum
 * over every root in the payload, so the four rows the panel had room for
 * do not change what is being compared. That is the difference between a
 * cut and a changed denominator, and it is the same rule sharePercents
 * already follows on the models table.
 */
export function widgetGap(
  summary: SummaryResponse | null,
  sessions: WidgetSessions,
): WidgetGap | null {
  if (!summary || summary.degraded) return null
  if (!sessions.exact) return null
  if (sessions.truncated) return null
  const heroCost = summary.data.cost
  const rowCost = sessions.total
  if (!Number.isFinite(heroCost) || !Number.isFinite(rowCost)) return null
  const delta = rowCost - heroCost
  if (delta === 0) return null
  return {
    delta,
    amountText: fmtMoney(Math.abs(delta)),
    higher: delta > 0 ? "rows" : "hero",
    where:
      delta > 0 ? "in session rows, not in the hero" : "in the hero, not in session rows",
    rowsText: fmtMoney(rowCost),
    heroText: fmtMoney(heroCost),
  }
}

/**
 * The gap as one sentence, or null when there is no gap.
 *
 * This is the whole of the gap's presence on screen. The line was
 * removed, so the figure survives only here, and the component hands
 * the result to three `title` attributes: the hero value, the sessions header
 * cell, and the footnote. Three places rather than one because two of them
 * were asked for and the sessions header cell turned out to be the
 * natural home for all three facts it absorbed when the head was cut.
 *
 * The sentence names both operands as well as the difference, because a
 * difference on its own is a number the reader has nowhere to check it
 * against.
 */
export function gapTitle(gap: WidgetGap | null): string | null {
  if (!gap) return null
  return `${gap.amountText} ${gap.where} · session rows ${gap.rowsText} minus stats total ${gap.heroText}`
}

/**
 * The sessions table's header cell tooltip: the window and the basis, plus
 * the gap when there is one.
 *
 * The reading it prevents: "top by cost" sat under a hero labelled "Total
 * cost · today", so
 * the top row read as today's largest spender. It is the largest spender ever,
 * among the sessions touched in the window, each priced by that session's own
 * total. `rangeLabel` is the same source the hero used before the label was
 * removed, so the window is named in the panel's own words rather than a
 * second set of them.
 */
export function sessionsHeadTitle(range: Range, gap: WidgetGap | null): string {
  const basis = `sessions touched ${rangeLabel(range)} · each row is that session's own total, not the window's share of it`
  const g = gapTitle(gap)
  return g ? `${basis} · ${g}` : basis
}

/**
 * The models table's header cell tooltip: the share denominator, which the cut
 * section head used to carry on screen.
 *
 * It has to name "the whole payload" and not just the rows shown, because
 * `sharePercents` allocates over every model row before the cut, so a share
 * next to a row the panel left out is a share of something other than what the
 * reader can see.
 */
export const MODELS_HEAD_TITLE =
  "share of model cost · every row's share is of the whole payload, not just the four shown"

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

export interface WidgetModelRow {
  /** "providerID/id · variant" — stable across name-map updates. */
  key: string
  /** The /api/model display name, or the project's short-id fallback. */
  name: string
  /** The raw providerID/id · variant, for the row's hover title. */
  full: string
  /** tokens > 0 with cost 0: the provider is unpriced, not free. */
  unpriced: boolean
  cost: number
  costText: string
  shareText: string
  /** 0..100, one decimal, the width of the share bar. */
  sharePct: number
}

export interface WidgetModels {
  rows: WidgetModelRow[]
  /** Model rows not shown because the panel is out of room. */
  remaining: number
  /** The cost of EVERY model row in the payload — the share denominator. */
  total: number
  /**
   * The payload carries at least one model flagged unpriced, whether or not
   * that row is one of the four the panel had room for. The footer names
   * the condition only when it is really in the data, and a
   * clause that could print about a model the reader cannot see is a
   * worse claim than no clause at all.
   */
  anyUnpriced: boolean
  /** False when no healthy payload is on screen: no row, no share. */
  exact: boolean
}

/**
 * Every row's share of `total`, as percentages to one decimal, summing to
 * exactly 100 across the whole list.
 *
 * Largest-remainder allocation, not per-row rounding. Rounding each share
 * independently makes six equal-cost models print six 16.7% cells that add
 * to 100.2%, and a column of percentages that does not add up is a
 * contradiction the reader can see. So each share is first floored to a
 * tenth of a percent, and the tenths that flooring gave away are handed to
 * the rows with the largest remainder, one tenth each, ties broken by
 * payload order so the result never depends on the walk's input order.
 *
 * The allocation runs over EVERY row the payload carries, not the rows the
 * panel has room for, so the denominator stays "every payload row" and a
 * truncated table still shows each shown row's true share. The rows that
 * are not shown consume their tenths, which is why the visible column sums
 * to 100 only when the list is complete.
 *
 * A non-positive or non-finite total has no share to give, so every share
 * is 0 rather than a division.
 */
export function sharePercents(costs: number[], total: number): number[] {
  const n = costs.length
  if (n === 0) return []
  const finiteTotal = Number.isFinite(total) && total > 0
  // Tenths of a percent, which is the unit the whole allocation works in.
  const tenths = costs.map((c) =>
    finiteTotal && Number.isFinite(c) && c > 0 ? (c / total) * 1000 : 0,
  )
  const out = tenths.map((t) => Math.floor(t))
  // Only a row with something left over can take a tenth. A row whose
  // exact share is already a whole tenth does not need one, and a row that
  // spent nothing has nothing to divide and must not collect one: its
  // share cell is the em-dash, and a tenth there would be a share of money
  // that was never spent.
  const eligible = tenths
    .map((t, i) => ({ i, rest: t - out[i] }))
    .filter((e) => e.rest > 0)
    .sort((a, b) => b.rest - a.rest || a.i - b.i)
  let left = 1000 - out.reduce((a, b) => a + b, 0)
  // The sum of the exact shares is 1000 tenths, so the leftover is always
  // smaller than the number of eligible rows. The clamp is float insurance
  // on a division, not a rule the arithmetic needs.
  left = Math.max(0, Math.min(left, eligible.length))
  for (const e of eligible) {
    if (left <= 0) break
    out[e.i] += 1
    left -= 1
  }
  return out.map((t) => t / 10)
}

/**
 * The share as shown: "62%", "7.5%", "—", or "<0.1%".
 *
 * The em-dash means one thing only: this model had no money to divide. A
 * model that spent $0.50 of $13,446.16 is 0.0037%, which no one-decimal
 * share can print, and it used to print the same em-dash as a model that
 * spent nothing at all. `spent` separates the two: real money too small to
 * round becomes "<0.1%", which is a bound and not a claim. It also guards
 * the invariant the allocator keeps, so a zero-cost row cannot print a
 * percentage even if that invariant is ever broken.
 */
export function shareText(pct: number, spent: boolean): string {
  if (!Number.isFinite(pct) || pct < 0 || !spent) return "—"
  if (pct === 0) return "<0.1%"
  const s = pct.toFixed(1)
  return `${s.endsWith(".0") ? s.slice(0, -2) : s}%`
}

/**
 * The top models by cost, with a share of the model-cost total.
 *
 * Ordering is the payload's own (summary.ts's modelRows is already
 * cost-descending, tokens as the tiebreak), so the panel shows the same
 * ranking the dashboard does.
 */
export function widgetModels(
  summary: SummaryResponse | null,
  names: ModelNames | undefined,
  limit: number = WIDGET_MODEL_ROWS,
): WidgetModels {
  if (!summary || summary.degraded) {
    return { rows: [], remaining: 0, total: 0, anyUnpriced: false, exact: false }
  }
  const all = modelRows(summary.data)
  const total = all.reduce((acc, m) => acc + m.cost, 0)
  // Every row gets its share before the list is cut, so the cut is a cut and
  // not a change of denominator.
  const shares = sharePercents(all.map((m) => m.cost), total)
  const top = all.slice(0, Math.max(0, limit))
  return {
    rows: top.map((m, i) => toModelRow(m, shares[i], names)),
    remaining: Math.max(0, all.length - top.length),
    total,
    anyUnpriced: all.some((m) => m.unpriced),
    exact: true,
  }
}

function toModelRow(m: ModelRow, sharePct: number, names?: ModelNames): WidgetModelRow {
  const base = `${m.providerID}/${m.id}`
  const variant = m.variant ? ` · ${m.variant}` : ""
  return {
    key: `${base}${variant}`,
    name: `${modelDisplayName(base, names)}${variant}`,
    full: `${base}${variant}`,
    unpriced: m.unpriced,
    cost: m.cost,
    costText: fmtMoney(m.cost),
    shareText: shareText(sharePct, m.cost > 0),
    sharePct,
  }
}

// ---------------------------------------------------------------------------
// The footer: when the numbers landed, and the only sentence that overrides it
// ---------------------------------------------------------------------------

/**
 * What the footer's left slot says.
 *
 * The timestamp lives here. It used to be on the top strip and the
 * panel had no other use for that corner, so it was printed in exactly one
 * place, which was correct. Then the footer arrived and the obvious thing to do
 * with it was to add the timestamp there as well, and a second copy of a
 * freshness claim is worse than none of them: the reader has no way to tell
 * which of the two is the live one, and the day they disagree one of them is a
 * lie. So the top strip gave it up and this function is now the only thing in
 * the project that decides how the panel says when it last refreshed.
 *
 * `unreachable` beats the timestamp, and it is not close. A rejected fetch still
 * stamps `updatedAt` (the panel is honest about having tried), so "updated just
 * now" above a dashed hero would be true about the request and false about the
 * numbers. The panel's whole exactness rule is about that distinction, so a
 * failed settle prints the failure and no time at all.
 *
 * Before the first settle settles, this prints nothing. There is no refresh to
 * report yet, and the footnote already says "loading…" in the same block.
 */
export function widgetRefreshText(opts: {
  /** `Date.now()` of the last settle, whatever its outcome, or null before one. */
  updatedAt: number | null
  /** True when either endpoint rejected on the last settle. */
  unreachable: boolean
  /** The clock to read `updatedAt` against, so this stays a pure function. */
  now: number
}): string {
  if (opts.unreachable) return "dashboard unreachable"
  if (opts.updatedAt === null) return ""
  return `updated ${relTime(opts.updatedAt, opts.now)}`
}

// ---------------------------------------------------------------------------
// The quit control: the one URL the panel hands the shell, and the arm that
// keeps a stray click from being one
// ---------------------------------------------------------------------------

/**
 * THE URL THE SHELL MUST INTERCEPT: `oc-dash://quit`.
 *
 * A page cannot terminate the process that hosts it. There is no API in a
 * WKWebView that reaches `NSApplication`, and the panel is served over http
 * from inside that same process, so a request the panel makes is a request the
 * app serves rather than one it obeys. So the panel emits the intent as a
 * navigation and the shell catches it. Everything there is to match is this one
 * constant:
 *
 *   scheme  "oc-dash"
 *   host    "quit"
 *   path    "" (empty)
 *
 * The shell's whole side is one case in
 * `WKNavigationDelegate.webView(_:decidePolicyFor:decisionHandler:)`: match those
 * two components, `decisionHandler(.cancel)`, terminate. The cancel is not
 * decoration. `.allow` would have WebKit try to load a scheme nothing handles,
 * which fails the provisional load and logs an error into the panel's own
 * console; it does not blank the panel, so a reader would never see it, but
 * there is no reason to ask for it.
 *
 * Two properties of the choice are worth stating, since the menu bar app has
 * to match them exactly. WebKit consults the delegate BEFORE it asks the system, so
 * the scheme needs no `CFBundleURLTypes` entry and no `LSApplicationQueriesSchemes`
 * to be seen: registering it would only be for a second app to open it. And the
 * scheme is not http, so if the shell is old and never matches, the navigation
 * simply fails and the panel is still there, which is the honest failure the
 * sent state below is written for.
 */
export const WIDGET_QUIT_URL = "oc-dash://quit"

/**
 * How long the confirm state waits, in milliseconds.
 *
 * The window has to be long enough for a second click that follows a human
 * reading a label that just changed, and short enough that a button left armed
 * cannot become the second click of some later and unrelated press. Both
 * failure modes are concrete:
 *
 * - Too short. Under about two seconds the reader has to aim the second click
 *   against a deadline. Miss it and the label is back to "Quit", the click
 *   arms again, and the reader concludes the button is broken.
 * - Too long. The panel is a glance surface, read in a second or two, and it
 *   polls every 30 seconds. An arm window longer than the gap between two
 *   glances hands the reader back a panel that is armed without their having
 *   armed it, and the next thing they click becomes the confirm. That is the
 *   exact failure the two-step exists to prevent, and a shorter window is the
 *   only thing that prevents it.
 *
 * Four seconds sits between those: comfortably longer than the ~150ms of a
 * deliberate double click and short enough that the reader has almost
 * certainly looked away by the time it expires.
 */
export const WIDGET_QUIT_ARM_MS = 4_000

export type WidgetQuitPhase = "idle" | "armed" | "sent"

export interface WidgetQuit {
  phase: WidgetQuitPhase
  /** When the control was armed, or null unless it is armed. */
  armedAt: number | null
}

/** The control's resting state. A frozen constant, so `useState` needs no call. */
export const WIDGET_QUIT_IDLE: WidgetQuit = { phase: "idle", armedAt: null }

/**
 * True once the arm window has run out.
 *
 * A separate predicate rather than a line inside the transition, because three
 * of them have to agree on it and a disagreement between "the button thinks it
 * is armed" and "the panel thinks it is armed" is a button that quits on a
 * click nobody meant as a confirmation.
 */
export function widgetQuitExpired(quit: WidgetQuit, now: number): boolean {
  return (
    quit.phase === "armed" &&
    quit.armedAt !== null &&
    now - quit.armedAt >= WIDGET_QUIT_ARM_MS
  )
}

/**
 * The state a press produces. Idle arms, armed sends, sent does nothing.
 *
 * An expired arm does NOT send. It re-arms instead, and that is deliberate: the
 * timer that calls this state machine can be late (a webview in a closed
 * popover is throttled, and macOS may put it behind something), and a press
 * arriving after the window must be the start of a new confirmation rather than
 * the end of one the reader never completed. The window is the promise; this
 * keeps the promise even when the clock that measures it drifts.
 */
export function widgetQuitPress(quit: WidgetQuit, now: number): WidgetQuit {
  // Sent is terminal and returns itself. It cannot happen through the UI (the
  // button is disabled there), but a re-arm from here would fire the URL a
  // second time on a panel that has already told the reader it asked once, and
  // the guard belongs in the state machine rather than in the markup.
  if (quit.phase === "sent") return quit
  if (quit.phase === "armed" && !widgetQuitExpired(quit, now)) {
    return { phase: "sent", armedAt: quit.armedAt }
  }
  return { phase: "armed", armedAt: now }
}

/**
 * The state once the clock has been read: an arm window that has run out is
 * idle again. Anything else is returned untouched, object and all, so a panel
 * that re-renders every 30 seconds does not re-arm its own timer.
 */
export function widgetQuitElapsed(quit: WidgetQuit, now: number): WidgetQuit {
  return widgetQuitExpired(quit, now) ? WIDGET_QUIT_IDLE : quit
}

/**
 * The state after the pointer leaves the control, or the range moves.
 *
 * Arming is a deliberate act of pointing at the button, so once the pointer is
 * somewhere else the reader's intent has moved on and the confirmation with it.
 * That is what stops the one genuinely bad sequence: arm, look away, reach for
 * something else, and have the panel interpret a click on a different control
 * as a confirmation of a quit. `sent` is never cleared, because the request has
 * gone and there is nothing left to disarm.
 */
export function widgetQuitDisarm(quit: WidgetQuit): WidgetQuit {
  return quit.phase === "armed" ? WIDGET_QUIT_IDLE : quit
}

/** The three labels, exported so tests pin the exact strings. */
export const WIDGET_QUIT_LABEL = "Quit"
export const WIDGET_QUIT_ARMED_LABEL = "Confirm quit"
export const WIDGET_QUIT_SENT_LABEL = "Quit requested"

/**
 * What the footer says once the request has gone out, in place of the
 * timestamp. It says SENT and it does not say it worked.
 *
 * The page has no way to observe the outcome: there is no reply to a
 * navigation, no event a WKWebView fires for "the host process is going away",
 * and the one signal that exists (`pagehide`) fires for a hundred ordinary
 * reasons. So the strongest claim available here is that a request was emitted,
 * and that is the claim made. The recovery instruction is on the same line
 * because the reader who is looking at it is by definition the one case where
 * the shell did not act: had it acted, the status item and this webview would
 * both be gone.
 */
export const WIDGET_QUIT_SENT_TEXT = "quit request sent · relaunch from a terminal"

export interface WidgetQuitView {
  /** The visible label. */
  label: string
  /**
   * The accessible name, which carries what a 40px label cannot: that the
   * first press only arms, what to do with the second one, and that quitting
   * costs the reader his status item.
   */
  ariaLabel: string
  armed: boolean
  sent: boolean
  /**
   * True once sent. This is `aria-disabled`, NOT the `disabled` attribute, and
   * the distinction is load-bearing: a `disabled` button is removed from the tab
   * order and, in several screen readers, its accessible-name changes stop being
   * announced, so the one state the reader most needs to hear about is the one
   * that goes quiet. `aria-disabled` keeps the control focusable and its name
   * announced while telling assistive tech it does nothing.
   *
   * Nothing is lost by not being able to press it: `widgetQuitPress` returns a
   * `sent` state untouched and the component only emits the URL on the
   * armed-to-sent edge, so a keypress here is a no-op by construction rather
   * than by the browser declining to deliver it.
   */
  disabled: boolean
}

/**
 * Everything the quit control shows, from its state. The component stays
 * presentational, which is what makes the arm, the expiry and the honest
 * failure testable in the node environment the project's vitest runs in.
 */
export function widgetQuitView(quit: WidgetQuit): WidgetQuitView {
  if (quit.phase === "armed") {
    return {
      label: WIDGET_QUIT_ARMED_LABEL,
      ariaLabel: `Quit armed. Press again to quit oc-dash, or wait ${Math.round(
        WIDGET_QUIT_ARM_MS / 1000,
      )} seconds to cancel. Quitting removes the menu bar item, so the app has to be relaunched from a terminal to get it back.`,
      armed: true,
      sent: false,
      disabled: false,
    }
  }
  if (quit.phase === "sent") {
    return {
      label: WIDGET_QUIT_SENT_LABEL,
      ariaLabel:
        "Quit requested. This page cannot see whether the shell acted on it. If this panel is still open, oc-dash is still running: relaunch it from a terminal.",
      armed: false,
      sent: true,
      disabled: true,
    }
  }
  return {
    label: WIDGET_QUIT_LABEL,
    ariaLabel: "Quit oc-dash. Needs a second click to confirm.",
    armed: false,
    sent: false,
    disabled: false,
  }
}

// ---------------------------------------------------------------------------
// The offline path, and the two controls that belong on it
// ---------------------------------------------------------------------------

/**
 * THE SECOND URL THE SHELL MUST INTERCEPT: `oc-dash://start-server`.
 *
 * One constant beside `WIDGET_QUIT_URL`, and it is one constant rather than two
 * copies of the scheme because the menu bar app on the other side has to match
 * it. These two projects once picked two different quit schemes and had to
 * reconcile them afterwards. Scheme `oc-dash`, host `start-server`, empty path,
 * emitted exactly as written: the shell path-constrains the match, so
 * `start-server/anything` would be a request nobody answers.
 *
 * The reason the ask is a navigation at all is the fact that put discovery in
 * Swift and that no page-side API can fix: a WKWebView has no process table and
 * no way to reach `NSApplication`. The panel is served over http from inside the
 * very process it wants to start, so anything the page does is a request that
 * process serves rather than one it obeys. Same mechanism, same
 * `decisionHandler(.cancel)`, and the same graceful failure: the scheme is not
 * http, so if the shell is older than this string the navigation simply fails
 * and the panel is still there, which is the failure the sent state below is
 * written for.
 */
export const WIDGET_START_URL = "oc-dash://start-server"

/** The poll cadence in the reader's units, so no sentence can drift from it. */
const POLL_SECONDS = Math.round(WIDGET_POLL_MS / 1000)

/**
 * How long the confirm state waits, in milliseconds: 2000, against the quit
 * control's 4000.
 *
 * The step is not optional, and the window is not the same decision twice.
 *
 * Why a step at all. A single press would spawn a process the reader did not ask
 * for, hold a port, and write a log they did not ask for. That is not
 * destructive, but it is rude and it is visible outside the panel, and one press
 * is arming by definition: the label changes under the pointer and the reader
 * has to point at the same control again. That is the same accident the quit
 * control exists to prevent, so the pattern is reused rather than reinvented,
 * and the reuse is pinned by a test that runs both machines over the same press
 * sequences and requires the same phases (see `widgetStartPress`).
 *
 * Why 2000 rather than 4000, which is what a wrong confirmation costs. Quitting
 * is unrecoverable from the panel: this app has no Dock icon and no app menu, so
 * a stray quit ends the status item and only a terminal brings it back. Starting
 * a server is not that. A server nobody wanted is a process in a terminal the
 * reader can find and stop, or a port they can see is taken, and neither is a
 * state with no way out of it. So the window does not have to survive a
 * distracted glance the way a quit window does, and halving it costs the reader
 * nothing they cannot undo.
 *
 * 2000 is the floor rather than a preference. It is the number the quit
 * control's own comment
 * names as the point below which "the reader has to aim the second click against
 * a deadline", so this control is never worse than the limit the destructive one
 * was already held to. Under it a missed confirm costs a click and reads as a
 * broken button; at it, a deliberate second press is still easy.
 */
export const WIDGET_START_ARM_MS = 2_000

/** The same three phases, deliberately: this is the quit control's ceremony. */
export type WidgetStartPhase = WidgetQuitPhase

export interface WidgetStart {
  phase: WidgetStartPhase
  /** When the control was armed, or null unless it is armed. */
  armedAt: number | null
}

/** The control's resting state. A frozen constant, so `useState` needs no call. */
export const WIDGET_START_IDLE: WidgetStart = { phase: "idle", armedAt: null }

/** True once the arm window has run out. The same boundary the quit control uses. */
export function widgetStartExpired(start: WidgetStart, now: number): boolean {
  return (
    start.phase === "armed" &&
    start.armedAt !== null &&
    now - start.armedAt >= WIDGET_START_ARM_MS
  )
}

/**
 * The state a press produces. Idle arms, armed sends, sent does nothing, and an
 * expired arm re-arms rather than sending.
 *
 * Deliberately the same four rules as `widgetQuitPress` in the same order,
 * including the one that is easy to get wrong: a press arriving after the window
 * has run out is the START of a confirmation, not the end of one the reader
 * never saw. The arm window is the promise and this keeps it even when the clock
 * measuring it drifts, which a throttled popover webview will do.
 */
export function widgetStartPress(start: WidgetStart, now: number): WidgetStart {
  if (start.phase === "sent") return start
  if (start.phase === "armed" && !widgetStartExpired(start, now)) {
    return { phase: "sent", armedAt: start.armedAt }
  }
  return { phase: "armed", armedAt: now }
}

/**
 * The state once the clock has been read: an arm window that has run out is idle
 * again. Anything else is returned untouched, object and all, so the panel's
 * 30s re-render does not re-arm its own timer.
 */
export function widgetStartElapsed(start: WidgetStart, now: number): WidgetStart {
  return widgetStartExpired(start, now) ? WIDGET_START_IDLE : start
}

/**
 * The state after the pointer leaves the control. Arming means pointing at the
 * button, so once the pointer is elsewhere the intent has moved on.
 */
export function widgetStartDisarm(start: WidgetStart): WidgetStart {
  return start.phase === "armed" ? WIDGET_START_IDLE : start
}

/**
 * The state after a settle, which is the only thing that ends a sent request
 * short of the server answering.
 *
 * `sent` is terminal for the EMISSION and not for the CONTROL, and that split is
 * the whole design. The URL must never go out twice for one intent, so
 * `widgetStartPress` hands a sent state back untouched and the component only
 * emits on the armed-to-sent edge. But a control that can be pressed exactly
 * once in the life of a popover is a dead control: if the spawn failed, or the
 * port was already taken, the reader's only way back would be to close the
 * popover and open it again, which is not a thing anyone discovers.
 *
 * So the 30s poll ends it, and the resting state it returns to is also the first
 * DISPROOF the panel can offer. A control that has gone back to inviting the
 * request is saying the first one did not work, which is true: a settle landed
 * and the dashboard still did not answer. The opposite settle unmounts this whole
 * block, so it needs no handling here.
 *
 * An `armed` state is deliberately left alone. The poll lands every 30 seconds
 * whether or not anyone is reading, so disarming on a settle would have a
 * background timer eating confirmations at random, and a button that cancels
 * itself when nothing visible happened reads as broken rather than as careful.
 */
export function widgetStartSettled(start: WidgetStart): WidgetStart {
  return start.phase === "sent" ? WIDGET_START_IDLE : start
}

/** The two labels, and the three for the spawn, exported so tests pin the exact strings. */
export const WIDGET_RETRY_LABEL = "Try again"
export const WIDGET_START_LABEL = "Start oc-dash server"
export const WIDGET_START_ARMED_LABEL = "Confirm start"
export const WIDGET_START_SENT_LABEL = "Start requested"

/**
 * What the footer's left slot says once the start request has gone out, in
 * place of "dashboard unreachable". It says SENT and it does not say it worked.
 *
 * The page cannot know whether the spawn succeeded. There is no reply to a
 * navigation, no event a WKWebView fires for "the process I asked for is
 * starting", and the shell logs what it did in a terminal the reader may not be
 * looking at. So the strongest available claim is that a request was emitted, and
 * the second half of the line is what makes the next thirty seconds legible: the
 * panel is still checking, on the timer it has always used, and the check is
 * where the proof comes from.
 *
 * The number is generated from `WIDGET_POLL_MS` rather than typed, so the one
 * sentence that promises a cadence cannot disagree with the cadence. That is the
 * failure this file has already had once, in a different form: the footer work
 * had to remove
 * a second copy of the timestamp because two freshness claims cannot both be the
 * live one.
 */
export const WIDGET_START_SENT_TEXT =
  `start request sent · the panel retries every ${POLL_SECONDS}s`

/** What a control shows. One shape for both, so the component stays dumb. */
export interface WidgetControlView {
  /** The visible label. */
  label: string
  /**
   * The accessible name, which carries what a short label cannot: which failure
   * the control is for, that a press needs a second one, and that the page cannot
   * see the outcome.
   */
  ariaLabel: string
  armed: boolean
  sent: boolean
  /**
   * `aria-disabled`, NOT the `disabled` attribute, for the quit control's
   * reason: `disabled`
   * takes the control out of the tab order and stops several screen readers
   * announcing name changes, so the state the reader most needs to hear about is
   * the one that would go quiet.
   */
  disabled: boolean
}

/**
 * Everything the spawn control shows, from its state, in the quit control's
 * shape and with
 * the same wording discipline: the sent phase says the request went out and that the
 * page cannot see the outcome, and never says it started.
 */
export function widgetStartView(start: WidgetStart): WidgetControlView {
  if (start.phase === "armed") {
    return {
      label: WIDGET_START_ARMED_LABEL,
      ariaLabel: `Start armed. Press again to start the oc-dash server, or wait ${Math.round(
        WIDGET_START_ARM_MS / 1000,
      )} seconds to cancel. The panel retries every ${POLL_SECONDS} seconds and cannot see whether the server started.`,
      armed: true,
      sent: false,
      disabled: false,
    }
  }
  if (start.phase === "sent") {
    return {
      label: WIDGET_START_SENT_LABEL,
      ariaLabel: `Start requested. This page cannot see whether the server started. The panel retries every ${POLL_SECONDS} seconds and fills in when the dashboard answers.`,
      armed: false,
      sent: true,
      disabled: true,
    }
  }
  return {
    label: WIDGET_START_LABEL,
    ariaLabel: `Start the oc-dash server, for when it is not running at all. Needs a second click to confirm. The panel retries every ${POLL_SECONDS} seconds and cannot see whether the server started.`,
    armed: false,
    sent: false,
    disabled: false,
  }
}

/** The re-fetch, which has no phases and needs none. */
export const WIDGET_RETRY_ARIA =
  "Try again. Fetch the dashboard now, for when it is running but was briefly unreachable."

function retryView(): WidgetControlView {
  return {
    label: WIDGET_RETRY_LABEL,
    ariaLabel: WIDGET_RETRY_ARIA,
    armed: false,
    sent: false,
    disabled: false,
  }
}

/**
 * What the panel offers when it cannot reach the dashboard, or null when it can.
 *
 * TWO CONTROLS, because there are two failures and one control cannot answer
 * both. A rejected fetch is one boolean in this panel's state, and the panel
 * cannot tell "the server is not running" from "the server answered badly" — the
 * two are different errors underneath (`getJson`'s `responded 502` against a
 * `fetch` TypeError) and `Promise.allSettled` has already thrown the difference
 * away. So the panel says what it knows and offers both, and each names the
 * failure it is for:
 *
 * - "Try again" is for a server that IS running and did not answer this time.
 *   It re-runs the panel's existing fetch on the existing range, which is the
 *   whole of what it does: no arm, because a request with no effect outside the
 *   page is not something a stray click can spoil. It is deliberately silent
 *   when it fails, and that is the footer's ruling applied rather than a gap: the panel
 *   suppresses the timestamp precisely because a rejected fetch still stamps
 *   `updatedAt`, so narrating an attempt would be the same error one level up.
 * - "Start oc-dash server" is for a server that is not running at all. It is the
 *   spawn, and it is armed first.
 *
 * Returning null rather than an empty object is what makes the controls' absence
 * in the healthy state a rule with a wrong answer instead of a reading of the
 * markup: a reachable dashboard renders nothing here at all, so there is no
 * button to press and nothing to emit. The test asserts the null directly.
 */
export function widgetOfflineActions(
  unreachable: boolean,
  start: WidgetStart,
): { retry: WidgetControlView; start: WidgetControlView } | null {
  if (!unreachable) return null
  return { retry: retryView(), start: widgetStartView(start) }
}

/**
 * True only on the armed-to-sent edge, which is the only moment the URL goes out.
 *
 * A predicate rather than an inline `if` in the component, so the rule the menu
 * bar app depends on — one emission per armed intent, never on the first press,
 * never twice — is a thing the node test suite can check instead of a thing a
 * screenshot shows.
 */
export function widgetStartSends(start: WidgetStart, next: WidgetStart): boolean {
  return start.phase === "armed" && next.phase === "sent"
}
