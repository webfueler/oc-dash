import { describe, expect, it } from "vitest"
import type {
  ModelUsage,
  Range,
  SessionInfo,
  SessionStatsInfo,
  SessionsPayload,
  SummaryDegraded,
  SummaryOk,
  TokenUsage,
} from "../src/api"
import { sess } from "./testFixtures"
import { fmtUSD } from "../src/format"
import {
  MODELS_HEAD_TITLE,
  WIDGET_GLASS_DEFAULT,
  WIDGET_GLASS_KEY,
  WIDGET_GLASS_VAR,
  WIDGET_MODEL_ROWS,
  WIDGET_OFFLINE_FAILURES,
  WIDGET_OFFLINE_IDLE,
  WIDGET_OFFLINE_URL,
  WIDGET_OPEN_ARIA,
  WIDGET_OPEN_LABEL,
  WIDGET_OPEN_TARGET_KEY,
  WIDGET_OPEN_TITLE,
  WIDGET_POLL_MS,
  WIDGET_QUIT_ARM_MS,
  WIDGET_QUIT_ARMED_LABEL,
  WIDGET_QUIT_IDLE,
  WIDGET_QUIT_LABEL,
  WIDGET_QUIT_SENT_LABEL,
  WIDGET_QUIT_SENT_TEXT,
  WIDGET_QUIT_URL,
  WIDGET_RANGES,
  WIDGET_RANGE_KEY,
  WIDGET_RANGE_LABELS,
  WIDGET_RETRY_LABEL,
  WIDGET_SESSION_ROWS,
  WIDGET_START_ARMED_LABEL,
  WIDGET_START_ARM_MS,
  WIDGET_START_IDLE,
  WIDGET_START_LABEL,
  WIDGET_START_SENT_LABEL,
  WIDGET_START_SENT_TEXT,
  WIDGET_START_URL,
  WIDGET_VIEW_ALL_ARIA,
  WIDGET_VIEW_ALL_LABEL,
  WIDGET_VIEW_ALL_MODELS_ARIA,
  fmtMoney,
  gapTitle,
  persistWidgetRange,
  projectLabel,
  readWidgetRange,
  sessionsHeadTitle,
  sharePercents,
  shareText,
  widgetAtRange,
  widgetDashboardTarget,
  widgetGap,
  widgetHero,
  widgetGlassAlpha,
  widgetModels,
  widgetOfflineActions,
  widgetOfflinePoll,
  widgetOfflineSends,
  widgetOpenURL,
  widgetQuitDisarm,
  widgetQuitElapsed,
  widgetQuitExpired,
  widgetQuitPress,
  widgetQuitView,
  widgetRefreshText,
  widgetSessions,
  widgetStartDisarm,
  widgetStartElapsed,
  widgetStartExpired,
  widgetStartPress,
  widgetStartSends,
  widgetStartSettled,
  widgetStartView,
  widgetStats,
  widgetRangeFrom,
  type WidgetOffline,
} from "../src/widget"

/**
 * The widget's view model. The panel
 * is 340x420, so most of these assertions are about what the panel refuses
 * to print: a degraded payload must dash rather than keep the last figure,
 * a rolled-up session must not read as its own cost, a truncated table must
 * not claim its share is of the whole when it is of everything the payload
 * carried, a column of shares must add up, a payload that never arrived
 * must not be described, and a disagreement between the hero and the
 * session rollup must be printed as a number rather than described.
 */

const zeroTokens: TokenUsage = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }

function usage(cost: number, input = 0): ModelUsage {
  return {
    model: { providerID: "opencode", id: "gpt-5" },
    steps: 1,
    tokens: { ...zeroTokens, input },
    cost,
  }
}

function ok(over: Partial<SessionStatsInfo> = {}, preset: Range = "today"): SummaryOk {
  return {
    degraded: false,
    range: { preset },
    timezone: "UTC",
    data: {
      range: { from: 0, to: 1 },
      sessions: 2,
      subagents: 3,
      prompts: 11,
      steps: 22,
      tokens: { input: 1000, output: 2000, reasoning: 0, cache: { read: 300, write: 400 } },
      cost: 9.5,
      activeDays: 1,
      streak: 1,
      activity: [],
      models: [],
      ...over,
    },
    // Derived from the same cost, so a fixture that varies `cost` cannot end up
    // carrying a costText the real route would never have sent beside it.
    costText: fmtUSD((over.cost ?? 9.5) as number),
  }
}

const degraded: SummaryDegraded = {
  degraded: true,
  range: { preset: "today" },
  timezone: "UTC",
  reason: "service unreachable",
}

function payload(
  rows: SessionInfo[],
  over: Partial<SessionsPayload> = {},
  preset: Range = "today",
): SessionsPayload {
  return {
    range: { preset },
    count: rows.length,
    pages: 1,
    truncated: false,
    data: rows,
    ...over,
  }
}

/** Sums of tenths drift in binary floating point; this is the assertable form. */
function round1(n: number): number {
  return Math.round(n * 10) / 10
}

describe("fmtMoney", () => {
  it("is the shared formatter, not a second implementation", () => {
    // Mission 089's whole shape: the panel's money IS the dashboard's money.
    // Identity, not equality, so reintroducing a parallel function fails here
    // even if the two happen to agree on the day.
    expect(fmtMoney).toBe(fmtUSD)
  })

  it("prints exactly two decimals at every magnitude", () => {
    expect(fmtMoney(0)).toBe("$0.00")
    expect(fmtMoney(9.5)).toBe("$9.50")
    expect(fmtMoney(0.5)).toBe("$0.50")
    expect(fmtMoney(999.99)).toBe("$999.99")
    expect(fmtMoney(1000)).toBe("$1,000.00")
    expect(fmtMoney(1234567.89)).toBe("$1,234,567.89")
  })

  it("bounds a real sub-cent amount instead of rounding it to nothing", () => {
    // The sub-cent bound, now the shared rule. A plain 2-decimal cap would
    // print $0.00, which reads as free. The bound is not a claim and says so.
    expect(fmtMoney(0.0001)).toBe("<$0.01")
    expect(fmtMoney(0.0023)).toBe("<$0.01")
    expect(fmtMoney(0.009999)).toBe("<$0.01")
  })

  it("keeps a genuine zero at $0.00, which is the whole distinction", () => {
    // A free session and a sub-cent session must not print the same string.
    // The live data is the case: the hero is genuinely $0.00 while
    // the row under it is real money smaller than a cent.
    expect(fmtMoney(0)).toBe("$0.00")
    expect(fmtMoney(0.0042)).not.toBe(fmtMoney(0))
  })

  it("rounds at the cent, the precision both surfaces now share", () => {
    expect(fmtMoney(0.4454)).toBe("$0.45")
    expect(fmtMoney(0.0558)).toBe("$0.06")
    expect(fmtMoney(0.0889)).toBe("$0.09")
  })

  it("bounds a negative sub-cent figure with its sign rather than dropping it", () => {
    // Unreachable with real spend — `widgetGap` formats Math.abs(delta) — but
    // a formatter that printed "<$0.01" for a credit would state the wrong
    // direction, which is the one thing this panel must not do.
    expect(fmtMoney(-0.0042)).toBe("<-$0.01")
    expect(fmtMoney(-1.5)).toBe("-$1.50")
  })

  it("dashes a figure that is not a number", () => {
    expect(fmtMoney(Number.NaN)).toBe("—")
    expect(fmtMoney(Number.POSITIVE_INFINITY)).toBe("—")
  })

  it("is narrower than the four-decimal string it replaces, not wider", () => {
    // The cap cannot make a money column overflow what it sized for. The
    // signed bound is the longest string the rule can produce below a cent.
    expect("<$0.01".length).toBeLessThanOrEqual("$0.4454".length)
    expect("<-$0.01".length).toBeLessThanOrEqual("$0.4454".length)
  })
})

describe("widgetHero", () => {
  it("prints the stats total through the panel's own formatter", () => {
    const hero = widgetHero(ok())
    expect(hero.cost).toBe("$9.50")
    expect(hero.exact).toBe(true)
    expect(hero.degraded).toBe(false)
  })

  it("carries no range label at all any more", () => {
    // Annotation 1. The label was the second mechanism guaranteeing a figure
    // could not sit under the wrong range's name; it was removed and
    // `widgetAtRange` took over. Asserted here so it cannot be put back by
    // accident, because putting it back would be a different design.
    expect(widgetHero(ok())).not.toHaveProperty("label")
  })

  it("dashes a degraded payload instead of keeping a stale figure", () => {
    const hero = widgetHero(degraded)
    expect(hero.cost).toBe("—")
    expect(hero.exact).toBe(false)
    expect(hero.degraded).toBe(true)
    expect(hero.reason).toBe("service unreachable")
  })

  it("dashes before the first payload lands, and is not 'degraded' yet", () => {
    const hero = widgetHero(null)
    expect(hero.cost).toBe("—")
    expect(hero.exact).toBe(false)
    expect(hero.degraded).toBe(false)
    expect(hero.reason).toBeNull()
  })

  it("bounds a sub-cent hero cost rather than printing a four-decimal figure", () => {
    // The four-decimal "0.0042" is gone from both surfaces; the shared rule
    // reads "<$0.01" and the assertion says why.
    expect(widgetHero(ok({ cost: 0.0042 })).cost).toBe("<$0.01")
  })

  it("still dashes a sub-cent hero to nothing rather than claiming a figure", () => {
    const hero = widgetHero(degraded)
    expect(hero.cost).toBe("—")
    expect(hero.exact).toBe(false)
  })
})

describe("the range selector", () => {
  it("offers the four ranges in macOS order, all visible at once", () => {
    expect(WIDGET_RANGES).toEqual(["today", "7d", "30d", "all"])
  })

  it("labels every segment with a string the 320px content box can hold", () => {
    expect(WIDGET_RANGES.map((r) => WIDGET_RANGE_LABELS[r])).toEqual([
      "Today",
      "7 Days",
      "30 Days",
      "All",
    ])
    // The longest of these header lines measured 97.55px in a 170px
    // cell; the segments have 80px each. The assertion is that no label is
    // long enough to need the ellipsis the CSS keeps as a safety net.
    for (const label of Object.values(WIDGET_RANGE_LABELS)) {
      expect(label.length).toBeLessThanOrEqual(7)
    }
  })

  it("accepts only a stored value it recognises, and null for anything else", () => {
    for (const r of WIDGET_RANGES) expect(widgetRangeFrom(r)).toBe(r)
    expect(widgetRangeFrom("yesterday")).toBeNull()
    expect(widgetRangeFrom("")).toBeNull()
    expect(widgetRangeFrom(null)).toBeNull()
    expect(widgetRangeFrom(undefined)).toBeNull()
  })

  it("round-trips through storage under a key of its own", () => {
    // Persistence across a popover close, which is the reason this exists: the
    // webview is rebuilt on reopen, so module state does not survive it.
    const store = new Map<string, string>()
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    }
    expect(readWidgetRange(storage)).toBeNull()
    persistWidgetRange(storage, "30d")
    expect(store.get(WIDGET_RANGE_KEY)).toBe("30d")
    expect(readWidgetRange(storage)).toBe("30d")
    // And the dashboard's theme key is untouched by any of it.
    expect([...store.keys()]).toEqual([WIDGET_RANGE_KEY])
  })

  it("survives storage that throws or is absent rather than stranding the panel", () => {
    const hostile = {
      getItem: () => {
        throw new Error("blocked")
      },
      setItem: () => {
        throw new Error("blocked")
      },
    }
    expect(readWidgetRange(hostile)).toBeNull()
    expect(() => persistWidgetRange(hostile, "all")).not.toThrow()
    expect(readWidgetRange(null)).toBeNull()
    expect(() => persistWidgetRange(null, "all")).not.toThrow()
  })
})

