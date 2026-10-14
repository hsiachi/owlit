import path from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { lingui } from "@lingui/vite-plugin"

// The reader's page, built to dist/ and served by apps/share-server at /s/<id>. In development the API
// comes from a share server running beside it (SHARE_API, default the server's own default port).
export default defineConfig({
  plugins: [react(), tailwindcss(), lingui({ macroTransform: true, configPath: path.resolve(import.meta.dirname, "../../lingui.config.ts") })],
  server: { proxy: { "/api": process.env.SHARE_API ?? "http://127.0.0.1:8787" } },
  // KaTeX and the Markdown renderer are most of the page; one file of this size loads once and is cached
  build: { chunkSizeWarningLimit: 800 },
})
