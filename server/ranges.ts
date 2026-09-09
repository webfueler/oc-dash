export type RangePreset = "today" | "7d" | "30d" | "all"

export interface ResolvedRange {
  preset: RangePreset
  /** Epoch ms, omitted for "all". */
  from?: number
  /** Epoch ms, omitted for "all". */
  to?: number
}

export function parseRangePreset(value: string | undefined | null): RangePreset | null {
  switch (value) {
    case "today":
    case "7d":
    case "30d":
    case "all":
      return value
    default:
      return null
  }
}

/**
 * Map a preset to the from/to window passed to session.stats.
 *
 * today = local midnight (machine timezone); 7d/30d = now minus N*24h;
 * all = omit from and to so stats defaults to the earliest message.
 */
export function resolveRange(preset: RangePreset, now: Date = new Date()): ResolvedRange {
  if (preset === "all") return { preset }
  const nowMs = now.getTime()
  if (preset === "today") {
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    return { preset, from: midnight, to: nowMs }
  }
  const days = preset === "7d" ? 7 : 30
  return { preset, from: nowMs - days * 24 * 3600 * 1000, to: nowMs }
}

/** The machine's local IANA timezone name, e.g. "Europe/Lisbon". */
export function localTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
}

/**
 * Trailing-7-days window that gives the Today chart its context days; null
 * for every other preset (they already cover their own span).
 */
export function contextStatsRange(preset: RangePreset, now: Date = new Date()): ResolvedRange | null {
  return preset === "today" ? resolveRange("7d", now) : null
}
