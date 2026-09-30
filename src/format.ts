/**
 * The project's one money formatter. The dashboard and the panel both call
 * it, so a cost reads identically in both surfaces.
 *
 * The rule, picked by hand in the panel's design review and now shared:
 * exactly two decimals; a genuine zero prints `$0.00`; a non-zero amount
 * under one cent prints `<$0.01` (`<-$0.01` for a credit) rather than
 * rounding to `$0.00`, which would read as free.
 */
const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function fmtUSD(n: number): string {
  if (!Number.isFinite(n)) return "—"
  // `n === 0` rather than `abs < 0.01`, so a genuine zero and a negative
  // zero both land on "$0.00".
  if (n === 0) return "$0.00"
  const abs = Math.abs(n)
  if (abs < 0.01) return n < 0 ? "<-$0.01" : "<$0.01"
  return USD.format(n)
}

/** K/M/B token formatting. */
export function fmtTokens(n: number): string {
  if (!Number.isFinite(n)) return "—"
  const abs = Math.abs(n)
  const scale = (x: number): string => String(Math.round(x * 100) / 100)
  if (abs >= 1e9) return `${scale(n / 1e9)}B`
  if (abs >= 1e6) return `${scale(n / 1e6)}M`
  if (abs >= 1e3) return `${scale(n / 1e3)}K`
  return String(Math.round(n))
}

export function fmtInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—"
  return new Intl.NumberFormat("en-US").format(n)
}

/** "just now", "3m ago", "5h ago", "2d ago". */
export function relTime(ms: number, now: number = Date.now()): string {
  if (!Number.isFinite(ms)) return "—"
  const minutes = Math.floor(Math.max(0, now - ms) / 60000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export type SessionOutcome = "succeeded" | "failed" | "interrupted"

/**
 * Outcome column as an exception report: successes collapse to a dim check
 * glyph, failures and interruptions keep their loud badges, and rows with
 * no outcome render a dim dash.
 */
export function outcomeView(outcome?: SessionOutcome): "check" | "badge" | "dim" {
  if (outcome === "succeeded") return "check"
  if (outcome === "failed" || outcome === "interrupted") return "badge"
  return "dim"
}

/** Local calendar date as YYYY-MM-DD, matching the stats activity dates. */
export function isoDate(ms: number): string {
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
