import { describe, expect, it } from "vitest"
import type { SessionInfo } from "./api"
import {
  NO_MODEL_KEY,
  applyFilters,
  directoryOptions,
  modelBaseKey,
  modelComboOptions,
  modelDisplayName,
  modelOptions,
  modelShortLabel,
  projectComboOptions,
  staleModelOption,
  staleProjectOption,
  withStaleOption,
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

describe("modelDisplayName (mission 044: /api/model display names)", () => {
  const names = { "opencode-go/glm-5.3-flash": "GLM 5.3 Flash" }

  it("prefers the mapped display name", () => {
    expect(modelDisplayName("opencode-go/glm-5.3-flash", names)).toBe("GLM 5.3 Flash")
  })

  it("falls back to the short id when the map has no entry", () => {
    expect(modelDisplayName("github-copilot/gpt-5.6-luna", names)).toBe("gpt-5.6-luna")
  })

  it("falls back to the short id with no map at all", () => {
    expect(modelDisplayName("opencode-go/glm-5.3-flash")).toBe("glm-5.3-flash")
  })

  it("never returns a blank label for an empty mapped name", () => {
    expect(modelDisplayName("p/m", { "p/m": "" })).toBe("m")
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

  it("labels real models with the display name when the map has it (mission 044)", () => {
    const opts = modelOptions(rows(), {
      "opencode-go/glm-5.3-flash": "GLM 5.3 Flash",
    })
    expect(opts.find((o) => o.key === "opencode-go/glm-5.3-flash")?.label).toBe("GLM 5.3 Flash")
    // Unmapped keys and the no-model bucket keep today's labels.
    expect(opts.find((o) => o.key === "github-copilot/gpt-5.6-luna")?.label).toBe("gpt-5.6-luna")
    expect(opts.find((o) => o.key === NO_MODEL_KEY)?.label).toBe("no model")
  })

  it("keeps the key and count untouched by the name map", () => {
    const plain = modelOptions(rows())
    const mapped = modelOptions(rows(), { "opencode-go/glm-5.3-flash": "GLM 5.3 Flash" })
    expect(mapped.map((o) => [o.key, o.count])).toEqual(plain.map((o) => [o.key, o.count]))
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

  it("shows the display name as the label with the base key kept as detail (mission 044)", () => {
    const opts = modelComboOptions(rows(), 5, { "opencode-go/glm-5.3-flash": "GLM 5.3 Flash" })
    const glm = opts.find((o) => o.key === "opencode-go/glm-5.3-flash")
    expect(glm?.label).toBe("GLM 5.3 Flash")
    expect(glm?.detail).toBe("opencode-go/glm-5.3-flash")
    // The name joins the search text so the visible label is findable; the
    // provider-prefixed base stays searchable too.
    expect(glm?.searchText).toBe("GLM 5.3 Flash opencode-go/glm-5.3-flash")
    expect(glm?.searchText.toLowerCase().includes("glm-5.3-flash")).toBe(true)
    // Unmapped keys keep today's exact option shape.
    const gpt = opts.find((o) => o.key === "github-copilot/gpt-5.6-luna")
    expect(gpt?.label).toBe("gpt-5.6-luna")
    expect(gpt?.searchText).toBe("github-copilot/gpt-5.6-luna")
  })
})

describe("withStaleOption (mission 020: filters always visible)", () => {
  it("passes the options through when the value is empty or present", () => {
    const project = projectComboOptions(rows(), 5)
    expect(withStaleOption(project, "", staleProjectOption)).toBe(project)
    expect(withStaleOption(project, OC_SETUP, staleProjectOption)).toBe(project)
    const model = modelComboOptions(rows(), 5)
    expect(withStaleOption(model, "github-copilot/gpt-5.6-luna", staleModelOption)).toBe(model)
  })

  it("re-adds a held project value the current range has no row for, at 0", () => {
    // The Captain's case: a project picked in 7d, faced with a range whose
    // rows hold nothing for it (here: an empty payload entirely).
    const stale = withStaleOption(projectComboOptions([], 0), OC_SETUP, staleProjectOption)
    expect(stale).toHaveLength(2)
    expect(stale[0]).toMatchObject({ key: "", label: "All", count: 0, pinned: true })
    expect(stale[1]).toEqual({
      key: OC_SETUP,
      label: "oc-setup",
      detail: OC_SETUP,
      count: 0,
      searchText: OC_SETUP,
    })
  })

  it("re-adds a held model value as the 019 short-form chip, at 0", () => {
    const stale = withStaleOption(
      modelComboOptions([], 0),
      "opencode-go/glm-5.3-flash",
      staleModelOption,
    )
    expect(stale[1]).toEqual({
      key: "opencode-go/glm-5.3-flash",
      label: "glm-5.3-flash",
      detail: "opencode-go/glm-5.3-flash",
      count: 0,
      searchText: "opencode-go/glm-5.3-flash",
      chip: true,
      dashed: false,
    })
  })

  it("re-adds a held model value with the display name when mapped (mission 044)", () => {
    const stale = withStaleOption(
      modelComboOptions([], 0),
      "opencode-go/glm-5.3-flash",
      (key) => staleModelOption(key, { "opencode-go/glm-5.3-flash": "GLM 5.3 Flash" }),
    )
    expect(stale[1]).toEqual({
      key: "opencode-go/glm-5.3-flash",
      label: "GLM 5.3 Flash",
      detail: "opencode-go/glm-5.3-flash",
      count: 0,
      searchText: "GLM 5.3 Flash opencode-go/glm-5.3-flash",
      chip: true,
      dashed: false,
    })
  })

  it("re-adds the no-model selection when this range has no model-less rows", () => {
    // rows() has one no-model row; a payload where every row carries a model
    // drops the bucket, and the held NO_MODEL_KEY must stay representable.
    const allModeled = rows().map((s, i) => ({
      ...s,
      model: { providerID: "p", id: `m${i}`, variant: "default" } as const,
    }))
    const stale = withStaleOption(
      modelComboOptions(allModeled, allModeled.length),
      NO_MODEL_KEY,
      staleModelOption,
    )
    const nm = stale.find((o) => o.key === NO_MODEL_KEY)
    expect(nm).toEqual({
      key: NO_MODEL_KEY,
      label: "no model",
      detail: undefined,
      count: 0,
      searchText: "no model",
      chip: true,
      dashed: true,
    })
  })

  it("does not duplicate the entry when the builder already has it", () => {
    // The no-model bucket exists in rows(); withStaleOption must not append
    // a second NO_MODEL_KEY row.
    const opts = withStaleOption(modelComboOptions(rows(), 5), NO_MODEL_KEY, staleModelOption)
    expect(opts.filter((o) => o.key === NO_MODEL_KEY)).toHaveLength(1)
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
