import { t } from "@lingui/core/macro"
import { chatOfFile, isOpenComment, isOwlit, isPerson, owlitOf, normalizeNoteLanguage, ROLES, RpcErrorCode, type ActivityAnswer, type ActorId, type BuildInfo, type ChangeOrigin, type ChatMessage, type ConsentAction, type DocComment, type CoreVersion, type Paper, type PaperPatch, type PersonId, type PromptInput, type ReadTrace, type Role, type RpcNotification, type RpcRequest, type RpcResponse, type WorkspaceInfo, type WorkspaceState } from "@owlit/protocol"
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { ActivityBus, activityEvent, activityQuery, answerActivity, Journal, readJournal, readingOf, traceOf } from "./activity/index.ts"
import { Agents } from "./agents/agents.ts"
import { hasProxyEnv, systemProxyEnv } from "./agents/proxy.ts"
import { AgentFs } from "./agents/fs.ts"
import { Undo } from "./changes/undo.ts"
import { docPassages } from "./changes/passages.ts"
import { Turns } from "./agents/turns.ts"
import { Updates } from "./updates/updates.ts"
import { UiBridge } from "./ui/bridge.ts"
import type { Host } from "./host.ts"
import { noParams, Notifier, Router, RpcFailure, WINDOW, type Caller } from "./rpc/index.ts"
import { newWriteId } from "./changes/record.ts"
import { commentChanges, signed } from "./docs/comments.ts"
import { readMemory } from "./memory/memory.ts"
import { SocketServer } from "./rpc/socket.ts"
import { ExtensionServer, type ExtensionServerOptions } from "./extension/server.ts"
import { AGENT_RULES } from "./agents/rules.ts"
import { guide } from "./agents/guide.ts"
import { Background, BackgroundFailure, type BackgroundResult, type BackgroundRun } from "./agents/background.ts"
import { openRun, runWords } from "./agents/runs.ts"
import { Initiative } from "./initiative/initiative.ts"
import { exportArchive } from "./initiative/archive.ts"
import { isCommentingRun, Reviews } from "./initiative/reviews.ts"
import { becameReadInFull } from "./initiative/reads.ts"
import { GO_THROUGH_RUN, RECHECK_RUN, REPLY_RUN } from "./initiative/runs.ts"
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
  // Where this build came from (the desktop app's build label); unset is a dev build
  build?: Omit<BuildInfo, "version">
  // The CHANGELOG.md the app ships, for what's new after an update
  changelog?: string
}

// The backend as one object. It speaks only JSON-RPC: handle() takes a request, onNotify() hears
// notifications. Constructing it touches nothing outside; start() is when it begins to talk.
// Runs Owlit starts on its own, which step aside while the user waits on a chat's answer
const OWN_RUNS = new Set<string>([RECHECK_RUN, "threads.reread"])

