import { useEffect, useId, useMemo, useRef, useState } from "react"
import type { ComboOption } from "../filters"

/**
 * Mission 013 (PA/PC): lightweight combobox for the filter row — a text input
 * opening a filtered listbox, hand-rolled per the ARIA combobox/listbox
 * pattern (role, aria-expanded, aria-activedescendant, arrows/enter/escape).
 * Closed, it reads like the native select it replaced: the selected option
 * plus its live count. Zero new dependencies, matching the repo's no-UI-deps
 * rule.
 *
 * The query matches each option's hidden searchText (the FULL path for
 * projects, the label for models), never the visible basename alone.
 */
export function FilterCombobox({
  ariaLabel,
  placeholder,
  options,
  value,
  onChange,
  align = "left",
}: {
  ariaLabel: string
  placeholder: string
  options: ComboOption[]
  value: string
  onChange: (key: string) => void
  /** "right" anchors the open listbox to the control's right edge and sizes
   * it to its content, so long model triples stay readable at the row's end. */
  align?: "left" | "right"
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const focusOnCloseRef = useRef(false)
  const listId = useId()

  const selected = useMemo(() => options.find((o) => o.key === value), [options, value])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.pinned || o.searchText.toLowerCase().includes(q))
  }, [options, query])

  const close = (refocus: boolean) => {
    focusOnCloseRef.current = refocus
    setOpen(false)
    setQuery("")
    setActive(0)
  }

  // Focus returns to the trigger after a keyboard close or a pick, so the
  // control keeps behaving like the select it replaced (APG: Esc returns
  // focus to the combobox). A click-away close leaves focus where the user
  // clicked.
  useEffect(() => {
    if (!open && focusOnCloseRef.current) {
      focusOnCloseRef.current = false
      buttonRef.current?.focus()
    }
  }, [open])

  // Keep the active row visible while arrows or typing move it.
  useEffect(() => {
    if (!open) return
    document.getElementById(`${listId}-opt-${active}`)?.scrollIntoView({ block: "nearest" })
  }, [active, open, filtered, listId])

  const openList = () => {
    const selIdx = options.findIndex((o) => o.key === value && o.key !== "")
    setActive(selIdx !== -1 ? selIdx : firstReal(options))
    setQuery("")
    setOpen(true)
  }

  const pick = (o: ComboOption) => {
    onChange(o.key)
    close(true)
  }

  const activeId = filtered[active] ? `${listId}-opt-${active}` : undefined

  return (
    <div className={align === "right" ? "cb right" : "cb"}>
      {open ? (
        <>
          <input
            role="combobox"
            aria-expanded="true"
            aria-haspopup="listbox"
            aria-controls={listId}
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            aria-label={ariaLabel}
            placeholder={placeholder}
            value={query}
            autoComplete="off"
            autoFocus
            onChange={(e) => {
              const q = e.target.value
              setQuery(q)
              // Type-to-filter: the active row jumps to the first real
              // match, so Enter picks a result instead of silently clearing.
              const trimmed = q.trim().toLowerCase()
              const list = trimmed
                ? options.filter((o) => o.pinned || o.searchText.toLowerCase().includes(trimmed))
                : options
              setActive(firstReal(list))
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault()
                setActive((a) => (filtered.length ? (a + 1) % filtered.length : 0))
              } else if (e.key === "ArrowUp") {
                e.preventDefault()
                setActive((a) => (filtered.length ? (a - 1 + filtered.length) % filtered.length : 0))
              } else if (e.key === "Enter") {
                e.preventDefault()
                const o = filtered[active]
                if (o) pick(o)
              } else if (e.key === "Escape") {
                e.preventDefault()
                close(true)
              }
            }}
            onBlur={() => close(false)}
          />
          <div className="list" role="listbox" aria-label={ariaLabel} id={listId}>
            {filtered.map((o, i) => (
              <div
                key={o.key}
                id={`${listId}-opt-${i}`}
                role="option"
                aria-selected={o.key === value}
                className={i === active ? "opt on" : "opt"}
                // Keep the input focused so the click lands as a pick, not a blur-close.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o)}
              >
                {o.chip ? (
                  <span className={o.dashed ? "mchip nm" : "mchip"} title={o.label}>
                    {o.label}
                  </span>
                ) : (
                  <span>{o.label}</span>
                )}
                {o.detail && <span className="path">{o.detail}</span>}
                <span className="n">{o.count}</span>
              </div>
            ))}
            {filtered.length === 0 && <div className="cb-empty">No matches</div>}
          </div>
        </>
      ) : (
        <button
          ref={buttonRef}
          type="button"
          className="cbv"
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={false}
          onClick={openList}
        >
          {selected ? (
            <>
              {selected.chip ? (
                <span className={selected.dashed ? "mchip nm" : "mchip"} title={selected.label}>
                  {selected.label}
                </span>
              ) : (
                selected.label
              )}{" "}
              ({selected.count})
            </>
          ) : (
            value || "All"
          )}
        </button>
      )}
      <span className="chev" aria-hidden>
        ▾
      </span>
    </div>
  )
}

/** Index of the first non-pinned option, so the All row is skipped by default. */
function firstReal(list: ComboOption[]): number {
  const i = list.findIndex((o) => !o.pinned)
  return i === -1 ? 0 : i
}
