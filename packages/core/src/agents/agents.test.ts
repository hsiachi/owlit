import type { Connector } from "@owlit/protocol"
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { SettingsStore } from "../settings/store.ts"
import { eventually, until } from "../test-util.ts"
import { agentEnv, Agents, tidy } from "./agents.ts"
import { splitCommand } from "./command.ts"

const fake = path.join(import.meta.dirname, "fake-acp.ts")
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
  delete process.env.FAKE_ACP_LOGIN_WAIT
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

describe("agentEnv", () => {
  it("drops the variables of a Claude Code session owlit was started from, and keeps sign-in ones", () => {
    const env = agentEnv({
      PATH: "/usr/bin",
      HOME: "/Users/me",
      CLAUDECODE: "1",
      CLAUDE_PID: "123",
      CLAUDE_EFFORT: "medium",
      AI_AGENT: "claude-code_2-1-295_agent",
      CLAUDE_CODE_ENTRYPOINT: "claude-desktop",
      CLAUDE_CODE_SESSION_ID: "abc",
      CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH: "1",
      CLAUDE_AGENT_SDK_VERSION: "0.3.295",
      CLAUDE_PREVIEW_CLASSIFIER_FLOOR: "1",
      CLAUDE_CODE_OAUTH_TOKEN: "token",
      CLAUDE_CODE_USE_BEDROCK: "1",
      CLAUDE_CONFIG_DIR: "/Users/me/.claude-work",
      ANTHROPIC_API_KEY: "key",
      HTTPS_PROXY: "http://127.0.0.1:7890",
    })
    expect(env).toEqual({
      PATH: "/usr/bin",
      HOME: "/Users/me",
      CLAUDE_CODE_OAUTH_TOKEN: "token",
      CLAUDE_CODE_USE_BEDROCK: "1",
      CLAUDE_CONFIG_DIR: "/Users/me/.claude-work",
      ANTHROPIC_API_KEY: "key",
      HTTPS_PROXY: "http://127.0.0.1:7890",
    })
  })

  it("leaves an environment from outside a Claude Code session as it is", () => {
    const env = { PATH: "/usr/bin", CLAUDE_CODE_MAX_OUTPUT_TOKENS: "8000" }
    expect(agentEnv(env)).toEqual(env)
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

  it("checks an agent: version, models and efforts from the agent itself", async () => {
    const { agents, id } = await setup()
    const checked = await agents.check(id)
    expect(checked).toMatchObject({ status: "connected", version: "1.2.3", authenticated: true, defaultModelId: "small", defaultEffortId: "low" })
    expect(checked.models.map((m) => m.id)).toEqual(["small", "large"])
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

  // A turn ends with this sentence, not the bare name ("Claude Code") under "Owlit stopped"
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

  it("signs in in the browser by running the agent's own terminal sign-in (Claude Code)", async () => {
    const { agents, id, dir } = await setup()
    process.env.FAKE_ACP_AUTH = "browser"
    process.env.FAKE_ACP_SIGNED_IN = path.join(dir, "signed-in")
    const before = await agents.check(id)
    expect(before).toMatchObject({ authenticated: false, browserSignIn: "claude-ai-login" })
    expect(before.error).toBe("Fake isn't signed in. Sign in under Settings › Agents, then try again.")
    const after = await agents.signIn(id, "claude-ai-login")
    expect(after).toMatchObject({ authenticated: true })
    expect(after.status === "available" || after.status === "connected").toBe(true)
  })

  it("lets a sign-in waiting in the browser be opened again or cancelled, without an error", async () => {
    const { agents, heard, id, dir } = await setup()
    process.env.FAKE_ACP_AUTH = "browser"
    process.env.FAKE_ACP_SIGNED_IN = path.join(dir, "signed-in")
    const back = path.join(dir, "back")
    process.env.FAKE_ACP_LOGIN_WAIT = back
    await agents.check(id)

    const first = agents.signIn(id, "claude-ai-login")
    await eventually(() => expect(heard.at(-1)?.signingIn).toBe(true))
    // The page opened again: the first ends quietly, the second waits
    const second = agents.signIn(id, "claude-ai-login")
    expect((await first).authenticated).toBe(false)
    await eventually(() => expect(heard.at(-1)?.signingIn).toBe(true))
    // Cancelled: the second ends quietly too, and nothing waits any more
    const cancelled = await agents.cancelSignIn(id)
    expect(cancelled.signingIn).toBeUndefined()
    expect((await second).signingIn).toBeUndefined()

    // A third comes back from the browser and signs in
    const third = agents.signIn(id, "claude-ai-login")
    await eventually(() => expect(heard.at(-1)?.signingIn).toBe(true))
    writeFileSync(back, "")
    expect(await third).toMatchObject({ authenticated: true })
    delete process.env.FAKE_ACP_LOGIN_WAIT
  })

  it("ends the process when idle and starts it again when needed", async () => {
    const { agents, id } = await setup(300)
    await agents.check(id)
    const pid = (await agents.process(id)).pid!
    expect(alive(pid)).toBe(true)
    await eventually(async () => {
      expect(alive(pid)).toBe(false)
      expect((await agents.process(id)).running).toBe(false)
    })
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
    const error = await until(() => heard.find((c) => c.status === "error"), { what: "the crash's error" })
    expect(error.error).toBe("Fake stopped (SIGKILL). It starts again with the next message.")
    expect((await agents.check(id)).status).toBe("connected")
    expect(proc.pid).not.toBe(pid)
    // Started again: any other error about the crash would have come before
    expect(heard.filter((c) => c.status === "error")).toHaveLength(1)
  })
})
