import type { ActivityDay } from "./api"

export interface BarGeom {
  date: string
  steps: number
  x: number
  w: number
  h: number
  /** false for muted context days and zero-step stubs */
  accent: boolean
}

export interface ChartLayout {
  bars: BarGeom[]
  max: number
  slot: number
}

export interface BarLayoutOptions {
  width: number
  /** total svg height; bars grow up from the bottom edge */
  height: number
  /** space reserved at the top for the y-max label */
  topPad?: number
  /** widest a single bar may render, regardless of slot size */
  cap?: number
  /** only the day matching this date renders accented; null accents all */
  accentDate?: string | null
}

/**
 * Bar geometry with capped, slot-centered widths: a single-day range no
 * longer paints the whole plot. Zero-step days get a 2px stub so the gap
 * stays visible.
 */
export function barLayout(data: ActivityDay[], opts: BarLayoutOptions): ChartLayout {
  const cap = opts.cap ?? 48
  const topPad = opts.topPad ?? 20
  const slot = data.length > 0 ? opts.width / data.length : opts.width
  const max = Math.max(...data.map((d) => d.steps), 1)
  const plotH = opts.height - topPad
  const bars = data.map((d, i) => {
    const w = Math.min(cap, Math.max(2, slot - 2))
    const x = i * slot + (slot - w) / 2
    const h = d.steps > 0 ? Math.max(2, (d.steps / max) * plotH) : 2
    const accent = d.steps > 0 && (opts.accentDate == null || d.date === opts.accentDate)
    return { date: d.date, steps: d.steps, x, w, h, accent }
  })
  return { bars, max, slot }
}

/**
 * Today's chart pads the in-range day with the trailing 7 days of context
 * (the summary's additive contextActivity field). Without context data the
 * range's own activity is used as-is.
 */
export function chartData(
  activity?: ActivityDay[],
  contextActivity?: ActivityDay[],
): { days: ActivityDay[]; usedContext: boolean } {
  if (contextActivity && contextActivity.length > 0) {
    return { days: contextActivity, usedContext: true }
  }
  return { days: activity ?? [], usedContext: false }
}

/**
 * Zero-step days must stay visible, but upstream stats omit them entirely.
 * Re-insert every missing calendar day between the first and last date as a
 * zero-step stub. `padTo` (used for Today's trailing-7-day window) extends
 * the front with zero days until the series reaches that length.
 */
export function fillDays(data: ActivityDay[], padTo?: number): ActivityDay[] {
  const sorted = [...data].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  if (sorted.length === 0) return sorted
  const start = Date.parse(`${sorted[0].date}T00:00:00Z`)
  const end = Date.parse(`${sorted[sorted.length - 1].date}T00:00:00Z`)
  // Malformed dates or pathological spans (>400 slots) render as-is; the
  // stubs would be sub-pixel anyway.
  if (!Number.isFinite(start) || !Number.isFinite(end) || (end - start) / 86_400_000 > 400) {
    return sorted
  }
  const byDate = new Map(sorted.map((d) => [d.date, d]))
  const out: ActivityDay[] = []
  for (let ms = start; ms <= end; ms += 86_400_000) {
    const date = new Date(ms).toISOString().slice(0, 10)
    out.push(byDate.get(date) ?? { date, steps: 0 })
  }
  if (padTo != null && out.length < padTo) {
    const pad: ActivityDay[] = []
    for (let i = out.length; i < padTo; i++) {
      const date = new Date(start - (padTo - i) * 86_400_000).toISOString().slice(0, 10)
      pad.push({ date, steps: 0 })
    }
    return [...pad, ...out]
  }
  return out
}
