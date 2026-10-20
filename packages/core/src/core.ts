import { t } from "@lingui/core/macro"
import { isOpenComment, sameAbout, type ResultOf, type StopReason, isOwlit, isPerson, normalizeNoteLanguage, RpcErrorCode, type BuildInfo, type ChangeOrigin, type CoreVersion, type Paper, type PaperPatch, type PersonId, type RpcNotification, type RpcRequest, type RpcResponse, type WorkspaceInfo, type WorkspaceState } from "@owlit/protocol"
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"

import path from "node:path"
import { ActivityBus, Journal } from "./activity/index.ts"
import { Agents } from "./agents/agents.ts"
import type { CutOff } from "@owlit/protocol"
import { hasProxyEnv, systemProxyEnv } from "./agents/proxy.ts"
import { AgentFs } from "./agents/fs.ts"
import { Undo } from "./changes/undo.ts"

import { Turns } from "./agents/turns.ts"
import { ReadLog, readFromOf } from "./agents/read-from.ts"
import { latestRelease } from "./updates/github.ts"
import { Updates } from "./updates/updates.ts"
import { UiBridge } from "./ui/bridge.ts"
import type { Host } from "./host.ts"
import { noParams, Notifier, Router, RpcFailure, WINDOW, type Caller, type Policy } from "./rpc/index.ts"
import { decide, type Who } from "./agents/policy.ts"
import { newWriteId } from "./changes/record.ts"

import { replyRecipe } from "./recipes/reply.ts"
import { SocketServer } from "./rpc/socket.ts"
import { ExtensionServer, type ExtensionServerOptions } from "./extension/server.ts"

import { askAgain, startedWith, startFor, tryAgain, type StartFor, type Started, type TurnAgent } from "./chats/chats.ts"
import { becameReadInFull } from "./library/read-in-full.ts"

import { limitMetadataHosts } from "./library/resolve.ts"
import { noteRelPath } from "./library/state.ts"

import { serveWorkspaceFile } from "./files/serve.ts"

import { Http } from "./net/http.ts"
import { SettingsStore } from "./settings.ts"
import { isMissing } from "./fs-util.ts"
import { messageOf } from "./util.ts"
import { defaultNoteLanguage, registerSettings } from "./settings-rpc.ts"
import { debugTasks, TaskThrottle, type TaskDefinition } from "./tasks/index.ts"

import { resolveFolder, Workspace } from "./workspace/workspace.ts"

import { registerActivity } from "./activity/rpc.ts"
import { registerAgents } from "./agents/rpc.ts"
import { registerChanges } from "./changes/rpc.ts"
import { registerChats } from "./chats/rpc.ts"
import { registerDocs } from "./docs/rpc.ts"
import { registerExtension } from "./extension/rpc.ts"
import { registerLibrary } from "./library/rpc.ts"
import { registerMemory } from "./memory/rpc.ts"
import { registerSearch } from "./search/rpc.ts"
import { registerShare } from "./share/rpc.ts"
import { registerTasks } from "./tasks/rpc.ts"
import { registerThreads } from "./threads/rpc.ts"
import { registerUi } from "./ui/rpc.ts"
import { registerUpdates } from "./updates/rpc.ts"
import { registerWorkspace } from "./workspace/rpc.ts"

export const CORE_VERSION = "0.0.0"

// Methods that may change what a shared doc's reader sees: the doc, the papers it cites, their notes
// How long the extension's Open waits for a window the host opened to load before saying none is open: a
// cold window loads the renderer and the workspace first
const WINDOW_LOADS_WITHIN_MS = 15_000

const SHARED_CHANGES = /^(docs\.(create|write|rename|move|delete|restore)|library\.(add|update|remove|restore|setNote|refresh|requestDigest|importPdf|attachPdf))$/

// Methods that change what the search index covers
const CHANGES = /^(docs\.(create|write|rename|move|delete|restore)|chats\.(create|update|delete|restore|appendMessage|patchMessage)|notes\.|library\.(add|update|remove|restore|setNote|importPdf|attachPdf))$/

// The docs or papers a change names, so only the shares that show them are built again; a change that
// names neither (or one this doesn't know) builds them all
function sharedChange(method: string, params: unknown, result: unknown): { docs?: string[]; papers?: string[] } | undefined {
  const p = (params ?? {}) as { path?: unknown; files?: { path?: unknown }[]; folders?: unknown; id?: unknown; ids?: unknown; paperId?: unknown }
  const r = (result ?? {}) as { path?: unknown; id?: unknown; paper?: { id?: unknown } }
  const strings = (...values: unknown[]) => values.flat().filter((v): v is string => typeof v === "string" && !!v)
  if (method.startsWith("docs.")) {
    const docs = strings(p.path, r.path, p.files?.map((f) => f.path), p.folders)
    return docs.length ? { docs } : undefined
  }
  const papers = strings(p.id, p.ids, p.paperId, r.id, r.paper?.id)
  return papers.length ? { papers } : undefined
}

