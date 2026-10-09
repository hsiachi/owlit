import type { CoreVersion, RpcNotification, RpcRequest, RpcResponse, WorkspaceInfo } from "@owlit/protocol"
import { existsSync } from "node:fs"
import { z } from "zod"
import { noParams, Notifier, Router } from "./rpc/index.ts"
import { SettingsStore } from "./settings.ts"
import { resolveFolder, Workspace } from "./workspace/workspace.ts"

export const CORE_VERSION = "0.0.0"

export interface CoreOptions {
  // This machine's data directory for owlit (Electron's userData): settings.json, workspaces/<hash>/
  userDataDir: string
  // Reported by core.version; the host knows it (Electron's app.getVersion())
  appVersion?: string
}

// The backend as one object. It speaks only JSON-RPC: handle() takes a request, onNotify() hears
// notifications. Constructing it touches nothing outside; start() is when it begins to talk.
export class Core {
  readonly settings: SettingsStore
  private router = new Router()
  private notifier = new Notifier()
  private options: CoreOptions
  private started = false
  private workspace: Workspace | null = null
  // Opens and closes run one at a time, in the order asked
  private switching: Promise<unknown> = Promise.resolve()

  constructor(options: CoreOptions) {
    this.options = options
    this.settings = new SettingsStore(options.userDataDir)

    this.router.register("core.ping", noParams, () => ({ ok: true as const }))
    this.router.register("core.version", noParams, () => this.version())

    this.router.register("workspace.current", noParams, () => this.workspace?.info ?? null)
    this.router.register("workspace.open", z.object({ path: z.string().min(1) }), ({ path }) => this.openWorkspace(path))
    this.router.register("workspace.recent", noParams, async () => {
      const { recentWorkspaces } = await this.settings.get()
      return recentWorkspaces.filter((p) => existsSync(p)).map(toInfo)
    })
    this.router.register("workspace.clearRecent", noParams, async () => {
      await this.settings.update((s) => ({ ...s, recentWorkspaces: [] }))
      return null
    })
  }

  handle(request: RpcRequest): Promise<RpcResponse> {
    return this.router.handle(request)
  }

  onNotify(listener: (notification: RpcNotification) => void) {
    return this.notifier.subscribe(listener)
  }

  start() {
    if (this.started) return
    this.started = true
    this.notifier.notify("core.hello", this.version())
  }

  // The workspace to reopen at launch, if it is still there
  async lastWorkspace() {
    const { lastWorkspace } = await this.settings.get()
    return lastWorkspace && existsSync(lastWorkspace) ? lastWorkspace : undefined
  }

  openWorkspace(folder: string): Promise<WorkspaceInfo> {
    const run = this.switching.then(async () => {
      const root = await resolveFolder(folder).catch(async (error) => {
        await this.settings.forgetWorkspace(folder)
        throw error
      })
      // The current workspace stays open until the next one has opened, so a failed switch loses nothing
      const next = this.workspace?.root === root ? this.workspace : await Workspace.open(root, this.options.userDataDir)
      if (this.workspace && this.workspace !== next) await this.workspace.dispose()
      this.workspace = next
      await this.settings.rememberWorkspace(next.root)
      this.notifier.notify("workspace.opened", next.info)
      return next.info
    })
    this.switching = run.catch(() => undefined)
    return run
  }

  async dispose() {
    this.started = false
    await this.switching
    await this.workspace?.dispose()
    this.workspace = null
  }

  private version(): CoreVersion {
    return { version: this.options.appVersion ?? CORE_VERSION, node: process.versions.node }
  }
}

const toInfo = (folder: string): WorkspaceInfo => ({ path: folder, name: folder.slice(folder.lastIndexOf("/") + 1) })
