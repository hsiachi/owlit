import { describe, expect, it } from "vitest"
import { outerApp, peerPid } from "./browser-app.ts"

describe("the browser app on the other end", () => {
  it("takes the process that isn't this one from lsof's list", () => {
    // lsof -Fp: a p line per process, f lines for its files; both ends of the connection match
    expect(peerPid("p1913\nf67\np9278\nf33\n", 1913)).toBe(9278)
    expect(peerPid("p9278\nf33\np1913\nf67\n", 1913)).toBe(9278)
    expect(peerPid("p1913\nf67\n", 1913)).toBeUndefined()
    expect(peerPid("", 1913)).toBeUndefined()
  })

  it("finds the browser's own .app around a helper nested in it", () => {
    expect(outerApp("/Applications/Dia.app/Contents/Frameworks/ArcCore.framework/Helpers/Browser Helper.app/Contents/MacOS/Browser Helper")).toBe("/Applications/Dia.app")
    expect(outerApp("/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/141.0/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper")).toBe("/Applications/Google Chrome.app")
    expect(outerApp("/usr/local/bin/curl")).toBeUndefined()
  })
})