export interface CoreOptions {
  // This machine's data directory for owlit (Electron's userData): settings.json, workspaces/<hash>/
  userDataDir: string
  // Reported by core.version; the host knows it (Electron's app.getVersion())
  appVersion?: string
  // What the machine offers beyond Node (the system Trash, opening files in their apps)
  host?: Host
  // A development build: adds what only helps while working on owlit (tasks.debugEnqueue)
  debug?: boolean
  // Base of the wait between tries of a failed request (default 1s); tests shorten it
  retryBaseMs?: number
  // The PATH agents are looked up and started with (default: the login shell's); tests pass their own, so
  // the developer's ~/.zshrc doesn't run inside them
  searchPath?: () => Promise<string>
  // pdfium's wasm file, where the desktop app ships it beside main
  pdfiumWasm?: string
  // Serve the open workspace on a Unix socket for owlit-mcp and the CLI ($TMPDIR, or this folder)
  socket?: boolean | { dir: string }
  // Serve owlit's browser extension on 127.0.0.1 (EXTENSION_PORT; tests give port 0 for any free one)
  extension?: boolean | ExtensionServerOptions
  // How to start owlit-mcp, handed to every agent session; --workspace, --chat and its session secret
  // (OWLIT_SESSION) are added
  mcp?: { command: string; args: string[]; env?: Record<string, string> }
  // How to start the Owlit engine (packages/owlit-agent); without it the engine isn't offered
  engine?: { command: string; args: string[]; env?: Record<string, string> }
  // How to run a JavaScript file as plain Node, and npm's CLI script: with both, owlit sets up its own copy
  // of Claude Code's and Codex's adapters (agents/setup.ts)
  node?: { command: string; args: string[]; env?: Record<string, string> }
  npm?: string
  // The share server new links are made on (apps/share-server), e.g. https://share.example.org; without
  // one, docs can't be shared
  shareServer?: string
  // How long changes settle before a shared doc is pushed, and how often comments are fetched (tests)
  shareTimings?: { settleMs?: number; pollMs?: number }
  // The example workspace the app ships, which workspace.createExample copies
  exampleDir?: string
  // Where this build came from (the desktop app's build label); unset is a dev build
  build?: Omit<BuildInfo, "version">
  // The CHANGELOG.md the app ships, for what's new after an update
  changelog?: string
}

// The backend as one object. It speaks only JSON-RPC: handle() takes a request, onNotify() hears
// notifications. Constructing it touches nothing outside; start() is when it begins to talk.

type DigestAsked = ResultOf<"library.requestDigest">
export class Core {
  readonly settings: SettingsStore
  readonly activity = new ActivityBus()
  readonly agents: Agents
  private turns: Turns
  // What agents read of the library, by who asked, for what an answer was built from
  private readonly reads = new ReadLog()
  private ui: UiBridge
  readonly fs: AgentFs
  readonly undo: Undo
  private journal: Journal
  private router = new Router()
  private notifier = new Notifier()
  private options: CoreOptions
  private started = false
  private workspace: Workspace | null = null
  // Opens and closes run one at a time, in the order asked
  private switching: Promise<unknown> = Promise.resolve()
  // Opens under way; while any is, the window waits rather than showing the welcome page
  private opening = 0
  // Digests asked for whose chat hasn't started yet (the paper's text may be read first), by workspace and
  // paper: what asking answers meanwhile
  private digestAsks = new Map<string, Promise<DigestAsked>>()
  // Replies under Owlit's comments being answered, by workspace and comment: the last one's answer
  private replies = new Map<string, Promise<void>>()
  private taskChanges = new TaskThrottle(200, (task) => this.notifier.notify("tasks.changed", { task }))
  private debugTasks = debugTasks()
  // One way out to the network for every workspace, so each service's rate holds across them
  private readonly http: Http
  // Owlit updating itself
  readonly updates: Updates
  private socket: SocketServer | null = null
  // The browser extension's port, for as long as core runs, whichever workspace is open
  private readonly extension: ExtensionServer | null
  // The system's preferred languages (BCP 47, most preferred first), read once: the interface and digests
  // follow them until Settings says otherwise
  private readonly systemLanguages: readonly string[]

