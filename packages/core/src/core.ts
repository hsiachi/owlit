import { RpcErrorCode, type ChatMessage, type CoreVersion, type PaperKnowledge, type PromptInput, type RpcNotification, type RpcRequest, type RpcResponse, type TopicSidecar, type WorkspaceInfo } from "@owlit/protocol"
import { existsSync } from "node:fs"
import path from "node:path"
import { z } from "zod"
import { ActivityBus, activityEvent, Journal } from "./activity/index.ts"
import { Agents } from "./agents/agents.ts"
import { AgentFs } from "./agents/fs.ts"
import { Turns } from "./agents/turns.ts"
import { UiBridge } from "./ui/bridge.ts"
import type { Host } from "./host.ts"
import { noParams, Notifier, Router, RpcFailure } from "./rpc/index.ts"
import { SocketServer } from "./rpc/socket.ts"
import { AGENT_RULES } from "./agents/rules.ts"
import { Background, KNOWLEDGE_TOOLS } from "./agents/background.ts"
import type { KnowledgeTimings } from "./knowledge/knowledge.ts"
import { limitMetadataHosts } from "./library/resolve.ts"
import { serveWorkspaceFile } from "./files/serve.ts"
import { Http } from "./net/http.ts"
import { SettingsStore } from "./settings.ts"
import { registerSettings, settingsView } from "./settings-rpc.ts"
import { debugTasks, LANE_LIMITS, TaskThrottle, type TaskDefinition } from "./tasks/index.ts"
import { resolveFolder, Workspace } from "./workspace/workspace.ts"
import { OWLIT_DIR } from "./workspace/paths.ts"

export const CORE_VERSION = "0.0.0"

// Methods that change what the search index covers
const CHANGES = /^(docs\.(create|write|rename|move|delete|restore)|chats\.(create|update|delete|appendMessage|patchMessage)|notes\.|library\.(add|update|remove|restore|setNote|importPdf|attachPdf|importPitta))$/

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
  // pdfium's wasm file, where the desktop app ships it beside main
  pdfiumWasm?: string
  // Serve the open workspace on a Unix socket for owlit-mcp and the CLI ($TMPDIR, or this folder)
  socket?: boolean | { dir: string }
  // How to start owlit-mcp, handed to every agent session; --workspace and --chat are added
  mcp?: { command: string; args: string[]; env?: Record<string, string> }
  // How long Knowledge waits after the user's activity before a run (tests shorten it)
  knowledgeTimings?: KnowledgeTimings
}

// The backend as one object. It speaks only JSON-RPC: handle() takes a request, onNotify() hears
// notifications. Constructing it touches nothing outside; start() is when it begins to talk.
export class Core {
  readonly settings: SettingsStore
  readonly activity = new ActivityBus()
  readonly agents: Agents
  private turns: Turns
  private ui: UiBridge
  readonly fs: AgentFs
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
  // One way out to the network for every workspace, so each service's rate holds across them
  private readonly http: Http
  private readonly background: Background
  private socket: SocketServer | null = null

