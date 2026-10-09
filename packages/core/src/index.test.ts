import { describe, expect, it } from "vitest"
import { CORE_VERSION } from "./index.ts"

describe("core", () => {
  it("loads without Electron", () => {
    expect(CORE_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