  constructor(options: CoreOptions) {
    this.options = options
    this.systemLanguages = options.host?.languages?.() ?? []
    this.settings = new SettingsStore(options.userDataDir, options.host?.secrets)
    this.http = new Http({ fetch: options.host?.fetch, userAgent: `owlit/${options.appVersion ?? CORE_VERSION}`, retryBaseMs: options.retryBaseMs })
    limitMetadataHosts(this.http)
    // activity.emit reads the settings before it publishes, so they are always loaded by then
    this.journal = new Journal(
      this.activity,
      () => this.workspace?.owlitPath("journal.jsonl") ?? null,
      async () => `p_${(await this.settings.get()).profile.id!}`,
      () => this.settings.peek()?.activity.enabled ?? true,
    )
    const resolveProxy = options.host?.resolveProxy
    this.agents = new Agents({
      settings: this.settings,
      searchPath: options.searchPath,
      proxyEnv: resolveProxy && !hasProxyEnv(process.env) ? () => systemProxyEnv(resolveProxy) : undefined,
      setup: options.node && options.npm ? { dir: path.join(options.userDataDir, "agents"), node: options.node, npm: options.npm, fetchJson: async (url) => JSON.parse(await this.http.text(url)) } : undefined,
      probeDir: path.join(options.userDataDir, "agents", "probe"),
      cwd: () => this.workspace?.root ?? null,
      notify: (connector) => this.notifier.notify("agents.changed", connector),
      idleMs: Number(process.env.OWLIT_AGENT_IDLE_MS) || undefined,
      engine: options.engine && {
        ...options.engine,
        env: {
          ...options.engine.env,
          // Its sign-ins, in owlit's own folder
          OWLIT_ENGINE_HOME: path.join(options.userDataDir, "agents", "owlit-engine"),
          // Model requests go through the proxy in HTTPS_PROXY, which Node's fetch otherwise ignores
          NODE_USE_ENV_PROXY: "1",
        },
      },
    })
    this.ui = new UiBridge((request) => this.notifier.notify("ui.request", request))
    this.extension = options.extension
      ? new ExtensionServer(
          {
            version: this.version().version,
            name: (options.extension === true ? undefined : options.extension.name) ?? "Owlit",
            settings: this.settings,
            workspace: () => {
              const ws = this.workspace
              if (!ws) return null
              return { name: ws.info.name, library: ws.library, added: (p: Paper) => ws.recorder.record(WINDOW, { action: "create", target: { kind: "paper", path: p.id } }, { label: p.title, quiet: true }) }
            },
            hasWindow: () => this.ui.hasWindow(),
            changed: (view) => this.notifier.notify("extension.changed", view),
            openInBrowser: options.host?.openInBrowser ?? (options.host?.openExternal && ((url) => options.host!.openExternal!(url))),
            showBrowser: options.host?.showBrowser,
            show: async (uri) => {
              await options.host?.showApp?.()
              if (!uri) return true
              // The window the user was in last shows it; one the host opened just now is given time to
              // load first. None there (or none answering) shows nothing.
              if (!(await this.ui.whenWindow(WINDOW_LOADS_WITHIN_MS))) return false
              return this.ui.act("open", { uri }).then(
                () => true,
                () => false,
              )
            },
            browserApp: options.host?.browserApp,
          },
          options.extension === true ? {} : options.extension,
        )
      : null
    this.fs = new AgentFs({
      workspace: () => this.workspace,
      ui: this.ui,
      claimOf: (rel) => this.turns.claimOf(rel),
      roleOf: (chatId) => this.turns.roleOf(chatId),
    })
    this.undo = new Undo({
      workspace: () => this.workspace,
      docs: { text: (rel) => this.fs.text(rel), write: (rel, content, changeId, base) => this.fs.place(rel, content, changeId, base) },
      commentsChanged: ({ path, changed, removed }) => {
        if (changed) this.notifier.notify("comments.changed", { path, comment: changed })
        if (removed) this.notifier.notify("comments.removed", { path, id: removed })
      },
    })
    this.turns = new Turns({
      agents: this.agents,
      fs: this.fs,
      workspace: () => this.workspace,
      notify: (chatId, update, messageId) => this.notifier.notify("chat.update", { chatId, messageId, update }),
      ended: (chatId, message, about) => {
        this.notifier.notify("chat.ended", { chatId, messageId: message.id, message })
        // A chat owlit started is followed where its work lands, by what it is about (chats.turn)
        const ws = this.workspace
        if (about && ws) void this.announceStarted(ws, chatId)
      },
      mcpServers: (root, chatId) => this.mcpServers(root, chatId),
      userName: async () => (await this.settings.get()).profile.name,
      memory: async () => (await this.workspace?.memory.list()) ?? [],
      readFrom: async (chatId, since, answer) => {
        const ws = this.workspace
        if (!ws) return []
        return readFromOf(this.reads.since(`chat:${chatId}`, since), answer, async (id) => (await ws.library.canonical(id)) ?? id, (id) => ws.hasText(id))
      },
    })
    this.updates = new Updates({
      build: { version: this.version().version, channel: options.build?.channel ?? "dev", commit: options.build?.commit },
      userDataDir: options.userDataDir,
      updater: options.host?.updater,
      changelog: options.changelog,
      onboarded: async () => (await this.settings.get()).onboardedAt !== undefined,
      answering: () => this.turns.answering(),
      latest: () => latestRelease((url) => this.http.json(url)),
      notify: (view) => this.notifier.notify("updates.changed", view),
    })
    // A visit to a paper ended: if it made the paper read in full, its status becomes Read (never down
    // from what the person set: Read is the top), once it is on disk
    this.activity.subscribe("paper.closed", (event) => {
      const ws = this.workspace
      if (!ws) return
      void this.journal
        .flush()
        .then(() => becameReadInFull(ws, event.paperId, event.at))
        .then(async (full) => {
          if (!full || this.workspace !== ws) return
          const paper = await ws.library.get(event.paperId)
          if (paper && paper.status !== "read") {
            // The person's reading turned it Read: theirs, on its own (via auto), as opening it turns it Reading
            const read = await this.updatePaper(paper.id, { status: "read" }, WINDOW, { via: "auto" })
            if (this.workspace !== ws) return
            this.notifier.notify("library.changed", { papers: [read], removed: [] })
            this.notifier.notify("library.readToEnd", { paperId: read.id, from: paper.status })
          }
        })
        .catch((error) => console.error("[core] couldn't tell whether a paper was read in full", error))
    })

    this.router.decide = (caller, _method, params, policy) => this.police(caller, params, policy)

    // Each area registers its own methods beside its code; core.ts only hands them what they need. The
    // Router refuses a method registered twice, so the order here carries no meaning.
    const requireWorkspace = () => this.requireWorkspace()
    const workspace = () => this.workspace
    const { router, notifier, settings, journal, turns } = this
    // core.* is about this object itself (diagnostics reads most of it), so it stays here
    router.register("core.ping", noParams, "read", () => ({ ok: true as const }))
    router.register("core.version", noParams, "read", () => this.version())
    router.register("core.diagnostics", noParams, "read", () => this.diagnostics())
    registerExtension({ router, extension: this.extension })
    registerUpdates({ router, updates: this.updates })
    registerWorkspace({ router, settings, workspace, requireWorkspace, open: (folder) => this.openWorkspace(folder), state: () => this.state(), exampleDir: options.exampleDir })
    registerActivity({ router, notifier, settings, activity: this.activity, workspace, requireWorkspace, systemLanguages: this.systemLanguages })
    registerSettings({
      router,
      settings,
      http: this.http,
      openExternal: options.host?.openExternal,
      systemLanguages: this.systemLanguages,
      changed: (view) => {
        this.notifier.notify("settings.changed", view)
        void this.workspace?.members.ensure(view.profile).catch((error) => console.error("[core] couldn't update the workspace's members", error))
      },
    })
    registerDocs({ router, notifier, requireWorkspace, answerReply: (ws, path, id) => this.answerReply(ws, path, id), pdfiumWasm: options.pdfiumWasm })
    registerChats({ router, turns, requireWorkspace, host: options.host, workAgent: () => this.workAgent(), announceStarted: (ws, chatId) => this.announceStarted(ws, chatId) })
    registerAgents({ router, agents: this.agents, turns, fs: this.fs, requireWorkspace })
    registerUi({ router, ui: this.ui })
    registerMemory({ router, requireWorkspace })
    registerChanges({ router, notifier, undo: this.undo, requireWorkspace, personAt: (caller) => this.personAt(caller) })
    registerLibrary({ router, turns, reads: this.reads, journal, requireWorkspace, updatePaper: (id, patch, caller, origin) => this.updatePaper(id, patch, caller, origin), requestDigest: (id, rewrite) => this.requestDigest(id, rewrite) })
    registerSearch({ router, requireWorkspace })
    registerTasks({ router, requireWorkspace, debug: options.debug ? this.debugTasks : undefined })
    registerThreads({ router, requireWorkspace })
    registerShare({ router, requireWorkspace })

  }

