import { t } from "@lingui/core/macro"
import { chatOfFile, normalizeNoteLanguage, ROLES, RpcErrorCode, type ActivityAnswer, type ChatMessage, type CoreVersion, type PromptInput, type Role, type RpcNotification, type RpcRequest, type RpcResponse, type WorkspaceInfo, type WorkspaceState } from "@owlit/protocol"
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { ActivityBus, activityEvent, activityQuery, answerActivity, Journal, readJournal } from "./activity/index.ts"
import { Agents } from "./agents/agents.ts"
import { hasProxyEnv, systemProxyEnv } from "./agents/proxy.ts"
import { AgentFs } from "./agents/fs.ts"
import { Turns } from "./agents/turns.ts"
import { UiBridge } from "./ui/bridge.ts"
import type { Host } from "./host.ts"
import { noParams, Notifier, Router, RpcFailure } from "./rpc/index.ts"
import { readMemory } from "./memory/memory.ts"
import { SocketServer } from "./rpc/socket.ts"
import { AGENT_RULES } from "./agents/rules.ts"
import { guide } from "./agents/guide.ts"
import { Background } from "./agents/background.ts"
import { wearOf } from "./library/wear.ts"
import { limitMetadataHosts } from "./library/resolve.ts"
import { noteRelPath } from "./library/state.ts"
import { pickFromText } from "./library/library.ts"
import { extractText, toMarkdown, UnreadablePdf } from "./library/text/extract.ts"
import { serveWorkspaceFile } from "./files/serve.ts"
import { attachFile, chatFile } from "./chats/attach.ts"
import { Http } from "./net/http.ts"
import { SettingsStore } from "./settings.ts"
import { defaultNoteLanguage, registerSettings, settingsView } from "./settings-rpc.ts"
import { debugTasks, LANE_LIMITS, TaskThrottle, type TaskDefinition } from "./tasks/index.ts"
import { copyExample } from "./workspace/example.ts"
import { createFolder, suggestFolder } from "./workspace/welcome.ts"
import { resolveFolder, Workspace } from "./workspace/workspace.ts"
import { OWLIT_DIR } from "./workspace/paths.ts"

export const CORE_VERSION = "0.0.0"

// Methods that may change what a shared doc's reader sees: the doc, the papers it cites, their notes
const SHARED_CHANGES = /^(docs\.(create|write|rename|move|delete|restore)|library\.(add|update|remove|restore|setNote|refresh|requestDigest|importPdf|attachPdf))$/

