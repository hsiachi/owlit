import { RpcErrorCode, type CoreVersion, type RpcNotification, type RpcRequest, type RpcResponse, type WorkspaceInfo } from "@owlit/protocol"
import { existsSync } from "node:fs"
import { z } from "zod"
import { ActivityBus, activityEvent, Journal } from "./activity/index.ts"
import type { Host } from "./docs/docs.ts"
import { noParams, Notifier, Router, RpcFailure } from "./rpc/index.ts"
import { SettingsStore } from "./settings.ts"
import { resolveFolder, Workspace } from "./workspace/workspace.ts"

export const CORE_VERSION = "0.0.0"

export interface CoreOptions {
  // This machine's data directory for owlit (Electron's userData): settings.json, workspaces/<hash>/
  userDataDir: string
  // Reported by core.version; the host knows it (Electron's app.getVersion())
  appVersion?: string
  // What the machine offers beyond Node (the system Trash, opening files in their apps)
  host?: Host
}

// The backend as one object. It speaks only JSON-RPC: handle() takes a request, onNotify() hears
// notifications. Constructing it touches nothing outside; start() is when it begins to talk.
export class Core {
  readonly settings: SettingsStore
  readonly activity = new ActivityBus()
  private journal: Journal
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
    this.journal = new Journal(this.activity, () => this.workspace?.owlitPath("journal.jsonl") ?? null)

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

    this.router.register("activity.emit", z.object({ event: activityEvent }), async ({ event }) => {
      if (this.workspace && (await this.settings.get()).activity.enabled) this.activity.publish(event)
      return null
    })
    this.router.register("activity.status", noParams, async () => (await this.settings.get()).activity)
    this.router.register("activity.setEnabled", z.object({ enabled: z.boolean() }), async ({ enabled }) => {
      const { activity } = await this.settings.update((s) => ({ ...s, activity: { ...s.activity, enabled } }))
      this.notifier.notify("activity.status", activity)
      return activity
    })

    const docs = () => this.requireWorkspace().docs
    const rel = z.string()
    this.router.register("docs.list", noParams, () => docs().list())
    this.router.register("docs.read", z.object({ path: rel }), ({ path }) => docs().read(path))
    this.router.register(
      "docs.create",
      z.object({ path: rel, content: z.string(), id: z.string().min(1).optional(), followsFirstLine: z.boolean().optional() }),
      ({ path, content, ...options }) => docs().create(path, content, options),
    )
    this.router.register(
      "docs.write",
      z.object({ path: rel, content: z.string(), expectedModifiedAt: z.number(), force: z.boolean().optional() }),
      ({ path, content, expectedModifiedAt, force }) => docs().write(path, content, expectedModifiedAt, force),
    )
    this.router.register("docs.rename", z.object({ path: rel, name: z.string() }), ({ path, name }) => docs().rename(path, name))
    this.router.register("docs.move", z.object({ path: rel, folder: z.string() }), ({ path, folder }) => docs().move(path, folder))
    this.router.register("docs.delete", z.object({ path: rel }), ({ path }) => docs().delete(path))
    this.router.register("docs.createFolder", z.object({ path: rel }), ({ path }) => docs().createFolder(path))
    this.router.register(
      "docs.restore",
      z.object({ files: z.array(z.object({ id: z.string(), path: rel, content: z.string() })), folders: z.array(rel) }),
      ({ files, folders }) => docs().restore(files, folders),
    )
    this.router.register("docs.open", z.object({ path: rel }), ({ path }) => docs().open(path))
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
      const next = this.workspace?.root === root ? this.workspace : await Workspace.open(root, this.options.userDataDir, this.options.host)
      if (this.workspace && this.workspace !== next) await this.workspace.dispose()
      if (this.workspace !== next) await next.docs.watch((change) => this.notifier.notify("docs.changed", change))
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
    await this.journal.dispose()
    await this.workspace?.dispose()
    this.workspace = null
  }

  private requireWorkspace() {
    if (!this.workspace) throw new RpcFailure(RpcErrorCode.NoWorkspace, "Open a folder as the workspace first.")
    return this.workspace
  }

  private version(): CoreVersion {
    return { version: this.options.appVersion ?? CORE_VERSION, node: process.versions.node }
  }
}

const toInfo = (folder: string): WorkspaceInfo => ({ path: folder, name: folder.slice(folder.lastIndexOf("/") + 1) })
