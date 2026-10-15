import type { Connector } from "@owlit/protocol"
import { mkdtempSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { SettingsStore } from "../settings.ts"
import { Agents, tidy } from "./agents.ts"
import { splitCommand } from "./command.ts"

const fake = path.join(import.meta.dirname, "fake-acp.ts")
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const made: Agents[] = []
afterEach(() => {
  for (const a of made.splice(0)) a.dispose()
  delete process.env.FAKE_ACP_AUTH
})

async function setup(idleMs = 60_000, searchPath = async () => process.env.PATH ?? "", proxyEnv?: () => Promise<Record<string, string>>) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-agents-")))
  const heard: Connector[] = []
  const agents = new Agents({
    settings: new SettingsStore(dir),
    probeDir: path.join(dir, "probe"),
    cwd: () => dir,
    notify: (c) => heard.push(c),
    idleMs,
    searchPath,
    proxyEnv,
  })
  made.push(agents)
  const added = await agents.add("Fake", `"${process.execPath}" "${fake}"`)
  return { agents, heard, id: added.id, dir }
}

describe("splitCommand", () => {
  it("splits on spaces and keeps quoted words whole", () => {
    expect(splitCommand(`gemini --experimental-acp`)).toEqual(["gemini", "--experimental-acp"])
    expect(splitCommand(`"/Applications/My Agent/bin" --x 'a b' ""`)).toEqual(["/Applications/My Agent/bin", "--x", "a b", ""])
  })
})

describe("tidy", () => {
  it("drops the agent's own \"default\" model and effort, and defaults to the model it pointed at", () => {
    const tidied = tidy({
      checkedAt: 1,
      models: [
        { id: "default", name: "Default (recommended)", description: "Opus" },
        { id: "opus", name: "Opus 5.5" },
        { id: "sonnet", name: "Sonnet 5.5 (recommended)" },
      ],
      modes: [],
      efforts: [{ id: "default", name: "Default" }, { id: "medium", name: "Medium" }, { id: "xhigh", name: "Xhigh" }],
      defaultModelId: "default",
      defaultEffortId: "medium",
    })
    expect(tidied.models).toEqual([{ id: "opus", name: "Opus 5.5" }, { id: "sonnet", name: "Sonnet 5.5" }])
    expect(tidied.defaultModelId).toBe("opus")
    expect(tidied.efforts.map((e) => e.name)).toEqual(["Medium", "Extra high"])
    expect(tidied.defaultEffortId).toBe("medium")
  })
})

describe("agents", () => {
  it("lists the built-in agents and the ones added", async () => {
    const { agents, id } = await setup()
    expect((await agents.list()).map((c) => c.id)).toEqual(["claude-code", "codex", "gemini-cli", id])
  })

  it("checks an agent: version, models, modes and efforts from the agent itself", async () => {
    const { agents, id } = await setup()
    const checked = await agents.check(id)
    expect(checked).toMatchObject({ status: "connected", version: "1.2.3", authenticated: true, defaultModelId: "small", defaultModeId: "ask", defaultEffortId: "low" })
    expect(checked.models.map((m) => m.id)).toEqual(["small", "large"])
    expect(checked.modes).toEqual([{ id: "ask", name: "Ask" }, { id: "auto", name: "Auto", description: "No questions" }])
    expect(checked.efforts?.map((e) => e.id)).toEqual(["low", "high"])
    // Remembered: the list shows it without starting anything
    agents.dispose()
    const listed = (await agents.list()).find((c) => c.id === id)!
    expect(listed.models.map((m) => m.id)).toEqual(["small", "large"])
  })

  it("says when an agent isn't installed, with its install command", async () => {
    // A PATH with nothing on it, whatever this machine has installed
    const empty = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-empty-path-")))
    const { agents } = await setup(60_000, async () => empty)
    const codex = await agents.check("codex").catch((e) => e)
    expect(codex).toMatchObject({ status: "not_installed", installHint: "npm install -g @agentclientprotocol/codex-acp" })
  })

  // A turn ends with this sentence; before, it was the bare name ("Claude Code") under "Owlit stopped"
  it("explains a missing agent when a turn starts it", async () => {
    const empty = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-empty-path-")))
    const { agents } = await setup(60_000, async () => empty)
    const error = await agents.process("codex").catch((e: Error) => e)
    expect((error as Error).message).toBe("Codex isn't installed, or Owlit can't find it. Run npm install -g @agentclientprotocol/codex-acp in a terminal to install it, then try again.")
  })

  it("says when an agent isn't signed in", async () => {
    const { agents, id } = await setup()
    process.env.FAKE_ACP_AUTH = "required"
    const checked = await agents.check(id)
    expect(checked).toMatchObject({ status: "error", authenticated: false })
    expect(checked.error).toBe("Fake isn't signed in. Run " + process.execPath + " in a terminal to sign in, then try again.")
  })

  it("says when an agent that opens sessions signed out reports it is (Claude Code)", async () => {
    const { agents, id } = await setup()
    process.env.FAKE_ACP_AUTH = "none"
    const checked = await agents.check(id)
    expect(checked).toMatchObject({ status: "error", authenticated: false, version: "1.2.3" })
    expect(checked.error).toMatch(/^Fake isn't signed in\. Run /)
  })

  it("ends the process when idle and starts it again when needed", async () => {
    const { agents, id } = await setup(300)
    await agents.check(id)
    const pid = (await agents.process(id)).pid!
    expect(alive(pid)).toBe(true)
    await sleep(700)
    expect(alive(pid)).toBe(false)
    expect((await agents.process(id)).running).toBe(false)
    await agents.check(id)
    const again = (await agents.process(id)).pid!
    expect(again).not.toBe(pid)
    expect(alive(again)).toBe(true)
  })

  it("tells each start of an agent the proxy as it is then", async () => {
    let proxy = "http://127.0.0.1:7890"
    const { agents, id } = await setup(undefined, undefined, async () => ({ HTTPS_PROXY: proxy }))
    const proc = await agents.process(id)
    expect((await proc.initialized())._meta?.proxy).toBe("http://127.0.0.1:7890")
    proxy = "http://127.0.0.1:7897"
    expect((await proc.initialized())._meta?.proxy).toBe("http://127.0.0.1:7890")
    proc.stop()
    expect((await proc.initialized())._meta?.proxy).toBe("http://127.0.0.1:7897")
  })

  it("survives a crash: one error, then the next call starts it again", async () => {
    const { agents, id, heard } = await setup()
    await agents.check(id)
    const proc = await agents.process(id)
    const pid = proc.pid!
    heard.length = 0
    process.kill(pid, "SIGKILL")
    await sleep(300)
    expect(heard.filter((c) => c.status === "error")).toHaveLength(1)
    expect(heard.find((c) => c.status === "error")!.error).toBe("Fake stopped (SIGKILL). It starts again with the next message.")
    expect((await agents.check(id)).status).toBe("connected")
    expect(proc.pid).not.toBe(pid)
  })
})
