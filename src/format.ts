/** USD via Intl; small values get up to 4 decimals so sub-cent costs read. */
export function fmtUSD(n: number): string {
  if (!Number.isFinite(n)) return "—"
  const abs = Math.abs(n)
  const max = abs > 0 && abs < 1 ? 4 : 2
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: max,
  }).format(n)
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
