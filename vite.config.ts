import react from "@vitejs/plugin-react"
import { readFileSync } from "node:fs"
import { defineConfig } from "vitest/config"

// Mission 014 (Option A): inline oc-dash's own version at build time so the
// topbar can show it with no runtime read and no API call.
const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string }

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: {
		host: true,
    port: 5273,
		strictPort: true,
		allowedHosts: ["omarchy-one.localdomain"],    
    proxy: {
      "/api": "http://0.0.0.0:4021",
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "server/**/*.test.ts"],
  },
})