  // caller: who sent it; the in-process host (the window) by default
  async handle(request: RpcRequest, caller: Caller = WINDOW): Promise<RpcResponse> {
    // An engine that doesn't name the tool call an owlit-mcp request is for: the chat's call to owlit's
    // tools running now, when there is one
    if (caller.kind === "socket" && caller.chatId && !caller.toolCallId) {
      const toolCallId = this.turns.owlitCallOf(caller.chatId)
      if (toolCallId) caller = { ...caller, toolCallId }
    }
    const response = await this.router.handle(request, caller)
    // What a client changed is searched for soon after (the index waits for things to settle)
    if (this.workspace && "result" in response && CHANGES.test(request?.method ?? "")) this.workspace.search.touch()
    if (this.workspace && "result" in response && SHARED_CHANGES.test(request?.method ?? "")) {
      // A doc renamed or moved, or renamed after its first line, takes its link along
      const from = (request.params as { path?: string } | undefined)?.path
      const to = (response.result as { path?: string } | null)?.path
      if (from && to && from !== to) void this.workspace.shares.moved(from, to)
      this.workspace.shares.touched(sharedChange(request.method, request.params, response.result))
    }
    return response
  }

  // A file of the open workspace for the window (owlit-file://workspace/<path>), byte ranges included
  serveFile(request: Request): Promise<Response> {
    return serveWorkspaceFile(this.workspace?.root, request)
  }

  onNotify(listener: (notification: RpcNotification) => void) {
    return this.notifier.subscribe(listener)
  }

  start() {
    if (this.started) return
    this.started = true
    this.notifier.notify("core.hello", this.version())
    void this.updates.start()
    void this.extension?.start().catch((error) => console.error("[core] couldn't start serving the browser extension", error))
  }

  // The workspace to reopen at launch, if it is still there
  async lastWorkspace() {
    const { lastWorkspace } = await this.settings.get()
    return lastWorkspace && existsSync(lastWorkspace) ? lastWorkspace : undefined
  }

  private state(): WorkspaceState {
    return { current: this.workspace?.info ?? null, opening: this.opening > 0 }
  }