describe("widgetAtRange", () => {
  const rows = [sess({ id: "a", cost: 2 }), sess({ id: "b", cost: 1 })]

  it("passes a matching pair straight through", () => {
    const summary = ok({ cost: 3 }, "7d")
    const sessions = payload(rows, {}, "7d")
    const out = widgetAtRange({ range: "7d", summary, sessions })
    expect(out.summary).toBe(summary)
    expect(out.sessions).toBe(sessions)
  })

  it("drops a summary whose own preset is not the selected range", () => {
    // The mechanism the removed hero label used to provide, and the only
    // reason that label could be removed safely. It reads the
    // PAYLOAD's preset, not the string on the cap, so a server that resolved
    // the range differently cannot slip a figure past it.
    const stale = ok({ cost: 3 }, "today")
    expect(widgetAtRange({ range: "30d", summary: stale, sessions: null }).summary).toBeNull()
  })

  it("drops a sessions payload from another range, so no old rows survive", () => {
    const stale = payload(rows, {}, "today")
    expect(widgetAtRange({ range: "all", summary: null, sessions: stale }).sessions).toBeNull()
  })

  it("renders a half-mismatched pair as half a panel rather than as a whole lie", () => {
    // Each payload is judged on its own, so a real 7d summary with a stale
    // today sessions payload still shows the hero and refuses the rows.
    const out = widgetAtRange({
      range: "7d",
      summary: ok({ cost: 3 }, "7d"),
      sessions: payload(rows, {}, "today"),
    })
    expect(out.summary).not.toBeNull()
    expect(out.sessions).toBeNull()
  })

  it("keeps a degraded payload so the panel can say why, since its preset matches", () => {
    const bad: SummaryDegraded = {
      degraded: true,
      range: { preset: "7d" },
      timezone: "UTC",
      reason: "service unreachable",
    }
    const out = widgetAtRange({ range: "7d", summary: bad, sessions: null })
    expect(out.summary).toBe(bad)
    expect(widgetHero(out.summary).cost).toBe("—")
  })

  it("returns nulls rather than throwing when there is no payload at all", () => {
    expect(widgetAtRange({ range: "today", summary: null, sessions: null })).toEqual({
      summary: null,
      sessions: null,
    })
  })

  it("renders an empty panel rather than a wrong one when the payload is another range's", () => {
    // This is the exact shape a browser probe produced by accident,
    // and the reason is worth keeping in a test rather than only in a
    // report. The probe stubbed the endpoints from its own loop
    // variable, so the panel — which asks for `today` until the reader clicks
    // a segment — was handed the 7d body. Three of the four ranges then
    // rendered as an empty panel and the probe reported it as a panel failure.
    // It was the guard working: a payload whose own preset is not the selected
    // range is refused, so the panel showed a dash and said "Sessions
    // unavailable" rather than printing 7 days' figures under today's cap.
    // The panel's answer to a mismatched payload is to show nothing. This
    // asserts that answer so it cannot be "fixed" by rendering the mismatch.
    const mismatched = widgetAtRange({
      range: "today",
      summary: ok({ cost: 6.1 }, "7d"),
      sessions: payload(rows, {}, "7d"),
    })
    expect(mismatched.summary).toBeNull()
    expect(mismatched.sessions).toBeNull()
    // Nothing derived from them, either. The hero is a dash and claims to be
    // inexact, and the sessions view is empty AND inexact, so the component
    // prints "Sessions unavailable" rather than an empty table that reads as
    // "nothing happened in this window".
    const hero = widgetHero(mismatched.summary)
    expect(hero.cost).toBe("—")
    expect(hero.exact).toBe(false)
    const view = widgetSessions(mismatched.sessions)
    expect(view.rows).toEqual([])
    expect(view.exact).toBe(false)
    expect(view.total).toBe(0)
  })

  it("holds for every combination of a selected range and a payload's preset", () => {
    // The exhaustive form of the case above, so the guarantee is arithmetic
    // rather than four hand-picked examples.
    for (const selected of WIDGET_RANGES) {
      for (const carried of WIDGET_RANGES) {
        const summary = ok({ cost: 1 }, carried)
        const sessions = payload(rows, {}, carried)
        const out = widgetAtRange({ range: selected, summary, sessions })
        const matches = carried === selected
        expect(out.summary === summary, `${selected} / ${carried}`).toBe(matches)
        expect(out.sessions === sessions, `${selected} / ${carried}`).toBe(matches)
      }
    }
  })
})

describe("gapTitle", () => {
  it("names the difference, the direction and both operands", () => {
    const gap = widgetGap(ok({ cost: 0 }), widgetSessions(payload([sess({ id: "a", cost: 1.5 })])))
    expect(gapTitle(gap)).toBe(
      "$1.50 in session rows, not in the hero · session rows $1.50 minus stats total $0.00",
    )
  })

  it("is null when there is no gap, so no tooltip claims one", () => {
    expect(gapTitle(null)).toBeNull()
    const agreeing = widgetGap(
      ok({ cost: 1.5 }),
      widgetSessions(payload([sess({ id: "a", cost: 1.5 })])),
    )
    expect(gapTitle(agreeing)).toBeNull()
  })

  it("bounds a sub-cent gap rather than rounding the disagreement away", () => {
    const gap = widgetGap(ok({ cost: 0 }), widgetSessions(payload([sess({ id: "a", cost: 0.0042 })])))
    expect(gapTitle(gap)).toBe(
      "<$0.01 in session rows, not in the hero · session rows <$0.01 minus stats total $0.00",
    )
  })
})

describe("sessionsHeadTitle", () => {
  it("names the window and the basis for every range, in the panel's own words", () => {
    // Annotation 4 cut the head off the screen, so this sentence is now the
    // only place the basis is stated, which is what it exists for: without it a
    // row reads as the window's spend of a session and it is not.
    expect(sessionsHeadTitle("today", null)).toBe(
      "sessions touched today · each row is that session's own total, not the window's share of it",
    )
    expect(sessionsHeadTitle("7d", null)).toBe(
      "sessions touched last 7 days · each row is that session's own total, not the window's share of it",
    )
    expect(sessionsHeadTitle("30d", null)).toBe(
      "sessions touched last 30 days · each row is that session's own total, not the window's share of it",
    )
    expect(sessionsHeadTitle("all", null)).toBe(
      "sessions touched all time · each row is that session's own total, not the window's share of it",
    )
  })

  it("carries the gap on the same hover when there is one", () => {
    const gap = widgetGap(ok({ cost: 0 }, "30d"), widgetSessions(payload([sess({ id: "a", cost: 2 })], {}, "30d")))
    const title = sessionsHeadTitle("30d", gap)
    expect(title).toContain("sessions touched last 30 days")
    expect(title).toContain("$2.00 in session rows, not in the hero")
    expect(title).toContain("minus stats total $0.00")
  })
})

describe("MODELS_HEAD_TITLE", () => {
  it("names the share denominator and says whose rows it covers", () => {
    // Annotation 5 cut the models head too, and the denominator was the one
    // fact on it that was a claim about a number the panel prints.
    expect(MODELS_HEAD_TITLE).toContain("share of model cost")
    expect(MODELS_HEAD_TITLE).toContain("whole payload")
  })
})

describe("widgetStats", () => {
  it("sums every token bucket and prints the rest from the same payload", () => {
    const stats = widgetStats(ok())
    expect(stats).not.toBeNull()
    expect(stats!.tokens).toBe("3.7K")
    expect(stats!.sessions).toBe("2")
    expect(stats!.subagents).toBe("3")
  })

  it("drops the strip entirely when there is no healthy payload", () => {
    expect(widgetStats(degraded)).toBeNull()
    expect(widgetStats(null)).toBeNull()
  })
})

describe("projectLabel", () => {
  it("shows the project basename, the label the dashboard's filter uses", () => {
    expect(projectLabel(sess({ id: "a", location: { directory: "/Users/x/Sites/oc-dash" } }))).toBe(
      "oc-dash",
    )
  })

  it("dashes a session with no directory instead of inventing a name", () => {
    expect(projectLabel(sess({ id: "a", location: undefined as never }))).toBe("—")
  })
})

