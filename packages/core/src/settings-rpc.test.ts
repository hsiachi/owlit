import type { RpcNotification } from "@owlit/protocol"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { Core } from "./core.ts"
import type { BrowserHost, SecretBox } from "./host.ts"

// Stands in for the keychain: reversible, and plainly not the key
const box: SecretBox = {
  seal: (plain) => `box:${Buffer.from(plain).toString("base64")}`,
  open: (sealed) => {
    if (!sealed.startsWith("box:")) throw new Error("sealed elsewhere")
    return Buffer.from(sealed.slice(4), "base64").toString()
  },
}

function setup(options: { fetch?: typeof fetch; browser?: BrowserHost; secrets?: SecretBox | null } = {}) {
  const userDataDir = mkdtempSync(path.join(tmpdir(), "owlit-settings-"))
  const make = () =>
    new Core({
      userDataDir,
      retryBaseMs: 1,
      host: { fetch: options.fetch, browser: options.browser, secrets: options.secrets === null ? undefined : (options.secrets ?? box) },
    })
  const core = make()
  const heard: RpcNotification[] = []
  core.onNotify((n) => heard.push(n))
  let id = 0
  const call = async (method: string, params?: unknown) => {
    const response = await core.handle({ jsonrpc: "2.0", id: ++id, method, params })
    if ("error" in response) throw new Error(response.error.message)
    return response.result as any
  }
  const onDisk = () => JSON.parse(readFileSync(path.join(userDataDir, "settings.json"), "utf8"))
  return { core, call, heard, onDisk, userDataDir, make }
}