  openWorkspace(folder: string): Promise<WorkspaceInfo> {
    this.opening++
    this.notifier.notify("workspace.state", this.state())
    const run = this.switching.then(async () => {
      const root = await resolveFolder(folder).catch(async (error) => {
        // Forgotten only when it is really gone: a folder macOS keeps from owlit, or an unmounted drive, comes back
        if (isMissing(folder)) await this.settings.forgetWorkspace(folder)
        throw error
      })
      // The current workspace stays open until the next one has opened, so a failed switch loses nothing
      const next =
        this.workspace?.root === root
          ? this.workspace
          : await Workspace.open(root, this.options.userDataDir, {
              host: this.options.host,
              library: {
                http: this.http,
                extension: this.extension?.work,
                pdfiumWasm: this.options.pdfiumWasm,
                settings: async () => (await this.settings.get()).library,
                parsing: async () => (await this.settings.get()).parsing,
                noteLanguage: async () => {
                  const settings = await this.settings.get()
                  const chosen = settings.library.digestLanguage
                  return chosen ? normalizeNoteLanguage(chosen) : defaultNoteLanguage(settings, this.systemLanguages)
                },
              },
              threads: {
                changed: (id, thread) => {
                  if (this.workspace?.root === root) this.notifier.notify("threads.changed", { id, thread })
                },
              },
              profile: async () => (await this.settings.get()).profile,
              changeAdded: (notification) => {
                if (this.workspace?.root === root) this.notifier.notify("changes.added", notification)
              },
              replyOf: (chatId, toolCallId) => this.turns.replyOf(chatId, toolCallId),
              memoryChanged: (lines) => {
                if (this.workspace?.root === root) this.notifier.notify("memory.changed", { lines })
              },
              shares: {
                server: () => this.options.shareServer ?? null,
                author: async () => (await this.settings.get()).profile.name,
                // Only the open workspace's shares reach the windows
                changed: (path, share) => {
                  if (this.workspace?.root === root) this.notifier.notify("share.changed", { path, share })
                },
                commentsChanged: (path, comments) => {
                  if (this.workspace?.root === root) this.notifier.notify("share.comments", { path, comments })
                },
                ...this.options.shareTimings,
              },
              tasks: {
                definitions: (workspace) => this.taskDefinitions(workspace),
                onChange: (task) => this.taskChanges.push(task),
                limits: { parse: (await this.settings.get()).parsing.concurrency ?? 2 },
                // Started below, once the workspace's socket is up
                start: false,
              },
            })
      if (this.workspace !== next) {
        // Every change seen on disk is recorded, by whoever the evidence names
        next.docs.textChanged = (rel, before, after) =>
          next.recorder.doc(this.seenBy(rel), rel, before, after).catch((error) => console.error("[core] couldn't record a change made outside owlit", error))
        // Watching starts before the old workspace goes, so a folder that can't be watched leaves it open
        // (a failed switch loses nothing). Until the switch, clients still show the old one: they load
        // the new one's state when they hear it opened.
        const current = () => this.workspace === next
        try {
          await next.docs.watch((change) => {
            if (current()) this.notifier.notify("docs.changed", change)
            next.search.touch()
            // A doc renamed outside owlit keeps its id: its link goes with it
            for (const gone of change.deleted) {
              const now = gone.id && change.changed.find((f) => f.id === gone.id)
              if (now) void next.shares.moved(gone.path, now.path)
            }
            // Only the shares of these docs are built again, unless too much changed to say
            next.shares.touched(
              change.reload || change.folders.deleted.length ? undefined : { docs: [...change.changed.map((f) => f.path), ...change.deleted.map((f) => f.path)] },
            )
          })
          await next.library.watch(
            (change) => {
              if (current()) this.notifier.notify("library.changed", change)
              next.search.touch()
              next.shares.touched({ papers: [...change.papers.map((p) => p.id), ...change.removed, ...Object.entries(change.renamed ?? {}).flat()] })
            },
            (paperId, note, before, own) => {
              if (current()) this.notifier.notify("library.noteChanged", { paperId, note })
              next.search.touch()
              next.shares.touched({ papers: [paperId] })
              // A note written outside owlit (another program, an agent writing the disk itself), recorded as
              // a doc's change is; core's own writes are recorded by whoever asked for them
              const rel = noteRelPath(paperId)
              if (!own) void next.recorder.doc(this.seenBy(rel), rel, before || null, note?.content ?? null).catch((error) => console.error("[core] couldn't record a change made outside owlit", error))
            },
          )
        } catch (error) {
          await next.dispose().catch(() => undefined)
          throw error
        }
      }
      if (this.workspace && this.workspace !== next) await this.stopWorkspace(this.workspace, "switched")
      if (this.workspace !== next) await this.serveSocket(next.root)
      const opened = this.workspace !== next
      this.workspace = next
      // The opener's seen marks begin as it opens, when they have none yet: what it held before isn't news
      // to them
      if (opened) {
        const me = await this.personAt(WINDOW).catch(() => undefined)
        if (me) await next.seen.get(me, [])
      }
      // Its tasks start once it is the open workspace
      if (opened) await next.tasks.start()
      if (opened) void next.shares.start().catch((error) => console.error("[core] couldn't start following shared docs", error))
      this.notifier.notify("workspace.opened", next.info)
      // Only the recent list: the switch has happened either way
      await this.settings.rememberWorkspace(next.root).catch((error) => console.error("[core] couldn't remember the workspace", error))
      return next.info
    })
    this.switching = run.catch(() => undefined)
    void this.switching.then(() => {
      this.opening--
      this.notifier.notify("workspace.state", this.state())
    })
    return run
  }

