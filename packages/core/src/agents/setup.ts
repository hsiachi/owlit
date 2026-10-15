// owlit's own copy of Claude Code's and Codex's ACP adapters, kept in owlit's data folder. Someone who has
// Claude Code or Codex signed in needs nothing else: owlit runs npm (a copy that ships inside owlit, on
// owlit's own Node) to fetch the adapter, so no Node, no global npm and no Terminal step is needed. Each
// adapter is about 300 MB because it carries its own copy of the agent; the user's own `claude` or `codex`
// is only what signed them in. A newer adapter is offered as an update, never fetched by itself.

import { t } from "@lingui/core/macro"
import type { AgentSetup } from "@owlit/protocol"
import { spawn } from "node:child_process"
import { readdir, readFile, rename, rm, stat } from "node:fs/promises"
import path from "node:path"
import type { Launch } from "./agents.ts"
import { resolveExecutable } from "./command.ts"

export interface Managed {
  pkg: string
  // The adapter's command, as its package's bin names it
  bin: string
  // The agent's own command, whose presence says the agent is on this Mac
  cli: string
  // How to install the agent itself, in Terminal
  installCli: string
  // About how much it takes on disk, measured 2026-10-13 (claude-agent-acp 0.88, codex-acp 2.2.1)
  sizeMb: number
}

export const MANAGED: Record<string, Managed> = {
  "claude-code": { pkg: "@agentclientprotocol/claude-agent-acp", bin: "claude-agent-acp", cli: "claude", installCli: "curl -fsSL https://claude.ai/install.sh | bash", sizeMb: 290 },
  codex: { pkg: "@agentclientprotocol/codex-acp", bin: "codex-acp", cli: "codex", installCli: "npm install -g @openai/codex", sizeMb: 335 },
}

// How often the registry is asked whether a newer adapter exists
const LATEST_TTL_MS = 12 * 60 * 60_000

export interface SetupOptions {
  // <userData>/agents: each adapter in a folder of its own
  dir: string
  // Runs a JavaScript file as plain Node (Electron's binary with ELECTRON_RUN_AS_NODE)
  node: Launch
  // npm's CLI script, run with node
  npm: string
  // The npm registry's answer for a package's latest version
  fetchJson: (url: string) => Promise<unknown>
  // Where `claude` and `codex` are looked for
  searchPath: () => Promise<string>
  // The system proxy as environment variables, which npm reads (proxy.ts)
  proxyEnv?: () => Promise<Record<string, string>>
  // Something changed for this agent (progress, done, failed)
  changed: (id: string) => void
}

interface Running {
  progress: number
  controller: AbortController
}

export class AgentSetups {
  private readonly options: SetupOptions
  private running = new Map<string, Running>()
  private errors = new Map<string, string>()
  private latest = new Map<string, { version: string; at: number }>()
  private cliFound = new Map<string, boolean>()

  constructor(options: SetupOptions) {
    this.options = options
  }

  // owlit's copy of the adapter: its version and the script to run, once set up
  async installed(id: string): Promise<{ version: string; entry: string } | null> {
    const managed = MANAGED[id]
    if (!managed) return null
    const root = path.join(this.folder(id), "node_modules", ...managed.pkg.split("/"))
    try {
      const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as { version: string; bin?: string | Record<string, string> }
      const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.[managed.bin]
      if (!bin) return null
      return { version: pkg.version, entry: path.join(root, bin) }
    } catch {
      return null
    }
  }

  // Looks again for the agent's own command and the newest adapter; called when the agent is checked
  async look(id: string) {
    const managed = MANAGED[id]
    if (!managed) return
    this.cliFound.set(id, !!(await resolveExecutable(managed.cli, await this.options.searchPath())))
    const known = this.latest.get(id)
    if (!known || Date.now() - known.at > LATEST_TTL_MS) {
      const answer = (await this.options.fetchJson(`https://registry.npmjs.org/${managed.pkg}/latest`).catch(() => null)) as { version?: string } | null
      if (answer?.version) this.latest.set(id, { version: answer.version, at: Date.now() })
    }
  }

  async view(id: string): Promise<AgentSetup | undefined> {
    const managed = MANAGED[id]
    if (!managed) return undefined
    const installed = await this.installed(id)
    const latest = this.latest.get(id)?.version
    const running = this.running.get(id)
    const error = this.errors.get(id)
    return {
      cliFound: this.cliFound.get(id) ?? false,
      installCli: managed.installCli,
      sizeMb: managed.sizeMb,
      ...(installed ? { installed: installed.version } : {}),
      ...(installed && latest && newer(latest, installed.version) ? { latest } : {}),
      ...(running ? { progress: running.progress } : {}),
      ...(error && !running ? { error } : {}),
    }
  }

