import { RpcErrorCode, type RpcNotification } from "@owlit/protocol"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, renameSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Core } from "../core.ts"
import { createFolder, suggestFolder } from "./welcome.ts"

const temp = () => realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-welcome-")))

const cores: Core[] = []
afterEach(async () => {
  for (const core of cores.splice(0)) await core.dispose()
})

function setup() {
  const base = temp()
  const core = new Core({ userDataDir: path.join(base, "userData") })
  cores.push(core)
  const call = async (method: string, params?: unknown): Promise<any> => {
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params })
    if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
    return response.result
  }
  return { base, core, call }
}

describe("suggestFolder", () => {
  it("suggests Research in Documents, or the next free name", () => {
    const home = temp()
    expect(suggestFolder(home)).toEqual({ parent: home, name: "Research" })
    mkdirSync(path.join(home, "Documents", "Research"), { recursive: true })
    mkdirSync(path.join(home, "Documents", "Research 2"))
    expect(suggestFolder(home)).toEqual({ parent: path.join(home, "Documents"), name: "Research 3" })
  })
})

describe("createFolder", () => {
  it("makes a new folder and never reuses one", async () => {
    const parent = temp()
    const folder = await createFolder(parent, "  Thesis ")
    expect(folder).toBe(path.join(parent, "Thesis"))
    expect(existsSync(folder)).toBe(true)
    await expect(createFolder(parent, "Thesis")).rejects.toMatchObject({ code: RpcErrorCode.Conflict, message: expect.stringMatching(/already a folder called Thesis/) })
  })

  it("refuses names that aren't a plain folder name", async () => {
    const parent = temp()
    for (const name of ["", "  ", "a/b", "..", ".hidden"]) await expect(createFolder(parent, name)).rejects.toMatchObject({ code: RpcErrorCode.InvalidParams })
  })
})

describe("the welcome page's requests", () => {
  it("creates a workspace and says it is opening, then open", async () => {
    const { base, core, call } = setup()
    const heard: RpcNotification[] = []
    core.onNotify((n) => n.method === "workspace.state" && heard.push(n))
    expect(await call("workspace.state")).toEqual({ current: null, opening: false })

    const info = await call("workspace.create", { parent: base, name: "Research" })
    expect(info).toEqual({ path: path.join(base, "Research"), name: "Research" })
    expect(await call("workspace.state")).toEqual({ current: info, opening: false })
    expect(heard.map((n) => n.params)).toEqual([
      { current: null, opening: true },
      { current: info, opening: false },
    ])
  })

  it("shows the first-launch flow until a workspace has opened on this machine", async () => {
    const { base, call } = setup()
    expect((await call("settings.get")).onboarded).toBe(false)
    await call("workspace.create", { parent: base, name: "Research" })
    expect((await call("settings.get")).onboarded).toBe(true)
  })

  it("lists a workspace that moved, and forgets it once found", async () => {
    const { base, call } = setup()
    const ws = path.join(base, "tool-use")
    mkdirSync(ws)
    await call("workspace.open", { path: ws })
    await call("workspace.open", { path: path.join(base, "userData") })
    renameSync(ws, path.join(base, "moved"))

    const { recent, suggestion } = await call("workspace.welcome")
    expect(recent).toContainEqual({ path: ws, name: "tool-use", missing: true })
    expect(suggestion.name).toMatch(/^Research/)

    await call("workspace.forget", { path: ws })
    expect((await call("workspace.welcome")).recent.map((r: { path: string }) => r.path)).not.toContain(ws)
  })
})
