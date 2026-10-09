import { RpcErrorCode, type ChatMessage, type CoreVersion, type RpcNotification, type RpcRequest, type RpcResponse, type WorkspaceInfo } from "@owlit/protocol"
import { existsSync } from "node:fs"
import path from "node:path"
import { z } from "zod"
import { ActivityBus, activityEvent, Journal } from "./activity/index.ts"
import { Agents } from "./agents/agents.ts"
import type { Host } from "./docs/docs.ts"
import { noParams, Notifier, Router, RpcFailure } from "./rpc/index.ts"
import { SettingsStore } from "./settings.ts"
import { debugTasks, LANE_LIMITS, TaskThrottle, type TaskDefinition } from "./tasks/index.ts"
import { resolveFolder, Workspace } from "./workspace/workspace.ts"

export const CORE_VERSION = "0.0.0"

export interface CoreOptions {
  // This machine's data directory for owlit (Electron's userData): settings.json, workspaces/<hash>/
  userDataDir: string
  // Reported by core.version; the host knows it (Electron's app.getVersion())
  appVersion?: string
  // What the machine offers beyond Node (the system Trash, opening files in their apps)
  host?: Host
  // A development build: adds what only helps while working on owlit (tasks.debugEnqueue)
  debug?: boolean
}

// The backend as one object. It speaks only JSON-RPC: handle() takes a request, onNotify() hears
// notifications. Constructing it touches nothing outside; start() is when it begins to talk.
export class Core {
  readonly settings: SettingsStore
  readonly activity = new ActivityBus()
  readonly agents: Agents
  private journal: Journal
  private router = new Router()
  private notifier = new Notifier()
  private options: CoreOptions
  private started = false
  private workspace: Workspace | null = null
  // Opens and closes run one at a time, in the order asked
  private switching: Promise<unknown> = Promise.resolve()
  private taskChanges = new TaskThrottle(200, (task) => this.notifier.notify("tasks.changed", { task }))
  private debugTasks = debugTasks()

  constructor(options: CoreOptions) {
    this.options = options
    this.settings = new SettingsStore(options.userDataDir)
    this.journal = new Journal(this.activity, () => this.workspace?.owlitPath("journal.jsonl") ?? null)
    this.agents = new Agents({
      settings: this.settings,
      probeDir: path.join(options.userDataDir, "agents", "probe"),
      cwd: () => this.workspace?.root ?? null,
      notify: (connector) => this.notifier.notify("agents.changed", connector),
      idleMs: Number(process.env.OWLIT_AGENT_IDLE_MS) || undefined,
    })

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

    this.router.register("workspace.layout", noParams, () => this.requireWorkspace().layout())
    this.router.register("workspace.setLayout", z.object({ patch: z.record(z.string(), z.unknown()) }), ({ patch }) =>
      this.requireWorkspace().setLayout(patch),
    )

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

    const anchor = z.object({ quote: z.string(), prefix: z.string(), suffix: z.string() })
    const note = anchor.extend({
      id: z.string().min(1),
      text: z.string(),
      by: z.string(),
      chatId: z.string().optional(),
      createdAt: z.number(),
    })
    const chats = () => this.requireWorkspace().chats
    const chatId = z.string().regex(/^[\w-]+$/)
    const summary = z.object({
      id: chatId,
      title: z.string(),
      createdAt: z.number(),
      updatedAt: z.number(),
      pinned: z.boolean(),
      connectorId: z.string().optional(),
      modelId: z.string().optional(),
      modeId: z.string().optional(),
      effortId: z.string().optional(),
    })
    // Messages are the app's own shape (protocol/chat.ts); core checks only what it relies on
    const message = z.looseObject({
      id: z.string().min(1),
      role: z.enum(["user", "assistant"]),
      parts: z.array(z.unknown()),
      createdAt: z.number(),
    }) as unknown as z.ZodType<ChatMessage>
    this.router.register("chats.list", noParams, () => chats().list())
    this.router.register("chats.get", z.object({ id: chatId }), ({ id }) => chats().get(id))
    this.router.register("chats.create", z.object({ chat: summary }), ({ chat }) => chats().create(chat))
    this.router.register("chats.update", z.object({ id: chatId, patch: summary.omit({ id: true, createdAt: true }).partial() }), ({ id, patch }) =>
      chats().update(id, patch),
    )
    this.router.register("chats.delete", z.object({ id: chatId }), ({ id }) => chats().delete(id))
    this.router.register("chats.appendMessage", z.object({ id: chatId, message }), ({ id, message }) =>
      chats().appendMessage(id, message),
    )
    this.router.register("chats.patchMessage", z.object({ id: chatId, message, final: z.boolean().optional() }), ({ id, message, final }) =>
      chats().patchMessage(id, message, final),
    )

    this.router.register("agents.list", noParams, () => this.agents.list())
    this.router.register("agents.check", z.object({ id: z.string() }), ({ id }) => this.agents.check(id))
    this.router.register("agents.add", z.object({ name: z.string(), command: z.string() }), ({ name, command }) => this.agents.add(name, command))
    this.router.register("agents.remove", z.object({ id: z.string() }), ({ id }) => this.agents.remove(id))

    const tasks = () => this.requireWorkspace().tasks
    const taskId = z.string().min(1)
    this.router.register("tasks.list", noParams, () => tasks().list())
    this.router.register("tasks.cancel", z.object({ id: taskId }), ({ id }) => tasks().cancel(id))
    this.router.register("tasks.resume", z.object({ id: taskId }), ({ id }) => tasks().resume(id))
    if (options.debug) {
      const lanes = Object.keys(LANE_LIMITS) as [keyof typeof LANE_LIMITS, ...(keyof typeof LANE_LIMITS)[]]
      this.router.register(
        "tasks.debugEnqueue",
        z.object({
          subject: z.string().min(1),
          lane: z.enum(lanes).optional(),
          priority: z.enum(["waiting", "asked", "background"]).optional(),
          ms: z.number().nonnegative().optional(),
          steps: z.number().int().positive().optional(),
          fail: z.boolean().optional(),
          waitForYou: z.boolean().optional(),
        }),
        ({ subject, lane = "network", priority, ...params }) => {
          const task = tasks().enqueue(`debug.${lane}`, subject, priority)
          this.debugTasks.params.set(task.id, params)
          return task
        },
      )
    }

    this.router.register("notes.all", noParams, () => docs().notesAll())
    this.router.register("notes.add", z.object({ path: rel, note }), ({ path, note }) => docs().addNote(path, note))
    this.router.register("notes.remove", z.object({ path: rel, id: z.string() }), ({ path, id }) => docs().removeNote(path, id))
    this.router.register("notes.reanchor", z.object({ path: rel, moved: z.record(z.string(), anchor) }), ({ path, moved }) =>
      docs().reanchorNotes(path, moved),
    )
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
      const next =
        this.workspace?.root === root
          ? this.workspace
          : await Workspace.open(root, this.options.userDataDir, this.options.host, {
              definitions: () => this.taskDefinitions(),
              onChange: (task) => this.taskChanges.push(task),
            })
      if (this.workspace && this.workspace !== next) {
        await this.workspace.dispose()
        // The old workspace's last task changes go out before clients hear of the switch
        this.taskChanges.flush()
      }
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
    this.agents.dispose()
    await this.switching
    await this.journal.dispose()
    await this.workspace?.dispose()
    this.workspace = null
    this.taskChanges.flush()
  }

  // Every kind of task core knows
  private taskDefinitions(): TaskDefinition[] {
    return this.options.debug ? this.debugTasks.definitions : []
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