  // Fetches the newest adapter into a folder of its own, then puts it in place of the old one, so a
  // running agent keeps its files and a failed or cancelled setup leaves the old one as it was
  async setUp(id: string): Promise<void> {
    const managed = MANAGED[id]
    if (!managed || this.running.has(id)) return
    const controller = new AbortController()
    const run: Running = { progress: 0, controller }
    this.running.set(id, run)
    this.errors.delete(id)
    this.options.changed(id)
    const next = `${this.folder(id)}.next`
    const cache = path.join(this.options.dir, ".npm-cache")
    // npm says nothing about how far it is; what has landed on disk does. Most of the time goes on the
    // download into its cache, about a third of the unpacked size (claude-agent-acp 0.90: 100 of 306 MB,
    // seen 2026-10-14); unpacking at the end is quick, and holds at 95% until it is done.
    const expected = managed.sizeMb * 0.36 * 1024 * 1024
    const timer = setInterval(() => {
      void Promise.all([sizeOf(next), sizeOf(cache)]).then(([a, b]) => {
        const progress = Math.min(0.95, (a + b) / expected)
        if (progress > run.progress) {
          run.progress = progress
          this.options.changed(id)
        }
      })
    }, 700)
    try {
      await rm(next, { recursive: true, force: true })
      await this.npm(["install", "--prefix", next, "--no-audit", "--no-fund", "--omit=dev", "--cache", cache, "--loglevel", "error", `${managed.pkg}@latest`], controller.signal)
      if (!(await this.installedAt(next, managed))) throw new Error(t`npm finished, but the adapter isn't there.`)
      await rm(this.folder(id), { recursive: true, force: true })
      await rename(next, this.folder(id))
    } catch (error) {
      await rm(next, { recursive: true, force: true }).catch(() => undefined)
      if (!controller.signal.aborted) this.errors.set(id, failure(error))
    } finally {
      clearInterval(timer)
      await rm(cache, { recursive: true, force: true }).catch(() => undefined)
      this.running.delete(id)
      this.options.changed(id)
    }
  }

  cancel(id: string) {
    this.running.get(id)?.controller.abort()
  }

  private folder(id: string) {
    return path.join(this.options.dir, id)
  }

  private async installedAt(folder: string, managed: Managed) {
    return stat(path.join(folder, "node_modules", ...managed.pkg.split("/"), "package.json")).then(
      () => true,
      () => false,
    )
  }

  private async npm(args: string[], signal: AbortSignal): Promise<void> {
    const { node } = this.options
    const proxy = (await this.options.proxyEnv?.()) ?? {}
    return new Promise((resolve, reject) => {
      const child = spawn(node.command, [...node.args, this.options.npm, ...args], {
        env: { ...process.env, ...node.env, ...proxy, PATH: process.env.PATH ?? "", npm_config_update_notifier: "false" },
        stdio: ["ignore", "ignore", "pipe"],
        signal,
      })
      let stderr = ""
      child.stderr.setEncoding("utf8")
      child.stderr.on("data", (chunk: string) => {
        stderr = (stderr + chunk).slice(-4000)
      })
      child.on("error", reject)
      child.on("close", (code) => (code === 0 ? resolve() : reject(new NpmFailed(stderr, code))))
    })
  }
}

class NpmFailed extends Error {
  readonly stderr: string
  constructor(stderr: string, code: number | null) {
    super(`npm exited with code ${code}`)
    this.stderr = stderr
  }
}

// One sentence for the row: the common causes in owlit's words, else npm's own last line
function failure(error: unknown): string {
  const text = error instanceof NpmFailed ? error.stderr : error instanceof Error ? error.message : String(error)
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|network/i.test(text)) return t`Couldn't reach the npm registry. Check the network or proxy, then try again.`
  if (/ENOSPC/.test(text)) return t`There isn't enough space on this Mac.`
  const last = text
    .split("\n")
    .map((l) => l.replace(/^npm (ERR!|error)\s*/, "").trim())
    .filter(Boolean)
    .at(-1)
  return last ?? t`The setup failed.`
}

// Whether version a is newer than b (plain x.y.z; anything else counts as not newer)
export function newer(a: string, b: string) {
  const parse = (v: string) => v.split("-")[0].split(".").map(Number)
  const [x, y] = [parse(a), parse(b)]
  if ([...x, ...y].some(Number.isNaN)) return false
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  return false
}

// Bytes under a folder, 0 if it isn't there
async function sizeOf(dir: string): Promise<number> {
  let total = 0
  const walk = async (d: string): Promise<void> => {
    const entries = await readdir(d, { withFileTypes: true }).catch(() => [])
    await Promise.all(
      entries.map(async (e) => {
        const p = path.join(d, e.name)
        if (e.isDirectory()) await walk(p)
        else if (e.isFile()) total += (await stat(p).catch(() => ({ size: 0 }))).size
      }),
    )
  }
  await walk(dir)
  return total
}
