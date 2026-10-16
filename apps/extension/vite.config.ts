import path from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { lingui } from "@lingui/vite-plugin"

// The popup and the background service worker, as ES modules; scripts/build.mjs builds the content
// script apart (a content script can't be a module) and writes the manifest
export default defineConfig({
  plugins: [react(), tailwindcss(), lingui({ macroTransform: true, configPath: path.resolve(import.meta.dirname, "../../lingui.config.ts") })],
  // The app's components the popup draws with import each other as @/…
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "../../app/src") } },
  // Extension pages load nothing from elsewhere and run no inline script
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "chrome116",
    // The polyfill touches document, which a service worker hasn't got
    modulePreload: false,
    // Read from disk, never downloaded: the catalogs and React in one file cost nothing
    chunkSizeWarningLimit: 1024,
    rollupOptions: {
      input: { popup: path.resolve(import.meta.dirname, "popup.html"), background: path.resolve(import.meta.dirname, "src/background/index.ts") },
      // The manifest names the service worker by a fixed name
      output: { entryFileNames: (chunk) => (chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js") },
    },
  },
})
