import { describe, expect, it } from "vitest"
import { look, LOOKED_AFTER_MS } from "./changed"

describe("look", () => {
  const places = [
    { key: "top", from: 0, to: 40 },
    { key: "bottom", from: 900, to: 960 },
    { key: "removed", from: 500, to: 500 },
  ]

  it("counts a place looked at once it has stayed on screen a moment, and only that place", () => {
    const since = new Map<string, number>()
    const looked = new Set<string>()
    const top = [{ from: 0, to: 300 }]
    look(places, top, since, looked, 0)
    expect([...looked]).toEqual([])
    look(places, top, since, looked, LOOKED_AFTER_MS)
    expect([...looked]).toEqual(["top"])
    // Scrolled past the bottom without stopping: not looked at
    look(places, [{ from: 880, to: 1000 }], since, looked, LOOKED_AFTER_MS + 100)
    look(places, top, since, looked, 2 * LOOKED_AFTER_MS + 100)
    expect([...looked]).toEqual(["top"])
  })

  it("counts where a paragraph was removed as on screen when its position is", () => {
    const since = new Map<string, number>()
    const looked = new Set<string>()
    look(places, [{ from: 450, to: 600 }], since, looked, 0)
    look(places, [{ from: 450, to: 600 }], since, looked, LOOKED_AFTER_MS)
    expect([...looked]).toEqual(["removed"])
  })
})
