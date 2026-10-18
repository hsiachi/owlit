import { defineConfig } from "vitest/config"

// One run for the whole repo; each package keeps its tests beside its sources
export default defineConfig({
  test: {
    globalSetup: ["./vitest.global-setup.ts"],
    projects: ["packages/*", "app", "apps/share-server", "apps/share-worker", "apps/extension"],
  },
})