export class Core {
  readonly settings: SettingsStore
  readonly activity = new ActivityBus()
  readonly agents: Agents
  private turns: Turns
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
  // Owlit's rules, and the hour that wakes them
  private readonly initiative: Initiative
  private readonly hourly: ReturnType<typeof setInterval>
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
      lateReply: (chatId, message) => this.notifier.notify("chat.lateReply", { chatId, message }),
      lateQuietMs: options.lateQuietMs,
      mcpServers: (root, chatId) => this.mcpServers(root, chatId),
      userName: async () => (await this.settings.get()).profile.name,
      memory: async () => (await this.workspace?.memory.list()) ?? [],
    })
    this.background = new Background(this.agents)
    this.updates = new Updates({
      build: { version: this.version().version, channel: options.build?.channel ?? "dev", commit: options.build?.commit },
      userDataDir: options.userDataDir,
      updater: options.host?.updater,
      changelog: options.changelog,
      onboarded: async () => (await this.settings.get()).onboardedAt !== undefined,
      answering: () => this.turns.answering(),
      notify: (view) => this.notifier.notify("updates.changed", view),
    })
    // What Owlit does without being asked is decided by its rules (initiative/rules.ts), which hear what
    // the user does and what core sees, and the clock
    this.initiative = new Initiative({ workspace: () => this.workspace, record: (entry) => this.journal.evaluation(entry), trace: (entry) => this.journal.trace(entry) })
    this.activity.subscribe((event) => this.initiative.observe(event))
    // The person's last activity is kept in their seen marks, so the next start knows since when they
    // were away; coming back is told to the windows (Home's Since you left)
    const presence = this.initiative.presence
    presence.heard = (at, left) => {
      const ws = this.workspace
      if (!ws) return
      void this.personAt(WINDOW)
        .then((me) => ws.seen.here(me, at, left))
        .catch((error) => console.error("[core] couldn't keep when the person was last here", error))
    }
    presence.cameBack = (away) => this.notifier.notify("presence.away", away)
    this.hourly = setInterval(() => this.workspace && this.initiative.observe({ kind: "clock.hour", at: Date.now() }), 3_600_000)
    this.hourly.unref?.()
    // Owlit's reviews of the user's docs, and the comments they hold while the user writes
    this.reviews = new Reviews({
      workspace: () => this.workspace,
      presence: this.initiative.presence,
      agent: async (prompt, ctx, tools, runId) => {
        const root = this.requireWorkspace().root
        const mcpServers = this.mcpServers(root, undefined, runId)
        if (!mcpServers.length) throw new Error("owlit's tools aren't reachable.")
        return this.runInBackground(root, ctx, { prompt, root, mcpServers, signal: ctx.signal, memory: await readMemory(root), ...(await this.backgroundAgent()), allow: tools })
      },
      write: (path, comment, run, quiet) => this.agentComment(path, comment, { kind: "owlit", run }, quiet),
      put: async (path, comment, run, auto) => {
        await this.putComment(path, comment, { kind: "owlit", run }, auto ? { via: "auto" } : {}, true)
      },
      looked: (path, state) => this.notifier.notify("docs.owlit", { path, state }),
      writeRecord: (path, content, run) => this.fs.write(path, content, { run }),
      record: (entry) => this.journal.evaluation(entry),
      userName: async () => (await this.settings.get()).profile.name ?? undefined,
    })
    // After presence has heard it (the bus calls kind listeners before catch-all ones, so this is one too)
    this.activity.subscribe((event) => {
      if (event.kind === "doc.closed" || event.kind === "doc.opened" || event.kind === "idle") void this.reviews.land()
    })
    // A visit to a paper ended: if it made the paper read in full, its status becomes Read (never down
    // from what the person set: Read is the top) and the rules hear it, once it is on disk
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
          this.initiative.observe({ kind: "paper.read", at: Date.now(), paperId: event.paperId })
        })
        .catch((error) => console.error("[core] couldn't tell whether a paper was read in full", error))
    })

    // Written where the user says, outside the workspace: handing it out is theirs to do
    this.router.register("archive.export", z.object({ to: z.string().min(1), since: z.number().nonnegative().optional() }), async ({ to, since }) => {
      const ws = this.requireWorkspace()
      await Promise.all([this.journal.flush(), ws.tasks.flush()])
      return exportArchive({
        root: ws.root,
        journal: ws.owlitPath("journal.jsonl"),
        tasksLog: path.join(ws.dataDir, "tasks", "log.jsonl"),
        changes: (await ws.changes.list({ target: { kind: "doc" } })).filter((c) => isOwlit(c.actor)).reverse(),
        owlit: owlitOf(await this.personAt(WINDOW)),
        to: path.resolve(ws.root, to),
        since,
        recording: (await this.settings.get()).activity.enabled,
        version: this.version().version,
        now: Date.now(),
      }).catch((error) => {
        throw new RpcFailure(RpcErrorCode.InvalidParams, messageOf(error))
      })
    })

    this.router.register("core.ping", noParams, () => ({ ok: true as const }))
    // What agents are told about owlit (owlit-mcp's instructions)
    this.router.register("agents.rules", noParams, () => AGENT_RULES)
    this.router.register("agents.guide", z.object({ topic: z.string().optional() }), ({ topic }) => guide(topic))
    this.router.register("core.version", noParams, () => this.version())
    this.router.register("core.diagnostics", noParams, () => this.diagnostics())
    this.router.register("extension.get", noParams, async () => (await this.extension?.view()) ?? { serving: false, portTaken: false, paired: [], asking: [], waits: [] })
    this.router.register("extension.answer", z.object({ id: z.string().min(1), allow: z.boolean() }), async ({ id, allow }) => {
      await this.extension?.pairings.answer(id, allow)
      return null
    })
    this.router.register("extension.open", z.object({ kind: z.enum(["sign-in", "check", "permission"]), host: z.string().min(1).max(253) }), async ({ kind, host }) => {
      if (!this.extension) throw new RpcFailure(RpcErrorCode.Unavailable, t`The browser extension needs the owlit desktop app.`)
      return this.extension.open(kind, host)
    })
    this.router.register("extension.forget", z.object({ id: z.string().min(1) }), async ({ id }) => {
      if (!this.extension) throw new RpcFailure(RpcErrorCode.Unavailable, t`The browser extension needs the owlit desktop app.`)
      await this.extension.pairings.forget(id)
      return this.extension.view()
    })
    this.router.register("updates.get", noParams, () => this.updates.view())
    this.router.register("updates.check", noParams, () => this.updates.check())
    this.router.register("updates.setAuto", z.object({ auto: z.boolean() }), ({ auto }) => this.updates.setAuto(auto))
    this.router.register("updates.seen", noParams, () => this.updates.seen())
    this.router.register("updates.restart", z.object({ force: z.boolean().optional() }), ({ force }) => this.updates.restart(force ?? false))

    this.router.register("workspace.current", noParams, () => this.workspace?.info ?? null)
    this.router.register("workspace.open", z.object({ path: z.string().min(1) }), ({ path }) => this.openWorkspace(path))
    this.router.register("workspace.recent", noParams, async () => {
      const { recentWorkspaces } = await this.settings.get()
      return recentWorkspaces.filter((p) => !isMissing(p)).map(toInfo)
    })
    this.router.register("workspace.state", noParams, () => this.state())
    this.router.register("workspace.welcome", noParams, async () => {
      const { recentWorkspaces } = await this.settings.get()
      return { recent: recentWorkspaces.map((p) => ({ ...toInfo(p), missing: isMissing(p) })), suggestion: suggestFolder() }
    })
    this.router.register("workspace.create", z.object({ parent: z.string().min(1), name: z.string() }), async ({ parent, name }) =>
      this.openWorkspace(await createFolder(parent, name)),
    )
    this.router.register("workspace.createExample", noParams, async () => {
      const source = this.options.exampleDir
      if (!source || !existsSync(source)) throw new RpcFailure(RpcErrorCode.NotFound, t`This copy of owlit has no example workspace.`)
      return this.openWorkspace(await copyExample(source, suggestFolder().parent, (await this.settings.get()).profile.id!))
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

    // Turned off, the journal keeps nothing (see Journal), but Owlit's rules still hear what the user opens
    this.router.register("activity.emit", z.object({ event: activityEvent }), async ({ event }) => {
      await this.settings.get()
      if (this.workspace) this.activity.publish(event)
      return null
    })
    this.router.register("activity.status", noParams, async () => (await this.settings.get()).activity)
    // What the user did lately, for an agent: nothing at all while recording is turned off
    this.router.register("activity.query", z.object({ query: activityQuery }), async ({ query }): Promise<ActivityAnswer> => {
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
      openExternal: options.host?.openExternal,
      systemLanguages: this.systemLanguages,
      changed: (view) => {
        this.notifier.notify("settings.changed", view)
        void this.workspace?.members.ensure(view.profile).catch((error) => console.error("[core] couldn't update the workspace's members", error))
      },
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
      async ({ path, content, ...options }, caller) => {
        const made = await docs().create(path, content, options)
        await this.requireWorkspace().recorder.doc(caller, made.path, null, content, {}, { quiet: true })
        return made
      },
    )
    this.router.register(
      "docs.write",
      z.object({ path: rel, content: z.string(), expectedModifiedAt: z.number(), force: z.boolean().optional() }),
      ({ path, content, expectedModifiedAt, force }) => docs().write(path, content, expectedModifiedAt, force),
    )
    this.router.register("docs.rename", z.object({ path: rel, name: z.string() }), ({ path, name }, caller) => this.movingDocs(path, caller, () => docs().rename(path, name)))
    this.router.register("docs.move", z.object({ path: rel, folder: z.string() }), ({ path, folder }, caller) => this.movingDocs(path, caller, () => docs().move(path, folder)))
    this.router.register("docs.delete", z.object({ path: rel }), async ({ path }, caller) => {
      const texts = await docs().textsUnder(path)
      await docs().delete(path)
      const writeId = newWriteId()
      for (const t of texts) await this.requireWorkspace().recorder.doc(caller, t.path, t.content, null, { origin: { writeId } }, { quiet: true })
      return null
    })
    this.router.register("docs.createFolder", z.object({ path: rel }), ({ path }) => docs().createFolder(path))
    this.router.register(
      "docs.restore",
      z.object({ files: z.array(z.object({ id: z.string(), path: rel, content: z.string() })), folders: z.array(rel) }),
      async ({ files, folders }, caller) => {
        const restored = await docs().restore(files, folders)
        const writeId = newWriteId()
        for (const [i, file] of restored.files.entries()) await this.requireWorkspace().recorder.doc(caller, file.path, null, files[i]!.content, { origin: { writeId } }, { quiet: true })
        return restored
      },
    )
    this.router.register("docs.open", z.object({ path: rel }), ({ path }) => docs().open(path))
    this.router.register("docs.owlit", z.object({ path: rel }), ({ path }) => docs().owlitOf(path))
    // The user asks Owlit to go through some material (a meeting's transcript, reviews) against their docs
    this.router.register("docs.goThrough", z.object({ path: rel }), async ({ path }) => {
      if (!MATERIAL.test(path)) throw new RpcFailure(RpcErrorCode.InvalidParams, t`Owlit goes through text: a Markdown or plain-text file.`)
      await docs().read(path)
      return this.requireWorkspace().tasks.enqueue(GO_THROUGH_RUN, path, "asked")
    })
    this.router.register("docs.setOwlitOut", z.object({ path: rel, out: z.boolean() }), async ({ path, out }) => {
      const state = await docs().setOwlitOut(path, out)
      this.notifier.notify("docs.owlit", { path, state })
      return state
    })
    this.router.register("docs.reveal", z.object({ path: rel }), ({ path }) => docs().reveal(path))

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
    this.router.register("chats.list", noParams, () => chats().list())
    this.router.register("chats.get", z.object({ id: chatId }), ({ id }) => chats().get(id))
    this.router.register("chats.runs", z.object({ since: z.number().nonnegative() }), ({ since }) => chats().runsSince(since))
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
      async (req) => {
        // The user is waiting on this answer: a run Owlit started on its own steps aside and runs again
        // a minute later, so the chat isn't slowed or charged for it meanwhile
        this.workspace?.tasks.yieldTo("agent", (task) => OWN_RUNS.has(task.kind), 60_000)
        return { stopReason: await this.turns.prompt(req) }
      },
    )
    this.router.register(
      "agents.consent",
      z.object({ chatId, action: z.enum(["delete", "move", "add_paper"]), title: z.string().min(1) }),
      ({ chatId, action, title }) => this.turns.consent(chatId, action, title),
    )
    this.router.register("agents.deleteDocs", z.object({ paths: z.array(z.string().min(1)).min(1), chatId: chatId.optional() }), async ({ paths, chatId }, caller) => {
      await this.consented(chatId, "delete", `Delete ${paths.map(nameOf).join(", ")}`)
      return { deleted: await this.fs.remove(paths, caller) }
    })
    this.router.register("agents.moveDoc", z.object({ path: z.string().min(1), to: z.string().min(1), chatId: chatId.optional() }), async ({ path: from, to, chatId }, caller) => {
      await this.consented(chatId, "move", `Move ${nameOf(from)} to ${to}`)
      return { path: await this.fs.move(from, to, caller) }
    })
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
      (input, caller) => this.requireWorkspace().memory.put(input, caller),
    )
    this.router.register("memory.remove", z.object({ id: z.string().min(1) }), ({ id }, caller) => this.requireWorkspace().memory.remove(id, caller))
    this.router.register(
      "memory.decideClaudeNotes",
      z.object({ keep: z.array(z.object({ file: z.string().min(1), kind: memoryKind, text: z.string() })), drop: z.array(z.string().min(1)) }),
      ({ keep, drop }, caller) => this.requireWorkspace().memory.decideClaudeNotes(keep, drop, caller),
    )
    this.router.register("changes.undo", z.object({ id: z.string().min(1) }), ({ id }, caller) => this.undo.undo(id, caller))
    this.router.register("changes.stats", z.object({ ids: z.array(z.string().min(1)).min(1) }), ({ ids }) => this.undo.stats(ids))
    const actor = z.custom<ActorId>((v) => typeof v === "string" && /^([po]_[0-9a-f]+|other)$/.test(v))
    this.router.register(
      "changes.list",
      z.object({
        target: z.object({ kind: z.enum(["doc", "comment", "paper", "thread", "memory"]), path: z.string(), part: z.string() }).partial().optional(),
        path: z.string().optional(),
        chatId: z.string().optional(),
        actor: actor.optional(),
        since: z.number().optional(),
      }),
      (filter) => this.requireWorkspace().changes.list(filter),
    )
    this.router.register("members.get", noParams, () => this.requireWorkspace().members.get())
    this.router.register("changes.unseen", z.object({ since: z.number().optional() }), async ({ since }, caller) => {
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
    this.router.register("changes.since", z.object({ path: z.string().min(1), hash: z.string().min(1) }), async ({ path: rel, hash }, caller) => {
      const ws = this.requireWorkspace()
      const me = await this.personAt(caller)
      const { content } = await ws.docs.read(rel)
      return docPassages(ws.changes, rel, hash, content, me)
    })
    const seenKind = z.enum(["docs", "threads", "chats", "comments", "digests"])
    this.router.register("seen.get", z.object({ kinds: z.array(seenKind).optional() }), async ({ kinds }, caller) => this.requireWorkspace().seen.get(await this.personAt(caller), kinds))
    const at = { at: z.number().optional() }
    this.router.register(
      "seen.mark",
      z.union([
        z.object({ kind: z.literal("doc"), path: z.string().min(1), hash: z.string().min(1), ...at }),
        z.object({ kind: z.literal("thread"), id: z.string().min(1), items: z.array(z.string().min(1)), ...at }),
        z.object({ kind: z.literal("chat"), id: z.string().min(1), message: z.string().min(1), ...at }),
        z.object({ kind: z.literal("comments"), path: z.string().min(1), ...at }),
        z.object({ kind: z.literal("digest"), paper: z.string().min(1), ...at }),
      ]),
      async (mark, caller) => {
        const marks = await this.requireWorkspace().seen.mark(await this.personAt(caller), mark)
        this.notifier.notify("seen.changed", marks)
        return marks
      },
    )
    // When the person was away is theirs, like what they have seen: the window asks, no program on the socket
    this.router.register("presence.away", noParams, (_params, caller) => {
      if (caller.kind !== "window") throw new RpcFailure(RpcErrorCode.Forbidden, "Only owlit's window asks when the person was away.")
      return this.initiative.presence.lastAway
    })
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
      z.object({ paper: resolved, chatId: z.string().optional() }),
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
    this.router.register("library.update", z.object({ id: paperId, patch }), ({ id, patch }, caller) => this.updatePaper(id, patch, caller))
    // The reader opened a paper: its status follows on its own, the person's all the same (via auto)
    this.router.register("library.opened", z.object({ id: paperId }), async ({ id }, caller) => {
      const paper = await library().get(id)
      if (!paper) throw new RpcFailure(RpcErrorCode.NotFound, t`That paper isn't in the library.`)
      return this.updatePaper(id, { lastOpenedAt: Date.now(), ...(paper.status === "unread" ? { status: "reading" as const } : {}) }, caller, { via: "auto" })
    })
    this.router.register("library.remove", z.object({ ids: z.array(paperId) }), async ({ ids }, caller) => {
      const ws = this.requireWorkspace()
      const titles = new Map(await Promise.all(ids.map(async (id) => [id, (await ws.library.get(id))?.title] as const)))
      await library().remove(ids)
      const writeId = newWriteId()
      for (const [id, title] of titles) if (title !== undefined) await ws.recorder.record(caller, { action: "delete", target: { kind: "paper", path: id }, origin: { writeId } }, { label: title, quiet: true })
      return null
    })
    // An agent's own additions, from the chat that added them; each removal is a change the user can undo
    this.router.register("library.removeByAgent", z.object({ ids: z.array(z.string()), chatId: z.string().optional() }), async ({ ids, chatId }, caller) => {
      // Changing the library either way: the role that may add may take back
      await this.consented(chatId, "add_paper", ids.length === 1 ? `Remove ${ids[0]} from the Library` : `Remove ${ids.length} papers from the Library`)
      const ws = this.requireWorkspace()
      const mine: string[] = []
      const refused: { id: string; why: string }[] = []
      const additions = chatId ? await ws.changes.list({ target: { kind: "paper" } }) : []
      for (const id of ids) {
        // Another chat's addition is that chat's to take back; past the log's keep window, the paper's own
        // addedBy (library.removeByAgent) still keeps the user's papers out of reach
        const added = additions.find((c) => c.target.path === id && c.action === "create" && isOwlit(c.actor))
        if (chatId && added && added.origin.chatId !== chatId) refused.push({ id, why: "another chat added it; ask the user" })
        else mine.push(id)
      }
      // Named as the user knows them, while they are still there to read
      const titles = new Map(await Promise.all(mine.map(async (id) => [id, (await ws.library.get(id))?.title ?? id] as const)))
      const done = await ws.library.removeByAgent(mine)
      const writeId = newWriteId()
      for (const id of done.removed) await ws.recorder.record(caller, { action: "delete", target: { kind: "paper", path: id }, origin: { writeId } }, { label: titles.get(id) ?? id })
      return { removed: done.removed, refused: [...refused, ...done.refused] }
    })
    this.router.register("library.restore", z.object({ ids: z.array(paperId) }), async ({ ids }, caller) => {
      const ws = this.requireWorkspace()
      const here = new Set((await Promise.all(ids.map(async (id) => ((await ws.library.get(id)) ? id : null)))).filter(Boolean))
      const restored = await library().restore(ids)
      const writeId = newWriteId()
      for (const p of restored) if (!here.has(p.id)) await ws.recorder.record(caller, { action: "create", target: { kind: "paper", path: p.id }, origin: { writeId } }, { label: p.title, quiet: true })
      return restored
    })
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
      createdAt: z.number(),
    })
    this.router.register("library.putHighlight", z.object({ highlight, chatId: z.string().optional() }), async ({ highlight, chatId }, caller) => {
      const by: Caller = chatId ? { kind: "owlit", chatId } : caller
      return (await library().putHighlight(highlight, await this.requireWorkspace().recorder.actorOf(by))).highlight
    })
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
    this.router.register("library.importPdf", z.object({ path: z.string().min(1) }), async ({ path }, caller) => {
      const done = await library().importPdf(path)
      if (!done.existed) await this.requireWorkspace().recorder.record(caller, { action: "create", target: { kind: "paper", path: done.paper.id } }, { label: done.paper.title, quiet: true })
      return done
    })
    this.router.register("library.digest", z.object({ id: paperId }), ({ id }) => library().digest(id))
    this.router.register("library.digestSource", z.object({ id: paperId }), ({ id }) => library().digestSource(id))
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
    this.router.register("library.findPassage", z.object({ id: paperId, quote: z.string().min(1).max(4000) }), async ({ id, quote }) => {
      const page = await this.requireWorkspace().findPassage(id, quote)
      return typeof page === "number" ? { page } : null
    })
    // What has been read of a paper, for its reader: what Owlit's answers cited of it, and where the person stayed
    this.router.register("library.wear", z.object({ id: paperId }), async ({ id }) => {
      const ws = this.requireWorkspace()
      return wearOf(id, { chats: ws.chats, threads: ws.threads, journal: ws.owlitPath("journal.jsonl"), aliases: await ws.library.aliases() })
    })
    this.router.register("library.trace", z.object({ ids: z.array(paperId).max(500) }), async ({ ids }) => {
      const ws = this.requireWorkspace()
      await this.journal.flush()
      const [aliases, entries] = await Promise.all([ws.library.aliases(), readJournal(ws.owlitPath("journal.jsonl")).catch(() => [])])
      const readings = readingOf(entries, (id) => aliases[id] ?? id)
      const out: Record<string, ReadTrace> = {}
      for (const id of ids) out[id] = traceOf(readings.get(aliases[id] ?? id), (await ws.library.get(id))?.status)
      return out
    })
    this.router.register("library.fetchPdf", z.object({ id: paperId }), ({ id }) => library().fetchPdf(id))
    this.router.register("library.attachPdf", z.object({ id: paperId, path: z.string().min(1) }), ({ id, path }) =>
      library().attachPdf(id, path),
    )
    this.router.register("library.setNote", z.object({ paperId, content: z.string() }), async ({ paperId, content }, caller) => {
      const before = (await library().read(paperId, "note")).text
      const note = await library().setNote(paperId, content)
      await this.requireWorkspace().recorder.saved(caller, noteRelPath(paperId), before || null, content)
      return note
    })

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
      }),
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
          z.object({ op: z.literal("watch"), on: z.boolean() }),
          z.object({ op: z.literal("hide"), column: z.string().min(1), hidden: z.boolean() }),
          z.object({ op: z.literal("project"), project: z.string() }),
          z.object({ op: z.literal("view"), groupBy: z.string().min(1) }),
        ]),
      }),
      ({ id, edit }, caller) => threads().edit(id, edit, caller),
    )
    this.router.register(
      "threads.split",
      z.object({ id: z.string().min(1), rows: z.array(z.string().min(1)).min(1), asked: z.string(), group: z.object({ column: z.string().min(1), id: z.string().min(1) }).optional(), chatId: z.string().optional() }),
      ({ id, rows, asked, group, chatId }, caller) => threads().split(id, rows, asked, group, caller, chatId),
    )
    this.router.register("threads.unsplit", z.object({ id: z.string().min(1), chatId: z.string().optional() }), ({ id, chatId }, caller) => threads().unsplit(id, caller, chatId))
    this.router.register("threads.about", z.object({ id: z.string().min(1) }), ({ id }) => threads().about(id))
    this.router.register(
      "threads.gather",
      z.object({ question: z.string().min(1), project: z.string().optional(), size: z.enum(["few", "many"]) }),
      (params, caller) => threads().gather(params, caller),
    )
    this.router.register("threads.run", z.object({ id: z.string().min(1), run: z.enum(["more", "read", "check"]) }), ({ id, run }) => threads().start(id, run))
    this.router.register(
      "threads.compare",
      z.object({ id: z.string().min(1), doc: z.string().min(1), sentences: z.array(z.string().min(1)).min(1).max(20) }),
      ({ id, doc, sentences }, caller) => threads().compare(id, doc, sentences, caller),
    )
    this.router.register("threads.fill", z.object({ id: z.string().min(1), column: z.string().min(1) }), ({ id, column }) => threads().fill(id, column))
    this.router.register("threads.group", z.object({ id: z.string().min(1), question: z.string().min(1) }), ({ id, question }, caller) => threads().group(id, question, caller))
    this.router.register("threads.ask", z.object({ id: z.string().min(1), question: z.string().min(1) }), ({ id, question }, caller) => threads().ask(id, question, caller))
    this.router.register("threads.delete", z.object({ id: z.string().min(1) }), ({ id }, caller) => threads().delete(id, caller))
    this.router.register("threads.undelete", z.object({ id: z.string().min(1) }), ({ id }, caller) => threads().undelete(id, caller))
    this.router.register("comments.all", noParams, () => docs().commentsAll())
    this.router.register(
      "comments.add",
      z.object({ path: rel, comment: commentSchema, agent: z.object({ chatId: z.string().optional(), run: z.string().optional(), toolCallId: z.string().optional() }).optional() }),
      async ({ path, comment, agent }, caller) => {
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
        // A run Owlit started on its own: held while the user is on that page
        if (isCommentingRun(agent.run)) await this.reviews.comment(agent.run!, path, own)
        else await this.agentComment(path, own, caller)
        return null
      },
    )
    this.router.register("comments.put", z.object({ path: rel, comment: commentSchema }), async ({ path, comment: input }, caller) => {
      const was = (await docs().listComments(path)).find((c) => c.id === input.id) ?? null
      const comment = signed(input, was, await this.requireWorkspace().recorder.actorOf(caller))
      const before = await this.putComment(path, comment, caller)
      // A reply of the user's under one of Owlit's comments: Owlit answers it there
      const first = comment.entries[0]
      const last = comment.entries.at(-1)
      if (first && isOwlit(first.by) && last && isPerson(last.by) && !before?.entries.some((e) => e.id === last.id) && isOpenComment(comment)) {
        this.journal.feedback({ kind: "feedback.reply", at: Date.now(), subject: path, detail: { comment: comment.id } })
        this.requireWorkspace().tasks.enqueue(REPLY_RUN, `${path}#${comment.id}`, "asked")
      }
      return before
    })
    // One of Owlit's comments the user doesn't want: put away for good
    this.router.register("comments.dismiss", z.object({ path: rel, id: z.string() }), async ({ path, id }, caller) => {
      const comment = (await docs().listComments(path)).find((c) => c.id === id)
      if (!comment) throw new RpcFailure(RpcErrorCode.NotFound, t`That comment isn't there any more.`)
      if (!comment.entries[0] || !isOwlit(comment.entries[0].by)) throw new RpcFailure(RpcErrorCode.InvalidParams, "Only Owlit's comments are dismissed; yours are resolved or deleted.")
      const dismissed = { ...comment, dismissedAt: Date.now() }
      await this.putComment(path, dismissed, caller, {}, true)
      this.journal.feedback({ kind: "feedback.dismiss", at: Date.now(), subject: path, detail: { comment: id } })
      return dismissed
    })
    // What the user did with Owlit's work that only the window sees: a comment of its came into view
    this.router.register(
      "initiative.feedback",
      z.object({ what: z.enum(["seen", "apply", "undo"]), subject: z.string(), detail: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional() }),
      ({ what, subject, detail }) => {
        if (this.workspace) this.journal.feedback({ kind: `feedback.${what}`, at: Date.now(), subject, ...(detail ? { detail } : {}) })
        return null
      },
    )
    this.router.register("comments.remove", z.object({ path: rel, id: z.string() }), async ({ path, id }, caller) => {
      const removed = await docs().removeComment(path, id)
      await this.recordComment(caller, path, removed, null)
      return removed
    })
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
                starred: (paperId) => {
                  if (this.workspace?.root === root) this.initiative.observe({ kind: "paper.starred", at: Date.now(), paperId })
                },
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
              ruleOf: (taskId) => this.initiative.ruleOf(taskId),
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
      if (this.workspace && this.workspace !== next) await this.stopWorkspace(this.workspace)
      if (this.workspace !== next) await this.serveSocket(next.root)
      const opened = this.workspace !== next
      this.workspace = next
      // Away since the person was last heard from in this workspace, the app closed meanwhile
      if (opened) {
        const me = await this.personAt(WINDOW).catch(() => undefined)
        const now = Date.now()
        if (me) {
          this.initiative.presence.resume((await next.seen.get(me, [])).here, now)
          await next.seen.here(me, now, true)
        }
      }
      // Its tasks run only now: an agent run started before its socket was up would go without owlit's tools
      if (opened) await next.tasks.start()
      // Owlit's rules look at the workspace once it runs (watched threads get their daily look)
      if (opened) this.initiative.observe({ kind: "workspace.opened", at: Date.now() })
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
  private async agentComment(path: string, comment: DocComment, caller: Caller, quiet = false) {
    const ws = this.requireWorkspace()
    await ws.docs.addComment(path, comment)
    this.notifier.notify("comments.changed", { path, comment })
    await ws.recorder.record(caller, { action: "create", target: { kind: "comment", path, part: comment.id }, after: comment }, { label: path.split("/").pop()!.replace(/\.md$/i, ""), quiet })
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

  // Whether a chat's agent may make this change, by the chat's role, asked in the chat when the role says
  // so; refused with what to tell the agent. A caller with no chat (an agent outside owlit) has its own
  // permission prompt, which is the user's say.
  private async consented(chatId: string | undefined, action: ConsentAction, title: string) {
    if (!chatId) return
    const { allowed, reason } = await this.turns.consent(chatId, action, title)
    if (!allowed) throw new RpcFailure(RpcErrorCode.Conflict, `Not done: ${reason ?? "the user said no."}`)
  }

  // A task's agent run, as a session the window can open from the row it works on: why it started, its
  // steps as they come, and how it ended
  private async runInBackground(root: string, ctx: TaskContext, run: BackgroundRun): Promise<BackgroundResult> {
    const ws = this.workspace
    if (ws?.root !== root) throw new Error("The workspace closed.")
    const words = await runWords(ws, ctx.task)
    const session = await openRun(ws.chats, ctx.task, words, {
      update: (chatId, messageId, update) => {
        if (this.workspace === ws) this.notifier.notify("chat.update", { chatId, messageId, update })
      },
      created: (chat) => {
        if (this.workspace === ws) this.notifier.notify("chats.run", { chat })
      },
    })
    ctx.describe({ chatId: session.chatId, doing: words.doing })
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
    clearInterval(this.hourly)
    await this.updates.dispose()
    this.initiative.dispose()
    await this.switching
    if (this.workspace) await this.stopWorkspace(this.workspace)
    this.workspace = null
    // After the workspace's background tasks: a run cut off by its agent closing would count as a failed
    // try, where one stopped by closing stays running, to run again next time
    this.agents.dispose()
    await this.extension?.close().catch(() => undefined)
    this.reviews.dispose()
    await this.journal.dispose()
  }

  // Everything that belongs to the open workspace stops here, in this order, whether owlit switches to
  // another one or closes. Each step runs even if one before it failed: a switch still goes ahead, and
  // the workspace's lock is still released. ws is still this.workspace throughout, so nothing that stops
  // late can reach the next one.
  private async stopWorkspace(ws: Workspace) {
    const steps: [string, () => unknown][] = [
      ["chat turns", () => this.turns.reset()],
      ["the window's requests", () => this.ui.reset()],
      // What Owlit's rules were settling or had put off was about this workspace
      ["Owlit's rules", () => this.initiative.reset()],
      // Before the agents they run on close (dispose closes them after this)
      ["background tasks", () => ws.tasks.dispose()],
      // After the tasks, whose runs may still add to what is held
      ["Owlit's held comments", () => this.reviews.stop()],
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

const nameOf = (p: string) => p.split("/").filter(Boolean).pop() ?? p

const toInfo = (folder: string): WorkspaceInfo => ({ path: folder, name: folder.slice(folder.lastIndexOf("/") + 1) })