// Methods that change what the search index covers
const CHANGES = /^(docs\.(create|write|rename|move|delete|restore)|chats\.(create|update|delete|restore|appendMessage|patchMessage)|notes\.|library\.(add|update|remove|restore|setNote|importPdf|attachPdf|importPitta))$/

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
  // pdfium's wasm file, where the desktop app ships it beside main
  pdfiumWasm?: string
  // Serve the open workspace on a Unix socket for owlit-mcp and the CLI ($TMPDIR, or this folder)
  socket?: boolean | { dir: string }
  // How to start owlit-mcp, handed to every agent session; --workspace and --chat are added
  mcp?: { command: string; args: string[]; env?: Record<string, string> }
  // How to start the Owlit engine (packages/owlit-agent); without it the engine isn't offered
  engine?: { command: string; args: string[]; env?: Record<string, string> }
  // How to run a JavaScript file as plain Node, and npm's CLI script: with both, owlit sets up its own copy
  // of Claude Code's and Codex's adapters (agents/setup.ts)
  node?: { command: string; args: string[]; env?: Record<string, string> }
  npm?: string
  // How long a reply the agent took up again after its turn waits for more before it ends (tests shorten it)
  lateQuietMs?: number
  // The share server new links are made on (apps/share-server), e.g. https://share.example.org; without
  // one, docs can't be shared
  shareServer?: string
  // How long changes settle before a shared doc is pushed, and how often comments are fetched (tests)
  shareTimings?: { settleMs?: number; pollMs?: number }
  // The example workspace the app ships, which workspace.createExample copies
  exampleDir?: string
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
  // Opens under way; while any is, the window waits rather than showing the welcome page
  private opening = 0
  private taskChanges = new TaskThrottle(200, (task) => this.notifier.notify("tasks.changed", { task }))
  private debugTasks = debugTasks()
  // One way out to the network for every workspace, so each service's rate holds across them
  private readonly http: Http
  private readonly background: Background
  private socket: SocketServer | null = null
  // The system's preferred languages (BCP 47, most preferred first), read once: the interface and digests
  // follow them until Settings says otherwise
  private readonly systemLanguages: readonly string[]

  constructor(options: CoreOptions) {
    this.options = options
    this.systemLanguages = options.host?.languages?.() ?? []
    this.settings = new SettingsStore(options.userDataDir, options.host?.secrets)
    this.http = new Http({ fetch: options.host?.fetch, userAgent: `owlit/${options.appVersion ?? CORE_VERSION}`, retryBaseMs: options.retryBaseMs })
    limitMetadataHosts(this.http)
    this.journal = new Journal(this.activity, () => this.workspace?.owlitPath("journal.jsonl") ?? null)
    const resolveProxy = options.host?.resolveProxy
    this.agents = new Agents({
      settings: this.settings,
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
    this.fs = new AgentFs({
      workspace: () => this.workspace,
      ui: this.ui,
      journal: this.journal,
      wrote: (record) => this.notifier.notify("agent.wrote", record),
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
      lateReply: (chatId, message) => this.notifier.notify("chat.lateReply", { chatId, message }),
      lateQuietMs: options.lateQuietMs,
      mcpServers: (root, chatId) => this.mcpServers(root, chatId),
      userName: async () => (await this.settings.get()).profile.name,
      memory: async () => (await this.workspace?.memory.list()) ?? [],
    })
    this.background = new Background(this.agents)
    // Opening a paper's page says the user is about to read it: its digest comes first
    this.activity.subscribe(["paper.opened"], (event) => void this.workspace?.library.wantDigest(event.paperId, "waiting"))

    this.router.register("core.ping", noParams, () => ({ ok: true as const }))
    // What agents are told about owlit (owlit-mcp's instructions)
    this.router.register("agents.rules", noParams, () => AGENT_RULES)
    this.router.register("agents.guide", z.object({ topic: z.string().optional() }), ({ topic }) => guide(topic))
    this.router.register("core.version", noParams, () => this.version())
    this.router.register("core.diagnostics", noParams, () => this.diagnostics())

    this.router.register("workspace.current", noParams, () => this.workspace?.info ?? null)
    this.router.register("workspace.open", z.object({ path: z.string().min(1) }), ({ path }) => this.openWorkspace(path))
    this.router.register("workspace.recent", noParams, async () => {
      const { recentWorkspaces } = await this.settings.get()
      return recentWorkspaces.filter((p) => existsSync(p)).map(toInfo)
    })
    this.router.register("workspace.state", noParams, () => this.state())
    this.router.register("workspace.welcome", noParams, async () => {
      const { recentWorkspaces } = await this.settings.get()
      return { recent: recentWorkspaces.map((p) => ({ ...toInfo(p), missing: !existsSync(p) })), suggestion: suggestFolder() }
    })
    this.router.register("workspace.create", z.object({ parent: z.string().min(1), name: z.string() }), async ({ parent, name }) =>
      this.openWorkspace(await createFolder(parent, name)),
    )
    this.router.register("workspace.createExample", noParams, async () => {
      const source = this.options.exampleDir
      if (!source || !existsSync(source)) throw new RpcFailure(RpcErrorCode.NotFound, t`This copy of owlit has no example workspace.`)
      return this.openWorkspace(await copyExample(source, suggestFolder().parent))
    })
    this.router.register("workspace.forget", z.object({ path: z.string().min(1) }), async ({ path }) => {
      await this.settings.forgetWorkspace(path)
      return null
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
    // What the user did lately, for an agent: nothing at all while recording is turned off
    this.router.register("activity.query", z.object({ query: activityQuery }), async ({ query }): Promise<ActivityAnswer> => {
      const ws = this.requireWorkspace()
      if (!(await this.settings.get()).activity.enabled) return { recording: false }
      const [{ papers, aliases }, chats, entries] = await Promise.all([ws.library.list(), ws.chats.list(), readJournal(ws.owlitPath("journal.jsonl"))])
      const titles = new Map(papers.map((p) => [p.id, p.title]))
      const chatTitles = new Map(chats.map((c) => [c.id, c.title]))
      const alias = (id: string) => aliases[id] ?? id
      const answer = answerActivity(entries, query, { now: Date.now(), names: { paper: (id) => titles.get(id), chat: (id) => chatTitles.get(id) }, alias })
      // A paper's history also says which of its sentences Owlit's answers rested on
      if (query.mode === "of" && query.paper) {
        const { cited } = await wearOf(query.paper, { chats: ws.chats, threads: ws.threads, journal: ws.owlitPath("journal.jsonl"), aliases })
        if (cited.length) return { recording: true, ...answer, cited: cited.map(({ quote, page, chatId, chatTitle, at }) => ({ quote, ...(page ? { page } : {}), chatId, chatTitle, at })) }
      }
      return { recording: true, ...answer }
    })
    this.router.register("activity.setEnabled", z.object({ enabled: z.boolean() }), async ({ enabled }) => {
      const next = await this.settings.update((s) => ({ ...s, activity: { ...s.activity, enabled } }))
      this.notifier.notify("activity.status", next.activity)
      this.notifier.notify("settings.changed", settingsView(next, this.systemLanguages))
      return next.activity
    })

    registerSettings({
      router: this.router,
      settings: this.settings,
      http: this.http,
      browser: options.host?.browser,
      systemLanguages: this.systemLanguages,
      changed: (view) => this.notifier.notify("settings.changed", view),
    })

    const docs = () => this.requireWorkspace().docs
    const rel = z.string()
    this.router.register("docs.list", noParams, () => docs().list())
    this.router.register("docs.read", z.object({ path: rel }), ({ path }) => docs().read(path))
    // Any agent reads a PDF the user has in the workspace (an attachment, a file that isn't in the Library)
    // through owlit, with the page numbers it would cite; the Owlit engine has no other way to read one
    this.router.register("docs.readPdf", z.object({ path: rel, pages: z.string().optional() }), async ({ path: file, pages }) => {
      const ws = this.requireWorkspace()
      const relPath = ws.docs.resolve(file)
      // Of owlit's own folder, only the copies of files attached in chats are the user's to read
      if (relPath.split("/")[0].toLowerCase() === OWLIT_DIR && !chatOfFile(relPath)) {
        throw new RpcFailure(RpcErrorCode.InvalidParams, `${relPath} is owlit's own state, not a document.`, { path: relPath })
      }
      const bytes = await readFile(path.join(ws.root, relPath)).catch(() => {
        throw new RpcFailure(RpcErrorCode.NotFound, `There is no ${relPath} in the workspace.`, { path: relPath })
      })
      const text = await extractText(bytes, { wasmPath: this.options.pdfiumWasm }).catch((error) => {
        throw error instanceof UnreadablePdf ? new RpcFailure(RpcErrorCode.InvalidParams, `${relPath} isn't a PDF owlit can read.`, { path: relPath }) : error
      })
      const markdown = toMarkdown(text)
      if (!markdown.replace(/<!-- page \d+ -->/g, "").trim()) return { text: `${relPath} has no text to read: its pages are images (a scan).`, pages: text.pages.length }
      return pickFromText(markdown, { pages })
    })
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
    this.router.register("docs.reveal", z.object({ path: rel }), ({ path }) => docs().reveal(path))

    const anchor = z.object({ quote: z.string(), prefix: z.string(), suffix: z.string() })
    const commentSchema = anchor.extend({
      id: z.string().min(1),
      entries: z.array(
        z.object({
          id: z.string().min(1),
          by: z.enum(["you", "owlit"]),
          agent: z.string().optional(),
          text: z.string(),
          at: z.number(),
          editedAt: z.number().optional(),
          chatId: z.string().optional(),
        }),
      ),
      createdAt: z.number(),
      resolvedAt: z.number().optional(),
    })
    const chats = () => this.requireWorkspace().chats
    const chatId = z.string().regex(/^[\w-]+$/)
    const roleSchema = z.enum(ROLES.map((r) => r.id) as [Role, ...Role[]])
    const summary = z.object({
      id: chatId,
      title: z.string(),
      createdAt: z.number(),
      updatedAt: z.number(),
      pinned: z.boolean(),
      connectorId: z.string().optional(),
      modelId: z.string().optional(),
      role: roleSchema.optional(),
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
    this.router.register("chats.removeMessages", z.object({ id: chatId, messageIds: z.array(z.string()) }), ({ id, messageIds }) =>
      chats().removeMessages(id, messageIds),
    )
    this.router.register("chats.patchMessage", z.object({ id: chatId, message, final: z.boolean().optional() }), ({ id, message, final }) =>
      chats().patchMessage(id, message, final),
    )
    this.router.register("chats.restore", z.object({ id: chatId }), ({ id }) => chats().restore(id))
    this.router.register(
      "chats.attach",
      z.object({ chatId, path: z.string().min(1).optional(), name: z.string().optional(), mimeType: z.string().optional(), data: z.string().optional() }),
      (params) => attachFile(this.requireWorkspace(), params),
    )
    this.router.register("chats.detach", z.object({ chatId, path: z.string() }), ({ chatId, path }) => chats().removeFile(chatId, chatFile(path)))
    this.router.register("chats.openFile", z.object({ path: z.string() }), async ({ path: rel }) => {
      const ws = this.requireWorkspace()
      const host = this.options.host
      if (!host?.openPath) throw new RpcFailure(RpcErrorCode.InternalError, t`owlit can't open files in other apps here.`)
      const file = path.join(ws.root, ...chatFile(rel).split("/"))
      if (!existsSync(file)) throw new RpcFailure(RpcErrorCode.NotFound, t`owlit no longer has that file.`, { path: rel })
      await host.openPath(file)
      return null
    })

    this.router.register("agents.list", noParams, () => this.agents.list())
    this.router.register("agents.check", z.object({ id: z.string() }), ({ id }) => this.agents.check(id))
    this.router.register("agents.setUp", z.object({ id: z.string() }), ({ id }) => this.agents.setUp(id))
    this.router.register("agents.cancelSetUp", z.object({ id: z.string() }), ({ id }) => this.agents.cancelSetUp(id))
    this.router.register("agents.add", z.object({ name: z.string(), command: z.string() }), ({ name, command }) => this.agents.add(name, command))
    this.router.register("agents.remove", z.object({ id: z.string() }), ({ id }) => this.agents.remove(id))
    this.router.register("agents.signIn", z.object({ id: z.string(), methodId: z.string(), apiKey: z.string().optional() }), ({ id, methodId, apiKey }) => this.agents.signIn(id, methodId, apiKey))
    this.router.register("agents.signOut", z.object({ id: z.string(), methodId: z.string().optional() }), ({ id, methodId }) => this.agents.signOut(id, methodId))
    this.router.register(
      "agents.prompt",
      z.object({
        chatId,
        connectorId: z.string(),
        modelId: z.string().optional(),
        role: roleSchema.optional(),
        effortId: z.string().optional(),
        input: z.looseObject({ text: z.string(), mentions: z.array(z.looseObject({ uri: z.string(), title: z.string() })), attachments: z.array(z.looseObject({ name: z.string() })) }) as unknown as z.ZodType<PromptInput>,
        userMessage: message,
        assistantMessageId: z.string().min(1),
      }),
      async (req) => ({ stopReason: await this.turns.prompt(req) }),
    )
    this.router.register(
      "agents.consent",
      z.object({ chatId, action: z.enum(["delete", "move", "add_paper"]), title: z.string().min(1) }),
      ({ chatId, action, title }) => this.turns.consent(chatId, action, title),
    )
    this.router.register("agents.deleteDocs", z.object({ paths: z.array(z.string().min(1)).min(1), chatId: chatId.optional() }), async ({ paths, chatId }) => ({
      deleted: await this.fs.remove(paths, chatId),
    }))
    this.router.register("agents.moveDoc", z.object({ path: z.string().min(1), to: z.string().min(1), chatId: chatId.optional() }), async ({ path: from, to, chatId }) => ({
      path: await this.fs.move(from, to, chatId),
    }))
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
    this.router.register("memory.list", noParams, async () => {
      const memory = this.requireWorkspace().memory
      return { lines: await memory.list(), claudeNotes: await memory.claudeNotes() }
    })
    const memoryKind = z.enum(["work", "about"])
    this.router.register(
      "memory.write",
      z.object({ op: z.enum(["add", "replace", "remove"]), id: z.string().optional(), kind: memoryKind.optional(), text: z.string().optional(), chatId: z.string().optional() }),
      async ({ op, id, kind, text, chatId }) => {
        // Said to the agent, so plain English
        const need = (what: string) => {
          throw new RpcFailure(RpcErrorCode.InvalidParams, `memory_write with op "${op}" needs ${what}.`)
        }
        const change = await this.requireWorkspace().memory.agentWrite(
          op === "add" ? { op, kind: kind ?? need("kind"), text: text ?? need("text") } : op === "replace" ? { op, id: id ?? need("id"), text: text ?? need("text"), ...(kind ? { kind } : {}) } : { op, id: id ?? need("id") },
          chatId ? { chatId } : {},
        )
        const shown = change.line ?? change.before
        if (change.versionId && shown) {
          this.notifier.notify("agent.changed", {
            kind: "memory",
            versionId: change.versionId,
            path: shown.id,
            label: shown.text,
            memory: shown.kind,
            ...(change.line === null ? { op: "removed" as const } : change.before ? { op: "updated" as const } : {}),
            ...(chatId ? { chatId } : {}),
          })
        }
        return change
      },
    )
    this.router.register(
      "memory.put",
      z.object({ id: z.string().optional(), kind: memoryKind, text: z.string(), at: z.number().optional(), chatId: z.string().optional() }),
      (input) => this.requireWorkspace().memory.put(input),
    )
    this.router.register("memory.remove", z.object({ id: z.string().min(1) }), ({ id }) => this.requireWorkspace().memory.remove(id))
    this.router.register(
      "memory.decideClaudeNotes",
      z.object({ keep: z.array(z.object({ file: z.string().min(1), kind: memoryKind, text: z.string() })), drop: z.array(z.string().min(1)) }),
      ({ keep, drop }) => this.requireWorkspace().memory.decideClaudeNotes(keep, drop),
    )
    this.router.register("versions.restore", z.object({ id: z.string().min(1), force: z.boolean().optional() }), ({ id, force }) => this.fs.restore(id, force))
    this.router.register("versions.stats", z.object({ from: z.string().min(1), to: z.string().min(1) }), ({ from, to }) => this.fs.stats(from, to))
    this.router.register("versions.list", z.object({ path: z.string().optional(), since: z.number().optional() }), (filter) => this.requireWorkspace().versions.list(filter))
    this.router.register("agents.cancel", z.object({ chatId }), ({ chatId }) => this.turns.cancel(chatId))
    this.router.register("agents.respondPermission", z.object({ chatId, requestId: z.string(), optionId: z.string() }), ({ chatId, requestId, optionId }) =>
      this.turns.respondPermission(chatId, requestId, optionId),
    )
    const answer = z.object({ picks: z.array(z.string()).optional(), text: z.string().optional() })
    this.router.register("agents.answerQuestion", z.object({ chatId, requestId: z.string(), answers: z.record(z.string(), answer).nullable() }), ({ chatId, requestId, answers }) =>
      this.turns.answerQuestion(chatId, requestId, answers),
    )

    const library = () => this.requireWorkspace().library
    this.router.register("library.resolve", z.object({ input: z.string().min(1) }), ({ input }) => library().resolve(input))
    // A search's results are kept for hours, a thread's papers for good: an agent filling a column a day
    // later still gets the whole abstract
    this.router.register("library.found", z.object({ id: z.string().min(1) }), async ({ id }) => (await library().snapshot(id)) ?? (await this.requireWorkspace().threads.paperOf(id)) ?? null)
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
        const { paper: added, existed } = await library().addNew(paper, addedBy)
        // A paper the library had already isn't the agent's to take back
        if (addedBy === "agent" && !existed) {
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
    // An agent's own additions, from the chat that added them; each removal is a version the user can undo
    this.router.register("library.removeByAgent", z.object({ ids: z.array(z.string()), chatId: z.string().optional() }), async ({ ids, chatId }) => {
      const ws = this.requireWorkspace()
      const mine: string[] = []
      const refused: { id: string; why: string }[] = []
      const versions = chatId ? await ws.versions.list() : []
      for (const id of ids) {
        const added = versions.find((v) => v.path === id && v.kind === "paper" && v.op === "added")
        if (chatId && added && added.chatId !== chatId) refused.push({ id, why: "another chat added it; ask the user" })
        else mine.push(id)
      }
      // Named as the user knows them, while they are still there to read
      const titles = new Map(await Promise.all(mine.map(async (id) => [id, (await ws.library.get(id))?.title ?? id] as const)))
      const done = await ws.library.removeByAgent(mine)
      for (const id of done.removed) {
        const version = await ws.versions.savePaper(id, "removed", { chatId })
        this.notifier.notify("agent.changed", { kind: "paper", op: "removed", versionId: version.id, path: id, label: titles.get(id) ?? id, ...(chatId ? { chatId } : {}) })
      }
      return { removed: done.removed, refused: [...refused, ...done.refused] }
    })
    this.router.register("library.restore", z.object({ ids: z.array(paperId) }), ({ ids }) => library().restore(ids))
    this.router.register("library.trash", noParams, () => library().trash())
    this.router.register("library.refresh", z.object({ id: paperId }), ({ id }) => library().refresh(id))
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
    this.router.register("library.requestDigest", z.object({ id: paperId, rewrite: z.boolean().optional() }), async ({ id, rewrite }) => {
      await library().wantDigest(id, "asked", { rewrite })
      return null
    })
    this.router.register("library.figures", z.object({ id: paperId }), ({ id }) => library().figures(id))
    this.router.register("library.pagePicture", z.object({ id: paperId, page: z.number().int().min(0) }), ({ id, page }) => library().pagePicture(id, page))
    this.router.register(
      "library.read",
      z.object({ id: paperId, part: z.enum(["text", "digest", "note"]), pages: z.string().optional(), section: z.string().optional() }),
      ({ id, part, pages, section }) => library().read(id, part, { pages, section }),
    )
    const year = z.string().max(20).optional()
    const sort = z.enum(["relevance", "citations", "newest"]).optional()
    this.router.register(
      "library.searchOnline",
      z.object({
        q: z.string().min(1),
        limit: z.number().int().positive().max(50).optional(),
        by: z.string().optional(),
        source: z.enum(["openalex", "s2", "arxiv"]).optional(),
        year,
        sort,
        minCitations: z.number().int().nonnegative().optional(),
        type: z.enum(["article", "review", "preprint", "book"]).optional(),
        author: z.string().min(1).optional(),
        venue: z.string().min(1).optional(),
        openAccess: z.boolean().optional(),
      }),
      ({ q, by, ...options }) => library().searchOnline(q, options, by),
    )
    this.router.register(
      "library.related",
      z.object({ ref: z.string().min(1), kind: z.enum(["references", "cited_by", "similar"]), limit: z.number().int().positive().max(100).optional(), year, sort, by: z.string().optional() }),
      ({ ref, kind, by, ...options }) => library().related(ref, kind, options, by),
    )
    this.router.register(
      "library.journal",
      z.object({
        journal: z.string().min(1),
        year: z.string().min(4).max(20),
        query: z.string().optional(),
        offset: z.number().int().nonnegative().optional(),
        limit: z.number().int().positive().max(200).optional(),
        by: z.string().optional(),
      }),
      ({ journal, year, by, ...options }) => library().journal(journal, year, options, by),
    )
    this.router.register("library.highlights", z.object({ id: paperId }), ({ id }) => library().highlights(id))
    this.router.register("library.importPitta", z.object({ root: z.string().min(1) }), ({ root }) => library().importPitta(root))
    this.router.register(
      "library.import",
      z.object({ source: z.enum(["zotero", "bibtex", "folder"]), path: z.string().min(1), collectionsAsTags: z.boolean().optional(), parse: z.boolean().optional() }),
      ({ source, path, collectionsAsTags, parse }) => library().imports.start(source, path, { collectionsAsTags, parse }),
    )
    this.router.register("library.previewImport", z.object({ source: z.enum(["zotero", "bibtex", "folder"]), path: z.string().min(1) }), ({ source, path }) =>
      library().imports.preview(source, path),
    )
    this.router.register("library.continueImport", z.object({ id: z.string().min(1) }), ({ id }) => library().imports.continue(id))
    this.router.register("library.imports", noParams, () => library().imports.list())
    this.router.register("library.findZotero", noParams, () => library().imports.findZotero())
    this.router.register("library.importAnswer", z.object({ id: z.string().min(1), parse: z.boolean() }), ({ id, parse }) => library().imports.answer(id, parse))
    this.router.register("library.dismissImport", z.object({ id: z.string().min(1) }), async ({ id }) => {
      await library().imports.dismiss(id)
      return null
    })
    this.router.register("library.text", z.object({ id: paperId }), ({ id }) => library().text(id))
    // What has been read of a paper, for its reader: what Owlit's answers cited of it, and where the person stayed
    this.router.register("library.wear", z.object({ id: paperId }), async ({ id }) => {
      const ws = this.requireWorkspace()
      return wearOf(id, { chats: ws.chats, threads: ws.threads, journal: ws.owlitPath("journal.jsonl"), aliases: await ws.library.aliases() })
    })
    this.router.register("library.fetchPdf", z.object({ id: paperId }), ({ id }) => library().fetchPdf(id))
    this.router.register("library.getInBrowser", z.object({ ids: z.array(paperId).min(1) }), ({ ids }) => library().getInBrowser(ids))
    this.router.register("library.showBrowser", z.object({ id: paperId.optional() }), ({ id }) => library().showBrowser(id))
    this.router.register("library.takeDownload", z.object({ id: paperId, take: z.boolean() }), ({ id, take }) => library().takeDownload(id, take))
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
      this.router.register("library.debugBrowserFetch", z.object({ landing: z.string(), pdf: z.string().optional(), allowHosts: z.array(z.string()) }), async (params) => {
        const bytes = await browser.fetchPdf({ ...params, signal: new AbortController().signal })
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

    const threads = () => this.requireWorkspace().threads
    const cellWrite = z.object({
      text: z.string(),
      depth: z.enum(["abstract", "full"]),
      passage: z.object({ quote: z.string().min(1), page: z.number().int().min(1) }).optional(),
      rel: z.enum(["supports", "challenges", "related"]).optional(),
      sentence: z.string().optional(),
    })
    const group = z.object({ id: z.string().regex(/^[\w-]+$/, "letters, digits, - and _"), name: z.string().min(1), one: z.string().optional(), parent: z.string().optional() })
    const item = z.string().regex(/^(title|memo:[\w-]+|cell:[^:]+:[\w-]+|row:[^:]+|group:[\w-]+)$/, "an item: title, memo:<id>, cell:<paper>:<column>, row:<paper> or group:<id>")
    this.router.register("threads.list", noParams, () => threads().list())
    this.router.register("threads.get", z.object({ id: z.string().min(1) }), ({ id }) => threads().get(id))
    this.router.register(
      "threads.write",
      z.object({
        id: z.string().optional(),
        asked: z.string().optional(),
        title: z.string().optional(),
        project: z.string().optional(),
        sources: z.array(z.string()).optional(),
        memo: z.array(z.object({ id: z.string().regex(/^[\w-]+$/).optional(), text: z.string() })).optional(),
        columns: z.array(z.object({ id: z.string().regex(/^[\w-]+$/).optional(), question: z.string() })).optional(),
        rows: z.array(z.object({ id: z.string().min(1), cells: z.record(z.string(), cellWrite).optional(), group: z.string().optional(), foundBy: z.string().optional() })).optional(),
        groups: z.array(group).optional(),
        removeRows: z.array(z.string()).optional(),
        why: z.string().optional(),
        note: z.string().optional(),
        chatId: z.string().optional(),
        run: z.string().optional(),
        docPath: z.string().optional(),
      }),
      (params) => threads().write(params),
    )
    this.router.register(
      "threads.edit",
      z.object({
        id: z.string().min(1),
        edit: z.discriminatedUnion("op", [
          z.object({ op: z.literal("rename"), title: z.string() }),
          z.object({ op: z.literal("rewrite"), item, text: z.string() }),
          z.object({ op: z.literal("revert"), item }),
          z.object({ op: z.literal("remove"), item }),
          z.object({ op: z.literal("unremove"), item }),
          z.object({ op: z.literal("move"), row: z.string().min(1), group: z.string().nullable() }),
          z.object({ op: z.literal("ungroup"), group: z.string().min(1) }),
          z.object({ op: z.literal("merge"), group: z.string().min(1), into: z.string().min(1) }),
          z.object({ op: z.literal("watch"), on: z.boolean() }),
          z.object({ op: z.literal("hide"), column: z.string().min(1), hidden: z.boolean() }),
          z.object({ op: z.literal("project"), project: z.string() }),
          z.object({ op: z.literal("seen") }),
        ]),
      }),
      ({ id, edit }) => threads().edit(id, edit),
    )
    this.router.register("threads.split", z.object({ id: z.string().min(1), rows: z.array(z.string().min(1)).min(1), asked: z.string() }), ({ id, rows, asked }) => threads().split(id, rows, asked))
    this.router.register("threads.unsplit", z.object({ id: z.string().min(1) }), ({ id }) => threads().unsplit(id))
    this.router.register("threads.about", z.object({ id: z.string().min(1) }), ({ id }) => threads().about(id))
    this.router.register(
      "threads.gather",
      z.object({ question: z.string().min(1), project: z.string().optional(), size: z.enum(["few", "many"]) }),
      (params) => threads().gather(params),
    )
    this.router.register("threads.run", z.object({ id: z.string().min(1), run: z.enum(["more", "read", "check"]) }), ({ id, run }) => threads().start(id, run))
    this.router.register(
      "threads.compare",
      z.object({ id: z.string().min(1), doc: z.string().min(1), sentences: z.array(z.string().min(1)).min(1).max(20) }),
      ({ id, doc, sentences }) => threads().compare(id, doc, sentences),
    )
    this.router.register("threads.fill", z.object({ id: z.string().min(1), column: z.string().min(1) }), ({ id, column }) => threads().fill(id, column))
    this.router.register("threads.ask", z.object({ id: z.string().min(1), question: z.string().min(1) }), ({ id, question }) => threads().ask(id, question))
    this.router.register("threads.delete", z.object({ id: z.string().min(1) }), ({ id }) => threads().delete(id))
    this.router.register("threads.undelete", z.object({ id: z.string().min(1) }), ({ id }) => threads().undelete(id))
    this.router.register("comments.all", noParams, () => docs().commentsAll())
    this.router.register(
      "comments.add",
      z.object({ path: rel, comment: commentSchema, agent: z.object({ chatId: z.string().optional() }).optional() }),
      async ({ path, comment, agent }) => {
        await docs().addComment(path, comment)
        this.notifier.notify("comments.changed", { path, comment })
        if (agent) {
          const version = await this.requireWorkspace().versions.saveComment(path, comment, "added", agent)
          this.notifier.notify("agent.changed", { kind: "note", versionId: version.id, path, label: path.split("/").pop()!.replace(/\.md$/i, ""), ...agent })
        }
        return null
      },
    )
    this.router.register("comments.put", z.object({ path: rel, comment: commentSchema }), ({ path, comment }) => docs().putComment(path, comment))
    this.router.register("comments.remove", z.object({ path: rel, id: z.string() }), ({ path, id }) => docs().removeComment(path, id))
    this.router.register("comments.reanchor", z.object({ path: rel, moved: z.record(z.string(), anchor) }), ({ path, moved }) =>
      docs().reanchorComments(path, moved),
    )

    const shares = () => this.requireWorkspace().shares
    const permission = z.enum(["comment", "view"])
    this.router.register("share.list", noParams, () => shares().list())
    this.router.register("share.create", z.object({ path: rel, notes: z.boolean() }), ({ path, notes }) => shares().create(path, notes))
    this.router.register("share.update", z.object({ path: rel, permission: permission.optional(), notes: z.boolean().optional() }), ({ path, ...change }) =>
      shares().update(path, change),
    )
    this.router.register("share.stop", z.object({ path: rel }), ({ path }) => shares().stop(path))
    this.router.register("share.comments", z.object({ path: rel }), ({ path }) => shares().commentsOf(path))
    this.router.register("share.reply", z.object({ path: rel, parent: z.string().min(1), text: z.string().trim().min(1).max(4000) }), ({ path, parent, text }) =>
      shares().reply(path, parent, text),
    )
    this.router.register("share.resolve", z.object({ path: rel, id: z.string().min(1), resolved: z.boolean() }), ({ path, id, resolved }) =>
      shares().resolve(path, id, resolved),
    )
  }

  async handle(request: RpcRequest): Promise<RpcResponse> {
    const response = await this.router.handle(request)
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
                openExternal: this.options.host?.openExternal,
                browserName: this.options.host?.browserName,
                showBrowser: this.options.host?.showBrowser,
                browserControl: this.options.host?.browserControl,
                downloadsDir: this.options.host?.downloadsDir,
                pdfiumWasm: this.options.pdfiumWasm,
                settings: async () => (await this.settings.get()).library,
                parsing: async () => (await this.settings.get()).parsing,
                // Libraries sign you out after a while (Tsinghua's tlink after two hours): Settings says so
                // once a run finds the sign-in page, and signed in again once a PDF comes through
                proxySignedIn: (signedIn) => void this.proxySignedIn(signedIn),
                agent: async (prompt, signal, pictures) =>
                  this.background.run({ prompt, pictures, root, mcpServers: this.mcpServers(root), signal, memory: await readMemory(root), ...(await this.backgroundAgent()) }),
                noteLanguage: async () => {
                  const settings = await this.settings.get()
                  const chosen = settings.library.digestLanguage
                  return chosen ? normalizeNoteLanguage(chosen) : defaultNoteLanguage(settings, this.systemLanguages)
                },
              },
              threads: {
                agent: async (prompt, signal, allow, run) => {
                  // Without owlit's tools (no socket: it failed to open) the agent couldn't write the
                  // thread at all. The run's tools sign its searches and writes, so About can show
                  // them as one batch.
                  const mcpServers = this.mcpServers(root, undefined, run)
                  if (!mcpServers.length) throw new Error("owlit's tools aren't reachable.")
                  return this.background.run({ prompt, root, mcpServers, signal, memory: await readMemory(root), ...(await this.backgroundAgent()), allow })
                },
                changed: (id, thread) => {
                  if (this.workspace?.root === root) this.notifier.notify("threads.changed", { id, thread })
                },
                // A chat's agent gathered papers into a thread: the chat shows it with Undo, as for any agent write
                wrote: ({ id, ...change }) => this.notifier.notify("agent.changed", { kind: "thread", path: id, ...change }),
              },
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
        next.docs.textChanged = (rel, before, after) => {
          const chatId = this.turns.claimant(rel)
          if (chatId) void this.fs.recordDirect(rel, before, after, chatId).catch((error) => console.error("[core] couldn't keep the agent's change", error))
        }
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
          // Threads the user watches get their daily look
          void next.threads.checkWatched().catch((error) => console.error("[core] couldn't check watched threads", error))
          await next.library.watch(
            (change) => {
              if (current()) this.notifier.notify("library.changed", change)
              next.search.touch()
              next.shares.touched({ papers: [...change.papers.map((p) => p.id), ...change.removed, ...Object.entries(change.renamed ?? {}).flat()] })
            },
            (paperId, note, before) => {
              if (current()) this.notifier.notify("library.noteChanged", { paperId, note })
              next.search.touch()
              next.shares.touched({ papers: [paperId] })
              // An agent that writes the disk itself (Claude Code does) changed the note while one of its tool
              // calls names the file: kept and journaled as the agent's, so the chat offers Undo, as for a doc
              const rel = noteRelPath(paperId)
              const chatId = this.turns.claimant(rel)
              if (chatId) void this.fs.recordDirect(rel, before || null, note?.content ?? null, chatId).catch((error) => console.error("[core] couldn't keep the agent's change", error))
            },
          )
        } catch (error) {
          await next.dispose().catch(() => undefined)
          throw error
        }
      }
      if (this.workspace && this.workspace !== next) {
        this.turns.reset()
        this.ui.reset()
        await this.workspace.dispose()
        // The old workspace's last task changes go out before clients hear of the switch
        this.taskChanges.flush()
      }
      if (this.workspace !== next) await this.serveSocket(next.root)
      const opened = this.workspace !== next
      this.workspace = next
      // Its tasks run only now: an agent run started before its socket was up would go without owlit's tools
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

  async dispose() {
    this.started = false
    await this.switching
    // Background work stops before the agents it runs on: a run cut off by its agent closing would count
    // as a failed try, where one stopped by closing stays running, to run again next time
    await this.workspace?.tasks.dispose()
    this.agents.dispose()
    await this.journal.dispose()
    await this.socket?.close().catch(() => undefined)
    this.socket = null
    await this.workspace?.dispose()
    this.workspace = null
    this.taskChanges.flush()
  }

  // What a run through the library proxy found of its sign-in, kept for Settings; only a change is saved
  private async proxySignedIn(signedIn: boolean) {
    const { library } = await this.settings.get()
    if (!library.proxy || !!library.proxySignedInAt === signedIn) return
    const next = await this.settings.update((s) => {
      const { proxySignedInAt: _, ...rest } = s.library
      return { ...s, library: signedIn ? { ...rest, proxySignedInAt: Date.now() } : rest }
    })
    this.notifier.notify("settings.changed", settingsView(next, this.systemLanguages))
  }

  // The agent (and its model) chosen for background work in Settings
  private async backgroundAgent() {
    const { connectors } = await this.settings.get()
    return { connectorId: connectors.background, models: connectors.backgroundModels }
  }

  // owlit-mcp for an agent session in this workspace (for one chat, or none in the background)
  private mcpServers(root: string, chatId?: string, run?: string) {
    const mcp = this.options.mcp
    if (!mcp || this.socket?.root !== root) return []
    return [
      {
        name: "owlit",
        command: mcp.command,
        args: [...mcp.args, "--workspace", root, ...(chatId ? ["--chat", chatId] : []), ...(run ? ["--run", run] : [])],
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
    return [...workspace.library.tasks(), ...workspace.search.tasks(), ...workspace.threads.tasks(), ...(this.options.debug ? this.debugTasks.definitions : [])]
  }

  private requireWorkspace() {
    if (!this.workspace) throw new RpcFailure(RpcErrorCode.NoWorkspace, t`Open a folder as the workspace first.`)
    return this.workspace
  }

  private async diagnostics(): Promise<string> {
    const macos = await new Promise<string>((resolve) => execFile("sw_vers", ["-productVersion"], (error, out) => resolve(error ? process.platform : `macOS ${out.trim()}`)))
    const home = (p: string) => p.replace(homedir(), "~")
    const lines = [`Owlit ${this.version().version} (${process.arch}) · ${macos} · Node ${process.versions.node}`]
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

const toInfo = (folder: string): WorkspaceInfo => ({ path: folder, name: folder.slice(folder.lastIndexOf("/") + 1) })
