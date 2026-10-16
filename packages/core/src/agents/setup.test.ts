import type { Connector } from "@owlit/protocol"
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { SettingsStore } from "../settings.ts"
import { Agents } from "./agents.ts"
import { failure, newer } from "./setup.ts"

const fake = path.join(import.meta.dirname, "fake-acp.ts")

const made: Agents[] = []
afterEach(() => {
  for (const a of made.splice(0)) a.dispose()
})

// An npm that "installs" a package by writing an adapter whose script starts the fake ACP agent;
// FAKE_NPM=fail makes it fail as npm does without a network
const FAKE_NPM = `
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
const args = process.argv.slice(2)
if (process.env.FAKE_NPM === "fail") { process.stderr.write("npm error code ENOTFOUND\\nnpm error network request to https://registry.npmjs.org failed\\n"); process.exit(1) }
const prefix = args[args.indexOf("--prefix") + 1]
const pkg = args.at(-1).replace(/@latest$/, "")
const root = path.join(prefix, "node_modules", ...pkg.split("/"))
mkdirSync(path.join(root, "dist"), { recursive: true })
writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: pkg, version: "0.90.0", bin: { [pkg.split("/")[1]]: "dist/index.mjs" } }))
writeFileSync(path.join(root, "dist", "index.mjs"), "import " + JSON.stringify(process.env.FAKE_AGENT) + "\\n")
`

async function setup(options: { claude?: boolean } = {}) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-setup-")))
  const bin = path.join(dir, "bin")
  mkdirSync(bin)
  // The agent's own command, as the user's PATH would have it
  if (options.claude !== false) {
    writeFileSync(path.join(bin, "claude"), "#!/bin/sh\nexit 0\n")
    chmodSync(path.join(bin, "claude"), 0o755)
  }
  const npm = path.join(dir, "fake-npm.mjs")
  writeFileSync(npm, FAKE_NPM)
  const heard: Connector[] = []
  const agents = new Agents({
    settings: new SettingsStore(dir),
    probeDir: path.join(dir, "probe"),
    cwd: () => dir,
    notify: (c) => heard.push(c),
    searchPath: async () => bin,
    setup: { dir: path.join(dir, "agents"), node: { command: process.execPath, args: [], env: { FAKE_AGENT: fake } }, npm, fetchJson: async () => ({ version: "0.91.0" }) },
  })
  made.push(agents)
  // Ends when a change for Claude Code satisfies the test
  const until = async (test: (c: Connector) => boolean) => {
    for (;;) {
      const c = heard.filter((h) => h.id === "claude-code").at(-1)
      if (c && test(c)) return c
      await new Promise((r) => setTimeout(r, 20))
    }
  }
  return { agents, heard, until, dir }
}

describe("owlit's own copy of an adapter", () => {
  it("offers to set Claude Code up when it is on the Mac, sets it up and runs that copy", async () => {
    const { agents, until } = await setup()
    process.env.FAKE_NPM = ""
    const before = await agents.check("claude-code")
    expect(before.status).toBe("not_installed")
    expect(before.setup).toMatchObject({ cliFound: true, sizeMb: 290 })
    expect(before.setup?.installed).toBeUndefined()

    expect((await agents.setUp("claude-code")).setup?.progress).toBe(0)
    const ready = await until((c) => c.status === "available" || c.status === "connected")
    expect(ready.setup).toMatchObject({ installed: "0.90.0", latest: "0.91.0" })
    expect(ready.setup?.progress).toBeUndefined()
  })

  it("says why a setup failed, and leaves nothing half set up", async () => {
    const { agents, until } = await setup()
    process.env.FAKE_NPM = "fail"
    try {
      await agents.setUp("claude-code")
      const failed = await until((c) => !!c.setup?.error)
      expect(failed.setup?.error).toBe("Couldn't reach the npm registry. Check the network or proxy, then try again.")
      expect(failed.setup?.installed).toBeUndefined()
    } finally {
      process.env.FAKE_NPM = ""
    }
  })

  it("knows when the agent itself isn't on the Mac", async () => {
    const { agents } = await setup({ claude: false })
    const c = await agents.check("claude-code")
    expect(c.setup).toMatchObject({ cliFound: false, installCli: "curl -fsSL https://claude.ai/install.sh | bash" })
    // Gemini CLI isn't one owlit sets up
    expect((await agents.list()).find((x) => x.id === "gemini-cli")?.setup).toBeUndefined()
  })
})

describe("newer", () => {
  it("compares plain versions", () => {
    expect(newer("0.91.0", "0.90.3")).toBe(true)
    expect(newer("1.0.0", "0.99.9")).toBe(true)
    expect(newer("0.90.0", "0.90.0")).toBe(false)
    expect(newer("0.89.9", "0.90.0")).toBe(false)
    expect(newer("next", "0.90.0")).toBe(false)
  })
})

describe("failure", () => {
  it("says npm's own sentence, not where its log is", () => {
    const stderr = [
      "npm warn deprecated something@1.0.0",
      "npm error code EACCES",
      "npm error syscall mkdir",
      "npm error path /Users/someone/.npm",
      "npm error The operation was rejected by your operating system.",
      "npm error A complete log of this run can be found in: /Users/someone/.npm/_logs/debug-0.log",
    ].join("\n")
    expect(failure(new Error(stderr))).toBe("The operation was rejected by your operating system.")
    expect(failure(new Error("npm error code ECONNRESET\nnpm error A complete log of this run can be found in: x"))).toBe(
      "Couldn't reach the npm registry. Check the network or proxy, then try again.",
    )
  })
})
