/**
 * Mission 015 (PB): the theme state machine, extracted so the mechanics are
 * unit-testable. The pre-paint script in index.html applies the stored
 * choice before first paint; this module is the React side — normalize what
 * is stored, apply/clear the attribute live, persist on change.
 *
 * System stays attribute-free on purpose: the OS media query in styles.css
 * (gated to :root:not([data-theme])) drives system mode natively, so an OS
 * scheme flip re-themes the page with no JS listener. Only forced dark and
 * forced light materialize into a data-theme attribute.
 */

export type ThemeChoice = "system" | "dark" | "light"

/** Segment order of the topbar control (artifact section 3). */
export const THEME_CHOICES: readonly ThemeChoice[] = ["system", "dark", "light"]

/** oc-dash's first stored value; nothing else is persisted today. */
export const THEME_STORAGE_KEY = "theme"

/**
 * Garbage, missing, and "system" all mean system. Only the two forced
 * choices survive, so a tampered storage value can never strand the page
 * attribute-less with forced tokens.
 */
export function normalizeTheme(raw: string | null | undefined): ThemeChoice {
  return raw === "dark" || raw === "light" ? raw : "system"
}

/**
 * Minimal surface of document.documentElement the applier needs, so tests
 * can run without a DOM (vitest environment is node).
 */
export interface ThemeRoot {
  dataset: { theme?: string }
  removeAttribute(name: string): void
}

/**
 * Forced dark/light set the attribute; system clears it. Idempotent — the
 * pre-paint script already did this before first paint, and the React
 * effect re-asserts the same state.
 */
export function applyTheme(root: ThemeRoot, choice: ThemeChoice): void {
  if (choice === "system") root.removeAttribute("data-theme")
  else root.dataset.theme = choice
}

/**
 * window.localStorage does not exist in the node test environment and can
 * throw on mere access when storage is blocked; callers get null and the
 * machine runs memory-only (the choice then lasts one session).
 */
export function browserStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage
  } catch {
    return null
  }
}

/** Missing, null, garbage, or blocked storage all fall back to system. */
export function readStoredTheme(
  storage: Pick<Storage, "getItem"> | null | undefined,
): ThemeChoice {
  if (!storage) return "system"
  try {
    return normalizeTheme(storage.getItem(THEME_STORAGE_KEY))
  } catch {
    return "system"
  }
}

/** Persist the choice; a blocked/quota-exceeded storage keeps it live for the session only. */
export function persistTheme(
  storage: Pick<Storage, "setItem"> | null | undefined,
  choice: ThemeChoice,
): void {
  if (!storage) return
  try {
    storage.setItem(THEME_STORAGE_KEY, choice)
  } catch {
    // Storage unavailable: the attribute is already applied live.
  }
}
