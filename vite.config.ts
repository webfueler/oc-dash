import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [react()],
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
