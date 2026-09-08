export const MAX_PAGES = 50

export interface RawPage {
  data?: unknown
  cursor?: { previous?: string | null; next?: string | null } | null
}

export type FetchPage = (cursor?: string) => Promise<RawPage>

export interface WalkResult {
  rows: unknown[]
  pages: number
  truncated: boolean
}

function updatedOf(row: unknown): number | null {
  const updated = (row as { time?: { updated?: unknown } })?.time?.updated
  return typeof updated === "number" ? updated : null
}

/**
 * Walk the cursor-paged session list (ordered by time.updated descending)
 * and collect the rows inside the requested range.
 *
 * The stop decision looks at the RAW page, before any filtering: stale rows
 * carry the oldest timestamps, so they are what tells the walk to stop.
 * Rows older than the range start are then dropped before they reach the
 * output, and the boundary itself is inclusive (updated == from stays).
 */
export async function walkSessions(
  from: number | null,
  fetchPage: FetchPage,
  maxPages = MAX_PAGES,
): Promise<WalkResult> {
  const out: unknown[] = []
  let cursor: string | undefined
  let pages = 0
  let more = true
  while (more && pages < maxPages) {
    const page = await fetchPage(cursor)
    const rows = Array.isArray(page.data) ? page.data : []
    pages++
    // Oldest time.updated on the raw page. A page with no numeric
    // timestamps leaves this at Infinity and cannot stop the walk.
    let oldest = Number.POSITIVE_INFINITY
    for (const row of rows) {
      const updated = updatedOf(row)
      if (updated != null && updated < oldest) oldest = updated
    }
    // Boundary inclusive; rows without a numeric time.updated cannot be
    // shown to be in range, so they are dropped when a range is set.
    if (from == null) {
      out.push(...rows)
    } else {
      out.push(...rows.filter((row) => {
        const updated = updatedOf(row)
        return updated != null && updated >= from
      }))
    }
    const next = page.cursor?.next ?? null
    if (!next) {
      more = false
      break
    }
    if (from != null) {
      // List order is time.updated descending: once a page's oldest
      // updated time falls below the range start, later pages are older.
      if (oldest < from) {
        more = false
        break
      }
    }
    cursor = next
  }
  return { rows: out, pages, truncated: more && pages >= maxPages }
}