  // The window's change to a paper: one entry per field it changed (starred, status, tags, each
  // correction as overrides.<field>), sharing one writeId; where it was left (the reader's position, the
  // side last read, the digest's scroll) and when it was opened aren't changes worth keeping
  private async updatePaper(id: string, patch: PaperPatch, caller: Caller, origin: Partial<ChangeOrigin> = {}) {
    const ws = this.requireWorkspace()
    const before = await ws.library.get(id)
    const after = await ws.library.update(id, patch)
    if (!before) return after
    const writeId = newWriteId()
    for (const field of Object.keys(patch) as (keyof PaperPatch)[]) {
      if (field === "position" || field === "view" || field === "digestPosition" || field === "lastOpenedAt") continue
      const was = before[field as keyof Paper]
      const now = after[field as keyof Paper]
      if (JSON.stringify(was) === JSON.stringify(now)) continue
      const part = field === "starred" || field === "status" || field === "tags" ? field : `overrides.${field}`
      await ws.recorder.record(caller, { action: "update", target: { kind: "paper", path: after.id, part }, origin: { ...origin, writeId }, ...(was !== undefined ? { before: was } : {}), ...(now !== undefined ? { after: now } : {}) }, { quiet: true })
    }
    return after
  }

  // Who changed a file the watcher saw change: the tool call claiming it (Owlit, and the user's when they
  // allowed its edit), else other, with the Co-author turn at work then as the only hint
  private seenBy(rel: string): Caller {
    const claim = this.turns.claimOf(rel)
    if (claim) return { kind: "watcher", chatId: claim.chatId, toolCallId: claim.toolCallId, ...(claim.accepted ? { accepted: true } : {}) }
    const chatId = this.turns.coauthorAtWork()
    return { kind: "watcher", ...(chatId ? { chatId } : {}) }
  }

  // The router's policy (agents/policy.ts) for one call: who asks, by the change log's name for them and
  // the chat's role; whose thing the target is; then allow, or refuse with what to tell the agent. The
  // window is never refused.
  private async police(caller: Caller, params: unknown, policy: Policy) {
    if (caller.kind === "window") return
    const ws = this.requireWorkspace()
    const target = policy.target ? await policy.target(params as never) : {}
    const chatId = caller.kind === "watcher" ? undefined : caller.chatId
    const role = chatId ? await this.turns.roleOf(chatId) : undefined
    const who: Who = { caller, actor: await ws.recorder.actorOf(caller), ...(role ? { role } : {}) }
    const touches = typeof policy.touches === "function" ? policy.touches(params as never, target, who) : policy.touches
    const decision = decide(who, touches, target)
    if (decision !== "allow") throw new RpcFailure(RpcErrorCode.Forbidden, `Not done: ${decision.refuse}`)
  }

  // Owlit writing a paper's digest: a chat about the paper, whose agent writes it with
  // library_write_digest. A digest already being written is that one. When the paper's text or figures
  // have to be read first, this answers at once (gettingText) and the chat starts once they are; one
  // that can't start then is told to every window (chats.notStarted). After one that broke or was
  // stopped, Retry is a new turn in its chat, on the agent Settings picks now, when its recipe is the
  // same; a recipe that changed since (another language, a newer way of writing) is a new chat.
  private async requestDigest(name: string, rewrite = false): Promise<DigestAsked> {
    const ws = this.requireWorkspace()
    const id = (await ws.library.canonical(name)) ?? name
    const about = { kind: "paper", id } as const
    const running = this.turns.inFlight().find((turn) => sameAbout(turn.about, about))
    if (running) return { chatId: running.chatId }
    const key = `${ws.root}\0${id}`
    const asking = this.digestAsks.get(key)
    if (asking) return asking
    // Kept until the chat started or couldn't, so asking again meanwhile has the same answer
    const answer = (async (): Promise<DigestAsked> => {
      const ready = await ws.library.digestReady(id, rewrite)
      if ("heldBack" in ready) return ready
      const started = this.startDigest(ws, id, rewrite, ready.waits).finally(() => this.digestAsks.delete(key))
      if (!ready.waits) return started
      void started.catch((error: unknown) => {
        if (this.workspace === ws) this.notifier.notify("chats.notStarted", { about, error: messageOf(error) })
      })
      return { gettingText: true }
    })()
    this.digestAsks.set(key, answer)
    void answer.then(
      (answered) => "heldBack" in answered && this.digestAsks.delete(key),
      () => this.digestAsks.delete(key),
    )
    return answer
  }

