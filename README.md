# oc-dash

Track exactly what AI usage costs in opencode2. oc-dash is a local dashboard
over the service API that shows spend session by session, subagents included,
under any time range and filter combination.

## What it looks like

One page: a cost hero, project and model filters with a filtered totals card,
then the sessions table, the models table, and an activity chart.

![oc-dash dashboard, dark mode, 7-day range: the total cost hero, the project and model filters with the project filter set to oc-setup and the filtered totals card below it, then the sessions table, the models table, and the activity chart.](docs/screenshot.png)

## What you can learn

- The total spend for a range, with a per-day average when the range covers
  full days, plus tokens, prompts, steps, sessions, subagents, and streaks.
- Spend per project and per model under combined filters. Pick one or both;
  the filtered totals card recomputes for the cut on screen.
- Subagent spend. Child sessions nest under their parent, and the Incl.
  subagents column rolls descendant cost into the parent at any depth.
- Which sessions cost the most. Click the Own cost, Incl. subagents, or
  Tokens header to sort; each cycles default, ascending, descending.
- Which models burned tokens at zero reported cost. The Models table flags
  them `unpriced`.

## Reading the numbers

- A number served by the stats endpoint is exact for the window and filter
  cut on screen.
- When a cut cannot be served, the card sums the session rows instead and
  marks the result `≈` (approximate). The fallback is labeled, never silent.
- If stats and the session rows disagree about a model, the card says so
  instead of showing either number.
- Stats totals exclude compaction usage. Session rows and the directory
  fallback include it, so the two totals can differ.
- Costs are list-price estimates from models.dev, not your bill, and models
  that burn tokens at zero reported cost are undercounted.
- Money is formatted one way everywhere: two decimals, `$0.45`; a genuine
  zero prints `$0.00`; a non-zero amount under one cent prints `<$0.01`
  (`<-$0.01` for a credit) rather than rounding to a false `$0.00`. The
  dashboard and the panel share one formatter, so the same figure reads the
  same on both.

## Quick start

Requires Node 22+ with npm, and a running opencode2 service from the
compatible 2.0.x line. oc-dash only issues read-only GETs and never starts,
stops, or restarts the service.

```sh
npx @webfueler/oc-dash@latest server start
```

`server start` starts the dashboard in the background, prints the URL and pid
it landed on, and returns to the prompt. Open the URL, `http://127.0.0.1:4021`
by default. `npx @webfueler/oc-dash@latest server status` reports where it is,
and `npx @webfueler/oc-dash@latest server stop` shuts it down. A background
server is an ordinary process: it ends when you log out and does not come back
after a reboot.

`--port <n>` picks the port to try, ahead of the `PORT` environment variable,
ahead of 4021. When that port is busy the server takes a free port from the
kernel and records where it landed, so read the real URL from `server status`
instead of assuming it. `server start --foreground` keeps it in the terminal
rather than detaching.

Bare `npx @webfueler/oc-dash@latest` prints the help and exits 0, and so does
`--help`; `npx @webfueler/oc-dash@latest --version` prints the version and
exits 0. The bare command used to start a server in the foreground. If a shell
alias, a script or a Makefile still says `npx oc-dash`, replace it with the
`server start` command shown above; what it does now is print help, start
nothing, and exit 0, with no error.

Exit codes, the same through `npx @webfueler/oc-dash@latest` or a global
install:

| Invocation | Exit |
| --- | --- |
| no arguments, `--help`, `help` | 0 |
| `--version` | 0 |
| `server start` (the server started) | 0 |
| `server status` (a server is running) | 0 |
| `server stop` (it stopped one) | 0 |
| `server status` / `server stop` (nothing running) | 1 |
| unknown command or flag, unusable `--port`, `--port` with no subcommand | 1 |
| `server start` (already running, or it could not start), `server stop` (it refused to signal) | 1 |

Errors go to stderr and exit 1; help and results go to stdout. `server status`
and `server stop` exit 1 on "not running" because they are predicates a script
branches on:

```sh
npx @webfueler/oc-dash@latest server status >/dev/null && echo up
```

`server start` records the port, pid, URL and version in the registry file at
`$XDG_STATE_HOME/oc-dash/service.json`, or at
`~/.local/state/oc-dash/service.json` when `XDG_STATE_HOME` is unset. Both
`server status` and `server stop` read it back, and so does the
[oc-dashbar](https://github.com/webfueler/oc-dashbar) menu bar app, a sibling
project that loads the compact panel this server serves at `/widget`.
[docs/API.md](https://github.com/webfueler/oc-dash/blob/main/docs/API.md)
covers the file, the route and the panel's own resolution order.

When no registered service answers the startup probe, the server exits and
`server start` reports that it exited before it finished starting. Start the
service with `opencode2 serve --service`.

No opencode2 yet? Install it with `npm install -g @opencode/cli`; it puts
the `opencode2` command on your PATH. Exact money needs the stats route,
which the 2.0.x line serves. To skip `npx`, `npm i -g @webfueler/oc-dash@latest`
puts `oc-dash` on your PATH.

## Using the dashboard

Ranges sit in the top bar: Today, 7 days, 30 days, All. A range switch
refetches and collapses the session tree.

The project and model filters sit above the tables, each with an All entry
and live counts. Type to search: projects match their full path, models their
display name and raw id. The model filter ignores reasoning variants; held
values survive range switches with a truthful 0 when nothing matches.

The filtered totals card appears whenever either filter is active. Its money
comes from the stats engine when the exact cut can be served; otherwise it is
the row sum, marked `≈`. A project filter on its own unlocks extra stats
tiles (prompts, steps, activity, any positive compaction gap); a model filter
hides them.

Sessions nest under their parent, collapsed by default. Click a parent row or
press Enter/Space to expand it; Expand all and Collapse all sit in the
section head. Own cost is the session's own spend, Incl. subagents adds every
descendant. The model chip shows the display name, with the raw
`providerID/id · variant` on hover.

If the stats endpoint is down, the hero carries a fallback badge and totals
from the session rows, the filtered card labels its money approximate, and
the Models table stays empty. The dashboard refreshes every 30 seconds while
the tab is visible, and right away when it becomes visible again.

## Known limits

- The opencode2 API and client move quickly; a service update can change
  behavior. Exact money needs a service that serves `session.stats`.
- The session walk stops after 50 pages of 100 rows. When it truncates, the
  dashboard warns and a directory filter falls back to the approximate row sum.
- The service endpoint is discovered once and cached. If the service comes
  back on a new port, restart the dashboard.
- Without a healthy service at startup, the server exits and `server start`
  says so. It never starts or restarts one.

## Development

Stack: Hono on Node 22 serves the API and built frontend from one process.
Frontend: React + Vite + TypeScript, plain CSS, inline-SVG chart. Tests use
vitest across the server routes, walk, and client logic; lint uses eslint.

```sh
npm install
npm run dev     # API on 4021, Vite on 5273, /api proxied to 4021
npm run build   # typecheck, bundle the frontend, compile the server
npm run start   # serve the build on 4021
npm test        # vitest
npm run lint    # eslint
```

The backend talks to the service through `@opencode/client`, pinned to an
exact build matching the service line (2.0.6), and is discover-only. See
[docs/API.md](https://github.com/webfueler/oc-dash/blob/main/docs/API.md) for
the backend routes, the range mapping, and the project layout.

## License

MIT. Source, issues, and releases: https://github.com/webfueler/oc-dash.
