import type { Absence } from "@owlit/protocol"
import { describe, expect, it } from "vitest"
import { AWAY_MS, Presence } from "./presence.ts"

describe("Presence", () => {
  it("knows the last stretch away: from the window going to the background to the next thing heard", () => {
    const presence = new Presence()
    const back: Absence[] = []
    const heard: [number, boolean][] = []
    presence.cameBack = (away) => back.push(away)
    presence.heard = (at, left) => heard.push([at, left])
    presence.hear({ kind: "doc.opened", at: 1_000, path: "a.md" })
    presence.hear({ kind: "idle", at: 1_000 + AWAY_MS, seconds: AWAY_MS / 1000 })
    expect(presence.lastAway).toBeNull()
    // A doc closing is the window's doing as often as the person's: they aren't back yet
    presence.hear({ kind: "doc.closed", at: 90_000, path: "a.md" })
    presence.hear({ kind: "back", at: 100_000, seconds: 99 })
    expect(presence.lastAway).toEqual({ from: 1_000, to: 100_000 })
    expect(back).toEqual([{ from: 1_000, to: 100_000 }])
    expect(heard).toEqual([[1_000, false], [1_000, true], [100_000, false]])
  })

  it("counts the time since the person was last heard from, the app closed, as away once long enough", () => {
    const presence = new Presence()
    presence.resume(5_000, 5_000 + AWAY_MS)
    expect(presence.lastAway).toEqual({ from: 5_000, to: 5_000 + AWAY_MS })
    presence.resume(5_000, 5_001)
    expect(presence.lastAway).toBeNull()
  })
})
