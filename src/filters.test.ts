import { describe, expect, it } from "vitest"
import type { SessionInfo } from "./api"
import {
  NO_MODEL_KEY,
  applyFilters,
  directoryOptions,
  modelBaseKey,
  modelComboOptions,
  modelOptions,
  modelShortLabel,
  projectComboOptions,
} from "./filters"
import { buildTree } from "./tree"
import { sess } from "./tree.test"

const OC_SETUP = "/Users/joaosantos/Sites/personal/oc-setup"
const PERSONAL = "/Users/joaosantos/Sites/personal"

/**
 * Synthetic rows shaped like the live 7d payload the scout measured (mission
 * 011): two directories, one model id split across two variants, a second
 * provider, and one row without a model. Shapes and relationships, not exact
 * live values.
 */
function rows(): SessionInfo[] {
  return [
    sess({
      id: "a1",
      location: { directory: OC_SETUP },
      model: { providerID: "opencode-go", id: "glm-5.3-flash", variant: "default" },
    }),
    sess({
      id: "a2",
      location: { directory: OC_SETUP },
      model: { providerID: "opencode-go", id: "glm-5.3-flash", variant: "max" },
    }),
    sess({
      id: "a3",
      parentID: "a2",
      location: { directory: OC_SETUP },
      model: { providerID: "opencode-go", id: "glm-5.3-flash", variant: "max" },
    }),
    sess({
      id: "b1",
      location: { directory: PERSONAL },
      model: { providerID: "github-copilot", id: "gpt-5.6-luna", variant: "default" },
    }),
    sess({ id: "b2", location: { directory: PERSONAL } }),
  ]
}

describe("directoryOptions", () => {
  it("counts rows per directory, count-desc", () => {
    const dirs = directoryOptions(rows())
    expect(dirs.map((d) => d.path)).toEqual([OC_SETUP, PERSONAL])
    expect(dirs.map((d) => d.count)).toEqual([3, 2])
  })

  it("exposes the basename next to the full path", () => {
    const dirs = directoryOptions(rows())
    expect(dirs.map((d) => d.basename)).toEqual(["oc-setup", "personal"])
  })

  it("skips rows without a directory and handles an empty list", () => {
    const orphan = { ...sess({ id: "x" }), location: undefined } as unknown as SessionInfo
    expect(directoryOptions([orphan])).toEqual([])
    expect(directoryOptions([])).toEqual([])
  })
})

describe("modelBaseKey / modelShortLabel", () => {
  it("builds the base key with the variant dropped", () => {
    expect(modelBaseKey({ providerID: "opencode-go", id: "glm-5.3-flash", variant: "max" })).toBe(
      "opencode-go/glm-5.3-flash",
    )
    expect(modelBaseKey({ providerID: "github-copilot", id: "gpt-5.6-luna" })).toBe(
      "github-copilot/gpt-5.6-luna",
    )
  })

  it("applies the short-form convention: provider prefix dropped, id kept", () => {
    expect(modelShortLabel("opencode-go/glm-5.3-flash")).toBe("glm-5.3-flash")
    expect(modelShortLabel("p/m")).toBe("m")
  })
})

describe("modelOptions", () => {
  it("groups rows by the base provider/id, summing the variants' counts", () => {
    const opts = modelOptions(rows())
    expect(opts.map((o) => [o.key, o.count])).toEqual([
      ["opencode-go/glm-5.3-flash", 3],
      ["github-copilot/gpt-5.6-luna", 1],
      [NO_MODEL_KEY, 1],
    ])
  })

  it("collapses the variants of one id into a single base bucket (mission 019)", () => {
    const opts = modelOptions(rows())
    const glm = opts.filter((o) => o.key === "opencode-go/glm-5.3-flash")
    expect(glm).toHaveLength(1)
    expect(glm[0].count).toBe(3)
    const keys = opts.map((o) => o.key)
    expect(keys).not.toContain("opencode-go/glm-5.3-flash · max")
    expect(keys).not.toContain("opencode-go/glm-5.3-flash · default")
  })

  it("labels real models with the short id form, provider dropped", () => {
    const glm = modelOptions(rows()).find((o) => o.key === "opencode-go/glm-5.3-flash")
    expect(glm?.label).toBe("glm-5.3-flash")
  })

  it("buckets the no-model rows into one explicit dashed entry", () => {
    const nm = modelOptions(rows()).find((o) => o.key === NO_MODEL_KEY)
    expect(nm).toBeDefined()
    expect(nm?.label).toBe("no model")
    expect(nm?.noModel).toBe(true)
    expect(nm?.count).toBe(1)
  })

  it("sorts count-desc with the no-model bucket in the same ordering", () => {
    // 5 no-model rows would outrank the 2-row max triple, so the bucket must
    // compete in the same sort rather than always sit last.
    const many = [
      sess({ id: "m1", model: { providerID: "p", id: "m", variant: "max" } }),
      sess({ id: "m2", model: { providerID: "p", id: "m", variant: "max" } }),
      ...Array.from({ length: 5 }, (_, i) => sess({ id: `n${i}` })),
    ]
    expect(modelOptions(many).map((o) => o.key)).toEqual([
      NO_MODEL_KEY,
      "p/m",
    ])
  })

  it("returns nothing for an empty list", () => {
    expect(modelOptions([])).toEqual([])
  })
})

