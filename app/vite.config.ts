import path from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { lingui } from "@lingui/vite-plugin"

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Compiles Lingui's macros (t`…`, <Trans>) and the .po catalogs src/lib/i18n.ts imports; the config
    // is the repo's, shared with main and core
    lingui({ macroTransform: true, configPath: path.resolve(import.meta.dirname, "../lingui.config.ts") }),
  ],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
})
