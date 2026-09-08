import type { Range } from "../api"

const TABS: { value: Range; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "all", label: "All" },
]

export function RangeTabs({
  range,
  onChange,
}: {
  range: Range
  onChange: (r: Range) => void
}) {
  return (
    <nav className="tabs" aria-label="Time range">
      {TABS.map((t) => (
        <button
          key={t.value}
          type="button"
          className={t.value === range ? "tab active" : "tab"}
          aria-pressed={t.value === range}
          onClick={() => onChange(t.value)}
        >
          {t.label}
        </button>
      ))}
    </nav>
  )
}