describe("widgetSessions", () => {
  it("rolls subagents into the parent and shows no separate child row", () => {
    const parent = sess({ id: "p", cost: 1, title: "Parent" })
    const child = sess({ id: "c", parentID: "p", cost: 0.5, title: "Child" })
    const view = widgetSessions(payload([parent, child]))
    expect(view.rows).toHaveLength(1)
    expect(view.rows[0].id).toBe("p")
    expect(view.rows[0].cost).toBe(1.5)
    expect(view.rows[0].costText).toBe("$1.50")
    expect(view.rows[0].subagents).toBe(1)
  })

  it("totals every root in the payload, not only the rows the panel shows", () => {
    // The gap line subtracts the hero from this figure, so it has to be
    // the whole payload's rollup. Summing the four rows that happen to fit
    // would make the gap depend on how tall the panel is, and "+5 more"
    // would then be quietly part of the money.
    const rows = Array.from({ length: 9 }, (_, i) => sess({ id: `s${i}`, cost: 1 }))
    const view = widgetSessions(payload(rows), 4)
    expect(view.rows).toHaveLength(4)
    expect(view.remaining).toBe(5)
    expect(view.total).toBe(9)
  })

  it("keeps the total equal to the rolled-up rows even when the walk stops", () => {
    // A cut list and a truncated walk are different things, and only the
    // second one makes the total unusable. The cut is the panel's; the
    // truncation is the server's, and widgetGap is what refuses it.
    const rows = Array.from({ length: 9 }, (_, i) => sess({ id: `s${i}`, cost: i }))
    const view = widgetSessions(payload(rows, { truncated: true }), 4)
    expect(view.truncated).toBe(true)
    expect(view.total).toBe(36)
  })

  it("orders by rolled-up cost, then tokens, then most recent", () => {
    const rows = [
      sess({ id: "cheap", cost: 1, time: { created: 0, updated: 300 } }),
      sess({ id: "dear", cost: 5, time: { created: 0, updated: 100 } }),
      sess({ id: "mid", cost: 5, time: { created: 0, updated: 200 } }),
      sess({ id: "newest-of-ties", cost: 5, time: { created: 0, updated: 900 } }),
    ]
    const ids = widgetSessions(payload(rows)).rows.map((r) => r.id)
    expect(ids).toEqual(["newest-of-ties", "mid", "dear", "cheap"])
  })

  it("counts the sessions it left out, exactly", () => {
    const rows = Array.from({ length: 9 }, (_, i) => sess({ id: `s${i}`, cost: 9 - i }))
    const view = widgetSessions(payload(rows), 4)
    expect(view.rows).toHaveLength(4)
    expect(view.remaining).toBe(5)
  })

  it("carries the truncation flag so the panel can say the list is incomplete", () => {
    const view = widgetSessions(payload([sess({ id: "a", cost: 1 })], { truncated: true }))
    expect(view.truncated).toBe(true)
  })

  it("reports a truncated walk and the rows it left out at the same time", () => {
    // The panel shows both at once: the section head's "+5 more" and the
    // warning line under the table. A view model that can only ever report
    // one of them would let the panel imply a complete list.
    const rows = Array.from({ length: 9 }, (_, i) => sess({ id: `s${i}`, cost: 9 - i }))
    const view = widgetSessions(payload(rows, { truncated: true }), 4)
    expect(view.truncated).toBe(true)
    expect(view.remaining).toBe(5)
    expect(view.rows).toHaveLength(4)
  })

  it("returns nothing for a missing payload rather than an empty table body", () => {
    expect(widgetSessions(null)).toEqual({
      rows: [],
      remaining: 0,
      truncated: false,
      exact: false,
      total: 0,
    })
  })

  it("marks a missing payload inexact, so the panel cannot say there were none", () => {
    // A rejected fetch leaves null behind, and an empty row list used
    // to reach the panel as "No sessions today." — a sentence about the
    // user's day that the panel had no basis for. The flag is the fix; the
    // browser probe pins which string the component prints off it.
    expect(widgetSessions(null).exact).toBe(false)
    expect(widgetSessions(payload([])).exact).toBe(true)
    expect(widgetSessions(payload([sess({ id: "a", cost: 1 })])).exact).toBe(true)
  })

  it("keeps a session whose parent is not in the payload, as its own root", () => {
    // A real "today" list carries a session with a
    // parentID that the 50-page walk never returned, and it is the most
    // expensive row in the window. tree.ts promotes it to a root, so the
    // panel shows it as a root rather than dropping the day's largest
    // spender on the floor.
    const orphan = sess({ id: "orphan", parentID: "not-in-this-page", cost: 0.157922568 })
    const view = widgetSessions(payload([orphan, sess({ id: "other", cost: 0.01 })]))
    expect(view.rows.map((r) => r.id)).toEqual(["orphan", "other"])
    expect(view.rows[0].cost).toBe(0.157922568)
    // The shared formatter, both surfaces. $0.157922568 is a fraction of a
    // cent over, so the four-decimal rule the dashboard used to have printed
    // "$0.1579" and the shared rule prints "$0.16". The `<$0.01` bound is
    // exercised by other real rows; this one is not sub-cent.
    expect(view.rows[0].costText).toBe("$0.16")
    expect(view.rows[0].subagents).toBe(0)
  })

  it("defaults to the panel's row budget", () => {
    const rows = Array.from({ length: 10 }, (_, i) => sess({ id: `s${i}`, cost: i }))
    expect(widgetSessions(payload(rows)).rows).toHaveLength(WIDGET_SESSION_ROWS)
  })

  it("keeps a session's own title verbatim for the second line", () => {
    const view = widgetSessions(payload([sess({ id: "a", cost: 1, title: "Wire up the thing" })]))
    expect(view.rows[0].title).toBe("Wire up the thing")
  })

  it("labels a session with no title instead of showing an empty cell", () => {
    const view = widgetSessions(payload([sess({ id: "a", cost: 1, title: undefined })]))
    expect(view.rows[0].title).toBe("(untitled)")
  })

  it("shows no rows for a zero or negative budget, and counts all of them", () => {
    const rows = Array.from({ length: 3 }, (_, i) => sess({ id: `s${i}`, cost: i + 1 }))
    for (const limit of [0, -1, -100]) {
      const view = widgetSessions(payload(rows), limit)
      expect(view.rows).toEqual([])
      expect(view.remaining).toBe(3)
    }
  })

  it("carries every digit of a five-figure cost, with nothing elided", () => {
    // The unit half of the cost-column bug. The panel used to size its cost
    // column for "$0.1523"
    // and cut "$1,234,567.89" to "$1,234,5…" at 340px. The column is
    // content-sized in CSS now; this pins the string the cell is handed,
    // which is the half of the bug that lives in TypeScript. Literal
    // expectations, not a test-local formatter: a second implementation in
    // the suite could drift with the first and still agree.
    const cases: Array<[number, string]> = [
      [999.99, "$999.99"],
      [1000, "$1,000.00"],
      [12345.67, "$12,345.67"],
      [123456.78, "$123,456.78"],
      [1234567.89, "$1,234,567.89"],
    ]
    for (const [cost, expected] of cases) {
      const view = widgetSessions(payload([sess({ id: "a", cost })]))
      expect(view.rows[0].costText).toBe(expected)
      expect(view.rows[0].costText).not.toMatch(/…|\.\.\./)
    }
  })
})

describe("widgetGap", () => {
  /**
   * A real "today" payload at 2026-09-29T20:57Z:
   * one unpriced model in the summary, so the hero reads $0.00, and nine
   * session rows that roll up to $0.15804837. Three of the nine are roots:
   * the orphan ses_f25c6ff, priced at its own $0.157922568 four days of
   * spend, and two sessions that really were created today.
   */
  const liveToday = () => {
    const rows = [
      sess({ id: "ses_f25c6ff", parentID: "ses_f25f1ddd", cost: 0.157922568 }),
      sess({ id: "ses_f114847", cost: 0.0000652 }),
      sess({ id: "ses_f15dc4f", cost: 0.0000606 }),
      ...Array.from({ length: 6 }, (_, i) => sess({ id: `sub${i}`, parentID: "ses_f114847", cost: 0 })),
    ]
    return {
      summary: ok({ cost: 0, models: [usage(0, 1134924)] }),
      sessions: widgetSessions(payload(rows)),
    }
  }

  it("prints the gap when the two figures disagree, through fmtMoney", () => {
    // The case that made the gap worth printing: show the gap, rename the
    // head. $0.158 of the money is in the
    // session rows and not in the hero.
    const { summary, sessions } = liveToday()
    const gap = widgetGap(summary, sessions)
    expect(gap).not.toBeNull()
    // The arithmetic is untouched by the unification: the delta is the live
    // figure to nine places.
    expect(gap!.delta).toBeCloseTo(0.158048368, 9)
    // The old dashboard rule printed "$0.158" here, dropping the trailing
    // zero; the shared rule rounds the same figure to the same cent. The
    // panel's string is unchanged, and the dashboard can no longer drift
    // from it.
    expect(gap!.amountText).toBe("$0.16")
    expect(gap!.higher).toBe("rows")
    expect(gap!.where).toBe("in session rows, not in the hero")
    expect(gap!.heroText).toBe("$0.00")
    expect(gap!.rowsText).toBe("$0.16")
  })

  it("says nothing when the two figures agree", () => {
    // The rule: when they agree, say so or say nothing. $0.00
    // against $0.00 is not a gap, and printing "the gap is $0.00" on a
    // panel whose two figures visibly match is noise the reader has to
    // check the way they check every other number.
    const rows = [sess({ id: "a", cost: 12.34 }), sess({ id: "b", cost: 0.16 })]
    expect(widgetGap(ok({ cost: 12.5 }), widgetSessions(payload(rows)))).toBeNull()
    expect(widgetGap(ok({ cost: 0 }), widgetSessions(payload([])))).toBeNull()
  })

  it("says nothing on a truncated walk, where the row total is a floor", () => {
    // The walk stopped at its 50-page cap, so the session figure is a
    // partial sum and the difference from the hero is an artefact of where
    // the walk stopped rather than a disagreement between two figures.
    // Printing it would put a wrong number next to a right one, and the
    // truncation warning is already on screen saying the list is short.
    const rows = Array.from({ length: 9 }, (_, i) => sess({ id: `s${i}`, cost: 1 }))
    const view = widgetSessions(payload(rows, { truncated: true }))
    expect(view.truncated).toBe(true)
    expect(view.total).toBe(9)
    expect(widgetGap(ok({ cost: 0 }), view)).toBeNull()
  })

  it("does not move when the panel has room for fewer rows than the payload has", () => {
    // remaining > 0 is the panel's cut, not the server's, and the total is
    // the whole payload's, so "+5 more" cannot leak into the money.
    const rows = Array.from({ length: 9 }, (_, i) => sess({ id: `s${i}`, cost: 1 }))
    const shown = widgetGap(ok({ cost: 0 }), widgetSessions(payload(rows), 4))
    const all = widgetGap(ok({ cost: 0 }), widgetSessions(payload(rows), 9))
    expect(shown!.amountText).toBe("$9.00")
    expect(shown).toEqual(all)
  })

  it("names the other direction when the hero is the larger figure", () => {
    const rows = [sess({ id: "a", cost: 10 }), sess({ id: "b", cost: 0 })]
    const gap = widgetGap(ok({ cost: 12.5 }), widgetSessions(payload(rows)))
    expect(gap!.delta).toBe(-2.5)
    expect(gap!.amountText).toBe("$2.50")
    expect(gap!.higher).toBe("hero")
    expect(gap!.where).toBe("in the hero, not in session rows")
  })

  it("bounds a sub-cent gap rather than rounding the disagreement away", () => {
    // Was "$0.0042" through the old dashboard rule. A real disagreement
    // smaller than a cent now prints as a bound on both surfaces, so it stays
    // a claim that something differs rather than a claim of how much at a
    // precision neither surface offers any more.
    const rows = [sess({ id: "a", cost: 0.0042 })]
    const gap = widgetGap(ok({ cost: 0 }), widgetSessions(payload(rows)))
    expect(gap!.amountText).toBe("<$0.01")
    // The exact number is still reachable, which is why this is a bounds
    // change and not a loss of the finding.
    expect(gap!.delta).toBeCloseTo(0.0042, 9)
  })

  it("prints nothing without two figures to compare", () => {
    const rows = [sess({ id: "a", cost: 5 })]
    // No sessions payload: there is no row figure at all.
    expect(widgetGap(ok({ cost: 0 }), widgetSessions(null))).toBeNull()
    // No healthy summary: the hero is a dash, and the difference between a
    // dash and a number is not a gap.
    expect(widgetGap(degraded, widgetSessions(payload(rows)))).toBeNull()
    expect(widgetGap(null, widgetSessions(payload(rows)))).toBeNull()
  })

  it("refuses to print a gap built on a figure that is not a number", () => {
    const rows = [sess({ id: "a", cost: 5 })]
    expect(widgetGap(ok({ cost: Number.NaN }), widgetSessions(payload(rows)))).toBeNull()
    const broken = { ...widgetSessions(payload(rows)), total: Number.POSITIVE_INFINITY }
    expect(widgetGap(ok({ cost: 0 }), broken)).toBeNull()
  })
})