describe("projectComboOptions", () => {
  it("leads with a pinned All entry carrying the payload count", () => {
    const opts = projectComboOptions(rows(), 5)
    expect(opts[0]).toMatchObject({ key: "", label: "All", count: 5, pinned: true })
  })

  it("searches the HIDDEN FULL PATH, showing only the basename", () => {
    // The artifact's "pers" example: one basename matches but both full
    // paths do, so oc-setup stays findable.
    const opts = projectComboOptions(rows(), 5)
    const oc = opts.find((o) => o.key === OC_SETUP)
    expect(oc?.label).toBe("oc-setup")
    expect(oc?.detail).toBe(OC_SETUP)
    expect(oc?.searchText).toBe(OC_SETUP)
    expect(oc?.searchText.toLowerCase().includes("pers")).toBe(true)
    const hits = opts.filter((o) => o.searchText.toLowerCase().includes("pers"))
    expect(hits.map((o) => o.key)).toEqual([OC_SETUP, PERSONAL])
  })
})

describe("modelComboOptions", () => {
  it("leads with All, then chip options with the dashed no-model entry", () => {
    const opts = modelComboOptions(rows(), 5)
    expect(opts[0]).toMatchObject({ key: "", label: "All", count: 5, pinned: true })
    const real = opts.filter((o) => o.key !== "")
    expect(real.every((o) => o.chip)).toBe(true)
    expect(real.filter((o) => o.dashed).map((o) => o.key)).toEqual([NO_MODEL_KEY])
  })

  it("matches the query against the hidden full base, provider included", () => {
    const opts = modelComboOptions(rows(), 5)
    const hits = opts.filter((o) => o.searchText.toLowerCase().includes("copilot"))
    expect(hits.map((o) => o.key)).toEqual(["github-copilot/gpt-5.6-luna"])
  })

  it("shows the short id label with the full base as detail (mission 019)", () => {
    const opts = modelComboOptions(rows(), 5)
    const glm = opts.find((o) => o.key === "opencode-go/glm-5.3-flash")
    expect(glm?.label).toBe("glm-5.3-flash")
    expect(glm?.detail).toBe("opencode-go/glm-5.3-flash")
    expect(glm?.searchText).toBe("opencode-go/glm-5.3-flash")
    // The no-model bucket keeps its dashed label and carries no detail.
    const nm = opts.find((o) => o.key === NO_MODEL_KEY)
    expect(nm?.label).toBe("no model")
    expect(nm?.detail).toBeUndefined()
    expect(nm?.searchText).toBe("no model")
  })
})

describe("applyFilters", () => {
  it("passes rows through untouched when both filters are empty", () => {
    const data = rows()
    expect(applyFilters(data, "", "")).toEqual(data)
  })

  it("filters by exact directory", () => {
    expect(applyFilters(rows(), PERSONAL, "").map((s) => s.id)).toEqual(["b1", "b2"])
    expect(applyFilters(rows(), "/nope", "")).toEqual([])
  })

  it("matches both variants of one model, variant-agnostic (mission 019)", () => {
    // a1 is the default variant, a2/a3 the max: one base filter takes all.
    expect(applyFilters(rows(), "", "opencode-go/glm-5.3-flash").map((s) => s.id)).toEqual([
      "a1",
      "a2",
      "a3",
    ])
  })

  it("matches nothing on a full triple key: the variant left the key", () => {
    expect(applyFilters(rows(), "", "opencode-go/glm-5.3-flash · max")).toEqual([])
    expect(applyFilters(rows(), "", "opencode-go/glm-5.3-flash · default")).toEqual([])
  })

  it("selects only the rows without a model for the no-model entry", () => {
    expect(applyFilters(rows(), "", NO_MODEL_KEY).map((s) => s.id)).toEqual(["b2"])
  })

  it("composes directory AND model into the intersection", () => {
    // a1/a2/a3 carry the glm base across both variants in oc-setup; no glm
    // rows exist in PERSONAL, so the intersection is the oc-setup trio only.
    expect(
      applyFilters(rows(), OC_SETUP, "opencode-go/glm-5.3-flash").map((s) => s.id),
    ).toEqual(["a1", "a2", "a3"])
    expect(
      applyFilters(rows(), PERSONAL, "opencode-go/glm-5.3-flash").map((s) => s.id),
    ).toEqual([])
    expect(applyFilters(rows(), OC_SETUP, NO_MODEL_KEY)).toEqual([])
  })

  it("feeds buildTree in one pass: the parent survives with its child", () => {
    // Both filters run before buildTree, so the a2 parent and its a3 child
    // stay nested (no orphan promotion mid-pipeline).
    const filtered = applyFilters(rows(), OC_SETUP, "opencode-go/glm-5.3-flash")
    const nodes = buildTree(filtered)
    expect(nodes.map((n) => n.session.id)).toEqual(["a1", "a2"])
    expect(nodes[1].session.id).toBe("a2")
    expect(nodes[1].children.map((n) => n.session.id)).toEqual(["a3"])
  })

  it("keeps buildTree's own promotion semantics for a filtered-out parent", () => {
    // A parent that fails the model filter while its child passes still lets
    // buildTree promote the child — composition changes what reaches
    // buildTree, not how buildTree behaves.
    const nodes = buildTree(applyFilters(rows(), "", "github-copilot/gpt-5.6-luna"))
    expect(nodes.map((n) => n.session.id)).toEqual(["b1"])
    expect(nodes[0].children).toHaveLength(0)
  })
})
