import { t } from "@lingui/core/macro"
import { chatOfFile, isOpenComment, isOwlit, isPerson, normalizeNoteLanguage, ROLES, RpcErrorCode, type ActivityAnswer, type ActorId, type BuildInfo, type ChangeOrigin, type ChatMessage, type DocComment, type Highlight, type CoreVersion, type Paper, type PaperPatch, type PersonId, type PromptInput, type ReadTrace, type Role, type RpcNotification, type RpcRequest, type RpcResponse, type WorkspaceInfo, type WorkspaceState } from "@owlit/protocol"
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { ActivityBus, activityEvent, activityQuery, answerActivity, Journal, readJournal, readingOf, traceOf } from "./activity/index.ts"
import { Agents } from "./agents/agents.ts"
import type { CutOff } from "./agents/failure.ts"
import { hasProxyEnv, systemProxyEnv } from "./agents/proxy.ts"
import { AgentFs } from "./agents/fs.ts"
import { Undo } from "./changes/undo.ts"
import { docPassages } from "./changes/passages.ts"
import { docProposals } from "./changes/proposals.ts"
import { Turns } from "./agents/turns.ts"
import { ReadLog, readFromOf } from "./agents/read-from.ts"
import { Updates } from "./updates/updates.ts"
import { UiBridge } from "./ui/bridge.ts"
import type { Host } from "./host.ts"
import { noParams, Notifier, Router, RpcFailure, WINDOW, type Caller, type Policy } from "./rpc/index.ts"
import { commentTouches, decide, replyOnly, type Target, type Who } from "./agents/policy.ts"
import { newWriteId } from "./changes/record.ts"
import { commentChanges, signed } from "./docs/comments.ts"
import { readMemory } from "./memory/memory.ts"
import { SocketServer } from "./rpc/socket.ts"
import { ExtensionServer, type ExtensionServerOptions } from "./extension/server.ts"
import { AGENT_RULES } from "./agents/rules.ts"
import { guide } from "./agents/guide.ts"
import { Background, BackgroundFailure, type BackgroundResult, type BackgroundRun } from "./agents/background.ts"
import { openRun, runWords } from "./agents/runs.ts"
import { isCommentingRun, Reviews } from "./initiative/reviews.ts"
import { becameReadInFull } from "./library/read-in-full.ts"
import { GO_THROUGH_RUN, REPLY_RUN } from "./initiative/runs.ts"
import { MATERIAL } from "./initiative/go-through.ts"
import { messageOf } from "./util.ts"
import { wearOf } from "./library/wear.ts"
import { limitMetadataHosts } from "./library/resolve.ts"
import { noteRelPath } from "./library/state.ts"
import { pickFromText } from "./library/library.ts"
import { extractText, toMarkdown, UnreadablePdf } from "./library/text/extract.ts"
import { serveWorkspaceFile } from "./files/serve.ts"
import { attachFile, chatFile } from "./chats/attach.ts"
import { Http } from "./net/http.ts"
import { SettingsStore } from "./settings.ts"
import { isMissing } from "./fs-util.ts"
import { defaultNoteLanguage, registerSettings, settingsView } from "./settings-rpc.ts"
import { debugTasks, LANE_LIMITS, TaskThrottle, type TaskContext, type TaskDefinition } from "./tasks/index.ts"
import { copyExample } from "./workspace/example.ts"
import { createFolder, suggestFolder } from "./workspace/welcome.ts"
import { resolveFolder, Workspace } from "./workspace/workspace.ts"
import { OWLIT_DIR } from "./workspace/paths.ts"

export const CORE_VERSION = "0.0.0"