  // The digest's chat, once the paper's text and figures are read. waits: they weren't yet; if reading
  // them left nothing to read, that is a failure, since the asker was told the chat would start.
  private async startDigest(ws: Workspace, id: string, rewrite: boolean, waits: boolean): Promise<DigestAsked> {
    const about = { kind: "paper", id } as const
    const work = await ws.library.digestWork(id, rewrite)
    if ("heldBack" in work) {
      if (waits && work.heldBack === "nothing-to-read") throw new RpcFailure(RpcErrorCode.InvalidParams, t`Owlit couldn't get this paper's text to read.`, { id })
      return work
    }
    const { title } = work
    const texts = [{ text: work.text, from: `The paper's full text, from library/papers/${id}/text.md,` }]
    const last = await ws.chats.latestAbout(about)
    const chat = last && (await ws.chats.get(last.id))
    const reply = chat?.messages.at(-1)
    const broke = reply?.role === "assistant" && reply.status !== "done" && reply.status !== "streaming"
    const first = chat?.messages[0]?.parts[0]
    const sameRecipe = first?.type === "text" && first.text === startedWith({ recipe: work.recipe, texts })
    const started =
      chat && broke && sameRecipe
        ? await tryAgain(this.turns, ws.chats, chat.id, await this.workAgent()).then(async (s) => (await this.announceStarted(ws, s.chatId), s))
        : await this.startFor({ about, title: t`Digest of “${title}”`, recipe: work.recipe, texts, pictures: work.pictures })
    void started.done.then((stop) => this.digestEnded(ws, id, started, stop))
    return { chatId: started.chatId }
  }

  // A digest's turn that finished without writing it says so on its reply, as a failure, with Retry
  private async digestEnded(ws: Workspace, id: string, started: Started, stop: StopReason | "error") {
    if (stop !== "end_turn" || this.workspace !== ws) return
    const chat = await ws.chats.get(started.chatId).catch(() => null)
    const reply = chat?.messages.find((m) => m.id === started.messageId)
    if (!reply) return
    const written = (await ws.library.get(id).catch(() => undefined))?.digestAt
    if (written && written >= reply.createdAt) return
    await ws.chats.patchMessage(started.chatId, { ...reply, status: "error", error: t`Owlit finished without writing the digest.` }, true)
    await this.announceStarted(ws, started.chatId)
  }

  // The person replied under one of Owlit's comments: Owlit answers there (recipes/reply.ts), in a turn of
  // the chat about that comment, so a later answer remembers the earlier ones. Replies under one comment
  // are answered in order, each once the turn before has ended; nothing else waits on them.
  private answerReply(ws: Workspace, path: string, id: string) {
    const key = `${ws.root}\0${path}#${id}`
    const next = (this.replies.get(key) ?? Promise.resolve())
      .then(() => this.replyTurn(ws, path, id))
      .catch((error) => console.error("[core] couldn't answer a reply under Owlit's comment", error))
    this.replies.set(key, next)
    void next.finally(() => {
      if (this.replies.get(key) === next) this.replies.delete(key)
    })
  }

  private async replyTurn(ws: Workspace, path: string, id: string) {
    if (this.workspace !== ws) return
    const comment = (await ws.docs.listComments(path)).find((c) => c.id === id)
    // Gone, put away, or already answered (a turn before this one took in the later reply too)
    const last = comment?.entries.at(-1)
    if (!comment || !isOpenComment(comment) || !last || !isPerson(last.by)) return
    const { content } = await ws.docs.read(path)
    const recipe = replyRecipe({ path, content, comment })
    const about = { kind: "comment", id: `${path}#${id}` } as const
    const chat = await ws.chats.latestAbout(about)
    let started: Started
    if (chat) {
      started = await askAgain(this.turns, ws.chats, chat.id, recipe, await this.workAgent())
      await this.announceStarted(ws, started.chatId)
    } else {
      const name = path.split("/").pop()!.replace(/\.md$/i, "")
      started = await this.startFor({ about, title: t`Answering your reply in “${name}”`, recipe })
    }
    const stop = await started.done
    // A turn that ended without a word in the comment says so on its reply, as a failure, with Retry
    if (stop !== "end_turn" || this.workspace !== ws) return
    const reply = (await ws.chats.get(started.chatId).catch(() => null))?.messages.find((m) => m.id === started.messageId)
    if (!reply) return
    const now = (await ws.docs.listComments(path)).find((c) => c.id === id)
    const answered = !now || now.entries.some((e) => isOwlit(e.by) && Math.max(e.at, e.editedAt ?? 0) >= reply.createdAt)
    if (answered) return
    await ws.chats.patchMessage(started.chatId, { ...reply, status: "error", error: t`Owlit finished without answering in the comment.` }, true)
    await this.announceStarted(ws, started.chatId)
  }

  // A chat owlit starts for the person, on the agent and model Settings chooses for its work. Every window
  // hears it begin (chats.turn) and end (chats.turn again, after chat.ended).
  async startFor(start: Omit<StartFor, "connectorId" | "modelId">): Promise<Started> {
    const ws = this.requireWorkspace()
    const started = await startFor(this.turns, ws.chats, { ...start, ...(await this.workAgent()) })
    await this.announceStarted(ws, started.chatId)
    return started
  }

  private async announceStarted(ws: Workspace, chatId: string) {
    const chat = await ws.chats.get(chatId).catch(() => null)
    if (chat && this.workspace === ws) this.notifier.notify("chats.turn", { chat })
  }

  async dispose() {
    this.started = false
    await this.updates.dispose()
    await this.switching
    if (this.workspace) await this.stopWorkspace(this.workspace, "closed")
    this.workspace = null
    // After the workspace's turns and tasks: a turn cut off by its agent closing would end as the agent's
    // failure, where one stopped by closing says owlit was closed
    this.agents.dispose()
    await this.extension?.close().catch(() => undefined)
    await this.journal.dispose()
  }

