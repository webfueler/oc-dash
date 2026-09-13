# oc-dash backend and internals

This page covers what the README leaves out: the routes oc-dash serves, the
connection to the opencode2 service, and the project layout. It lives on
GitHub only, since the npm package does not list `docs/` in its `files`
field.

## Backend routes

All routes are GET-only and read from the opencode2 service; none of them
mutate anything.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Dashboard version, latest published version, update command, plus the discovered service URL, health, and version |
| `GET /api/summary?range=today\|7d\|30d\|all` | `session.stats` for the resolved window, with `tools="summary"` and the machine's local IANA timezone. The optional `project=<id[,id...]>` adds one best-effort per-project stats call for each id; successes ride along as `projectStats` |
| `GET /api/sessions?range=today\|7d\|30d\|all` | Cursor-paginated `GET /api/session` walk (100 rows per page, capped at 50 pages), windowed by `time.updated >= range start`. Returns `count`, `pages`, and `truncated` |
| `GET /api/model-names` | `providerID/id` to display-name map from `GET /api/model`. Answers `{ "names": {} }` when the lookup fails |

Range mapping: `today` starts at local midnight; `7d` and `30d` start now
minus N×24h; `all` omits `from`/`to` so stats starts at the earliest message.
Nesting, filtering, sorting, and cost rollup happen in the frontend.

When the stats endpoint is unavailable, `/api/summary` answers
`{ "degraded": true, "reason": ... }` instead of an error, and the UI falls
back to totals computed from the session list.

## Upstream connection

The backend uses `@opencode/client`, pinned to an exact beta build, and is
discover-only: `Service.discover()` finds a healthy registered service and
never starts, stops, or restarts one. If nothing healthy is registered when
the dashboard starts, it prints a short message (start
`opencode serve --service`) and exits. If the service dies later, the UI
shows its degraded state instead of crashing. Calls go through the typed
client with a raw-fetch fallback using the service auth headers.

The discovered endpoint is cached for the life of the dashboard process, so
if the opencode service comes back on a different port, restart the
dashboard too.

## Project layout

```
server/          Hono backend (routes, service connection, range mapping, walk)
src/             React frontend (components, tree and rollup logic, formatting)
src/*.test.ts    Client tests (vitest); server tests live under server/
bin/oc-dash.js   npx launcher (runs the compiled server)
dist/            Built frontend (gitignored)
dist-server/     Compiled server (gitignored)
```
