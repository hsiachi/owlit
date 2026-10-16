import { mkdirSync, mkdtempSync, readFileSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Core } from "../core.ts"

const cores: Core[] = []
afterEach(async () => {
  await Promise.all(cores.splice(0).map((c) => c.dispose()))
})

async function setup() {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-dial-")))
  const root = path.join(base, "ws")
  mkdirSync(root)
  const core = new Core({ userDataDir: path.join(base, "userData") })
  cores.push(core)
  const call = async (method: string, params?: unknown): Promise<any> => {
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params })
    if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
    return response.result
  }
  await call("workspace.open", { path: root })
  const journal = async () => {
    // The journal is written in the background
    await new Promise((r) => setTimeout(r, 50))
    return readFileSync(path.join(root, ".owlit/journal.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
  }
  return { root, call, journal }
}

describe("the dial (Settings › Owlit › On its own)", () => {
  it("starts Off, is kept in the workspace, and each move is journaled as feedback", async () => {
    const { root, call, journal } = await setup()
    expect(await call("initiative.get")).toEqual({ mode: "off", dailyCap: 20 })
    expect(await call("initiative.set", { patch: { mode: "onOpen" } })).toEqual({ mode: "onOpen", dailyCap: 20 })
    const file = JSON.parse(readFileSync(path.join(root, ".owlit/workspace.json"), "utf8"))
    expect(file).toMatchObject({ version: 1, layout: {}, initiative: { mode: "onOpen" } })
    // Setting the same position again isn't a move
    await call("initiative.set", { patch: { mode: "onOpen", dailyCap: 5 } })
    expect(await journal()).toEqual([{ kind: "feedback.dialChanged", at: expect.any(Number), subject: "workspace", detail: { from: "off", to: "onOpen" }, actor: "user" }])
    await expect(call("initiative.set", { patch: { mode: "always" } })).rejects.toThrow()
  })

  it("logs the upkeep rules' decisions, a digest held back (no text yet) included", async () => {
    const { call, journal } = await setup()
    await call("library.add", { paper: { id: "doi-10.1-x", title: "X", authors: ["A"], ids: { doi: "10.1/x" } } })
    await call("library.update", { id: "doi-10.1-x", patch: { starred: true } })
    const lines = await journal()
    expect(lines.filter((l: { kind: string }) => l.kind === "evaluation")).toEqual([
      expect.objectContaining({ rule: "digest.onStar", subject: "doi-10.1-x", decision: "none", reason: "nothing to read", cause: "paper.starred", actor: "owlit" }),
    ])
  })
})