describe("settings", () => {
  it("starts from defaults: follow the system, warm paper, MinerU automatic", async () => {
    const { call } = setup()
    expect(await call("settings.get")).toEqual({
      appearance: { theme: "system", tone: "warm" },
      profile: {},
      library: {},
      parsing: { auto: true },
      secrets: {},
      activity: { enabled: true },
    })
  })

  it("changes what the patch names, clears what it nulls, and tells every window", async () => {
    const { call, heard } = setup()
    await call("settings.update", { patch: { appearance: { tone: "sepia" }, library: { contactEmail: "me@uni.edu", digestLanguage: "中文" } } })
    const view = await call("settings.update", { patch: { appearance: { theme: "dark" }, library: { digestLanguage: null }, backgroundAgent: "codex" } })
    expect(view).toMatchObject({ appearance: { theme: "dark", tone: "sepia" }, library: { contactEmail: "me@uni.edu" }, backgroundAgent: "codex" })
    expect(view.library).not.toHaveProperty("digestLanguage")
    expect(heard.filter((n) => n.method === "settings.changed")).toHaveLength(2)
  })

  it("keeps the name Owlit calls the user, trimmed, and forgets it when cleared", async () => {
    const { call } = setup()
    expect((await call("settings.update", { patch: { profile: { name: "  Xia " } } })).profile).toEqual({ name: "Xia" })
    expect((await call("settings.update", { patch: { profile: { name: null } } })).profile).toEqual({})
  })

  it("keeps keys sealed on disk and shows the window only how they end", async () => {
    const { call, onDisk, make } = setup()
    const view = await call("settings.setSecret", { name: "s2ApiKey", value: " abcdefgh1234 " })
    expect(view.secrets).toEqual({ s2ApiKey: "1234" })
    expect(JSON.stringify(view)).not.toContain("abcdefgh")
    expect(onDisk().library.s2ApiKey).toEqual({ sealed: expect.any(String) })
    expect(JSON.stringify(onDisk())).not.toContain("abcdefgh")
    // Read back by a fresh core, the key works again
    expect((await make().settings.get()).library.s2ApiKey).toBe("abcdefgh1234")
    await call("settings.setSecret", { name: "s2ApiKey", value: null })
    expect(onDisk().library).not.toHaveProperty("s2ApiKey")
  })

  it("reads a key written by hand and seals it on the next save; drops one it can't open", async () => {
    const { userDataDir, make, onDisk } = setup()
    writeFileSync(path.join(userDataDir, "settings.json"), JSON.stringify({ parsing: { service: "cloud", token: "plain-token" }, library: { openalexApiKey: { sealed: "garbage" } } }))
    const core = make()
    const settings = await core.settings.get()
    expect(settings.parsing.token).toBe("plain-token")
    expect(settings.library).not.toHaveProperty("openalexApiKey")
    await core.settings.update((s) => s)
    expect(onDisk().parsing.token).toEqual({ sealed: expect.any(String) })
  })

  it("writes keys as they are when nothing can seal them", async () => {
    const { call, onDisk } = setup({ secrets: null })
    await call("settings.setSecret", { name: "mineruToken", value: "tok-9876" })
    expect(onDisk().parsing.token).toBe("tok-9876")
  })

  it("sets the proxy from a known library or a link, and refuses a link without one", async () => {
    const { call } = setup()
    expect((await call("settings.setProxy", { preset: "tsinghua" })).library.proxy).toEqual({
      base: "https://tlink.lib.tsinghua.edu.cn",
      scheme: "login-url",
      path: "/go",
      preset: "tsinghua",
    })
    expect((await call("settings.setProxy", { link: "https://dl-acm-org.ezproxy.example.edu/doi/1" })).library.proxy).toEqual({
      base: "https://ezproxy.example.edu",
      scheme: "host-rewrite",
    })
    await expect(call("settings.setProxy", { link: "https://dl.acm.org/doi/1" })).rejects.toThrow("doesn't show which proxy")
    expect((await call("settings.setProxy", {})).library).not.toHaveProperty("proxy")
  })

  it("signs in through the browser window and remembers when; a new proxy forgets it", async () => {
    const opened: string[] = []
    const browser = { showLogin: async (url: string) => void opened.push(url), fetchPdf: async () => new Uint8Array() }
    const { call } = setup({ browser })
    await call("settings.setProxy", { preset: "tsinghua" })
    const view = await call("settings.proxySignIn")
    expect(opened).toEqual(["https://tlink.lib.tsinghua.edu.cn"])
    expect(view.library.proxySignedInAt).toBeGreaterThan(0)
    expect((await call("settings.setProxy", { link: "https://ezproxy.example.edu/login?url=https://x.org" })).library).not.toHaveProperty("proxySignedInAt")
  })

  it("tells a refused key from a service that couldn't be asked", async () => {
    let status = 403
    const seen: Request[] = []
    const fetch = (async (input: string, init?: RequestInit) => {
      seen.push(new Request(input, init))
      return new Response("{}", { status })
    }) as typeof globalThis.fetch
    const { call } = setup({ fetch })
    await call("settings.setSecret", { name: "s2ApiKey", value: "s2-key" })
    expect(await call("settings.check", { target: "s2ApiKey" })).toEqual({ result: "rejected", message: expect.stringContaining("Semantic Scholar says") })
    expect(seen[0].headers.get("x-api-key")).toBe("s2-key")
    status = 200
    expect(await call("settings.check", { target: "s2ApiKey" })).toEqual({ result: "works" })
    status = 429
    expect((await call("settings.check", { target: "s2ApiKey" })).result).toBe("unknown")
  })

  it("checks a MinerU token by its answer code, and a self-hosted server by whether it answers", async () => {
    let body: unknown = { code: "A0202", msg: "token error" }
    let up = true
    const fetch = (async (input: string) => {
      if (input.startsWith("http://127.0.0.1")) {
        if (!up) throw new TypeError("fetch failed")
        return new Response("{}", { status: 404 })
      }
      return Response.json(body)
    }) as typeof globalThis.fetch
    const { call } = setup({ fetch })
    await call("settings.update", { patch: { parsing: { service: "cloud" } } })
    await call("settings.setSecret", { name: "mineruToken", value: "tok" })
    expect((await call("settings.check", { target: "mineruToken" })).result).toBe("rejected")
    body = { code: -60012, msg: "task not found" }
    expect(await call("settings.check", { target: "mineruToken" })).toEqual({ result: "works" })
    body = { code: -60018, msg: "quota" }
    expect(await call("settings.check", { target: "mineruToken" })).toEqual({ result: "works", message: expect.stringContaining("quota") })

    await call("settings.update", { patch: { parsing: { service: "self-hosted", url: "http://127.0.0.1:8000" } } })
    expect((await call("settings.check", { target: "mineruServer" })).result).toBe("works")
    up = false
    expect(await call("settings.check", { target: "mineruServer" })).toEqual({ result: "rejected", message: expect.stringContaining("Is MinerU running?") })
  })
})
