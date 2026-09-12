import { describe, expect, it } from "vitest"
import { compareVersions } from "./version.js"

describe("compareVersions", () => {
  it("orders equal, older, and newer x.y.z versions", () => {
    expect(compareVersions("0.1.3", "0.1.3")).toBe(0)
    expect(compareVersions("0.1.2", "0.1.3")).toBe(-1)
    expect(compareVersions("0.1.4", "0.1.3")).toBe(1)
  })

  it("compares segments numerically, not as strings", () => {
    expect(compareVersions("0.10.0", "0.9.9")).toBe(1)
    expect(compareVersions("1.0.0", "0.99.99")).toBe(1)
  })

  it("treats missing segments as zero", () => {
    expect(compareVersions("0.2", "0.2.0")).toBe(0)
    expect(compareVersions("0.2", "0.2.1")).toBe(-1)
  })
})
