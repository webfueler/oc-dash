import { describe, expect, it } from "vitest"
import {
  THEME_CHOICES,
  THEME_STORAGE_KEY,
  applyTheme,
  browserStorage,
  normalizeTheme,
  persistTheme,
  readStoredTheme,
  type ThemeRoot,
} from "./theme"

/**
 * Fake documentElement: the data-theme attribute is modeled as a map so
 * tests can assert what a real DOM would reflect, without a DOM.
 */
function fakeRoot(initial?: string): ThemeRoot & { attrs: Map<string, string> } {
  const attrs = new Map<string, string>()
  if (initial !== undefined) attrs.set("data-theme", initial)
  return {
    attrs,
    dataset: {
      get theme(): string | undefined {
        return attrs.get("data-theme")
      },
      set theme(v: string | undefined) {
        if (v === undefined) attrs.delete("data-theme")
        else attrs.set("data-theme", v)
      },
    },
    removeAttribute(name: string) {
      attrs.delete(name)
    },
  }
}

/** Fake Storage good enough for getItem/setItem. */
function fakeStorage(initial?: Record<string, string>) {
  const map = new Map(Object.entries(initial ?? {}))
  return {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      map.set(k, v)
    },
  }
}

const blocked = {
  getItem: () => {
    throw new Error("storage blocked")
  },
  setItem: () => {
    throw new Error("storage blocked")
  },
}

describe("normalizeTheme", () => {
  it("passes through only the two forced choices", () => {
    expect(normalizeTheme("dark")).toBe("dark")
    expect(normalizeTheme("light")).toBe("light")
  })

  it("falls back to system for null, missing, and garbage values", () => {
    expect(normalizeTheme(null)).toBe("system")
    expect(normalizeTheme(undefined)).toBe("system")
    expect(normalizeTheme("")).toBe("system")
    expect(normalizeTheme("system")).toBe("system")
    expect(normalizeTheme("LIGHT")).toBe("system")
    expect(normalizeTheme("blue")).toBe("system")
  })
})

describe("applyTheme", () => {
  it("sets data-theme for forced dark and forced light", () => {
    const dark = fakeRoot()
    applyTheme(dark, "dark")
    expect(dark.attrs.get("data-theme")).toBe("dark")
    const light = fakeRoot()
    applyTheme(light, "light")
    expect(light.attrs.get("data-theme")).toBe("light")
  })

  it("clears the attribute for system, even a stale forced one", () => {
    const root = fakeRoot("light")
    applyTheme(root, "system")
    expect(root.attrs.has("data-theme")).toBe(false)
  })

  it("is idempotent: re-applying the same choice changes nothing", () => {
    const root = fakeRoot()
    applyTheme(root, "dark")
    applyTheme(root, "dark")
    expect(root.attrs.get("data-theme")).toBe("dark")
  })
})

describe("browserStorage", () => {
  it("is null outside a browser (node test environment)", () => {
    expect(browserStorage()).toBeNull()
  })
})

describe("readStoredTheme", () => {
  it("reads the stored choice from the theme key", () => {
    expect(readStoredTheme(fakeStorage({ [THEME_STORAGE_KEY]: "light" }))).toBe("light")
    expect(readStoredTheme(fakeStorage({ [THEME_STORAGE_KEY]: "dark" }))).toBe("dark")
    expect(readStoredTheme(fakeStorage({ [THEME_STORAGE_KEY]: "system" }))).toBe("system")
  })

  it("defaults to system on empty storage", () => {
    expect(readStoredTheme(fakeStorage())).toBe("system")
    expect(readStoredTheme(fakeStorage({ other: "light" }))).toBe("system")
  })

  it("defaults to system with no storage at all or a blocked one", () => {
    expect(readStoredTheme(null)).toBe("system")
    expect(readStoredTheme(undefined)).toBe("system")
    expect(readStoredTheme(blocked)).toBe("system")
  })
})

describe("persistTheme", () => {
  it("writes every choice, including system, under the theme key", () => {
    const storage = fakeStorage()
    persistTheme(storage, "dark")
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe("dark")
    persistTheme(storage, "light")
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe("light")
    persistTheme(storage, "system")
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe("system")
  })

  it("silently does nothing with no storage or a blocked one", () => {
    expect(() => persistTheme(null, "dark")).not.toThrow()
    expect(() => persistTheme(blocked, "dark")).not.toThrow()
  })
})

describe("THEME_CHOICES", () => {
  it("is the artifact's three segments in order", () => {
    expect([...THEME_CHOICES]).toEqual(["system", "dark", "light"])
  })
})
