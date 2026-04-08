import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { Agent } from "node:http"

// Reuse TCP connections to avoid TIME_WAIT port exhaustion in dev
const keepAliveAgent = new Agent({ keepAlive: true, maxSockets: 20 })

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:18800",
        changeOrigin: true,
        agent: keepAliveAgent,
      },
      "/ws": {
        target: "ws://127.0.0.1:18800",
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