// Methods that may change what a shared doc's reader sees: the doc, the papers it cites, their notes
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
  private taskChanges = new TaskThrottle(200, (task) => this.notifier.notify("tasks.changed", { task }))
  private debugTasks = debugTasks()
  // One way out to the network for every workspace, so each service's rate holds across them
  private readonly http: Http
  private readonly background: Background
  private readonly reviews: Reviews
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
      docs: { text: (rel) => this.fs.text(rel), write: (rel, content, changeId) => this.fs.place(rel, content, changeId, true) },
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
      ended: (chatId, message) => this.notifier.notify("chat.ended", { chatId, messageId: message.id, message }),
      mcpServers: (root, chatId) => this.mcpServers(root, chatId),
      userName: async () => (await this.settings.get()).profile.name,
      memory: async () => (await this.workspace?.memory.list()) ?? [],
      readFrom: async (chatId, since, answer) => {
        const ws = this.workspace
        if (!ws) return []
        return readFromOf(this.reads.since(`chat:${chatId}`, since), answer, async (id) => (await ws.library.canonical(id)) ?? id, (id) => ws.hasText(id))
      },
    })
    this.background = new Background(this.agents, this.fs)
    this.updates = new Updates({
      build: { version: this.version().version, channel: options.build?.channel ?? "dev", commit: options.build?.commit },
      userDataDir: options.userDataDir,
      updater: options.host?.updater,
      changelog: options.changelog,
      onboarded: async () => (await this.settings.get()).onboardedAt !== undefined,
      answering: () => this.turns.answering(),
      notify: (view) => this.notifier.notify("updates.changed", view),
    })
    // Owlit's runs on the user's docs: answering a reply under its comment, going through material
    this.reviews = new Reviews({
      workspace: () => this.workspace,
      agent: async (prompt, ctx, tools, runId) => {
        const root = this.requireWorkspace().root
        const mcpServers = this.mcpServers(root, undefined, runId)
        if (!mcpServers.length) throw new Error("owlit's tools aren't reachable.")
        return this.runInBackground(root, ctx, { prompt, root, mcpServers, signal: ctx.signal, memory: await readMemory(root), ...(await this.backgroundAgent()), allow: tools })
      },
      write: (path, comment, run) => this.agentComment(path, comment, { kind: "owlit", run }),
      put: async (path, comment, run) => {
        await this.putComment(path, comment, { kind: "owlit", run }, {}, true)
      },
      looked: (path, state) => this.notifier.notify("docs.owlit", { path, state }),
      writeRecord: (path, content, run) => this.fs.write(path, content, { run }),
      userName: async () => (await this.settings.get()).profile.name ?? undefined,
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


    this.router.register("core.ping", noParams, "read", () => ({ ok: true as const }))
    // What agents are told about owlit (owlit-mcp's instructions)
    this.router.register("agents.rules", noParams, "read", () => AGENT_RULES)
    this.router.register("agents.guide", z.object({ topic: z.string().optional() }), "read", ({ topic }) => guide(topic))
    this.router.register("core.version", noParams, "read", () => this.version())
    this.router.register("core.diagnostics", noParams, "read", () => this.diagnostics())
    this.router.register("extension.get", noParams, "read", async () => (await this.extension?.view()) ?? { serving: false, portTaken: false, paired: [], asking: [], waits: [] })
    this.router.register("extension.answer", z.object({ id: z.string().min(1), allow: z.boolean() }), "admin", async ({ id, allow }) => {
      await this.extension?.pairings.answer(id, allow)
      return null
    })
    this.router.register("extension.open", z.object({ kind: z.enum(["sign-in", "check", "permission"]), host: z.string().min(1).max(253) }), "admin", async ({ kind, host }) => {
      if (!this.extension) throw new RpcFailure(RpcErrorCode.Unavailable, t`The browser extension needs the owlit desktop app.`)
      return this.extension.open(kind, host)
    })
    this.router.register("extension.forget", z.object({ id: z.string().min(1) }), "admin", async ({ id }) => {
      if (!this.extension) throw new RpcFailure(RpcErrorCode.Unavailable, t`The browser extension needs the owlit desktop app.`)
      await this.extension.pairings.forget(id)
      return this.extension.view()
    })
    this.router.register("updates.get", noParams, "read", () => this.updates.view())
    this.router.register("updates.check", noParams, "admin", () => this.updates.check())
    this.router.register("updates.setAuto", z.object({ auto: z.boolean() }), "admin", ({ auto }) => this.updates.setAuto(auto))
    this.router.register("updates.seen", noParams, "admin", () => this.updates.seen())
    this.router.register("updates.restart", z.object({ force: z.boolean().optional() }), "admin", ({ force }) => this.updates.restart(force ?? false))

    this.router.register("workspace.current", noParams, "read", () => this.workspace?.info ?? null)
    this.router.register("workspace.open", z.object({ path: z.string().min(1) }), "admin", ({ path }) => this.openWorkspace(path))
    this.router.register("workspace.recent", noParams, "read", async () => {
      const { recentWorkspaces } = await this.settings.get()
      return recentWorkspaces.filter((p) => !isMissing(p)).map(toInfo)
    })
    this.router.register("workspace.state", noParams, "read", () => this.state())
    this.router.register("workspace.welcome", noParams, "read", async () => {
      const { recentWorkspaces } = await this.settings.get()
      return { recent: recentWorkspaces.map((p) => ({ ...toInfo(p), missing: isMissing(p) })), suggestion: suggestFolder() }
    })
    this.router.register("workspace.create", z.object({ parent: z.string().min(1), name: z.string() }), "admin", async ({ parent, name }) =>
      this.openWorkspace(await createFolder(parent, name)),
    )
    this.router.register("workspace.createExample", noParams, "admin", async () => {
      const source = this.options.exampleDir
      if (!source || !existsSync(source)) throw new RpcFailure(RpcErrorCode.NotFound, t`This copy of owlit has no example workspace.`)
      return this.openWorkspace(await copyExample(source, suggestFolder().parent, (await this.settings.get()).profile.id!))
    })
    this.router.register("workspace.forget", z.object({ path: z.string().min(1) }), "admin", async ({ path }) => {
      await this.settings.forgetWorkspace(path)
      return null
    })
    this.router.register("workspace.clearRecent", noParams, "admin", async () => {
      await this.settings.update((s) => ({ ...s, recentWorkspaces: [] }))
      return null
    })

    this.router.register("workspace.layout", noParams, "read", () => this.requireWorkspace().layout())
    this.router.register("workspace.setLayout", z.object({ patch: z.record(z.string(), z.unknown()) }), "admin", ({ patch }) =>
      this.requireWorkspace().setLayout(patch),
    )

    // Turned off, the journal keeps nothing (see Journal), but Owlit's rules still hear what the user opens
    this.router.register("activity.emit", z.object({ event: activityEvent }), "admin", async ({ event }) => {
      await this.settings.get()
      if (this.workspace) this.activity.publish(event)
      return null
    })
    this.router.register("activity.status", noParams, "read", async () => (await this.settings.get()).activity)
    // What the user did lately, for an agent: nothing at all while recording is turned off
    this.router.register("activity.query", z.object({ query: activityQuery }), "read", async ({ query }): Promise<ActivityAnswer> => {
      const ws = this.requireWorkspace()
      if (!(await this.settings.get()).activity.enabled) return { recording: false }
      const [{ papers, aliases }, chats, entries, docChanges] = await Promise.all([
        ws.library.list(),
        ws.chats.list(),
        readJournal(ws.owlitPath("journal.jsonl")),
        ws.changes.list({ target: { kind: "doc" } }),
      ])
      const titles = new Map(papers.map((p) => [p.id, p.title]))
      const chatTitles = new Map(chats.map((c) => [c.id, c.title]))
      const alias = (id: string) => aliases[id] ?? id
      const changes = docChanges.filter((c) => isOwlit(c.actor)).reverse()
      const statuses = new Map(papers.map((p) => [p.id, p.status]))
      const answer = answerActivity(entries, query, { now: Date.now(), names: { paper: (id) => titles.get(id), chat: (id) => chatTitles.get(id) }, alias, changes, status: (id) => statuses.get(id) })
      // A paper's history also says which of its sentences Owlit's answers rested on
      if (query.mode === "of" && query.paper) {
        const { cited } = await wearOf(query.paper, { chats: ws.chats, threads: ws.threads, journal: ws.owlitPath("journal.jsonl"), aliases })
        if (cited.length) return { recording: true, ...answer, cited: cited.map(({ quote, page, chatId, chatTitle, at }) => ({ quote, ...(page ? { page } : {}), chatId, chatTitle, at })) }
      }
      return { recording: true, ...answer }
    })
    this.router.register("activity.setEnabled", z.object({ enabled: z.boolean() }), "admin", async ({ enabled }) => {
      const next = await this.settings.update((s) => ({ ...s, activity: { ...s.activity, enabled } }))
      this.notifier.notify("activity.status", next.activity)
      this.notifier.notify("settings.changed", settingsView(next, this.systemLanguages))
      return next.activity
    })

    registerSettings({
      router: this.router,
      settings: this.settings,
      http: this.http,
      openExternal: options.host?.openExternal,
      systemLanguages: this.systemLanguages,
      changed: (view) => {
        this.notifier.notify("settings.changed", view)
        void this.workspace?.members.ensure(view.profile).catch((error) => console.error("[core] couldn't update the workspace's members", error))
      },
    })

    const docs = () => this.requireWorkspace().docs
    const rel = z.string()
    this.router.register("docs.list", noParams, "read", () => docs().list())
    this.router.register("docs.read", z.object({ path: rel }), "read", ({ path }) => docs().read(path))
    // Any agent reads a PDF the user has in the workspace (an attachment, a file that isn't in the Library)
    // through owlit, with the page numbers it would cite; the Owlit engine has no other way to read one
    this.router.register("docs.readPdf", z.object({ path: rel, pages: z.string().optional() }), "read", async ({ path: file, pages }) => {
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
      z.object({ path: rel, content: z.string(), id: z.string().min(1).optional(), followsFirstLine: z.boolean().optional() }), "words",
      async ({ path, content, ...options }, caller) => {
        const made = await docs().create(path, content, options)
        await this.requireWorkspace().recorder.doc(caller, made.path, null, content, {}, { quiet: true })
        return made
      },
    )
    this.router.register(
      "docs.write",
      z.object({ path: rel, content: z.string(), expectedModifiedAt: z.number(), force: z.boolean().optional() }), "words",
      ({ path, content, expectedModifiedAt, force }) => docs().write(path, content, expectedModifiedAt, force),
    )
    this.router.register("docs.rename", z.object({ path: rel, name: z.string() }), "structure", ({ path, name }, caller) => this.movingDocs(path, caller, () => docs().rename(path, name)))
    this.router.register("docs.move", z.object({ path: rel, folder: z.string() }), "structure", ({ path, folder }, caller) => this.movingDocs(path, caller, () => docs().move(path, folder)))
    this.router.register("docs.delete", z.object({ path: rel }), "structure", async ({ path }, caller) => {
      const texts = await docs().textsUnder(path)
      await docs().delete(path)
      const writeId = newWriteId()
      for (const t of texts) await this.requireWorkspace().recorder.doc(caller, t.path, t.content, null, { origin: { writeId } }, { quiet: true })
      return null
    })
    this.router.register("docs.createFolder", z.object({ path: rel }), "structure", ({ path }) => docs().createFolder(path))
    this.router.register(
      "docs.restore",
      z.object({ files: z.array(z.object({ id: z.string(), path: rel, content: z.string() })), folders: z.array(rel) }), "structure",
      async ({ files, folders }, caller) => {
        const restored = await docs().restore(files, folders)
        const writeId = newWriteId()
        for (const [i, file] of restored.files.entries()) await this.requireWorkspace().recorder.doc(caller, file.path, null, files[i]!.content, { origin: { writeId } }, { quiet: true })
        return restored
      },
    )
    this.router.register("docs.open", z.object({ path: rel }), "admin", ({ path }) => docs().open(path))
    this.router.register("docs.owlit", z.object({ path: rel }), "read", ({ path }) => docs().owlitOf(path))
    // The user asks Owlit to go through some material (a meeting's transcript, reviews) against their docs
    this.router.register("docs.goThrough", z.object({ path: rel }), "own", async ({ path }) => {
      if (!MATERIAL.test(path)) throw new RpcFailure(RpcErrorCode.InvalidParams, t`Owlit goes through text: a Markdown or plain-text file.`)
      await docs().read(path)
      return this.requireWorkspace().tasks.enqueue(GO_THROUGH_RUN, path, "asked")
    })
    this.router.register("docs.setOwlitOut", z.object({ path: rel, out: z.boolean() }), "admin", async ({ path, out }) => {
      const state = await docs().setOwlitOut(path, out)
      this.notifier.notify("docs.owlit", { path, state })
      return state
    })
    this.router.register("docs.reveal", z.object({ path: rel }), "admin", ({ path }) => docs().reveal(path))

    const anchor = z.object({ quote: z.string(), prefix: z.string(), suffix: z.string() })
    const commentSchema = anchor.extend({
      id: z.string().min(1),
      entries: z.array(
        z.object({
          id: z.string().min(1),
          agent: z.string().optional(),
          text: z.string(),
          at: z.number(),
          editedAt: z.number().optional(),
          chatId: z.string().optional(),
        }),
      ),
      createdAt: z.number(),
      resolvedAt: z.number().optional(),
      dismissedAt: z.number().optional(),
      foldedAt: z.number().optional(),
      source: z.object({ path: z.string(), label: z.string() }).optional(),
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
    this.router.register("chats.list", noParams, "read", () => chats().list())
    this.router.register("chats.get", z.object({ id: chatId }), "read", ({ id }) => chats().get(id))
    this.router.register("chats.create", z.object({ chat: summary }), "admin", ({ chat }) => chats().create(chat))
    this.router.register("chats.update", z.object({ id: chatId, patch: summary.omit({ id: true, createdAt: true }).partial() }), "admin", ({ id, patch }) =>
      chats().update(id, patch),
    )
    this.router.register("chats.delete", z.object({ id: chatId }), "admin", ({ id }) => chats().delete(id))
    this.router.register("chats.appendMessage", z.object({ id: chatId, message }), "admin", ({ id, message }) =>
      chats().appendMessage(id, message),
    )
    this.router.register("chats.removeMessages", z.object({ id: chatId, messageIds: z.array(z.string()) }), "admin", ({ id, messageIds }) =>
      chats().removeMessages(id, messageIds),
    )
    this.router.register("chats.patchMessage", z.object({ id: chatId, message, final: z.boolean().optional() }), "admin", ({ id, message, final }) =>
      chats().patchMessage(id, message, final),
    )
    this.router.register("chats.restore", z.object({ id: chatId }), "admin", ({ id }) => chats().restore(id))
    this.router.register(
      "chats.attach",
      z.object({ chatId, path: z.string().min(1).optional(), name: z.string().optional(), mimeType: z.string().optional(), data: z.string().optional() }), "admin",
      (params) => attachFile(this.requireWorkspace(), params),
    )
    this.router.register("chats.detach", z.object({ chatId, path: z.string() }), "admin", ({ chatId, path }) => chats().removeFile(chatId, chatFile(path)))
    this.router.register("chats.openFile", z.object({ path: z.string() }), "admin", async ({ path: rel }) => {
      const ws = this.requireWorkspace()
      const host = this.options.host
      if (!host?.openPath) throw new RpcFailure(RpcErrorCode.InternalError, t`owlit can't open files in other apps here.`)
      const file = path.join(ws.root, ...chatFile(rel).split("/"))
      if (!existsSync(file)) throw new RpcFailure(RpcErrorCode.NotFound, t`owlit no longer has that file.`, { path: rel })
      await host.openPath(file)
      return null
    })

    this.router.register("agents.list", noParams, "read", () => this.agents.list())
    this.router.register("agents.check", z.object({ id: z.string() }), "read", ({ id }) => this.agents.check(id))
    this.router.register("agents.setUp", z.object({ id: z.string() }), "admin", ({ id }) => this.agents.setUp(id))
    this.router.register("agents.cancelSetUp", z.object({ id: z.string() }), "admin", ({ id }) => this.agents.cancelSetUp(id))
    this.router.register("agents.add", z.object({ name: z.string(), command: z.string() }), "admin", ({ name, command }) => this.agents.add(name, command))
    this.router.register("agents.remove", z.object({ id: z.string() }), "admin", ({ id }) => this.agents.remove(id))
    this.router.register("agents.signIn", z.object({ id: z.string(), methodId: z.string(), apiKey: z.string().optional() }), "admin", ({ id, methodId, apiKey }) => this.agents.signIn(id, methodId, apiKey))
    this.router.register("agents.signOut", z.object({ id: z.string(), methodId: z.string().optional() }), "admin", ({ id, methodId }) => this.agents.signOut(id, methodId))
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
      }), "admin",
      async (req) => {
        return { stopReason: await this.turns.prompt(req) }
      },
    )
    this.router.register("agents.deleteDocs", z.object({ paths: z.array(z.string().min(1)).min(1) }), { touches: "structure", target: ({ paths }) => this.fs.target(paths) }, async ({ paths }, caller) => ({ deleted: await this.fs.remove(paths, caller) }))
    this.router.register("agents.moveDoc", z.object({ path: z.string().min(1), to: z.string().min(1) }), { touches: "structure", target: ({ path: from, to }) => this.fs.target([from, to]) }, async ({ path: from, to }, caller) => ({ path: await this.fs.move(from, to, caller) }))
    // What a window says of itself: which docs it holds open (Owlit's writes to them go through it), its
    // answers to core's requests, its focus. Changing nothing, they pass the policy as reads, so a program
    // on the socket that said it held a doc open could take Owlit's writes and drop them: only a window
    // may say them.
    const windowOnly = (caller: Caller) => {
      if (caller.kind !== "window") throw new RpcFailure(RpcErrorCode.Forbidden, "Not done: only owlit's window says what it has open and answers its requests.")
    }
    this.router.register("ui.setOpenDocs", z.object({ clientId: z.string().min(1), paths: z.array(z.string()) }), "read", ({ clientId, paths }, caller) => {
      windowOnly(caller)
      return this.ui.setOpenDocs(clientId, paths)
    })
    this.router.register("ui.respond", z.object({ requestId: z.string(), result: z.unknown().optional(), error: z.string().optional() }), "read", ({ requestId, result, error }, caller) => {
      windowOnly(caller)
      return this.ui.respond(requestId, result, error)
    })
    this.router.register("ui.focus", z.object({ clientId: z.string().min(1) }), "read", ({ clientId }, caller) => {
      windowOnly(caller)
      return this.ui.focus(clientId)
    })
    this.router.register("ui.leave", z.object({ clientId: z.string().min(1) }), "read", ({ clientId }, caller) => {
      windowOnly(caller)
      return this.ui.leave(clientId)
    })
    const owlitUri = z.string().regex(/^owlit:\/\/[a-z]+\/.+/, "an owlit:// link")
    const asker = z.string().min(1).optional()
    this.router.register("ui.open", z.object({ uri: owlitUri, chatId: asker }), "read", (params) => this.ui.act("open", params))
    this.router.register("ui.jump", z.object({ uri: owlitUri, page: z.number().int().positive().optional(), quote: z.string().min(1).optional(), chatId: asker }), "read", (params) =>
      this.ui.act("jump", params),
    )
    this.router.register(
      "ui.mark",
      z.object({ uri: owlitUri, quote: z.string().min(1), color: z.enum(["yellow", "green", "blue", "pink"]).optional(), chatId: asker }), "own",
      (params) => this.ui.act("mark", params),
    )
    this.router.register("memory.list", noParams, "read", async () => {
      const memory = this.requireWorkspace().memory
      return { lines: await memory.list(), claudeNotes: await memory.claudeNotes() }
    })
    const memoryKind = z.enum(["work", "about"])
    this.router.register(
      "memory.write",
      z.object({ op: z.enum(["add", "replace", "remove"]), id: z.string().optional(), kind: memoryKind.optional(), text: z.string().optional(), chatId: z.string().optional() }),
      { touches: "own", target: ({ op, id }) => this.memoryTarget(op === "add" ? undefined : id) },
      async ({ op, id, kind, text }, caller) => {
        // Said to the agent, so plain English
        const need = (what: string) => {
          throw new RpcFailure(RpcErrorCode.InvalidParams, `memory_write with op "${op}" needs ${what}.`)
        }
        return this.requireWorkspace().memory.agentWrite(
          op === "add" ? { op, kind: kind ?? need("kind"), text: text ?? need("text") } : op === "replace" ? { op, id: id ?? need("id"), text: text ?? need("text"), ...(kind ? { kind } : {}) } : { op, id: id ?? need("id") },
          caller,
        )
      },
    )
    this.router.register(
      "memory.put",
      z.object({ id: z.string().optional(), kind: memoryKind, text: z.string(), at: z.number().optional(), chatId: z.string().optional() }),
      { touches: "own", target: ({ id }) => this.memoryTarget(id) },
      (input, caller) => this.requireWorkspace().memory.put(input, caller),
    )
    this.router.register("memory.remove", z.object({ id: z.string().min(1) }), { touches: "own", target: ({ id }) => this.memoryTarget(id) }, ({ id }, caller) => this.requireWorkspace().memory.remove(id, caller))
    this.router.register(
      "memory.decideClaudeNotes",
      z.object({ keep: z.array(z.object({ file: z.string().min(1), kind: memoryKind, text: z.string() })), drop: z.array(z.string().min(1)) }), "own",
      ({ keep, drop }, caller) => this.requireWorkspace().memory.decideClaudeNotes(keep, drop, caller),
    )
    this.router.register(
      "changes.undo",
      z.object({ id: z.string().min(1) }),
      { touches: "own", target: async ({ id }) => ({ what: "change", by: (await this.requireWorkspace().changes.get(id))?.actor }) },
      ({ id }, caller) => this.undo.undo(id, caller),
    )
    this.router.register("changes.stats", z.object({ ids: z.array(z.string().min(1)).min(1) }), "read", ({ ids }) => this.undo.stats(ids))
    const actor = z.custom<ActorId>((v) => typeof v === "string" && /^([po]_[0-9a-f]+|other)$/.test(v))
    this.router.register(
      "changes.list",
      z.object({
        target: z.object({ kind: z.enum(["doc", "comment", "paper", "thread", "memory"]), path: z.string(), part: z.string() }).partial().optional(),
        path: z.string().optional(),
        chatId: z.string().optional(),
        actor: actor.optional(),
        since: z.number().optional(),
      }), "read",
      (filter) => this.requireWorkspace().changes.list(filter),
    )
    this.router.register("members.get", noParams, "read", () => this.requireWorkspace().members.get())
    this.router.register("changes.unseen", z.object({ since: z.number().optional() }), "read", async ({ since }, caller) => {
      const ws = this.requireWorkspace()
      const me = await this.personAt(caller)
      const marks = await ws.seen.get(me, ["chats"])
      const [changes, chatList, runs, { papers }] = await Promise.all([ws.changes.list(), ws.chats.list(), ws.chats.runs(), ws.library.list()])
      const summaries = [...chatList, ...runs]
      // Only the chats that moved after the person's mark on them can have a reply they haven't seen
      const moved = summaries.filter((c) => (marks.chats[c.id]?.at ?? Infinity) < c.updatedAt)
      const chats = (await Promise.all(moved.map((c) => ws.chats.get(c.id).catch(() => null)))).filter((c) => c !== null)
      return ws.seen.unseen(me, { changes, chats, papers, since })
    })
    this.router.register("changes.since", z.object({ path: z.string().min(1), hash: z.string().min(1) }), "read", async ({ path: rel, hash }, caller) => {
      const ws = this.requireWorkspace()
      const me = await this.personAt(caller)
      const { content } = await ws.docs.read(rel)
      return docPassages(ws.changes, rel, hash, content, me)
    })
    this.router.register("changes.proposals", z.object({ path: rel, text: z.string(), hash: z.string().min(1).optional(), since: z.number().optional() }), "read", ({ path, text, hash, since }) =>
      docProposals(this.requireWorkspace().changes, path, text, { ...(hash !== undefined ? { hash } : {}), ...(since !== undefined ? { since } : {}) }),
    )
    const seenKind = z.enum(["docs", "threads", "chats", "comments", "digests"])
    this.router.register("seen.get", z.object({ kinds: z.array(seenKind).optional() }), "read", async ({ kinds }, caller) => this.requireWorkspace().seen.get(await this.personAt(caller), kinds))
    const at = { at: z.number().optional() }
    this.router.register(
      "seen.mark",
      z.union([
        z.object({ kind: z.literal("doc"), path: z.string().min(1), hash: z.string().min(1), ...at }),
        z.object({ kind: z.literal("thread"), id: z.string().min(1), items: z.array(z.string().min(1)), ...at }),
        z.object({ kind: z.literal("chat"), id: z.string().min(1), message: z.string().min(1), ...at }),
        z.object({ kind: z.literal("comments"), path: z.string().min(1), ...at }),
        z.object({ kind: z.literal("digest"), paper: z.string().min(1), ...at }),
      ]), "admin",
      async (mark, caller) => {
        const marks = await this.requireWorkspace().seen.mark(await this.personAt(caller), mark)
        this.notifier.notify("seen.changed", marks)
        return marks
      },
    )
    this.router.register("agents.cancel", z.object({ chatId }), "admin", ({ chatId }) => this.turns.cancel(chatId))
    this.router.register("agents.running", noParams, "read", () => this.turns.inFlight())
    this.router.register("agents.respondPermission", z.object({ chatId, requestId: z.string(), optionId: z.string() }), "admin", ({ chatId, requestId, optionId }) =>
      this.turns.respondPermission(chatId, requestId, optionId),
    )
    const answer = z.object({ picks: z.array(z.string()).optional(), text: z.string().optional() })
    this.router.register("agents.answerQuestion", z.object({ chatId, requestId: z.string(), answers: z.record(z.string(), answer).nullable() }), "admin", ({ chatId, requestId, answers }) =>
      this.turns.answerQuestion(chatId, requestId, answers),
    )

    const library = () => this.requireWorkspace().library
    this.router.register("library.resolve", z.object({ input: z.string().min(1) }), "read", ({ input }) => library().resolve(input))
    // A search's results are kept for hours, a thread's papers for good: an agent filling a column a day
    // later still gets the whole abstract
    this.router.register("library.found", z.object({ id: z.string().min(1) }), "read", async ({ id }) => (await library().snapshot(id)) ?? (await this.requireWorkspace().threads.paperOf(id)) ?? null)
    this.router.register("library.known", z.object({ inputs: z.array(z.string()) }), "read", ({ inputs }) => library().known(inputs))
    this.router.register("library.list", noParams, "read", () => library().list())
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
    // A paper added is the adder's own, whoever adds it (addedBy), until someone else touches it
    this.router.register(
      "library.add",
      z.object({ paper: resolved, chatId: z.string().optional() }), "own",
      async ({ paper }, caller) => {
        const ws = this.requireWorkspace()
        const { paper: added, existed } = await library().addNew(paper, await ws.recorder.actorOf(caller))
        // A paper the library had already isn't the adder's to take back
        if (!existed) await ws.recorder.record(caller, { action: "create", target: { kind: "paper", path: added.id } }, { label: added.title, quiet: caller.kind === "window" })
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
        view: z.enum(["digest", "pdf"]),
        digestPosition: z.object({ y: z.number() }),
        lastOpenedAt: z.number(),
      })
      .partial()
    // A paper's marks (star, status, tags) and where it was left are meta; its details are the person's words
    const DETAILS = new Set<keyof PaperPatch>(["title", "authors", "year", "venue", "abstract", "kind", "ids"])
    this.router.register(
      "library.update",
      z.object({ id: paperId, patch }),
      { touches: ({ patch }) => ((Object.keys(patch) as (keyof PaperPatch)[]).some((f) => DETAILS.has(f)) ? "words" : "meta") },
      ({ id, patch }, caller) => this.updatePaper(id, patch, caller),
    )
    // The reader opened a paper: its status follows on its own, the person's all the same (via auto)
    this.router.register("library.opened", z.object({ id: paperId }), "meta", async ({ id }, caller) => {
      const paper = await library().get(id)
      if (!paper) throw new RpcFailure(RpcErrorCode.NotFound, t`That paper isn't in the library.`)
      return this.updatePaper(id, { lastOpenedAt: Date.now(), ...(paper.status === "unread" ? { status: "reading" as const } : {}) }, caller, { via: "auto" })
    })
    this.router.register("library.remove", z.object({ ids: z.array(paperId) }), "structure", async ({ ids }, caller) => {
      const ws = this.requireWorkspace()
      const titles = new Map(await Promise.all(ids.map(async (id) => [id, (await ws.library.get(id))?.title] as const)))
      await library().remove(ids)
      const writeId = newWriteId()
      for (const [id, title] of titles) if (title !== undefined) await ws.recorder.record(caller, { action: "delete", target: { kind: "paper", path: id }, origin: { writeId } }, { label: title, quiet: true })
      return null
    })
    // An agent's own additions; each removal is a change the user can undo. The library's own check
    // (addedBy, and nothing of the user's on the paper) holds past the log's keep window too.
    this.router.register("library.removeByAgent", z.object({ ids: z.array(z.string()) }), { touches: "own", target: ({ ids }) => this.papersTarget(ids) }, async ({ ids }, caller) => {
      const ws = this.requireWorkspace()
      // Named as the user knows them, while they are still there to read
      const titles = new Map(await Promise.all(ids.map(async (id) => [id, (await ws.library.get(id))?.title ?? id] as const)))
      const done = await ws.library.removeByAgent(ids)
      const writeId = newWriteId()
      for (const id of done.removed) await ws.recorder.record(caller, { action: "delete", target: { kind: "paper", path: id }, origin: { writeId } }, { label: titles.get(id) ?? id })
      return done
    })
    this.router.register("library.restore", z.object({ ids: z.array(paperId) }), "structure", async ({ ids }, caller) => {
      const ws = this.requireWorkspace()
      const here = new Set((await Promise.all(ids.map(async (id) => ((await ws.library.get(id)) ? id : null)))).filter(Boolean))
      const restored = await library().restore(ids)
      const writeId = newWriteId()
      for (const p of restored) if (!here.has(p.id)) await ws.recorder.record(caller, { action: "create", target: { kind: "paper", path: p.id }, origin: { writeId } }, { label: p.title, quiet: true })
      return restored
    })
    this.router.register("library.trash", noParams, "read", () => library().trash())
    this.router.register("library.refresh", z.object({ id: paperId }), "meta", ({ id }) => library().refresh(id))
    const rect = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
    const highlight = z.object({
      id: z.string().min(1),
      paperId,
      page: z.number().int().nonnegative(),
      rects: z.array(rect.extend({ page: z.number().int().nonnegative() })),
      text: z.string(),
      color: z.enum(["yellow", "green", "blue", "pink"]),
      comment: z.string().optional(),
      createdAt: z.number(),
    })
    // A highlight's owner is whoever added it; one not there yet is the caller's to make
    const highlightTarget = async (paperId: string, id: string): Promise<Target> => {
      const was = (await library().highlights(paperId).catch(() => [] as Highlight[])).find((h) => h.id === id)
      return { what: "highlight", ...(was ? { by: was.addedBy, was } : {}) }
    }
    const HIGHLIGHT_PUT: Policy<"library.putHighlight"> = {
      touches: (_params, target, who) => (target.by === undefined || target.by === who.actor ? "own" : "words"),
      target: ({ highlight }) => highlightTarget(highlight.paperId, highlight.id),
    }
    this.router.register("library.putHighlight", z.object({ highlight, chatId: z.string().optional() }), HIGHLIGHT_PUT, async ({ highlight, chatId }, caller) => {
      const by: Caller = chatId ? { kind: "owlit", chatId } : caller
      return (await library().putHighlight(highlight, await this.requireWorkspace().recorder.actorOf(by))).highlight
    })
    this.router.register("library.removeHighlight", z.object({ paperId, id: z.string() }), { touches: "own", target: ({ paperId, id }) => highlightTarget(paperId, id) }, ({ paperId, id }) =>
      library().removeHighlight(paperId, id),
    )
    const search = () => this.requireWorkspace().search
    const query = z.object({ q: z.string() })
    this.router.register("search.palette", query, "read", ({ q }) => search().palette(q))
    this.router.register("search.papers", query.extend({ marked: z.boolean().optional() }), "read", ({ q, marked }) => search().papers(q, marked))
    this.router.register("search.status", noParams, "read", () => search().status())
    this.router.register("search.rebuild", noParams, "read", () => {
      search().rebuild()
      return null
    })
    this.router.register("links.to", z.object({ uri: z.string().min(1) }), "read", ({ uri }) => search().linksTo(uri))
    this.router.register("library.importPdf", z.object({ path: z.string().min(1) }), "own", async ({ path }, caller) => {
      const done = await library().importPdf(path)
      if (!done.existed) await this.requireWorkspace().recorder.record(caller, { action: "create", target: { kind: "paper", path: done.paper.id } }, { label: done.paper.title, quiet: true })
      return done
    })
    this.router.register("library.digest", z.object({ id: paperId }), "read", ({ id }) => library().digest(id))
    this.router.register("library.digestSource", z.object({ id: paperId }), "read", ({ id }) => library().digestSource(id))
    this.router.register("library.requestDigest", z.object({ id: paperId, rewrite: z.boolean().optional() }), "own", async ({ id, rewrite }) => {
      await library().wantDigest(id, "asked", { rewrite })
      return null
    })
    this.router.register("library.figures", z.object({ id: paperId }), "read", ({ id }) => library().figures(id))
    this.router.register("library.pagePicture", z.object({ id: paperId, page: z.number().int().min(0) }), "read", ({ id, page }) => library().pagePicture(id, page))
    this.router.register(
      "library.read",
      z.object({ id: paperId, part: z.enum(["text", "digest", "note"]), pages: z.string().optional(), section: z.string().optional(), asker: z.string().optional() }), "read",
      async ({ id, part, pages, section, asker }) => {
        const read = await library().read(id, part, { pages, section })
        // Only what was there to read counts as read
        if (asker && read.text.trim()) this.reads.record({ asker, paperId: id, part, ...(pages ? { pages } : {}), at: Date.now() })
        return read
      },
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
      }), "read",
      ({ q, by, ...options }) => library().searchOnline(q, options, by),
    )
    this.router.register(
      "library.related",
      z.object({ ref: z.string().min(1), kind: z.enum(["references", "cited_by", "similar"]), limit: z.number().int().positive().max(100).optional(), year, sort, by: z.string().optional() }), "read",
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
      }), "read",
      ({ journal, year, by, ...options }) => library().journal(journal, year, options, by),
    )
    this.router.register("library.highlights", z.object({ id: paperId }), "read", ({ id }) => library().highlights(id))
    this.router.register(
      "library.import",
      z.object({ source: z.enum(["zotero", "bibtex", "folder"]), path: z.string().min(1), collectionsAsTags: z.boolean().optional(), parse: z.boolean().optional() }), "own",
      ({ source, path, collectionsAsTags, parse }) => library().imports.start(source, path, { collectionsAsTags, parse }),
    )
    this.router.register("library.previewImport", z.object({ source: z.enum(["zotero", "bibtex", "folder"]), path: z.string().min(1) }), "read", ({ source, path }) =>
      library().imports.preview(source, path),
    )
    this.router.register("library.continueImport", z.object({ id: z.string().min(1) }), "own", ({ id }) => library().imports.continue(id))
    this.router.register("library.imports", noParams, "read", () => library().imports.list())
    this.router.register("library.findZotero", noParams, "read", () => library().imports.findZotero())
    this.router.register("library.importAnswer", z.object({ id: z.string().min(1), parse: z.boolean() }), "own", ({ id, parse }) => library().imports.answer(id, parse))
    this.router.register("library.dismissImport", z.object({ id: z.string().min(1) }), "own", async ({ id }) => {
      await library().imports.dismiss(id)
      return null
    })
    this.router.register("library.text", z.object({ id: paperId }), "read", ({ id }) => library().text(id))
    this.router.register("library.findPassage", z.object({ id: paperId, quote: z.string().min(1).max(4000) }), "read", async ({ id, quote }) => {
      const page = await this.requireWorkspace().findPassage(id, quote)
      return typeof page === "number" ? { page } : null
    })
    // What has been read of a paper, for its reader: what Owlit's answers cited of it, and where the person stayed
    this.router.register("library.wear", z.object({ id: paperId }), "read", async ({ id }) => {
      const ws = this.requireWorkspace()
      return wearOf(id, { chats: ws.chats, threads: ws.threads, journal: ws.owlitPath("journal.jsonl"), aliases: await ws.library.aliases() })
    })
    this.router.register("library.trace", z.object({ ids: z.array(paperId).max(500) }), "read", async ({ ids }) => {
      const ws = this.requireWorkspace()
      await this.journal.flush()
      const [aliases, entries] = await Promise.all([ws.library.aliases(), readJournal(ws.owlitPath("journal.jsonl")).catch(() => [])])
      const readings = readingOf(entries, (id) => aliases[id] ?? id)
      const out: Record<string, ReadTrace> = {}
      for (const id of ids) out[id] = traceOf(readings.get(aliases[id] ?? id), (await ws.library.get(id))?.status)
      return out
    })
    this.router.register("library.fetchPdf", z.object({ id: paperId }), "meta", ({ id }) => library().fetchPdf(id))
    this.router.register("library.attachPdf", z.object({ id: paperId, path: z.string().min(1) }), "meta", ({ id, path }) =>
      library().attachPdf(id, path),
    )
    this.router.register("library.setNote", z.object({ paperId, content: z.string() }), "words", async ({ paperId, content }, caller) => {
      const before = (await library().read(paperId, "note")).text
      const note = await library().setNote(paperId, content)
      await this.requireWorkspace().recorder.saved(caller, noteRelPath(paperId), before || null, content)
      return note
    })

    const tasks = () => this.requireWorkspace().tasks
    const taskId = z.string().min(1)
    this.router.register("tasks.list", noParams, "read", () => tasks().list())
    this.router.register("tasks.cancel", z.object({ id: taskId }), "admin", ({ id }) => tasks().cancel(id))
    this.router.register("tasks.resume", z.object({ id: taskId }), "admin", ({ id }) => tasks().resume(id))
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
        }), "admin",
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
    const item = z.string().regex(/^(title|memo:[\w-]+|cell:[^:]+:[\w-]+|row:[^:]+|group:[\w-]+:[\w-]+)$/, "an item: title, memo:<id>, cell:<paper>:<column>, row:<paper> or group:<column>:<id>")
    this.router.register("threads.list", noParams, "read", () => threads().list())
    this.router.register("threads.get", z.object({ id: z.string().min(1) }), "read", ({ id }) => threads().get(id))
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
        rows: z.array(z.object({ id: z.string().min(1), cells: z.record(z.string(), cellWrite).optional(), group: z.string().optional(), groups: z.array(z.string()).optional(), foundBy: z.string().optional() })).optional(),
        groups: z.array(group).optional(),
        grouping: z.string().optional(),
        newGrouping: z.string().optional(),
        removeRows: z.array(z.string()).optional(),
        why: z.string().optional(),
        note: z.string().optional(),
        chatId: z.string().optional(),
        run: z.string().optional(),
        docPath: z.string().optional(),
      }), "own",
      (params, caller) => threads().write(params, caller),
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
          z.object({ op: z.literal("place"), column: z.string().min(1), row: z.string().min(1), group: z.string().min(1), in: z.boolean() }),
          z.object({ op: z.literal("move"), column: z.string().min(1), row: z.string().min(1), group: z.string().nullable(), from: z.string().optional() }),
          z.object({ op: z.literal("unplace"), column: z.string().min(1), row: z.string().min(1), placed: z.record(z.string(), z.object({ in: z.boolean(), at: z.number() }).nullable()) }),
          z.object({ op: z.literal("unmerge"), column: z.string().min(1), group: z.string().min(1) }),
          z.object({ op: z.literal("ungroup"), column: z.string().min(1), group: z.string().min(1) }),
          z.object({ op: z.literal("merge"), column: z.string().min(1), group: z.string().min(1), into: z.string().min(1) }),
          z.object({ op: z.literal("hide"), column: z.string().min(1), hidden: z.boolean() }),
          z.object({ op: z.literal("project"), project: z.string() }),
          z.object({ op: z.literal("view"), groupBy: z.string().min(1) }),
        ]),
      }),
      // The thread's name and settings are its marks; a rewrite is the person's words; what removes, moves
      // or merges its parts is its structure
      {
        touches: ({ edit }) => (edit.op === "rename" || edit.op === "hide" || edit.op === "project" || edit.op === "view" ? "meta" : edit.op === "rewrite" ? "words" : "structure"),
      },
      ({ id, edit }, caller) => threads().edit(id, edit, caller),
    )
    this.router.register(
      "threads.split",
      z.object({ id: z.string().min(1), rows: z.array(z.string().min(1)).min(1), asked: z.string(), group: z.object({ column: z.string().min(1), id: z.string().min(1) }).optional(), chatId: z.string().optional() }), "structure",
      ({ id, rows, asked, group, chatId }, caller) => threads().split(id, rows, asked, group, caller, chatId),
    )
    this.router.register("threads.unsplit", z.object({ id: z.string().min(1), chatId: z.string().optional() }), "structure", ({ id, chatId }, caller) => threads().unsplit(id, caller, chatId))
    this.router.register("threads.about", z.object({ id: z.string().min(1) }), "read", ({ id }) => threads().about(id))
    this.router.register(
      "threads.gather",
      z.object({ question: z.string().min(1), project: z.string().optional(), size: z.enum(["few", "many"]) }), "own",
      (params, caller) => threads().gather(params, caller),
    )
    this.router.register("threads.run", z.object({ id: z.string().min(1), run: z.enum(["more", "read"]), what: z.string().optional() }), "own", ({ id, run, what }, caller) => threads().start(id, run, caller, what))
    this.router.register(
      "threads.compare",
      z.object({ id: z.string().min(1), doc: z.string().min(1), sentences: z.array(z.string().min(1)).min(1).max(20) }), "own",
      ({ id, doc, sentences }, caller) => threads().compare(id, doc, sentences, caller),
    )
    this.router.register("threads.fill", z.object({ id: z.string().min(1), column: z.string().min(1) }), "own", ({ id, column }) => threads().fill(id, column))
    this.router.register("threads.group", z.object({ id: z.string().min(1), question: z.string().min(1) }), "own", ({ id, question }, caller) => threads().group(id, question, caller))
    this.router.register("threads.ask", z.object({ id: z.string().min(1), question: z.string().min(1) }), "own", ({ id, question }, caller) => threads().ask(id, question, caller))
    this.router.register("threads.delete", z.object({ id: z.string().min(1) }), "structure", ({ id }, caller) => threads().delete(id, caller))
    this.router.register("threads.undelete", z.object({ id: z.string().min(1) }), "structure", ({ id }, caller) => threads().undelete(id, caller))
    this.router.register("comments.all", noParams, "read", () => docs().commentsAll())
    // A comment is whoever started it (its first entry); others: who replied under it
    // adding: a comment or reply made on the doc, which the user may have kept Owlit out of
    const commentTarget = async (path: string, id: string, { replies = false, adding = false } = {}): Promise<Target> => {
      const out = adding && (await docs().owlitOf(path)).out ? { out: true } : {}
      const was = (await docs().listComments(path)).find((c) => c.id === id)
      if (!was) return { what: "comment", ...out }
      const by = was.entries[0]?.by
      return { what: "comment", by, was, ...(replies ? { touchedBy: was.entries.slice(1).map((e) => e.by) } : {}), ...out }
    }
    const ownComment: Policy<"comments.dismiss"> = { touches: "own", target: ({ path, id }) => commentTarget(path, id) }
    const addComment: Policy<"comments.add"> = { touches: "own", target: ({ path, comment }) => commentTarget(path, comment.id, { adding: true }) }
    this.router.register("comments.add", z.object({ path: rel, comment: commentSchema }), addComment, async ({ path, comment }, caller) => {
      const agent = caller.kind !== "window"
      // Never over an existing comment (add replaces one with the same id)
      if ((await docs().listComments(path)).some((c) => c.id === comment.id)) throw new RpcFailure(RpcErrorCode.Conflict, agent ? "That comment is already there; an agent adds new ones." : t`That comment is already there.`)
      if (!agent) {
        const made = signed(comment, null, await this.requireWorkspace().recorder.actorOf(caller))
        await docs().addComment(path, made)
        this.notifier.notify("comments.changed", { path, comment: made })
        await this.recordComment(caller, path, null, made)
        return null
      }
      // Where a comment carries words from is core's to say (a Go through's record), never the agent's
      const { source: _claimed, ...own } = signed(comment, null, await this.requireWorkspace().recorder.actorOf(caller))
      // A Go through's comment waits for the record it points back to
      const run = caller.kind === "socket" || caller.kind === "owlit" ? caller.run : undefined
      if (isCommentingRun(run)) await this.reviews.comment(run!, path, own)
      else await this.agentComment(path, own, caller)
      return null
    })
    const COMMENT_PUT: Policy<"comments.put"> = {
      touches: ({ comment }, target, who) => commentTouches(comment, target, who),
      target: async ({ path, comment }) => {
        const target = await commentTarget(path, comment.id, { adding: true })
        // A reply alone is a new entry of the caller's, whoever started the comment
        if (target.was && replyOnly(comment, target.was as DocComment)) return { what: "reply", was: target.was, ...(target.out ? { out: true } : {}) }
        return target
      },
    }
    this.router.register("comments.put", z.object({ path: rel, comment: commentSchema }), COMMENT_PUT, async ({ path, comment: input }, caller) => {
      const was = (await docs().listComments(path)).find((c) => c.id === input.id) ?? null
      const comment = signed(input, was, await this.requireWorkspace().recorder.actorOf(caller))
      const before = await this.putComment(path, comment, caller)
      // A reply of the user's under one of Owlit's comments: Owlit answers it there
      const first = comment.entries[0]
      const last = comment.entries.at(-1)
      if (first && isOwlit(first.by) && last && isPerson(last.by) && !before?.entries.some((e) => e.id === last.id) && isOpenComment(comment)) {
        this.requireWorkspace().tasks.enqueue(REPLY_RUN, `${path}#${comment.id}`, "asked")
      }
      return before
    })
    // One of Owlit's comments the user doesn't want: put away for good
    this.router.register("comments.dismiss", z.object({ path: rel, id: z.string() }), ownComment, async ({ path, id }, caller) => {
      const comment = (await docs().listComments(path)).find((c) => c.id === id)
      if (!comment) throw new RpcFailure(RpcErrorCode.NotFound, t`That comment isn't there any more.`)
      if (!comment.entries[0] || !isOwlit(comment.entries[0].by)) throw new RpcFailure(RpcErrorCode.InvalidParams, "Only Owlit's comments are dismissed; yours are resolved or deleted.")
      const dismissed = { ...comment, dismissedAt: Date.now() }
      await this.putComment(path, dismissed, caller, {}, true)
      return dismissed
    })
    this.router.register("comments.remove", z.object({ path: rel, id: z.string() }), { touches: "own", target: ({ path, id }) => commentTarget(path, id, { replies: true }) }, async ({ path, id }, caller) => {
      const removed = await docs().removeComment(path, id)
      await this.recordComment(caller, path, removed, null)
      return removed
    })
    this.router.register("comments.reanchor", z.object({ path: rel, moved: z.record(z.string(), anchor) }), "words", ({ path, moved }) =>
      docs().reanchorComments(path, moved),
    )

    const shares = () => this.requireWorkspace().shares
    const permission = z.enum(["comment", "view"])
    this.router.register("share.list", noParams, "read", () => shares().list())
    this.router.register("share.create", z.object({ path: rel, notes: z.boolean() }), "admin", ({ path, notes }) => shares().create(path, notes))
    this.router.register("share.update", z.object({ path: rel, permission: permission.optional(), notes: z.boolean().optional() }), "admin", ({ path, ...change }) =>
      shares().update(path, change),
    )
    this.router.register("share.stop", z.object({ path: rel }), "admin", ({ path }) => shares().stop(path))
    this.router.register("share.comments", z.object({ path: rel }), "read", ({ path }) => shares().commentsOf(path))
    this.router.register("share.reply", z.object({ path: rel, parent: z.string().min(1), text: z.string().trim().min(1).max(4000) }), "admin", ({ path, parent, text }) =>
      shares().reply(path, parent, text),
    )
    this.router.register("share.resolve", z.object({ path: rel, id: z.string().min(1), resolved: z.boolean() }), "admin", ({ path, id, resolved }) =>
      shares().resolve(path, id, resolved),
    )
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
                agent: async (prompt, ctx, pictures) =>
                  this.runInBackground(root, ctx, { prompt, pictures, root, mcpServers: this.mcpServers(root), signal: ctx.signal, memory: await readMemory(root), ...(await this.backgroundAgent()) }),
                noteLanguage: async () => {
                  const settings = await this.settings.get()
                  const chosen = settings.library.digestLanguage
                  return chosen ? normalizeNoteLanguage(chosen) : defaultNoteLanguage(settings, this.systemLanguages)
                },
              },
              threads: {
                agent: async (prompt, ctx, allow, run) => {
                  // Without owlit's tools (no socket: it failed to open) the agent couldn't write the
                  // thread at all. The run's tools sign its searches and writes, so About can show
                  // them as one batch.
                  const mcpServers = this.mcpServers(root, undefined, run)
                  if (!mcpServers.length) throw new Error("owlit's tools aren't reachable.")
                  return this.runInBackground(root, ctx, { prompt, root, mcpServers, signal: ctx.signal, memory: await readMemory(root), ...(await this.backgroundAgent()), allow })
                },
                changed: (id, thread) => {
                  if (this.workspace?.root === root) this.notifier.notify("threads.changed", { id, thread })
                },
              },
              profile: async () => (await this.settings.get()).profile,
              changeAdded: (notification) => {
                if (this.workspace?.root === root) this.notifier.notify("changes.added", notification)
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

  // One of Owlit's comments, written as an agent's: recorded in the change log (Undo) and shown in the
  // session's result card
  // quiet: from a run Owlit made while the user was away, which says nothing when it lands (no toast);
  // the comment and its change are kept the same
  private async agentComment(path: string, comment: DocComment, caller: Caller) {
    const ws = this.requireWorkspace()
    await ws.docs.addComment(path, comment)
    this.notifier.notify("comments.changed", { path, comment })
    await ws.recorder.record(caller, { action: "create", target: { kind: "comment", path, part: comment.id }, after: comment }, { label: path.split("/").pop()!.replace(/\.md$/i, "") })
  }

  // A comment as it reads now, replacing the one with its id; recorded, and told to windows when the
  // change isn't the asking window's own (tell). The comment as it was.
  private async putComment(path: string, comment: DocComment, caller: Caller, origin: Partial<ChangeOrigin> = {}, tell = false) {
    const before = await this.requireWorkspace().docs.putComment(path, comment)
    if (tell) this.notifier.notify("comments.changed", { path, comment })
    await this.recordComment(caller, path, before, comment, origin)
    return before
  }

  // How a comment changed, one entry per comment or reply that did, sharing one writeId
  private async recordComment(caller: Caller, path: string, before: DocComment | null, after: DocComment | null, origin: Partial<ChangeOrigin> = {}) {
    const recorder = this.requireWorkspace().recorder
    const writeId = newWriteId()
    for (const { part, ...change } of commentChanges(before, after)) {
      await recorder.record(caller, { ...change, target: { kind: "comment", path, part }, origin: { ...origin, writeId } }, { quiet: true })
    }
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

  // The window renames or moves a doc or folder: each file under it recorded as leaving its old place and
  // arriving at the new one, sharing one writeId
  private async movingDocs(from: string, caller: Caller, move: () => Promise<{ path: string }>) {
    const ws = this.requireWorkspace()
    const texts = await ws.docs.textsUnder(from)
    const moved = await move()
    if (moved.path === from) return moved
    const writeId = newWriteId()
    for (const t of texts) {
      await ws.recorder.doc(caller, t.path, t.content, null, { origin: { writeId } }, { quiet: true })
      await ws.recorder.doc(caller, moved.path + t.path.slice(from.length), null, t.content, { origin: { writeId } }, { quiet: true })
    }
    return moved
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

  // Whose papers these are: who added them (a person's or an outside addition names the owner before an
  // Owlit's; every adder counts as having touched the batch, so papers of two Owlits aren't one's), and
  // whoever else changed one since it was added, from the log
  private async papersTarget(ids: string[]): Promise<Target> {
    const ws = this.requireWorkspace()
    const papers = (await Promise.all(ids.map((id) => ws.library.get(id)))).filter((p): p is Paper => p !== null)
    const changes = await ws.changes.list({ target: { kind: "paper" } })
    const adders = [...new Set(papers.map((p) => p.addedBy))]
    const touchedBy: ActorId[] = [...adders]
    for (const p of papers) {
      const added = changes.findLast((c) => c.target.path === p.id && c.action === "create")
      for (const c of changes) if (c.target.path === p.id && c.actor !== p.addedBy && (!added || c.at > added.at)) touchedBy.push(c.actor)
    }
    const theirs = papers.find((p) => !isOwlit(p.addedBy))
    const by = theirs?.addedBy ?? adders[0]
    return { what: theirs ? `paper ${theirs.id}` : "paper", ...(by ? { by } : {}), touchedBy }
  }

  // Whose a memory line is: whoever kept it, as the change log says, and whoever changed it since. A line
  // the log has no record of was written by hand in memory.md, the person's, unless it names the chat it
  // came from. No id: a line not there yet, the caller's to make.
  private async memoryTarget(id: string | undefined): Promise<Target> {
    if (!id) return { what: "memory line" }
    const ws = this.requireWorkspace()
    const line = (await ws.memory.list()).find((l) => l.id === id)
    if (!line) return { what: "memory line" }
    const changes = (await ws.changes.list({ target: { kind: "memory", part: id } })).reverse()
    const made = changes.findLast((c) => c.action === "create")
    const by = made?.actor ?? (line.chatId ? undefined : await ws.recorder.actorOf(WINDOW))
    const since = made ? changes.slice(changes.indexOf(made) + 1) : changes
    return { what: "memory line", ...(by ? { by } : {}), touchedBy: since.map((c) => c.actor) }
  }

  // A task's agent run, kept as a session: why it started, its steps as they come, and how it ended
  private async runInBackground(root: string, ctx: TaskContext, run: BackgroundRun): Promise<BackgroundResult> {
    const ws = this.workspace
    if (ws?.root !== root) throw new Error("The workspace closed.")
    const words = await runWords(ws, ctx.task)
    const session = await openRun(ws.chats, ctx.task, words, (chat) => {
      if (this.workspace === ws) this.notifier.notify("chats.run", { chat })
    })
    ctx.describe({ chatId: session.chatId })
    try {
      const result = await this.background.run({ ...run, onUpdate: session.update })
      await session.finish({ status: "done", connectorId: result.connectorId, model: result.model })
      return result
    } catch (error) {
      const failed = ctx.signal.aborted ? {} : { error: messageOf(error), ...(error instanceof BackgroundFailure && error.detail ? { errorDetail: error.detail } : {}) }
      await session.finish({ status: ctx.signal.aborted ? "cancelled" : "error", ...failed }).catch(() => undefined)
      throw error
    }
  }

  async dispose() {
    this.started = false
    await this.updates.dispose()
    await this.switching
    if (this.workspace) await this.stopWorkspace(this.workspace, "closed")
    this.workspace = null
    // After the workspace's background tasks: a run cut off by its agent closing would count as a failed
    // try, where one stopped by closing stays running, to run again next time
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
      ["background tasks", () => ws.tasks.dispose()],
      // After the tasks, whose runs may still add to what waits
      ["Owlit's waiting comments", () => this.reviews.stop()],
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

  // The agent (and its model) chosen for background work in Settings
  private async backgroundAgent() {
    const { connectors } = await this.settings.get()
    return { connectorId: connectors.background, models: connectors.backgroundModels }
  }

  // owlit-mcp for an agent session in this workspace (for one chat, or a run in the background). The
  // secret in OWLIT_SESSION is what names the chat or run to core at auth (rpc/socket.ts); --chat and
  // --run only tell owlit-mcp what to sign its searches and comments with.
  mcpServers(root: string, chatId?: string, run?: string) {
    const mcp = this.options.mcp
    if (!mcp || this.socket?.root !== root) return []
    const session = this.socket.grant({ ...(chatId ? { chatId } : {}), ...(run ? { run } : {}) })
    return [
      {
        name: "owlit",
        command: mcp.command,
        args: [...mcp.args, "--workspace", root, ...(chatId ? ["--chat", chatId] : []), ...(run ? ["--run", run] : [])],
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
    return [...workspace.library.tasks(), ...workspace.search.tasks(), ...workspace.threads.tasks(), ...this.reviews.tasks(), ...(this.options.debug ? this.debugTasks.definitions : [])]
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


// The card's icon for a change the policy asks about, from what the method does

const toInfo = (folder: string): WorkspaceInfo => ({ path: folder, name: folder.slice(folder.lastIndexOf("/") + 1) })