  // Everything that belongs to the open workspace stops here, in this order, whether owlit switches to
  // another one or closes. Each step runs even if one before it failed: a switch still goes ahead, and
  // the workspace's lock is still released. ws is still this.workspace throughout, so nothing that stops
  // late can reach the next one.
  private async stopWorkspace(ws: Workspace, why: CutOff) {
    const steps: [string, () => unknown][] = [
      ["chat turns", () => this.turns.reset(why)],
      ["the window's requests", () => this.ui.reset()],
      // Before the agents they run on close (dispose closes them after this)
      ["tasks", () => ws.tasks.dispose()],
      // owlit-mcp and the CLI can't write into the workspace once it has let go of its lock
      ["the socket", () => this.closeSocket()],
      ["the journal", () => this.journal.flush()],
      ["the workspace", () => ws.dispose()],
    ]
    for (const [what, step] of steps) {
      try {
        await step()
      } catch (error) {
        console.error(`[core] couldn't stop ${what} of ${ws.root}`, error)
      }
    }
    // The old workspace's last task changes go out before clients hear of the switch
    this.taskChanges.flush()
  }

  // The agent (and its model) Settings chooses for the tasks the person hands Owlit, as it is now: the
  // first that is set up when none is chosen
  private async workAgent(): Promise<TurnAgent> {
    const { connectors } = await this.settings.get()
    const connectorId = await this.agents.forWork(connectors.background)
    const modelId = connectors.backgroundModels?.[connectorId]
    return { connectorId, ...(modelId ? { modelId } : {}) }
  }

  // owlit-mcp for an agent session in this workspace, for one chat. The secret in OWLIT_SESSION is what
  // names the chat to core at auth (rpc/socket.ts); --chat only tells owlit-mcp what to sign its searches
  // and comments with.
  mcpServers(root: string, chatId?: string) {
    const mcp = this.options.mcp
    if (!mcp || this.socket?.root !== root) return []
    const session = this.socket.grant(chatId ? { chatId } : {})
    return [
      {
        name: "owlit",
        command: mcp.command,
        args: [...mcp.args, "--workspace", root, ...(chatId ? ["--chat", chatId] : [])],
        env: [...Object.entries(mcp.env ?? {}).map(([name, value]) => ({ name, value })), { name: "OWLIT_SESSION", value: session }],
      },
    ]
  }

  private async closeSocket() {
    const socket = this.socket
    this.socket = null
    await socket?.close()
  }

  // The socket of the workspace now open
  private async serveSocket(root: string) {
    if (!this.options.socket) return
    await this.closeSocket().catch(() => undefined)
    try {
      this.socket = await SocketServer.start(root, this, this.options.socket === true ? undefined : this.options.socket.dir)
    } catch (error) {
      // owlit works without it; only owlit-mcp and the CLI can't reach the workspace
      console.error("[core] couldn't open the workspace's socket", error)
    }
  }

  // Every kind of task core knows, made for one workspace
  private taskDefinitions(workspace: Workspace): TaskDefinition[] {
    return [...workspace.library.tasks(), ...workspace.search.tasks(), ...(this.options.debug ? this.debugTasks.definitions : [])]
  }

  // The person at the window, whose seen marks these are: an agent or a program on the socket has none
  private async personAt(caller: Caller): Promise<PersonId> {
    const actor = caller.kind === "window" ? await this.requireWorkspace().recorder.actorOf(caller) : "other"
    if (!isPerson(actor)) throw new RpcFailure(RpcErrorCode.Forbidden, "Only the person at owlit's window has things they have seen.")
    return actor
  }

  private requireWorkspace() {
    if (!this.workspace) throw new RpcFailure(RpcErrorCode.NoWorkspace, t`Open a folder as the workspace first.`)
    return this.workspace
  }

  private async diagnostics(): Promise<string> {
    const macos = await new Promise<string>((resolve) => execFile("sw_vers", ["-productVersion"], (error, out) => resolve(error ? process.platform : `macOS ${out.trim()}`)))
    const home = (p: string) => p.replace(homedir(), "~")
    const lines = [`Owlit ${this.version().version} (${process.arch}) · ${macos} · Node ${process.versions.node}`, this.updates.describe()]
    for (const c of await this.agents.list()) {
      const state = c.setup?.progress !== undefined ? "setting up" : c.status === "not_installed" ? (c.setup?.cliFound ? "on this Mac, not set up" : "not found") : c.authenticated === false ? "signed out" : c.status
      const copy = c.setup?.installed ? `, owlit's copy ${c.setup.installed}` : ""
      lines.push(`${c.name}: ${state}${c.version ? `, ${c.version}` : ""}${copy}${c.error ? ` · ${c.error}` : ""}${c.setup?.error ? ` · setup: ${c.setup.error}` : ""}`)
    }
    const ws = this.workspace
    lines.push(ws ? `Workspace: ${home(ws.root)}` : "Workspace: none open")
    lines.push(`Data: ${home(this.options.userDataDir)}${ws ? ` · ${home(ws.dataDir)}` : ""}`)
    return lines.join("\n")
  }

  private version(): CoreVersion {
    return { version: this.options.appVersion ?? CORE_VERSION, node: process.versions.node }
  }
}
