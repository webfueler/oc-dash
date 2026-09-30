import react from "@vitejs/plugin-react"
import { readFileSync } from "node:fs"
import { defineConfig } from "vitest/config"

// Inline oc-dash's own version at build time so the
// topbar can show it with no runtime read and no API call.
const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string }

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // Two entries, no router. `main` is the full dashboard at
  // `/` and keeps its own output name; `widget` is the compact menu bar
  // panel at `/widget`, which the server serves from dist/widget.html. The
  // widget imports none of the dashboard's components, so the two emit
  // separate CSS files. The JavaScript is not separate: both entries
  // import a shared chunk (React, src/tree.ts, src/summary.ts) that is by
  // far the largest asset in the build, so the dashboard's own entry JS is
  // small and the shared chunk is requested by both pages. That is the
  // right trade — two copies of React and the domain logic would be worse
  // — but it does mean a change to tree.ts or summary.ts rebuilds both
  // entries' asset names.
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        widget: "widget.html",
      },
    },
  },
  server: {
		host: true,
    port: 5273,
		strictPort: true,
		allowedHosts: ["omarchy-one.localdomain", "macbookpro.localdomain"],    
    proxy: {
      "/api": "http://0.0.0.0:4021",
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
})