  constructor(options: CoreOptions) {
    this.options = options
    this.settings = new SettingsStore(options.userDataDir, options.host?.secrets)
    this.http = new Http({ fetch: options.host?.fetch, userAgent: `owlit/${options.appVersion ?? CORE_VERSION}`, retryBaseMs: options.retryBaseMs })
    limitMetadataHosts(this.http)
    this.journal = new Journal(this.activity, () => this.workspace?.owlitPath("journal.jsonl") ?? null)
    this.agents = new Agents({
      settings: this.settings,
      probeDir: path.join(options.userDataDir, "agents", "probe"),
      cwd: () => this.workspace?.root ?? null,
      notify: (connector) => this.notifier.notify("agents.changed", connector),
      idleMs: Number(process.env.OWLIT_AGENT_IDLE_MS) || undefined,
    })
    this.ui = new UiBridge((request) => this.notifier.notify("ui.request", request))
    this.fs = new AgentFs({
      workspace: () => this.workspace,
      ui: this.ui,
      journal: this.journal,
      wrote: (record) => this.notifier.notify("agent.wrote", record),
      notesChanged: ({ path, added, removed }) => {
        if (added) this.notifier.notify("notes.added", { path, note: added })
        if (removed) this.notifier.notify("notes.removed", { path, id: removed })
      },
    })
    this.turns = new Turns({
      agents: this.agents,
      fs: this.fs,
      workspace: () => this.workspace,
      notify: (chatId, update) => this.notifier.notify("chat.update", { chatId, update }),
      mcpServers: (root, chatId) => this.mcpServers(root, chatId),
    })
    this.background = new Background(this.agents)
    // Opening a paper's page says the user is about to read it: its reading note comes first
    this.activity.subscribe(["paper.opened"], (event) => void this.workspace?.library.wantDigest(event.paperId, "waiting"))
    // What the user does feeds Knowledge: a run once things have been quiet for a while
    this.activity.subscribe(["doc.edited", "chat.sent", "chat.ended", "highlight.added", "note.edited", "paper.closed", "knowledge.edited"], (event) =>
      this.workspace?.knowledge.heard(event),
    )

    this.router.register("core.ping", noParams, () => ({ ok: true as const }))
    // What agents are told about owlit (owlit-mcp's instructions)
    this.router.register("agents.rules", noParams, () => AGENT_RULES)
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
      const next = await this.settings.update((s) => ({ ...s, activity: { ...s.activity, enabled } }))
      this.notifier.notify("activity.status", next.activity)
      this.notifier.notify("settings.changed", settingsView(next))
      return next.activity
    })

    registerSettings({
      router: this.router,
      settings: this.settings,
      http: this.http,
      browser: options.host?.browser,
      changed: (view) => this.notifier.notify("settings.changed", view),
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
    this.router.register(
      "agents.prompt",
      z.object({
        chatId,
        connectorId: z.string(),
        modelId: z.string().optional(),
        modeId: z.string().optional(),
        effortId: z.string().optional(),
        input: z.looseObject({ text: z.string(), mentions: z.array(z.looseObject({ uri: z.string(), title: z.string() })), attachments: z.array(z.looseObject({ name: z.string() })) }) as unknown as z.ZodType<PromptInput>,
        userMessage: message,
        assistantMessageId: z.string().min(1),
      }),
      async (req) => ({ stopReason: await this.turns.prompt(req) }),
    )
    this.router.register("ui.setOpenDocs", z.object({ clientId: z.string().min(1), paths: z.array(z.string()) }), ({ clientId, paths }) =>
      this.ui.setOpenDocs(clientId, paths),
    )
    this.router.register("ui.respond", z.object({ requestId: z.string(), result: z.unknown().optional(), error: z.string().optional() }), ({ requestId, result, error }) =>
      this.ui.respond(requestId, result, error),
    )
    this.router.register("ui.focus", z.object({ clientId: z.string().min(1) }), ({ clientId }) => this.ui.focus(clientId))
    this.router.register("ui.leave", z.object({ clientId: z.string().min(1) }), ({ clientId }) => this.ui.leave(clientId))
    const owlitUri = z.string().regex(/^owlit:\/\/[a-z]+\/.+/, "an owlit:// link")
    const asker = z.string().min(1).optional()
    this.router.register("ui.open", z.object({ uri: owlitUri, chatId: asker }), (params) => this.ui.act("open", params))
    this.router.register("ui.jump", z.object({ uri: owlitUri, page: z.number().int().positive().optional(), quote: z.string().min(1).optional(), chatId: asker }), (params) =>
      this.ui.act("jump", params),
    )
    this.router.register(
      "ui.mark",
      z.object({ uri: owlitUri, quote: z.string().min(1), color: z.enum(["yellow", "green", "blue", "pink"]).optional(), chatId: asker }),
      (params) => this.ui.act("mark", params),
    )
    this.router.register("ui.say", z.object({ text: z.string().min(1) }), (params) => this.ui.act("say", params))
    this.router.register("versions.restore", z.object({ id: z.string().min(1), force: z.boolean().optional() }), ({ id, force }) => this.fs.restore(id, force))
    this.router.register("versions.list", z.object({ path: z.string().optional(), since: z.number().optional() }), (filter) => this.requireWorkspace().versions.list(filter))
    this.router.register("agents.cancel", z.object({ chatId }), ({ chatId }) => this.turns.cancel(chatId))
    this.router.register("agents.respondPermission", z.object({ chatId, requestId: z.string(), optionId: z.string() }), ({ chatId, requestId, optionId }) =>
      this.turns.respondPermission(chatId, requestId, optionId),
    )

    const library = () => this.requireWorkspace().library
    this.router.register("library.resolve", z.object({ input: z.string().min(1) }), ({ input }) => library().resolve(input))
    this.router.register("library.known", z.object({ inputs: z.array(z.string()) }), ({ inputs }) => library().known(inputs))
    this.router.register("library.list", noParams, () => library().list())
    const paperId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
    const ids = z.object({ doi: z.string(), arxiv: z.string(), s2: z.string(), openalex: z.string(), url: z.string() }).partial()
    const kind = z.enum(["article", "conference", "preprint", "book", "thesis", "other"])
    const resolved = z.object({
      id: paperId.optional(),
      title: z.string(),
      authors: z.array(z.string()),
      ids,
      year: z.number().optional(),
      venue: z.string().optional(),
      abstract: z.string().optional(),
      kind: kind.optional(),
    })
    this.router.register(
      "library.add",
      z.object({ paper: resolved, addedBy: z.enum(["user", "agent"]).optional(), chatId: z.string().optional() }),
      async ({ paper, addedBy, chatId }) => {
        const added = await library().add(paper, addedBy)
        if (addedBy === "agent") {
          const version = await this.requireWorkspace().versions.savePaper(added.id, "added", { chatId })
          this.notifier.notify("agent.changed", { kind: "paper", versionId: version.id, path: added.id, label: added.title, ...(chatId ? { chatId } : {}) })
        }
        return added
      },
    )
    const position = z.object({ page: z.number(), y: z.number() })
    const patch = z
      .object({
        title: z.string(),
        authors: z.array(z.string()),
        year: z.number().optional(),
        venue: z.string().optional(),
        abstract: z.string().optional(),
        kind: kind.optional(),
        ids,
        starred: z.boolean(),
        status: z.enum(["unread", "reading", "read"]),
        tags: z.array(z.string()),
        position,
        lastOpenedAt: z.number(),
      })
      .partial()
    this.router.register("library.update", z.object({ id: paperId, patch }), ({ id, patch }) => library().update(id, patch))
    this.router.register("library.remove", z.object({ ids: z.array(paperId) }), ({ ids }) => library().remove(ids))
    this.router.register("library.restore", z.object({ ids: z.array(paperId) }), ({ ids }) => library().restore(ids))
    const rect = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
    const highlight = z.object({
      id: z.string().min(1),
      paperId,
      page: z.number().int().nonnegative(),
      rects: z.array(rect.extend({ page: z.number().int().nonnegative() })),
      text: z.string(),
      color: z.enum(["yellow", "green", "blue", "pink"]),
      comment: z.string().optional(),
      addedBy: z.literal("agent").optional(),
      createdAt: z.number(),
    })
    this.router.register("library.putHighlight", z.object({ highlight }), ({ highlight }) => library().putHighlight(highlight))
    this.router.register("library.removeHighlight", z.object({ paperId, id: z.string() }), ({ paperId, id }) =>
      library().removeHighlight(paperId, id),
    )
    const search = () => this.requireWorkspace().search
    const query = z.object({ q: z.string() })
    this.router.register("search.palette", query, ({ q }) => search().palette(q))
    this.router.register("search.papers", query.extend({ marked: z.boolean().optional() }), ({ q, marked }) => search().papers(q, marked))
    this.router.register("search.status", noParams, () => search().status())
    this.router.register("search.rebuild", noParams, () => {
      search().rebuild()
      return null
    })
    this.router.register("links.to", z.object({ uri: z.string().min(1) }), ({ uri }) => search().linksTo(uri))
    this.router.register("library.importPdf", z.object({ path: z.string().min(1) }), ({ path }) => library().importPdf(path))
    this.router.register("library.digest", z.object({ id: paperId }), ({ id }) => library().digest(id))
    this.router.register("library.requestDigest", z.object({ id: paperId }), async ({ id }) => {
      await library().wantDigest(id, "asked")
      return null
    })
    this.router.register("library.writeDigest", z.object({ id: paperId, text: z.string().min(1), by: z.string().optional() }), ({ id, text, by }) =>
      library().writeDigest(id, text, by ?? "agent"),
    )
    this.router.register(
      "library.read",
      z.object({ id: paperId, part: z.enum(["text", "digest", "note"]), pages: z.string().optional(), section: z.string().optional() }),
      ({ id, part, pages, section }) => library().read(id, part, { pages, section }),
    )
    this.router.register(
      "library.searchOnline",
      z.object({ q: z.string().min(1), limit: z.number().int().positive().max(25).optional(), by: z.string().optional() }),
      ({ q, limit, by }) => library().searchOnline(q, limit, by),
    )
    this.router.register("library.highlights", z.object({ id: paperId }), ({ id }) => library().highlights(id))
    this.router.register("library.importPitta", z.object({ root: z.string().min(1) }), ({ root }) => library().importPitta(root))
    this.router.register("library.text", z.object({ id: paperId }), ({ id }) => library().text(id))
    this.router.register("library.fetchPdf", z.object({ id: paperId }), ({ id }) => library().fetchPdf(id))
    this.router.register("library.checkPublisher", z.object({ id: paperId }), ({ id }) => library().checkPublisher(id))
    this.router.register("library.attachPdf", z.object({ id: paperId, path: z.string().min(1) }), ({ id, path }) =>
      library().attachPdf(id, path),
    )
    this.router.register("library.setNote", z.object({ paperId, content: z.string() }), ({ paperId, content }) =>
      library().setNote(paperId, content),
    )

    const tasks = () => this.requireWorkspace().tasks
    const taskId = z.string().min(1)
    this.router.register("tasks.list", noParams, () => tasks().list())
    this.router.register("tasks.cancel", z.object({ id: taskId }), ({ id }) => tasks().cancel(id))
    this.router.register("tasks.resume", z.object({ id: taskId }), ({ id }) => tasks().resume(id))
    if (options.debug && options.host?.browser) {
      const browser = options.host.browser
      // Development only: the hidden browser on any page, for trying it against a local server
      this.router.register("library.debugBrowserFetch", z.object({ landing: z.string(), pdf: z.string().optional(), allowHosts: z.array(z.string()), withUser: z.boolean().optional() }), async (params) => {
        const bytes = await browser.fetchPdf({ ...params, signal: new AbortController().signal, needUser: async (_reason, _detail, settled) => settled })
        return { bytes: bytes.length, head: Buffer.from(bytes.subarray(0, 8)).toString("latin1") }
      })
    }
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

    const knowledge = () => this.requireWorkspace().knowledge
    const sidecar = z.looseObject({ seenAt: z.number(), history: z.array(z.looseObject({})), edits: z.record(z.string(), z.looseObject({ text: z.string() })), removed: z.record(z.string(), z.looseObject({ text: z.string() })) }) as unknown as z.ZodType<TopicSidecar>
    const paperKnowledge = z.looseObject({ passages: z.record(z.string(), z.looseObject({})), connections: z.array(z.looseObject({})) }) as unknown as z.ZodType<PaperKnowledge>
    this.router.register("knowledge.state", noParams, () => knowledge().state())
    this.router.register("knowledge.putTopic", z.object({ id: z.string().min(1), sidecar }), ({ id, sidecar }) => knowledge().putTopic(id, sidecar))
    this.router.register("knowledge.putPaper", z.object({ id: z.string().min(1), paper: paperKnowledge }), ({ id, paper }) => knowledge().putPaper(id, paper))
    this.router.register("knowledge.topics", noParams, () => knowledge().summaries())
    this.router.register("knowledge.read", z.object({ topic: z.string().min(1) }), ({ topic }) => knowledge().read(topic))
    this.router.register(
      "knowledge.write",
      z.object({
        topic: z.string().min(1),
        content: z.string().min(1),
        why: z.string().min(1),
        remove: z.array(z.string()).optional(),
        passages: z.array(z.object({ id: z.string().regex(/^[\w.-]+$/, "letters, digits, - and _"), paper: z.string(), quote: z.string().min(1), section: z.string().optional() })).optional(),
        chatId: z.string().optional(),
      }),
      (params) => knowledge().write(params),
    )
    this.router.register("knowledge.update", noParams, () => knowledge().update())
    this.router.register("knowledge.versions", noParams, () => knowledge().versions())
    this.router.register("knowledge.revert", z.object({ id: z.string().min(1) }), ({ id }) => knowledge().revert(id))
    this.router.register("notes.all", noParams, () => docs().notesAll())
    this.router.register("notes.add", z.object({ path: rel, note, agent: z.object({ chatId: z.string().optional() }).optional() }), async ({ path, note, agent }) => {
      await docs().addNote(path, note)
      this.notifier.notify("notes.added", { path, note })
      if (agent) {
        const version = await this.requireWorkspace().versions.saveNote(path, note, "added", agent)
        this.notifier.notify("agent.changed", { kind: "note", versionId: version.id, path, label: path.split("/").pop()!.replace(/\.md$/i, ""), ...agent })
      }
      return null
    })
    this.router.register("notes.remove", z.object({ path: rel, id: z.string() }), ({ path, id }) => docs().removeNote(path, id))
    this.router.register("notes.reanchor", z.object({ path: rel, moved: z.record(z.string(), anchor) }), ({ path, moved }) =>
      docs().reanchorNotes(path, moved),
    )
  }

  async handle(request: RpcRequest): Promise<RpcResponse> {
    const response = await this.router.handle(request)
    // What a client changed is searched for soon after (the index waits for things to settle)
    if (this.workspace && "result" in response && CHANGES.test(request?.method ?? "")) this.workspace.search.touch()
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
          : await Workspace.open(root, this.options.userDataDir, {
              host: this.options.host,
              library: {
                http: this.http,
                browser: this.options.host?.browser,
                pdfiumWasm: this.options.pdfiumWasm,
                settings: async () => (await this.settings.get()).library,
                parsing: async () => (await this.settings.get()).parsing,
                agent: async (prompt, signal) =>
                  this.background.run({ prompt, root, mcpServers: this.mcpServers(root), signal, connectorId: (await this.settings.get()).connectors.background }),
              },
              knowledge: {
                agent: async (prompt, signal) =>
                  this.background.run({ prompt, root, mcpServers: this.mcpServers(root), signal, connectorId: (await this.settings.get()).connectors.background, allow: KNOWLEDGE_TOOLS }),
                changed: (change) => this.notifier.notify("knowledge.changed", change),
                updated: (run) => this.notifier.notify("knowledge.updated", run),
                timings: this.options.knowledgeTimings,
                journalFlushed: () => this.journal.flush(),
                // A chat's agent changed a topic: the window offers Undo, as for any agent write
                wroteTopic: (change) => this.notifier.notify("agent.changed", { kind: "knowledge", ...change }),
              },
              tasks: {
                definitions: (workspace) => this.taskDefinitions(workspace),
                onChange: (task) => this.taskChanges.push(task),
                limits: { parse: (await this.settings.get()).parsing.concurrency ?? 2 },
              },
            })
      if (this.workspace && this.workspace !== next) {
        this.turns.reset()
        this.ui.reset()
        await this.workspace.dispose()
        // The old workspace's last task changes go out before clients hear of the switch
        this.taskChanges.flush()
      }
      if (this.workspace !== next) {
        next.docs.textChanged = (rel, before, after) => {
          const chatId = this.turns.claimant(rel)
          if (chatId) void this.fs.recordDirect(rel, before, after, chatId).catch((error) => console.error("[core] couldn't keep the agent's change", error))
        }
        await next.docs.watch((change) => {
          this.notifier.notify("docs.changed", change)
          next.search.touch()
        })
        await next.library.watch(
          (change) => {
            this.notifier.notify("library.changed", change)
            next.search.touch()
          },
          (paperId, note, before) => {
            this.notifier.notify("library.noteChanged", { paperId, note })
            next.search.touch()
            // An agent that writes the disk itself (Claude Code does) changed the note while one of its tool
            // calls names the file: kept and journaled as the agent's, so the chat offers Undo, as for a doc
            const rel = `${OWLIT_DIR}/papers/${paperId}/note.md`
            const chatId = this.turns.claimant(rel)
            if (chatId) void this.fs.recordDirect(rel, before || null, note?.content ?? null, chatId).catch((error) => console.error("[core] couldn't keep the agent's change", error))
          },
        )
      }
      if (this.workspace !== next) await this.serveSocket(next.root)
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
    await this.socket?.close().catch(() => undefined)
    this.socket = null
    await this.workspace?.dispose()
    this.workspace = null
    this.taskChanges.flush()
  }

  // owlit-mcp for an agent session in this workspace (for one chat, or none in the background)
  private mcpServers(root: string, chatId?: string) {
    const mcp = this.options.mcp
    if (!mcp || !this.socket) return []
    return [
      {
        name: "owlit",
        command: mcp.command,
        args: [...mcp.args, "--workspace", root, ...(chatId ? ["--chat", chatId] : [])],
        env: Object.entries(mcp.env ?? {}).map(([name, value]) => ({ name, value })),
      },
    ]
  }

  // The socket of the workspace now open, in place of the last one's
  private async serveSocket(root: string) {
    if (!this.options.socket) return
    await this.socket?.close().catch(() => undefined)
    this.socket = null
    try {
      this.socket = await SocketServer.start(root, this, this.options.socket === true ? undefined : this.options.socket.dir)
    } catch (error) {
      // owlit works without it; only owlit-mcp and the CLI can't reach the workspace
      console.error("[core] couldn't open the workspace's socket", error)
    }
  }

  // Every kind of task core knows, made for one workspace
  private taskDefinitions(workspace: Workspace): TaskDefinition[] {
    return [...workspace.library.tasks(), ...workspace.search.tasks(), ...workspace.knowledge.tasks(), ...(this.options.debug ? this.debugTasks.definitions : [])]
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
