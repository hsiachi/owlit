import type { ExtensionStatus } from "@owlit/protocol"
import { describe, expect, it } from "vitest"
import { afterStatus, outcomeOfError } from "./connect.ts"
import { Elsewhere, OwlitError, Unreachable } from "./owlit.ts"

const owlit = { id: "o1", name: "Owlit" }
const status = (workspace: string | null): ExtensionStatus => ({ version: "0.3.0", workspace: workspace ? { name: workspace } : null, connectedAt: 1, owlit })

describe("afterStatus", () => {
  it("is connected when owlit answers, and asks it for work", () => {
    expect(afterStatus({ status: status("Thesis") }, { token: "t", owlit })).toEqual({ connection: { state: "connected", workspace: "Thesis" }, unpair: false, reconnect: false, work: true })
    expect(afterStatus({ status: status(null) }, { token: "t", owlit }).connection).toEqual({ state: "connected", workspace: null })
  })

  it("keeps the owlit that answered when the token's owlit wasn't known", () => {
    expect(afterStatus({ status: status("Thesis") }, { token: "t" }).remember).toEqual(owlit)
  })

  it("forgets a token owlit doesn't know, and says why the last pairing ended", () => {
    const unknown = new OwlitError(401, { reason: "not-paired" })
    expect(afterStatus({ error: unknown }, { token: "t" })).toEqual({ connection: { state: "unpaired" }, unpair: true, reconnect: false, work: false })
    expect(afterStatus({ error: unknown }, { problem: "refused" })).toEqual({ connection: { state: "unpaired", problem: "refused" }, unpair: false, reconnect: false, work: false })
  })

  it("keeps the pairing while owlit is away or another owlit has the port, and looks again", () => {
    expect(afterStatus({ error: new Unreachable() }, { token: "t" })).toEqual({ connection: { state: "offline", paired: true }, unpair: false, reconnect: true, work: false })
    expect(afterStatus({ error: new Unreachable() }, {})).toMatchObject({ connection: { state: "offline", paired: false }, reconnect: false })
    expect(afterStatus({ error: new Elsewhere("Owlit Dev (pdf-flow)") }, { token: "t" })).toMatchObject({ connection: { state: "elsewhere", name: "Owlit Dev (pdf-flow)" }, unpair: false, reconnect: true })
  })

  it("throws on what isn't owlit's answer", () => {
    expect(() => afterStatus({ error: new TypeError("bug") }, {})).toThrow("bug")
  })
})

describe("outcomeOfError", () => {
  it("names owlit's refusals, and keeps owlit's sentence for the rest", () => {
    expect(outcomeOfError(new Unreachable())).toEqual({ kind: "offline" })
    expect(outcomeOfError(new OwlitError(503, { reason: "no-workspace" }))).toEqual({ kind: "no-workspace" })
    expect(outcomeOfError(new OwlitError(404, { reason: "not-a-library-paper" }))).toEqual({ kind: "unknown-pdf" })
    expect(outcomeOfError(new OwlitError(400, { reason: "bad-request", message: "owlit couldn't read what the extension sent." }))).toEqual({ kind: "failed", message: "owlit couldn't read what the extension sent." })
  })
})
