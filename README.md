# oc-dash

A small local webapp that reads the opencode2 service API and shows session
costs, token totals, and the subagent spend the opencode2 TUI never displays.

Single package: Hono backend on Node 22, React + Vite + TypeScript frontend,
plain CSS, inline-SVG activity chart. No chart library, no CSS framework.

## What it shows

- **KPI header** — total cost (USD), total tokens, prompts, steps, sessions,
  subagents, active days, and streak for the selected range. Data comes from
  `GET /api/session/stats` on the opencode service.
- **Sessions table** — every session in the range with title, agent, model,
  own cost, **incl. subagents** (recursive: parent cost plus the cost of all
  descendants at any depth), tokens, last activity, and outcome. Child
  sessions nest collapsibly under their parent. A project filter is built
  from the session directories.
- **Models table** — steps, tokens, and cost per model, with an `unpriced`
  flag on models that burn tokens but report zero cost.
- **Activity chart** — steps per day, drawn as inline SVG.

Refreshes every 30 seconds while the tab is visible; refreshes immediately
when the tab becomes visible again.

## Requirements

- Node 22+
- npm
- A running local opencode2 service (the app only ever issues read-only GETs
  and never stops or restarts the service)

## Install

```sh
npm install
```

## Develop

```sh
npm run dev
```

Starts two processes: the API server on port 4021 and the Vite dev server on
port 5273 (http://localhost:5273). The dev server proxies `/api/*` to 4021.

## Build

```sh
npm run build
```

Typechecks the frontend (`tsc --noEmit`), bundles it with Vite into `dist/`,
and compiles the server with `tsc` into `dist-server/`.

## Start (production)

```sh
npm run build
npm run start
```

Serves the built frontend and the API from a single process on port 4021
(override with `PORT`). Open http://localhost:4021.

## Test

```sh
npm test        # or: npx vitest run
```

Unit tests cover session-tree nesting, the recursive rollup math, unpriced
model detection, and the client-side fallback totals.

## Lint

```sh
npm run lint
```

## API surface (this app's own backend)

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Dashboard health plus the opencode service URL and health |
| `GET /api/summary?range=today\|7d\|30d\|all` | `session.stats` for the resolved window, with `tools="summary"` and the machine's local IANA timezone |
| `GET /api/sessions?range=today\|7d\|30d\|all` | Cursor-paginated `GET /api/session` walk (limit 100, capped at 50 pages), windowed by `time.updated >= range start` |

Range mapping: `today` starts at local midnight; `7d` and `30d` start now
minus N×24h; `all` omits `from`/`to` so stats fall back to the earliest
message. Nesting, filtering, and cost rollup happen in the frontend.

If the stats endpoint is unavailable, `/api/summary` answers with
`{ "degraded": true, "reason": ... }` instead of an error page, and the UI
falls back to totals computed from the session list (marked as degraded).

## How it connects

The backend uses `@opencode/client` (pinned to the `beta` dist-tag):
`Service.discover()` finds a healthy registered service without starting one;
`Service.ensure()` is the fallback and may auto-start a service when none is
registered. Calls go through the typed client with a raw-fetch fallback
(`Service.headers(endpoint)` auth attached).

## Estimate caveats (read before quoting numbers)

- Session costs and the stats totals are **list-price estimates** based on
  models.dev pricing data, not your actual bill.
- Providers without price data are **undercounted**: models flagged
  `unpriced` in the Models table burn real tokens but report zero cost, so
  real spend is higher than shown.
- The stats endpoint adds **compaction usage** (not attributed to any
  session) to the totals, so KPI totals can legitimately exceed the sum of
  the session rollups in the table.
- Subagent spend rolls up into the parent row; the opencode2 TUI does not
  show this.

## Project layout

```
server/          Hono backend (entry, service connection, range mapping)
src/             React frontend (components, tree/rollup logic, formatting)
src/*.test.ts    Unit tests (vitest)
dist/            Built frontend (gitignored)
dist-server/     Compiled server (gitignored)
```
