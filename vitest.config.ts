import { defineConfig } from "vitest/config"

// One run for the whole repo; each package keeps its tests beside its sources
export default defineConfig({
  test: {
    projects: ["packages/*", "app", "apps/share-server", "apps/share-worker"],
  },
})