describe("sharePercents", () => {
  it("gives every row its share of the total, to one decimal", () => {
    expect(sharePercents([1], 4)).toEqual([25])
    expect(sharePercents([1], 3)).toEqual([33.4])
  })

  it("adds up to 100 for six equal models instead of 100.2", () => {
    // Rounding each row on its own printed six 16.7% cells.
    const shares = sharePercents([1, 1, 1, 1, 1, 1], 6)
    expect(shares.filter((s) => s === 16.7)).toHaveLength(4)
    expect(shares.filter((s) => s === 16.6)).toHaveLength(2)
    expect(round1(shares.reduce((a, b) => a + b, 0))).toBe(100)
  })

  it("adds up to 100 on the worst case the panel was built for", () => {
    // 37.5 + 25 + 18.8 + 12.5 + 6.3 was 100.1 on screen.
    const shares = sharePercents([300, 200, 150, 100, 50], 800)
    expect(shares).toEqual([37.5, 25, 18.8, 12.5, 6.2])
    expect(round1(shares.reduce((a, b) => a + b, 0))).toBe(100)
  })

  it("adds up to 100 for every row count and shape it can meet", () => {
    const vectors: number[][] = [
      [1],
      [1, 1],
      [1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      [0.01, 99.99],
      [0.5, 13445.66],
      [3, 3, 2, 1, 1],
      [100, 99, 98, 97, 96, 95, 94],
      [1, 0, 0, 0],
      [12345.67, 1, 1],
      [0.0001, 0.0002, 99999.99],
    ]
    for (const v of vectors) {
      const total = v.reduce((a, b) => a + b, 0)
      const shares = sharePercents(v, total)
      expect(round1(shares.reduce((a, b) => a + b, 0)), v.join("+")).toBe(100)
      // The leftover tenth must not overstate a row. A $0.0001 share of
      // $100,000 is 0.000001%, which stays at 0.0% and prints "<0.1%";
      // what it may never do is collect a tenth it has no claim to.
      for (const [i, s] of shares.entries()) {
        expect(s, `${v[i]} of ${total}`).toBeLessThanOrEqual(
          Math.ceil((v[i] / total) * 1000) / 10 + 1e-9,
        )
      }
    }
  })

  it("never gives a tenth to a model that spent nothing", () => {
    // The leftover tenth goes to the largest remainder, and a zero-cost
    // row's remainder is the smallest there is. If it ever collected one,
    // an unpriced model would print a share and stop meaning "nothing to
    // divide".
    const shares = sharePercents([13445.66, 0.5, 0], 13446.16)
    expect(shares[2]).toBe(0)
    expect(round1(shares.reduce((a, b) => a + b, 0))).toBe(100)
  })

  it("refuses to divide by nothing", () => {
    expect(sharePercents([], 0)).toEqual([])
    expect(sharePercents([0, 0], 0)).toEqual([0, 0])
    expect(sharePercents([5], 0)).toEqual([0])
    expect(sharePercents([5], -1)).toEqual([0])
    expect(sharePercents([5], Number.POSITIVE_INFINITY)).toEqual([0])
    expect(sharePercents([Number.NaN, 5], 5)).toEqual([0, 100])
  })
})

describe("shareText", () => {
  it("drops the decimal on a whole percentage and keeps a real one", () => {
    expect(shareText(25, true)).toBe("25%")
    expect(shareText(33.3, true)).toBe("33.3%")
  })

  it("dashes a share of nothing rather than claiming 0%", () => {
    expect(shareText(0, false)).toBe("—")
    expect(shareText(Number.NaN, true)).toBe("—")
  })

  it("says <0.1% when the model spent money too little to round", () => {
    // $0.50 of $13,446.16 is 0.0037%. The em-dash used to say both
    // "no share to give" and "smaller than a tenth of a percent", and a
    // reader could not tell which one they were looking at.
    expect(shareText(0, true)).toBe("<0.1%")
  })
})

describe("widgetModels", () => {
  it("computes each share against every model row, not just the shown ones", () => {
    const summary = ok({
      models: [usage(6), usage(3, 10), usage(1, 10)],
    })
    const view = widgetModels(summary, undefined, 1)
    expect(view.total).toBe(10)
    expect(view.rows).toHaveLength(1)
    expect(view.rows[0].shareText).toBe("60%")
    expect(view.remaining).toBe(2)
  })

  it("labels an unpriced model rather than letting $0.00 read as free", () => {
    const summary = ok({ models: [usage(5, 100), usage(0, 9999)] })
    const view = widgetModels(summary, undefined)
    const unpriced = view.rows.find((r) => r.unpriced)
    expect(unpriced).toBeDefined()
    expect(unpriced!.costText).toBe("$0.00")
    expect(unpriced!.shareText).toBe("—")
  })

  it("reports an unpriced model anywhere in the payload, not only in the rows shown", () => {
    // The footer's unpriced clause is conditioned on this, and
    // in the real data the unpriced model is the only model there
    // is, so a test that only looked at the visible rows would pass while
    // the clause never printed.
    const models = [
      usage(5, 100),
      usage(4, 100),
      usage(3, 100),
      usage(2, 100),
      usage(0, 9999), // unpriced, and fifth
    ]
    expect(widgetModels(ok({ models }), undefined, 4).anyUnpriced).toBe(true)
    expect(widgetModels(ok({ models: [usage(5, 100)] }), undefined, 4).anyUnpriced).toBe(false)
    expect(widgetModels(degraded, undefined).anyUnpriced).toBe(false)
    expect(widgetModels(null, undefined).anyUnpriced).toBe(false)
  })

  it("prefers the display-name map and falls back to the short id", () => {
    const summary = ok({ models: [usage(1)] })
    expect(widgetModels(summary, { "opencode/gpt-5": "GPT-5" }).rows[0].name).toBe("GPT-5")
    expect(widgetModels(summary, undefined).rows[0].name).toBe("gpt-5")
  })

  it("keeps the variant on the visible label and the raw key", () => {
    const summary = ok({
      models: [
        { ...usage(1), model: { providerID: "opencode", id: "gpt-5", variant: "high" } },
      ],
    })
    const row = widgetModels(summary, undefined).rows[0]
    expect(row.name).toBe("gpt-5 · high")
    expect(row.full).toBe("opencode/gpt-5 · high")
  })

  it("claims nothing when the payload is degraded or missing", () => {
    for (const summary of [degraded, null]) {
      const view = widgetModels(summary, undefined)
      expect(view.exact).toBe(false)
      expect(view.rows).toEqual([])
      expect(view.total).toBe(0)
    }
  })

  it("says no model usage without pretending it is a share of zero", () => {
    const view = widgetModels(ok({ models: [] }), undefined)
    expect(view.exact).toBe(true)
    expect(view.rows).toEqual([])
    expect(view.remaining).toBe(0)
  })

  it("defaults to the panel's row budget", () => {
    const models = Array.from({ length: 8 }, (_, i) => usage(8 - i, 10))
    expect(widgetModels(ok({ models }), undefined).rows).toHaveLength(WIDGET_MODEL_ROWS)
  })

  it("shows no rows for a zero or negative budget, and counts all of them", () => {
    const models = Array.from({ length: 3 }, (_, i) => usage(3 - i, 10))
    for (const limit of [0, -1, -100]) {
      const view = widgetModels(ok({ models }), undefined, limit)
      expect(view.rows).toEqual([])
      expect(view.remaining).toBe(3)
      expect(view.total).toBe(6)
    }
  })

  it("prints a share for a model that spent money too little to round", () => {
    // End to end through the row: $0.50 of $13,446.16 next to the
    // $13,445.66 that makes up the rest. The old em-dash made the two rows
    // look like one model spent nothing. The big row's exact share is
    // 99.996%, which is 100.0% at one decimal, and the leftover tenth
    // goes to it rather than to the row that spent $0.50.
    const summary = ok({ models: [usage(13445.66, 900000), usage(0.5, 1200)] })
    const view = widgetModels(summary, undefined)
    expect(view.rows.map((r) => [r.costText, r.shareText])).toEqual([
      ["$13,445.66", "100%"],
      ["$0.50", "<0.1%"],
    ])
  })

  it("keeps the visible column under 100 and the whole payload at 100", () => {
    const models = Array.from({ length: 6 }, () => usage(1, 1000))
    const view = widgetModels(ok({ models }), undefined)
    const visible = view.rows.map((r) => Number(r.shareText.replace("%", "")))
    expect(visible).toEqual([16.7, 16.7, 16.7, 16.7])
    expect(round1(visible.reduce((a, b) => a + b, 0))).toBeLessThanOrEqual(100)
    expect(round1(sharePercents(models.map((m) => m.cost), 6).reduce((a, b) => a + b, 0))).toBe(100)
    expect(view.remaining).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// The footer's last-refresh text, and the quit control's arm
// ---------------------------------------------------------------------------

describe("widgetRefreshText", () => {
  it("uses the panel's existing relative style, prefixed by 'updated'", () => {
    // The wording is unchanged from the top strip it came from. What changed is
    // that this is now the only place the panel says it, which is what makes the
    // next two tests load-bearing rather than redundant.
    expect(widgetRefreshText({ updatedAt: 1_000_000, unreachable: false, now: 1_000_000 })).toBe(
      "updated just now",
    )
    expect(widgetRefreshText({ updatedAt: 0, unreachable: false, now: 3 * 60000 })).toBe(
      "updated 3m ago",
    )
    expect(widgetRefreshText({ updatedAt: 0, unreachable: false, now: 5 * 3600_000 })).toBe(
      "updated 5h ago",
    )
    expect(widgetRefreshText({ updatedAt: 0, unreachable: false, now: 2 * 86400_000 })).toBe(
      "updated 2d ago",
    )
  })

  it("says the dashboard is unreachable instead of claiming a refresh", () => {
    // The exactness rule applied to the timestamp itself. A rejected fetch still
    // stamps `updatedAt`, so printing "updated just now" here would be true
    // about the request and false about the numbers.
    expect(
      widgetRefreshText({ updatedAt: 1_000_000, unreachable: true, now: 1_000_000 }),
    ).toBe("dashboard unreachable")
  })

  it("prints nothing before the first settle, leaving 'loading' to the footnote", () => {
    expect(widgetRefreshText({ updatedAt: null, unreachable: false, now: 5_000_000 })).toBe("")
  })

  it("never prints both a failure and a time, in any combination", () => {
    // The property the one-place rule exists to protect, asserted over the whole
    // truth table rather than case by case.
    for (const updatedAt of [null, 0, 1_000_000]) {
      for (const unreachable of [false, true]) {
        const text = widgetRefreshText({ updatedAt, unreachable, now: 1_000_000 })
        expect(text.includes("unreachable") && text.includes("updated")).toBe(false)
        expect(text).not.toBe("updated unreachable")
      }
    }
  })
})

describe("widgetQuitPress", () => {
  const T0 = 1_700_000_000_000

  it("arms on the first press and sends on the second, and never on the first", () => {
    // The whole reason the control exists. This app has no Dock icon and no app
    // menu, so a quit that happened on a stray click leaves no way back but a
    // terminal.
    const once = widgetQuitPress(WIDGET_QUIT_IDLE, T0)
    expect(once.phase).toBe("armed")
    expect(once.armedAt).toBe(T0)
    expect(widgetQuitPress(once, T0 + 50).phase).toBe("sent")
  })

  it("cannot send from idle, whatever the clock says", () => {
    // The clock is not a path to a single-click quit.
    for (const now of [T0, T0 + WIDGET_QUIT_ARM_MS * 100, T0 - WIDGET_QUIT_ARM_MS]) {
      expect(widgetQuitPress(WIDGET_QUIT_IDLE, now).phase).toBe("armed")
    }
  })

  it("re-arms instead of sending once the window has already run out", () => {
    // The timer can be late (a webview in a closed popover is throttled), and a
    // press arriving after the window must start a new confirmation rather than
    // finish one the reader never saw the whole of.
    const armed = { phase: "armed", armedAt: T0 } as const
    const late = widgetQuitPress(armed, T0 + WIDGET_QUIT_ARM_MS)
    expect(late.phase).toBe("armed")
    expect(late.armedAt).toBe(T0 + WIDGET_QUIT_ARM_MS)
  })

  it("does nothing once sent, so a third press cannot re-fire the URL", () => {
    const sent = widgetQuitPress(widgetQuitPress(WIDGET_QUIT_IDLE, T0), T0 + 100)
    const again = widgetQuitPress(sent, T0 + 200)
    expect(again).toBe(sent)
    expect(again.phase).toBe("sent")
  })
})

describe("widgetQuitElapsed", () => {
  const T0 = 1_700_000_000_000
  const armed = { phase: "armed", armedAt: T0 } as const

  it("leaves an arm alone inside the window and disarms it at the deadline", () => {
    expect(widgetQuitElapsed(armed, T0).phase).toBe("armed")
    expect(widgetQuitElapsed(armed, T0 + WIDGET_QUIT_ARM_MS - 1).phase).toBe("armed")
    expect(widgetQuitElapsed(armed, T0 + WIDGET_QUIT_ARM_MS).phase).toBe("idle")
    expect(widgetQuitElapsed(armed, T0 + WIDGET_QUIT_ARM_MS + 60_000).phase).toBe("idle")
  })

  it("returns the same object while the window is open, so a poll does not re-arm", () => {
    // Identity, not equality. The panel re-renders every 30 seconds and the
    // timer effect depends on this object; a fresh object each time would
    // restart the countdown forever and the control would never expire.
    expect(widgetQuitElapsed(armed, T0 + 10)).toBe(armed)
    expect(widgetQuitElapsed(WIDGET_QUIT_IDLE, T0)).toBe(WIDGET_QUIT_IDLE)
    const sent = { phase: "sent", armedAt: null } as const
    expect(widgetQuitElapsed(sent, T0)).toBe(sent)
  })

  it("disarms to the module's idle constant, not a fresh idle", () => {
    expect(widgetQuitElapsed(armed, T0 + WIDGET_QUIT_ARM_MS)).toBe(WIDGET_QUIT_IDLE)
  })

  it("agrees with widgetQuitExpired, which is the same boundary", () => {
    for (const d of [0, 1, WIDGET_QUIT_ARM_MS - 1, WIDGET_QUIT_ARM_MS, WIDGET_QUIT_ARM_MS + 1]) {
      expect(widgetQuitExpired(armed, T0 + d)).toBe(d >= WIDGET_QUIT_ARM_MS)
      expect(widgetQuitElapsed(armed, T0 + d).phase).toBe(
        d >= WIDGET_QUIT_ARM_MS ? "idle" : "armed",
      )
    }
  })
})

describe("widgetQuitDisarm", () => {
  const T0 = 1_700_000_000_000

  it("disarms an armed control on pointer-out", () => {
    // The pointer-out case is what prevents the one genuinely bad sequence: arm,
    // look away, reach for something else, and have a click on a different
    // control read as a confirmation.
    expect(widgetQuitDisarm({ phase: "armed", armedAt: T0 })).toBe(WIDGET_QUIT_IDLE)
  })

  it("never touches a sent request, because there is nothing left to disarm", () => {
    const sent = { phase: "sent", armedAt: null } as const
    expect(widgetQuitDisarm(sent)).toBe(sent)
  })

  it("is a no-op on an idle control", () => {
    expect(widgetQuitDisarm(WIDGET_QUIT_IDLE)).toBe(WIDGET_QUIT_IDLE)
  })
})

describe("widgetQuitView", () => {
  const T0 = 1_700_000_000_000

  it("labels all three phases with different, non-empty strings", () => {
    const idle = widgetQuitView(WIDGET_QUIT_IDLE)
    const armed = widgetQuitView({ phase: "armed", armedAt: T0 })
    const sent = widgetQuitView({ phase: "sent", armedAt: null })
    expect([idle.label, armed.label, sent.label]).toEqual([
      WIDGET_QUIT_LABEL,
      WIDGET_QUIT_ARMED_LABEL,
      WIDGET_QUIT_SENT_LABEL,
    ])
    expect(new Set([idle.label, armed.label, sent.label]).size).toBe(3)
    for (const v of [idle, armed, sent]) expect(v.label.trim().length).toBeGreaterThan(0)
  })

  it("gives every phase an accessible name, and says what a second click means", () => {
    for (const v of [
      widgetQuitView(WIDGET_QUIT_IDLE),
      widgetQuitView({ phase: "armed", armedAt: T0 }),
      widgetQuitView({ phase: "sent", armedAt: null }),
    ]) {
      expect(v.ariaLabel.trim().length).toBeGreaterThan(10)
    }
    // The unarmed name has to name the two-step, or a screen reader user is
    // told to press a button that will not do the thing they expect.
    expect(widgetQuitView(WIDGET_QUIT_IDLE).ariaLabel).toContain("second click")
    expect(widgetQuitView({ phase: "armed", armedAt: T0 }).ariaLabel).toContain("Press again")
  })

  it("says SENT and never says it quit, because the page cannot observe a quit", () => {
    // The one claim the panel is allowed to make. If a shell is older than the
    // scheme, nothing happens and the panel is still on screen, so "quit" or
    // "closing" anywhere in this view would be a statement about a process this
    // code cannot see.
    const sent = widgetQuitView({ phase: "sent", armedAt: null })
    const words = `${sent.label} ${sent.ariaLabel}`.toLowerCase()
    expect(words).toContain("cannot see")
    expect(words).toContain("terminal")
    expect(words).not.toMatch(/\bquitting\b|\bhas quit\b|\bdone\b|\bsuccess|\bclosed\b/)
    // The visible line is the request, not the outcome: "sent" is the whole
    // claim, and the second half is the recovery rather than a confirmation.
    expect(WIDGET_QUIT_SENT_TEXT.toLowerCase()).toBe(
      "quit request sent · relaunch from a terminal",
    )
  })

  it("disables only the sent phase, so an armed control is still pressable", () => {
    expect(widgetQuitView(WIDGET_QUIT_IDLE).disabled).toBe(false)
    expect(widgetQuitView({ phase: "armed", armedAt: T0 }).disabled).toBe(false)
    expect(widgetQuitView({ phase: "sent", armedAt: null }).disabled).toBe(true)
  })

  it("hands the component a name to put on aria-disabled, and it is never empty", () => {
    // The reason `disabled` is exposed as a field rather than the component
    // inferring the phase: `aria-disabled` needs a boolean, and a screen reader
    // that is being told "this does nothing" should be told what it did do.
    for (const q of [
      WIDGET_QUIT_IDLE,
      { phase: "armed", armedAt: T0 },
      { phase: "sent", armedAt: null },
    ] as const) {
      expect(typeof widgetQuitView(q).disabled).toBe("boolean")
      expect(widgetQuitView(q).ariaLabel.trim()).not.toBe("")
    }
    expect(widgetQuitView({ phase: "sent", armedAt: null }).ariaLabel).toContain("cannot see")
  })

  it("carries no separate announce string, because the aria-label IS the announcement", () => {
    // Asserted as a shape rather than a behaviour: the component puts
    // aria-live on the button itself, so a second field to fill in would be a
    // second place for the sent wording to drift out of agreement with the
    // name a reader actually hears.
    expect(widgetQuitView(WIDGET_QUIT_IDLE)).not.toHaveProperty("announce")
    expect(widgetQuitView({ phase: "sent", armedAt: null })).not.toHaveProperty("announce")
  })
})

describe("WIDGET_QUIT_URL", () => {
  it("is the exact URL the shell has to match, and nothing else is emitted", () => {
    // The oc-dashbar menu bar app matches this string. Scheme, host and
    // path are asserted separately so a rename cannot pass as a refactor.
    const u = new URL(WIDGET_QUIT_URL)
    expect(u.protocol).toBe("oc-dash:")
    expect(u.host).toBe("quit")
    expect(u.pathname).toBe("")
    expect(u.href).toBe("oc-dash://quit")
  })

  it("is not http, so an unhandled navigation fails instead of refetching", () => {
    expect(WIDGET_QUIT_URL.startsWith("http")).toBe(false)
  })
})

describe("WIDGET_QUIT_ARM_MS", () => {
  it("is long enough to read a changed label and short enough to lapse", () => {
    // The two failure modes, as bounds rather than as taste. Under ~2s the
    // second click has to be aimed under a deadline and missing it makes the
    // button look broken; over ~10s the reader comes back to a panel that is
    // armed without their having armed it.
    expect(WIDGET_QUIT_ARM_MS).toBeGreaterThanOrEqual(2_000)
    expect(WIDGET_QUIT_ARM_MS).toBeLessThanOrEqual(10_000)
  })

  it("names its window in the reader's own units", () => {
    expect(widgetQuitView({ phase: "armed", armedAt: 0 }).ariaLabel).toContain("4 seconds")
  })
})

// ---------------------------------------------------------------------------
// The offline path. Two controls, one of which asks the shell to
// spawn a process.
// ---------------------------------------------------------------------------

describe("widgetOfflineActions", () => {
  const T0 = 1_700_000_000_000

  it("offers both controls while the dashboard does not answer", () => {
    // Both, not one instead of the other. The two failures are different and the
    // panel cannot tell them apart: a rejected fetch is one boolean, and the two
    // causes underneath it are `getJson`'s "responded 502" against a fetch
    // TypeError, which `Promise.allSettled` has already discarded. So the panel
    // offers the reader both and each names the failure it is for.
    const offline = widgetOfflineActions(true, WIDGET_START_IDLE)
    expect(offline).not.toBeNull()
    expect(offline?.retry.label).toBe(WIDGET_RETRY_LABEL)
    expect(offline?.start.label).toBe(WIDGET_START_LABEL)
    expect(offline?.retry.armed || offline?.start.armed).toBe(false)
  })

  it("offers NEITHER control while the dashboard answers", () => {
    // The acceptance criterion, as a value rather than as a reading of the
    // markup: null means no button exists, so there is nothing to press and
    // nothing that could emit a start request against a server that is running.
    for (const start of [
      WIDGET_START_IDLE,
      { phase: "armed", armedAt: T0 },
      { phase: "sent", armedAt: T0 },
    ] as const) {
      expect(widgetOfflineActions(false, start)).toBeNull()
    }
  })

  it("gives each control a name that says which failure it is for", () => {
    // The 40px labels cannot carry this, so the accessible names have to.
    const offline = widgetOfflineActions(true, WIDGET_START_IDLE)
    expect(offline?.retry.ariaLabel).toMatch(/unreachable/i)
    expect(offline?.retry.ariaLabel).toMatch(/running/i)
    expect(offline?.start.ariaLabel).toMatch(/not running at all/i)
    for (const a of [offline?.retry.ariaLabel, offline?.start.ariaLabel]) {
      expect(a?.trim().length ?? 0).toBeGreaterThan(20)
    }
  })

  it("leaves the re-fetch unarmed in every phase, because it has no phases", () => {
    // One press runs the panel's existing fetch and there is nothing outside the
    // page that a stray click could spoil, so an arm would be ceremony with no
    // accident behind it.
    const sent = widgetOfflineActions(true, { phase: "sent", armedAt: T0 })
    expect(sent?.retry.armed).toBe(false)
    expect(sent?.retry.sent).toBe(false)
    expect(sent?.retry.disabled).toBe(false)
    expect(sent?.start.sent).toBe(true)
    expect(sent?.start.disabled).toBe(true)
  })
})

describe("widgetStartPress", () => {
  const T0 = 1_700_000_000_000

  it("arms on the first press and sends on the second, and never on the first", () => {
    const once = widgetStartPress(WIDGET_START_IDLE, T0)
    expect(once.phase).toBe("armed")
    expect(once.armedAt).toBe(T0)
    expect(widgetStartPress(once, T0 + 50).phase).toBe("sent")
  })

  it("cannot send from idle, whatever the clock says", () => {
    for (const now of [T0, T0 + WIDGET_START_ARM_MS * 100, T0 - WIDGET_START_ARM_MS]) {
      expect(widgetStartPress(WIDGET_START_IDLE, now).phase).toBe("armed")
    }
  })

  it("re-arms rather than sends once the window has run out", () => {
    const late = widgetStartPress({ phase: "armed", armedAt: T0 }, T0 + WIDGET_START_ARM_MS)
    expect(late.phase).toBe("armed")
    expect(late.armedAt).toBe(T0 + WIDGET_START_ARM_MS)
  })

  it("does nothing once sent, so no third press can re-fire the URL", () => {
    const sent = widgetStartPress(widgetStartPress(WIDGET_START_IDLE, T0), T0 + 100)
    expect(widgetStartPress(sent, T0 + 200)).toBe(sent)
  })
})

describe("widgetStartSends", () => {
  const T0 = 1_700_000_000_000

  it("emits on the armed-to-sent edge and nowhere else", () => {
    // The emission rule the menu bar app depends on, as a function rather than
    // as an `if` inside the component: one URL per armed intent.
    const armed = widgetStartPress(WIDGET_START_IDLE, T0)
    const sent = widgetStartPress(armed, T0 + 50)
    expect(widgetStartSends(WIDGET_START_IDLE, armed)).toBe(false)
    expect(widgetStartSends(WIDGET_START_IDLE, sent)).toBe(false)
    expect(widgetStartSends(armed, sent)).toBe(true)
  })

  it("emits exactly once per armed intent, over a whole press sequence", () => {
    // The property rather than the case: walk a reader's clicks and count the
    // emissions. A deliberate arm-then-confirm is one; a third press after the
    // sent state is none; a press after the window lapsed starts a NEW intent and
    // is not a second emission of the old one.
    let s = WIDGET_START_IDLE
    let emitted = 0
    const press = (t: number) => {
      const next = widgetStartPress(s, t)
      if (widgetStartSends(s, next)) emitted++
      s = next
    }
    press(T0) // arm
    press(T0 + 120) // send
    for (let i = 0; i < 5; i++) press(T0 + 200 + i * 10) // a third click, and four more
    expect(emitted).toBe(1)
    expect(s.phase).toBe("sent")
    // A settle is what ends the sent state, and then a fresh confirmation can
    // send once more and only once. The lapsed-arm branch is exercised above, in
    // `widgetStartPress`, because reaching it from `sent` needs the settle.
    s = widgetStartSettled(s)
    press(T0 + 10_000)
    expect(s.phase).toBe("armed")
    expect(emitted).toBe(1)
    press(T0 + 10_100)
    expect(emitted).toBe(2)
    press(T0 + 10_200)
    expect(emitted).toBe(2)
  })
})

describe("widgetStartElapsed and widgetStartDisarm", () => {
  const T0 = 1_700_000_000_000
  const armed = { phase: "armed", armedAt: T0 } as const

  it("leaves an arm alone inside the window and disarms it at the deadline", () => {
    expect(widgetStartElapsed(armed, T0).phase).toBe("armed")
    expect(widgetStartElapsed(armed, T0 + WIDGET_START_ARM_MS - 1).phase).toBe("armed")
    expect(widgetStartElapsed(armed, T0 + WIDGET_START_ARM_MS).phase).toBe("idle")
    expect(widgetStartElapsed(armed, T0 + 60_000).phase).toBe("idle")
  })

  it("returns the same object while the window is open, so a poll cannot re-arm it", () => {
    expect(widgetStartElapsed(armed, T0 + 10)).toBe(armed)
    expect(widgetStartElapsed(WIDGET_START_IDLE, T0)).toBe(WIDGET_START_IDLE)
    const sent = { phase: "sent", armedAt: null } as const
    expect(widgetStartElapsed(sent, T0)).toBe(sent)
  })

  it("agrees with widgetStartExpired, which is the same boundary", () => {
    for (const d of [0, 1, WIDGET_START_ARM_MS - 1, WIDGET_START_ARM_MS, WIDGET_START_ARM_MS + 1]) {
      expect(widgetStartExpired(armed, T0 + d)).toBe(d >= WIDGET_START_ARM_MS)
    }
  })

  it("disarms an armed control on pointer-out and never touches a sent request", () => {
    expect(widgetStartDisarm(armed)).toBe(WIDGET_START_IDLE)
    const sent = { phase: "sent", armedAt: null } as const
    expect(widgetStartDisarm(sent)).toBe(sent)
    expect(widgetStartDisarm(WIDGET_START_IDLE)).toBe(WIDGET_START_IDLE)
  })
})

describe("widgetStartSettled", () => {
  const T0 = 1_700_000_000_000

  it("ends a sent request when the next settle lands, so the control is not dead", () => {
    // The distinction this rule exists for: `sent` is terminal for the EMISSION
    // and not for the CONTROL. A control that could be pressed once per popover
    // would leave a failed spawn with no recovery but closing the panel.
    const sent = { phase: "sent", armedAt: T0 } as const
    expect(widgetStartSettled(sent)).toBe(WIDGET_START_IDLE)
    expect(widgetStartSettled(sent).phase).toBe("idle")
  })

  it("never eats an arm, because the poll lands every 30s whether or not anyone reads", () => {
    // Disarming here would have a background timer cancelling confirmations at
    // random, which reads as a broken button rather than as a careful one.
    const armed = { phase: "armed", armedAt: T0 } as const
    expect(widgetStartSettled(armed)).toBe(armed)
    expect(widgetStartSettled(WIDGET_START_IDLE)).toBe(WIDGET_START_IDLE)
  })
})

describe("widgetStartView", () => {
  const T0 = 1_700_000_000_000

  it("labels all three phases with different, non-empty strings", () => {
    const views = [
      widgetStartView(WIDGET_START_IDLE),
      widgetStartView({ phase: "armed", armedAt: T0 }),
      widgetStartView({ phase: "sent", armedAt: null }),
    ]
    expect(views.map((v) => v.label)).toEqual([
      WIDGET_START_LABEL,
      WIDGET_START_ARMED_LABEL,
      WIDGET_START_SENT_LABEL,
    ])
    expect(new Set(views.map((v) => v.label)).size).toBe(3)
    for (const v of views) expect(v.label.trim().length).toBeGreaterThan(0)
  })

  it("says SENT and never says it started, because the page cannot observe a spawn", () => {
    // The one claim the panel is allowed to make. The shell logs what it did in
    // a terminal the reader may not be looking at, so anything stronger here is a
    // statement about a process this code cannot see.
    const sent = widgetStartView({ phase: "sent", armedAt: null })
    const words = `${sent.label} ${sent.ariaLabel}`.toLowerCase()
    expect(words).toContain("cannot see")
    // Affirmative claims only: the sentence has to be able to NAME the verb in a
    // negation, which is what "cannot see whether the server started" does.
    expect(words).not.toMatch(
      /\bhas started\b|\bstarted successfully\b|\bis starting\b|\bnow running\b|\bdone\b|\bsuccess/,
    )
    expect(WIDGET_START_SENT_TEXT).toMatch(/^start request sent · /)
    expect(WIDGET_START_SENT_TEXT).not.toMatch(/\bstarted\b|\bsuccess|\bdone\b/)
  })

  it("tells the reader the first press only arms, in both names that matter", () => {
    expect(widgetStartView(WIDGET_START_IDLE).ariaLabel).toContain("second click")
    expect(widgetStartView({ phase: "armed", armedAt: T0 }).ariaLabel).toContain("Press again")
  })

  it("disables only the sent phase, so an armed control is still pressable", () => {
    expect(widgetStartView(WIDGET_START_IDLE).disabled).toBe(false)
    expect(widgetStartView({ phase: "armed", armedAt: T0 }).disabled).toBe(false)
    expect(widgetStartView({ phase: "sent", armedAt: null }).disabled).toBe(true)
  })
})

describe("WIDGET_START_URL", () => {
  it("is the exact string the oc-dashbar menu bar app has to match", () => {
    // Protocol, host, path and href asserted separately, as for the quit
    // URL, so a rename cannot pass as a refactor and a trailing path cannot pass
    // as the same verb. The shell path-constrains the match, so
    // `start-server/anything` would be a request nobody answers.
    const u = new URL(WIDGET_START_URL)
    expect(u.protocol).toBe("oc-dash:")
    expect(u.host).toBe("start-server")
    expect(u.pathname).toBe("")
    expect(u.href).toBe("oc-dash://start-server")
    // The verb is the whole of the host: nothing after it, so
    // `oc-dash://start-server/anything` cannot be a second working spelling.
    expect(WIDGET_START_URL.split("//")[1]).toBe("start-server")
  })

  it("is a sibling of the quit URL, sharing the scheme and nothing else", () => {
    // One mechanism, two verbs. If the schemes ever diverge the shell needs two
    // delegate cases, which is the reconciliation this design avoids.
    expect(new URL(WIDGET_START_URL).protocol).toBe(new URL(WIDGET_QUIT_URL).protocol)
    expect(new URL(WIDGET_START_URL).host).not.toBe(new URL(WIDGET_QUIT_URL).host)
  })

  it("is not http, so an unhandled navigation fails instead of refetching", () => {
    expect(WIDGET_START_URL.startsWith("http")).toBe(false)
  })
})

describe("WIDGET_OFFLINE_URL", () => {
  it("is the exact string the oc-dashbar menu bar app has to match", () => {
    // Pinned component by component, as for the quit and start URLs, so a rename
    // cannot pass as a refactor and a trailing path cannot pass as the same verb.
    // The shell path-constrains its match, so `offline/anything` would be a
    // request nobody answers.
    const u = new URL(WIDGET_OFFLINE_URL)
    expect(u.protocol).toBe("oc-dash:")
    expect(u.host).toBe("offline")
    expect(u.pathname).toBe("")
    expect(u.href).toBe("oc-dash://offline")
    // The verb is the whole of the host: nothing after it.
    expect(WIDGET_OFFLINE_URL.split("//")[1]).toBe("offline")
  })

  it("is a sibling of the other three verbs, sharing the scheme and nothing else", () => {
    // One mechanism, four verbs, one interception point in the shell. If this
    // scheme ever diverged the app would need a fourth delegate case, which is
    // the reconciliation the quit URL already avoided by being written beside the
    // others. Every host has to stay distinct or two verbs collapse into one.
    const offline = new URL(WIDGET_OFFLINE_URL)
    const verbs = [WIDGET_QUIT_URL, WIDGET_START_URL, widgetOpenURL("http://127.0.0.1:4021/")]
    for (const v of verbs) {
      expect(new URL(v).protocol).toBe(offline.protocol)
      expect(new URL(v).host).not.toBe(offline.host)
    }
    // And the four hosts among themselves, which is the property the shell's
    // four `case` statements are standing on.
    const hosts = [...verbs, WIDGET_OFFLINE_URL].map((v) => new URL(v).host)
    expect(new Set(hosts).size).toBe(hosts.length)
  })

  it("is not http, so an unhandled navigation fails instead of refetching", () => {
    // Same reason as the other two: the panel is served over http from inside the
    // very process it is asking about. An http navigation would be answered by
    // that process rather than caught by its delegate, so an old shell that never
    // matches would silently reload the panel instead of leaving it alone.
    expect(WIDGET_OFFLINE_URL.startsWith("http")).toBe(false)
  })
})

describe("WIDGET_OFFLINE_FAILURES", () => {
  it("is 2, so a single missed poll during a restart cannot blank the panel", () => {
    // The Captain restarts `npm run dev` routinely, and a restart is a refused
    // connection. At 1 every restart would throw his panel out to the help page,
    // which is the worst available outcome for a control whose job is to notice
    // something he would have noticed anyway. Pinned as a literal and not as a
    // range, because the Officer set this number and the Captain is the person
    // who changes it.
    expect(WIDGET_OFFLINE_FAILURES).toBe(2)
  })

  it("costs about a minute of real loss at the panel's poll cadence", () => {
    // The reason two is not arbitrary: it is read in the reader's units, and a
    // threshold nobody can translate into seconds is a threshold nobody can
    // decide to shorten.
    expect(WIDGET_OFFLINE_FAILURES * WIDGET_POLL_MS).toBe(60_000)
  })
})

describe("the offline verb's latch", () => {
  /**
   * Replays a sequence of poll outcomes and returns what each poll emitted: 1 for
   * the poll that navigated, 0 for the ones that did not.
   *
   * This is the harness the three required behaviours are all properties of. The
   * panel's only job here is the transition, so a sequence is the honest unit of
   * assertion rather than a single state.
   */
  function runPolls(outcomes: boolean[]): number[] {
    let s: WidgetOffline = WIDGET_OFFLINE_IDLE
    return outcomes.map((reachable) => {
      const next = widgetOfflinePoll(s, reachable)
      const emitted = widgetOfflineSends(s, next) ? 1 : 0
      s = next
      return emitted
    })
  }

  it("emits nothing until two polls in a row have failed", () => {
    // One failed poll is a blip, and swapping the whole document on a blip is
    // worse than the blip. Asserted on the prefix rather than on the whole
    // sequence so the threshold cannot drift to 1 without the first case failing.
    expect(runPolls([true, false])).toEqual([0, 0])
    expect(runPolls([true, false, false])).toEqual([0, 0, 1])
  })

  it("emits once per loss, not once per failed poll", () => {
    // Behaviour 1. The fifth and sixth polls below are as dead as the third, and
    // an old shell that never matched `offline` leaves the panel sitting there
    // failing forever, so a rule that emitted per poll would navigate on every
    // one of them.
    const emitted = runPolls([true, false, false, false, false, false, false])
    expect(emitted).toEqual([0, 0, 1, 0, 0, 0, 0])
    expect(emitted.reduce((a, b) => a + b, 0)).toBe(1)
  })

  it("emits exactly twice across a loss, a recovery and a second loss", () => {
    // Behaviour 2, as the brief asks for it: the sequence rather than the
    // individual state, because the latch and the reset are two different rules
    // and only the sequence shows that they compose.
    const emitted = runPolls([
      true, // loads
      false, // first missed poll
      false, // second: emit
      false, // still dead, already sent
      true, // recovers: count cleared, latch disarmed
      false, // second loss, first missed poll
      false, // second loss, second: emit again
      false, // still dead
    ])
    expect(emitted).toEqual([0, 0, 1, 0, 0, 0, 1, 0])
    expect(emitted.reduce((a, b) => a + b, 0)).toBe(2)
  })

  it("never emits on a panel that never loaded, however long it stays down", () => {
    // The shell already answers a failed navigation with its help page, so a verb
    // emitted here would be a second and redundant path to the place the reader is
    // already at. This is also the reason the latch carries `armed` separately
    // from the panel's own `loaded`, which is true after a failed settle too.
    expect(runPolls([false, false, false, false, false, false])).toEqual([0, 0, 0, 0, 0, 0])
  })

  it("never emits on a blip between healthy polls", () => {
    // The case the threshold exists for, stated as the exact thing the Captain
    // does: restart the dev server, miss one poll, get the panel back untouched.
    expect(runPolls([true, false, true, false, true, false, true])).toEqual([
      0, 0, 0, 0, 0, 0, 0,
    ])
  })

  it("resets the failure count on every good poll, not only after an emission", () => {
    // A count that survived a success would mean two failures an hour apart, with
    // a working panel in between, blanked the panel.
    let s: WidgetOffline = WIDGET_OFFLINE_IDLE
    for (let i = 0; i < 10; i++) {
      s = widgetOfflinePoll(widgetOfflinePoll(s, false), true)
    }
    expect(s.failures).toBe(0)
    expect(s.sent).toBe(false)
  })

  it("arms on a good poll and disarms nothing, because the next loss can emit", () => {
    // Deliberate and counter-intuitive next to the spawn control, whose settle
    // takes a `sent` state back to `idle`. Here a good poll is the only thing that
    // can make the next request possible, so it returns an ARMED state. Pinned so
    // the name cannot be "fixed" into the other convention and quietly break the
    // second loss.
    expect(widgetOfflinePoll(WIDGET_OFFLINE_IDLE, true)).toEqual({
      failures: 0,
      armed: true,
      sent: false,
    })
    const recovered = widgetOfflinePoll({ failures: 9, armed: true, sent: true }, true)
    expect(recovered).toEqual({ failures: 0, armed: true, sent: false })
  })

  it("counts failures past the threshold rather than clamping, and holds the latch", () => {
    // The count is the count: it is the evidence that the panel has been down for
    // a minute, and the latch is what stops it being a navigation per poll.
    const dead = widgetOfflinePoll({ failures: 6, armed: true, sent: true }, false)
    expect(dead.failures).toBe(7)
    expect(dead.sent).toBe(true)
  })

  it("starts inert, so a panel that never polls cannot emit", () => {
    expect(WIDGET_OFFLINE_IDLE).toEqual({ failures: 0, armed: false, sent: false })
  })
})

describe("widgetOfflineSends", () => {
  it("emits on the armed-to-sent edge and nowhere else", () => {
    // The emission rule as a function rather than as an `if` in the component,
    // which is what keeps a StrictMode double-invoked updater from navigating
    // twice and replacing the document twice.
    const loaded = widgetOfflinePoll(WIDGET_OFFLINE_IDLE, true)
    const first = widgetOfflinePoll(loaded, false)
    const second = widgetOfflinePoll(first, false)
    const third = widgetOfflinePoll(second, false)
    expect(widgetOfflineSends(loaded, first)).toBe(false)
    expect(widgetOfflineSends(loaded, second)).toBe(true)
    expect(widgetOfflineSends(second, third)).toBe(false)
    expect(widgetOfflineSends(WIDGET_OFFLINE_IDLE, loaded)).toBe(false)
    expect(widgetOfflineSends(loaded, loaded)).toBe(false)
  })
})

describe("the offline verb changes nothing the panel already shows", () => {
  it("carries no view data of its own, so nothing can ride in on the latch", () => {
    // Behaviour 3, as far as a suite with no DOM and no component tests can state
    // it. The latch is three fields and nothing reads them but the two functions
    // above, so "the degraded panel still says its four sentences" is a structural
    // fact here rather than a hope about the markup.
    expect(Object.keys(widgetOfflinePoll(WIDGET_OFFLINE_IDLE, true)).sort()).toEqual([
      "armed",
      "failures",
      "sent",
    ])
  })

  it("leaves the degraded state exactly as it was", () => {
    // The Captain has screenshots of this state and did not ask for it to change,
    // so the strings are pinned here as well as in their own tests. If a future
    // change threads the latch into one of these, this goes red first.
    const T0 = 1_700_000_000_000
    expect(widgetRefreshText({ updatedAt: T0, unreachable: true, now: T0 })).toBe(
      "dashboard unreachable",
    )
    expect(widgetHero(null)).toEqual({ cost: "—", exact: false, degraded: false, reason: null })
    expect(widgetModels(null, {}).rows).toEqual([])
    expect(widgetSessions(null).exact).toBe(false)
    // Both controls, and the retry label the panel wears.
    const offline = widgetOfflineActions(true, WIDGET_START_IDLE)
    expect(offline?.retry.label).toBe(WIDGET_RETRY_LABEL)
    expect(offline?.start.label).toBe(WIDGET_START_LABEL)
    expect(offline?.start.armed || offline?.start.sent).toBe(false)
  })
})

describe("widgetOpenURL", () => {
  it("is the exact string the shell has to match, with the target encoded once", () => {
    // Protocol, host and key asserted separately, as for the other two verbs, so a
    // rename cannot pass as a refactor. The target is the whole absolute URL
    // percent-encoded once, which encodes the colons and slashes and so leaves a
    // value that cannot carry a second `&` or a second `?`.
    expect(widgetOpenURL("http://127.0.0.1:4021/")).toBe(
      "oc-dash://open?url=http%3A%2F%2F127.0.0.1%3A4021%2F",
    )
    const u = new URL(widgetOpenURL("http://127.0.0.1:4021/"))
    expect(u.protocol).toBe("oc-dash:")
    expect(u.host).toBe("open")
    expect(u.pathname).toBe("")
    expect(u.searchParams.get(WIDGET_OPEN_TARGET_KEY)).toBe("http://127.0.0.1:4021/")
  })

  it("is a sibling of the other two verbs, sharing the scheme and nothing else", () => {
    // One mechanism, three verbs, one interception. If the scheme ever diverged
    // the shell would need three delegate cases, which is the reconciliation the
    // quit and start URLs already avoided by being written beside each other.
    const open = widgetOpenURL("http://127.0.0.1:4021/")
    expect(new URL(open).protocol).toBe(new URL(WIDGET_QUIT_URL).protocol)
    expect(new URL(open).protocol).toBe(new URL(WIDGET_START_URL).protocol)
    expect(new URL(open).host).not.toBe(new URL(WIDGET_QUIT_URL).host)
    expect(new URL(open).host).not.toBe(new URL(WIDGET_START_URL).host)
    // It is not http, so a shell too old to know the verb fails the navigation
    // instead of refetching the panel at a URL nothing serves.
    expect(open.startsWith("http")).toBe(false)
  })

  it("cannot be talked into carrying a second parameter", () => {
    // The reason the whole URL is encoded rather than its path. A target that
    // already holds a query of its own must arrive at the shell as one opaque
    // value, not as a second key it would then have to allow or deny.
    const hostile = "http://127.0.0.1:4021/?range=30d&x=1"
    const url = widgetOpenURL(hostile)
    // Exactly one `?`, from the prefix, and no `&` at all: the target own query
    // has been encoded, so it cannot add a key or split the one it is in.
    expect(url.match(/[?]/g)).toHaveLength(1)
    expect(url).not.toContain("&")
    expect(new URL(url).searchParams.getAll(WIDGET_OPEN_TARGET_KEY)).toHaveLength(1)
    expect(new URL(url).searchParams.get(WIDGET_OPEN_TARGET_KEY)).toBe(hostile)
  })
})

describe("widgetDashboardTarget", () => {
  it("is the origin the panel was served from, with a trailing slash", () => {
    // The panel is served by the process it is asking about and the dashboard is
    // that process's own root, so a panel opened against a test port opens that
    // port's dashboard without a configured URL anywhere.
    expect(widgetDashboardTarget("http://127.0.0.1:4021")).toBe("http://127.0.0.1:4021/")
    expect(widgetDashboardTarget("https://localhost:5273")).toBe("https://localhost:5273/")
  })

  it("refuses anything that is not an http origin rather than emitting it", () => {
    // Null, not a fallback. An opaque origin is not a dashboard, and handing one
    // to the shell is the panel asking for something it cannot have; the whole
    // point of the null is that the caller has to decide what to do about it.
    for (const bad of ["", "null", "file:///tmp", "about:blank", "data:text/html,x", "127.0.0.1:4021", "http://"]) {
      expect(widgetDashboardTarget(bad)).toBeNull()
    }
  })

  it("refuses an origin carrying a path or a slash, so the target cannot double up", () => {
    // `window.location.origin` never has either, so this is the belt to the
    // braces above: an origin that arrived with a slash in it would produce a
    // `//` and a target the shell's path allowlist would have to reason about.
    expect(widgetDashboardTarget("http://127.0.0.1:4021/")).toBeNull()
    expect(widgetDashboardTarget("http://127.0.0.1:4021/widget")).toBeNull()
  })
})

describe("the labels the two new affordances wear", () => {
  it("names the control and the destination, and never claims the outcome", () => {
    // The panel cannot see whether a browser opened: there is no reply to a
    // navigation. So the accessible name says what was asked for, not that it
    // worked, and it is distinct from the quit control's, which is the other
    // thing in the same row.
    expect(WIDGET_OPEN_LABEL).toBe("Dashboard")
    expect(WIDGET_OPEN_ARIA).toContain("dashboard")
    expect(WIDGET_OPEN_ARIA).not.toBe(WIDGET_OPEN_ARIA.toLowerCase())
    expect(WIDGET_OPEN_ARIA).not.toBe(WIDGET_QUIT_ARMED_LABEL)
    // The tooltip exists because a 9.5px label cannot say what pressing the
    // control does, and it must not become a second, quieter claim: it says the
    // same thing the accessible name says, minus the sentence about what the
    // panel cannot observe.
    expect(WIDGET_OPEN_TITLE).toBe("Open the oc-dash dashboard in your browser")
    expect(WIDGET_OPEN_ARIA.startsWith(WIDGET_OPEN_TITLE)).toBe(true)
  })

  it("says which table each link belongs to, and carries no range", () => {
    // Two identical `view all` links in one popover are two identical controls
    // to a screen reader, and a label that mentioned the current range would be
    // claiming something the link cannot deliver.
    expect(WIDGET_VIEW_ALL_ARIA).not.toBe(WIDGET_VIEW_ALL_MODELS_ARIA)
    for (const aria of [WIDGET_VIEW_ALL_ARIA, WIDGET_VIEW_ALL_MODELS_ARIA]) {
      expect(aria).toContain("dashboard")
      expect(aria.toLowerCase()).not.toContain("range")
      expect(aria.toLowerCase()).not.toContain("7 days")
      expect(aria.toLowerCase()).not.toContain("30 days")
      expect(aria.toLowerCase()).not.toContain("today")
    }
    // Three words, lower case: the table header is upper case and a link has to
    // read as something to press rather than as part of the caption.
    expect(WIDGET_VIEW_ALL_LABEL).toBe("view all")
  })
})

describe("WIDGET_START_ARM_MS", () => {
  it("is shorter than the quit window, because a wrong start is not a wrong quit", () => {
    // The ceremony is not negotiable and the window is: quitting costs the reader
    // their status item and only a terminal brings it back, while a server nobody
    // wanted is a process they can stop. So the window is halved rather than
    // dropped, and never below the floor set for the destructive control.
    expect(WIDGET_START_ARM_MS).toBeGreaterThanOrEqual(2_000)
    expect(WIDGET_START_ARM_MS).toBeLessThan(WIDGET_QUIT_ARM_MS)
    expect(WIDGET_START_ARM_MS).toBeLessThan(WIDGET_POLL_MS)
  })

  it("names its window in the reader's own units", () => {
    expect(widgetStartView({ phase: "armed", armedAt: 0 }).ariaLabel).toContain("2 seconds")
  })
})

describe("the two arm ceremonies are the same ceremony", () => {
  const T0 = 1_700_000_000_000

  it("gives both machines identical phases for presses inside both windows", () => {
    // "Reuse the pattern rather than invent a second one", asserted
    // rather than claimed. Two machines are needed only because the arm window is
    // a constant each of them reads; every other rule is shared, and this is the
    // test that says so. Press times are chosen to sit inside BOTH windows so the
    // only difference between the two runs is the constant.
    for (const second of [1, 50, 200, 900, 1_500]) {
      const q1 = widgetQuitPress(WIDGET_QUIT_IDLE, T0)
      const s1 = widgetStartPress(WIDGET_START_IDLE, T0)
      expect(s1.phase).toBe(q1.phase)
      expect(s1.armedAt).toBe(q1.armedAt)
      const q2 = widgetQuitPress(q1, T0 + second)
      const s2 = widgetStartPress(s1, T0 + second)
      expect(s2.phase).toBe(q2.phase)
      expect(s2.armedAt).toBe(q2.armedAt)
    }
  })

  it("still agrees on the three rules that are about the reader, not the clock", () => {
    // Sent is terminal, pointer-out only ever disarms an arm, and an elapsed arm
    // returns the module's own idle constant. None of the three mentions a window.
    const armedQ = widgetQuitPress(WIDGET_QUIT_IDLE, T0)
    const armedS = widgetStartPress(WIDGET_START_IDLE, T0)
    expect(widgetStartDisarm(armedS)).toBe(WIDGET_START_IDLE)
    expect(widgetQuitDisarm(armedQ)).toBe(WIDGET_QUIT_IDLE)
    const sentQ = widgetQuitPress(armedQ, T0 + 50)
    const sentS = widgetStartPress(armedS, T0 + 50)
    expect(widgetStartPress(sentS, T0 + 100)).toBe(sentS)
    expect(widgetQuitPress(sentQ, T0 + 100)).toBe(sentQ)
    expect(widgetStartDisarm(sentS)).toBe(sentS)
    expect(widgetQuitDisarm(sentQ)).toBe(sentQ)
    expect(widgetStartElapsed({ phase: "armed", armedAt: 0 }, 10 ** 9)).toBe(WIDGET_START_IDLE)
    expect(widgetQuitElapsed({ phase: "armed", armedAt: 0 }, 10 ** 9)).toBe(WIDGET_QUIT_IDLE)
  })
})

describe("WIDGET_START_SENT_TEXT", () => {
  it("names the panel's own poll cadence, generated rather than typed", () => {
    // The rule: two claims about freshness cannot both be the live one, and a
    // promise about when the next check happens is exactly such a claim. So the
    // number comes from WIDGET_POLL_MS and this test fails if anyone ever changes
    // one of them alone.
    expect(WIDGET_START_SENT_TEXT).toBe(
      `start request sent · the panel retries every ${Math.round(WIDGET_POLL_MS / 1000)}s`,
    )
    expect(WIDGET_START_SENT_TEXT).toContain("30s")
  })

  it("is the panel talking about itself, not about the server's state", () => {
    // It cannot know whether the server started, so the subject of the sentence is
    // the only thing it does know: it is still checking.
    expect(WIDGET_START_SENT_TEXT).toContain("the panel retries")
  })
})

/**
 * contextActivity is the dashboard chart's data, not the panel's. The panel
 * asks the server to skip the Today-only call behind it (the `context: false`
 * fetch), so this pins the other half: every view-model function that reads a
 * summary produces the same output with the field as without it.
 */
describe("the panel's view model ignores contextActivity", () => {
  const without = ok(
    {
      cost: 12.5,
      models: [usage(9), usage(3.5)],
    },
    "today",
  )
  const withContext: SummaryOk = {
    ...without,
    contextActivity: [
      { date: "2026-09-24", steps: 4 },
      { date: "2026-09-30", steps: 9 },
    ],
  }

  it("renders the same hero, strip, models and gap", () => {
    expect(widgetHero(withContext)).toEqual(widgetHero(without))
    expect(widgetStats(withContext)).toEqual(widgetStats(without))
    expect(widgetModels(withContext, undefined)).toEqual(widgetModels(without, undefined))
    const sessions = widgetSessions(payload([sess({ id: "s1", cost: 5 })], {}, "today"))
    expect(widgetGap(withContext, sessions)).toEqual(widgetGap(without, sessions))
    // The strip and the models rows are the two things built from the array
    // fields; both sides really were rendered, not skipped by an early return.
    expect(widgetStats(withContext)).not.toBeNull()
    expect(widgetModels(withContext, undefined).rows).toHaveLength(2)
  })
})

describe("the tint override", () => {
  it("is off by default, and the default is the transparent panel", () => {
    // The whole point of the parameter is to let the Captain put today's panel
    // beside the transparent one in a second. So the shipped URL has to be the
    // transparent one, which means the default is zero and not "whatever the
    // tint used to be".
    expect(WIDGET_GLASS_DEFAULT).toBe(0)
    for (const search of ["", "?", "range=7d", "?surface=1", "?glassish=0.84"]) {
      expect(widgetGlassAlpha(search)).toBe(0)
    }
    // A null or absent query string is the same case as an empty one, and the
    // entry file passes `window.location.search` which is never null.
    expect(widgetGlassAlpha(null)).toBe(0)
    expect(widgetGlassAlpha(undefined)).toBe(0)
  })

  it("reads the one numeric value, and 0.84 is the panel that used to ship", () => {
    expect(widgetGlassAlpha("?glass=0.84")).toBe(0.84)
    // Written without the leading dot, and with the parameter not first: both
    // are the same alpha to a reader and a number to `Number`. The `+` form is
    // here because `URLSearchParams` decodes it to a space, which is why the
    // value is trimmed before it is read rather than after.
    expect(widgetGlassAlpha("?glass=.84")).toBe(0.84)
    expect(widgetGlassAlpha("?glass=+0.84")).toBe(0.84)
    expect(widgetGlassAlpha("?range=7d&glass=0.5")).toBe(0.5)
    // It composes with the diagnostic that already existed rather than
    // replacing it, because both are read from the same query string.
    expect(widgetGlassAlpha("?surface=1&glass=0.84")).toBe(0.84)
  })

  it("clamps rather than refusing, and the ends are the two panels that exist", () => {
    // `?glass=2` is not a second ground to invent; it is the most ground this
    // panel can ever paint, which is the tinted one. `?glass=-1` is the least,
    // which is the transparent one.
    expect(widgetGlassAlpha("?glass=2")).toBe(1)
    expect(widgetGlassAlpha("?glass=99")).toBe(1)
    expect(widgetGlassAlpha("?glass=-1")).toBe(0)
    expect(widgetGlassAlpha("?glass=-0.001")).toBe(0)
    // The ends themselves are not clamped into anything else.
    expect(widgetGlassAlpha("?glass=1")).toBe(1)
    expect(widgetGlassAlpha("?glass=0")).toBe(0)
  })

  it("falls back to the default on anything it cannot read as a number", () => {
    // Every one of these would otherwise be a ground nobody asked for. The empty
    // value matters most: `Number("")` is 0 rather than NaN, so it has to be
    // refused before it reaches `Number` or `?glass=` would read as an alpha of
    // zero by accident rather than by decision.
    for (const raw of ["", " ", "  ", "abc", "0.84abc", "0,84", "transparent", "1px", "e"]) {
      expect(widgetGlassAlpha(`?glass=${encodeURIComponent(raw)}`)).toBe(0)
    }
    // A key with no `=` is the same as an empty value.
    expect(widgetGlassAlpha("?glass")).toBe(0)
    // Infinity parses as a number and is not an alpha, so it falls back with the
    // rest rather than clamping to 1.
    expect(widgetGlassAlpha("?glass=Infinity")).toBe(0)
    expect(widgetGlassAlpha("?glass=1e999")).toBe(0)
  })

  it("names the key and the custom property the stylesheet declares", () => {
    // Pinned as literals rather than derived from the file, so a rename in
    // widget.css or in src/widget.ts fails here instead of silently leaving the
    // parameter setting a property nothing reads. widget.css declares
    // `--glass-alpha: 0` in `:root`, and that is the number this route turns.
    expect(WIDGET_GLASS_KEY).toBe("glass")
    expect(WIDGET_GLASS_VAR).toBe("--glass-alpha")
  })
})
