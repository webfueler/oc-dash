# oc-dash backend and internals

This page covers what the README leaves out: the routes oc-dash serves, the
CLI and its registry file, the connection to the opencode2 service, the menu
bar app's side of the contract, and the project layout. It lives on GitHub
only, since the npm package ships `docs/screenshot.png` and nothing else from
this directory.

## Backend routes

All routes are GET-only and read from the opencode2 service; none of them
mutate anything.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Dashboard version, latest published version, update command, plus the discovered service URL, health, and version. The update command is `npx @webfueler/oc-dash@latest` for an installed package and `git pull --ff-only && npm install` for a checkout |
| `GET /api/summary?range=today\|7d\|30d\|all` | `session.stats` for the resolved window, with `tools="summary"` and the machine's local IANA timezone. Today adds a second best-effort 7-day stats call whose activity rides along as `contextActivity`, the Activity chart's muted context days. The `context` parameter defaults to on; the value `none` (`context=none`) skips that call and omits the field, for callers that render no chart. The optional `project=<id[,id...]>` adds one best-effort per-project stats call for each id; successes ride along as `projectStats`. The body's `costText` is `data.cost` as a finished string from `fmtUSD`, so a caller that renders money prints what the server formatted; it is absent on the degraded answer below. A `$0.00` means a zero cost, which an unpriced model also produces, so pair it with `data.tokens` before reading it as a statement that money was counted |
| `GET /api/sessions?range=today\|7d\|30d\|all` | Cursor-paginated `GET /api/session` walk (100 rows per page, capped at 50 pages), windowed by `time.updated >= range start`. Returns `count`, `pages`, and `truncated` |
| `GET /api/model-names` | `providerID/id` to display-name map from `GET /api/model`. Answers `{ "names": {} }` when the lookup fails |
| `GET /widget`, `GET /widget/` | The compact menu bar panel (`dist/widget.html`), served identically on both spellings. `/widget.html` is served by the static root as well. Registered before the SPA fallback, which would otherwise answer with the full dashboard |

Range mapping: `today` starts at local midnight; `7d` and `30d` start now
minus N×24h; `all` omits `from`/`to` so stats starts at the earliest message.
Nesting, filtering, sorting, and cost rollup happen in the frontend.

When the stats endpoint is unavailable, `/api/summary` answers
`{ "degraded": true, "reason": ... }` instead of an error, and the UI falls
back to totals computed from the session list.

## The CLI and the registry file

The CLI surface is `npx @webfueler/oc-dash@latest server start|stop|status`,
`--port <n>`, `--help`, and `--version`. A bare
`npx @webfueler/oc-dash@latest` prints the root help and exits 0. It used to
start a server in the foreground, so an alias or a script still carrying the
bare command now gets help and no server. The README carries the migration
line and the exit-code table. The dispatcher is `server/cli.ts`, the parser
`server/args.ts`, the text `server/help.ts`, and the published entry point
`bin/oc-dash.js`, which runs the compiled `dist-server/cli.js`.

`server start` publishes where it landed in the registry file:

```
$XDG_STATE_HOME/oc-dash/service.json
~/.local/state/oc-dash/service.json   when XDG_STATE_HOME is unset
```

That is the same `??` rule `@opencode/client` uses for
`$XDG_STATE_HOME/opencode/service.json`: an unset `XDG_STATE_HOME` falls back
to `~/.local/state`. The writer goes through a sibling temp file and a rename,
so a reader never sees half a record.

```
{ "port": 4022, "pid": 54923,
  "url": "http://127.0.0.1:4022",
  "version": "0.1.12" }
```

`version` is `appVersion()` in `server/registry.ts`, read from the manifest, so
the example above moves with the version rather than being a second place to
forget. The CLI's own `--help` prints the same string from the same reader.

`port` and `pid` are the source of truth. `url` is composed from the port
(`http://127.0.0.1:<port>`) when written and recomposed from it when read, so
the two cannot disagree; read the port, not the URL. `version` is
informational, and a record without it still reads.

A file that is absent means not running. `server status` and `server stop`
refuse to interpret a malformed or unreadable file and say so; `server start`
clears one and carries on, because an unreadable file must not block a fresh
start.

`server stop` confirms the recorded pid is an oc-dash launcher listening on
the recorded port before it sends SIGTERM, then removes the file. A record it
cannot confirm is refused, not signalled; `server start` clears that record
too. There is no name-based fallback (`pkill -f`, `killall`) anywhere in the
package.

## The menu bar app and the panel

[oc-dashbar](https://github.com/webfueler/oc-dashbar) is a sibling project, a
macOS menu bar app that loads the panel served at `/widget`. On every open it
resolves the URL in this order, highest first:

1. `OC_DASHBAR_URL`, an explicit override. If it is set but unusable, the app
   shows its offline page instead of falling through.
2. The registry file above, trusted only when it is present, decodes, and its
   `pid` is a live process.
3. The compiled default, `http://127.0.0.1:4021/widget`.

It appends `/widget` to the base URL the registry records. The panel and the
dashboard share one money formatter, `fmtUSD` in `server/money.ts`, which
`src/format.ts` re-exports (the panel imports that as `fmtMoney`): exactly two
decimals, `$0.00` for a genuine zero, and `<$0.01` (`<-$0.01` for a credit) for
a non-zero amount under one cent, so the same figure reads the same on both
surfaces. The implementation lives in `server/` because `tsconfig.server.json`
pins `rootDir: "server"`, which puts `src/format.ts` out of reach of a server
module; the re-export is not a copy, and `test/widget.test.ts` pins the two
names to the same function object.

The panel is also the caller that sends `context=none` to `/api/summary`,
because it renders no chart and the skipped call only feeds the chart's
context days. The dashboard leaves the parameter out.

## Upstream connection

The backend uses `@opencode/client`, pinned to an exact build matching the
service line (2.0.6), and is discover-only: `Service.discover()` finds a
healthy registered service and never starts, stops, or restarts one. If
nothing healthy is registered when the dashboard starts, it prints the two
commands that fix it (start `opencode serve --service`, then start the
dashboard again) and exits. If the service dies later, the UI shows its
degraded state instead of crashing. Calls go through the typed client with a
raw-fetch fallback using the service auth headers.

Discovery and the `/api/health` health surface both read the service's
`GET /api/info` (`{ version, pid }`), the endpoint the 2.0.x line serves;
the beta line's `/api/health` is gone there (404).

The discovered endpoint is cached for the life of the dashboard process, so
if the opencode service comes back on a different port, restart the
dashboard too.

## Project layout

```
server/          Hono backend and CLI (routes, args, help, registry, procinfo,
                 service connection, range mapping, walk, and the money
                 formatter in money.ts)
src/             React frontend (components, tree and rollup logic;
                 format.ts re-exports fmtUSD from server/money.ts)
test/            Vitest suites, mirroring the source layout (test/server/ for the backend)
bin/oc-dash.js   Published launcher: runs the compiled dist-server/cli.js
dist/            Built frontend, two Vite entries (index.html, widget.html), gitignored
dist-server/     Compiled server and CLI (gitignored)
```
