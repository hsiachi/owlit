import type { ActivityEvent } from "./activity.ts"
import type { Chat, ChatMessage, ChatSummary, Connector, PromptInput, SessionUpdate, StopReason } from "./chat.ts"
import type { AgentNote, DocsChange, DocsListing, DocStat, VersionInfo } from "./docs.ts"
import type { Highlight, LibraryChange, Paper, PaperNote, PaperPatch, PaperText, ResolvedPaper } from "./library.ts"
import type { KnowledgeRun, KnowledgeVersion, KnowledgeWrite, PaperKnowledge, TopicSidecar, TopicSummary } from "./knowledge.ts"
import type { LinkSource, PaletteResults, SearchHit, SearchStatus } from "./search.ts"
import type { Task, TaskLane, TaskPriority } from "./tasks.ts"
import type { AppearanceSettings, UiActions, UiRequest, WorkspaceInfo } from "./workspace.ts"
import type { ProxyPreset, SecretName, SettingsCheck, SettingsCheckTarget, SettingsPatch, SettingsView } from "./settings.ts"

// The one way to talk to core: JSON-RPC 2.0 requests with responses, and notifications from core to
// its clients. The transport (Electron IPC now, a Unix socket later) only moves these envelopes.

export interface RpcRequest {
  jsonrpc: "2.0"
  id: number | string
  method: string
  params?: unknown
}

export interface RpcError {
  code: number
  // One sentence a person can read; shown as is in the UI
  message: string
  data?: unknown
}

export type RpcResponse =
  | { jsonrpc: "2.0"; id: number | string; result: unknown }
  | { jsonrpc: "2.0"; id: number | string; error: RpcError }

export interface RpcNotification {
  jsonrpc: "2.0"
  method: string
  params?: unknown
}

// JSON-RPC's reserved codes, plus owlit's own above -32000
export const RpcErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  // Something the request names is not there (a folder, a file)
  NotFound: -32001,
  // Someone else holds it (a workspace open in another owlit)
  Conflict: -32002,
  // The request needs an open workspace and there is none
  NoWorkspace: -32003,
  // A service owlit asks (OpenAlex, Semantic Scholar, a publisher) couldn't be reached or refused
  Unavailable: -32004,
} as const

// Every request core answers: method name ("<area>.<verb>") → params and result. Clients are typed
// from this map; core checks params at runtime against its own schema for each method.
export interface Methods {
  "core.ping": { params: void; result: { ok: true } }
  "core.version": { params: void; result: CoreVersion }
  // The open workspace, or null before one is chosen
  "workspace.current": { params: void; result: WorkspaceInfo | null }
  // Open a folder as the workspace, closing the current one; creates .owlit/ if missing
  "workspace.open": { params: { path: string }; result: WorkspaceInfo }
  // Recently opened folders, most recent first; folders that no longer exist are left out
  "workspace.recent": { params: void; result: WorkspaceInfo[] }
  "workspace.clearRecent": { params: void; result: null }
  // .owlit/workspace.json's layout: what the window shows, kept with the workspace (the agent
  // window's chat, …)
  "workspace.layout": { params: void; result: Record<string, unknown> }
  // Merges into the layout; a key set to null is removed
  "workspace.setLayout": { params: { patch: Record<string, unknown> }; result: Record<string, unknown> }
  // One thing the user did; dropped when activity is turned off or no workspace is open
  "activity.emit": { params: { event: ActivityEvent }; result: null }
  "activity.status": { params: void; result: { enabled: boolean } }
  "activity.setEnabled": { params: { enabled: boolean }; result: { enabled: boolean } }

  // ---- Settings: this machine's, kept in the app data directory. Keys stay in core (sealed with the
  // system keychain on disk); the window only sees how each one ends.
  "settings.get": { params: void; result: SettingsView }
  "settings.update": { params: { patch: SettingsPatch }; result: SettingsView }
  // null removes the key
  "settings.setSecret": { params: { name: SecretName; value: string | null }; result: SettingsView }
  // Tries a key (or the self-hosted MinerU's address) once with the service it is for
  "settings.check": { params: { target: SettingsCheckTarget }; result: SettingsCheck }
  // A known library, a link opened through one (proxyFromLink), or neither to turn the proxy off.
  // A link no proxy can be read from is refused.
  "settings.setProxy": { params: { preset?: ProxyPreset; link?: string }; result: SettingsView }
  // Shows the proxy's sign-in in owlit's browser window; resolves once the user closes it
  "settings.proxySignIn": { params: void; result: SettingsView }

  // ---- Docs: the workspace's files. Every path is workspace-relative; library/ and dot-folders are
  // out of reach. Names a call asks for are made unique ("Name 2"), so results carry the real path.
  // Every Markdown file with its text, other files without, and every folder
  "docs.list": { params: void; result: DocsListing }
  "docs.read": { params: { path: string }; result: { content: string; modifiedAt: number } }
  // Writes a new file. id carries over one the client already uses; followsFirstLine names the file
  // after its first line now and on later writes, until it is renamed by hand.
  "docs.create": { params: { path: string; content: string; id?: string; followsFirstLine?: boolean }; result: DocStat }
  // Replaces a file's text. Refused with Conflict (data: DocConflict) when the file changed on disk
  // since expectedModifiedAt, unless force.
  "docs.write": { params: { path: string; content: string; expectedModifiedAt: number; force?: boolean }; result: DocStat }
  // A file or folder, renamed in place; a renamed file stops following its first line
  "docs.rename": { params: { path: string; name: string }; result: { path: string } }
  // A file or folder, moved into another folder ("" is the root)
  "docs.move": { params: { path: string; folder: string }; result: { path: string } }
  // A file or folder, to the system Trash
  "docs.delete": { params: { path: string }; result: null }
  "docs.createFolder": { params: { path: string }; result: { path: string } }
  // Puts back what a delete removed, from the text the client kept (Undo)
  "docs.restore": {
    params: { files: { id: string; path: string; content: string }[]; folders: string[] }
    result: { files: DocStat[]; folders: string[] }
  }
  // Opens a file in the system's app for it (files that aren't Markdown)
  "docs.open": { params: { path: string }; result: null }

  // ---- Notes agents left on docs, kept beside the files (.owlit/docs/notes/); they follow renames,
  // moves and deletes made through docs.* or outside owlit
  // Every doc's notes, by path
  "notes.all": { params: void; result: Record<string, AgentNote[]> }
  // Adds a note, or puts a dismissed one back
  // agent: the note is an agent's (owlit-mcp), kept as a version so the window can offer Undo
  "notes.add": { params: { path: string; note: AgentNote; agent?: { chatId?: string } }; result: null }
  // The note removed, or null if it wasn't there
  "notes.remove": { params: { path: string; id: string }; result: AgentNote | null }
  // Passages edited while the doc was open, saved as they read now: note id → its new anchor
  "notes.reanchor": { params: { path: string; moved: Record<string, NoteAnchor> }; result: null }

  // ---- Knowledge: topic files in knowledge/ (read and written as docs), and beside them in .owlit/knowledge/
  // what the user did to them, which no run may undo
  // Every topic's sidecar and every paper's passages, and the last run that changed something
  "knowledge.state": { params: void; result: { topics: Record<string, TopicSidecar>; papers: Record<string, PaperKnowledge>; lastRun: KnowledgeRun | null } }
  // The window's own changes: an edit or removal of a line, a passage found, a topic seen
  "knowledge.putTopic": { params: { id: string; sidecar: TopicSidecar }; result: null }
  "knowledge.putPaper": { params: { id: string; paper: PaperKnowledge }; result: null }
  "knowledge.topics": { params: void; result: TopicSummary[] }
  // One topic's file, with the lines the user rewrote (kept word for word) and removed (never back)
  "knowledge.read": {
    params: { topic: string }
    result: { id: string; path: string; name: string; content: string; edited: { id: string; text: string }[]; removed: string[]; paused: boolean }
  }
  // An agent's write, checked against the rules; InvalidParams lists every problem
  "knowledge.write": { params: KnowledgeWrite; result: { id: string; path: string; name: string; changes: string[] } }
  // Update now: a run as soon as the agent lane is free
  "knowledge.update": { params: void; result: Task }
  "knowledge.versions": { params: void; result: KnowledgeVersion[] }
  // knowledge/ back as a version had it; versionId is the version kept of how it was just before
  "knowledge.revert": { params: { id: string }; result: { files: string[]; versionId: string } }

  // ---- Chats, in .owlit/chats/. A message still streaming when owlit stopped comes back cancelled.
  // Most recently updated first, without messages
  "chats.list": { params: void; result: ChatSummary[] }
  "chats.get": { params: { id: string }; result: Chat }
  "chats.create": { params: { chat: ChatSummary }; result: ChatSummary }
  // Title, pin, agent settings, last use
  "chats.update": { params: { id: string; patch: Partial<Omit<ChatSummary, "id" | "createdAt">> }; result: ChatSummary }
  // Moves the chat to .owlit/trash/
  "chats.delete": { params: { id: string }; result: null }
  "chats.appendMessage": { params: { id: string; message: ChatMessage }; result: null }
  // Replaces a message by id. While final is false the disk catches up within half a second;
  // final (the end of a turn) writes at once.
  "chats.patchMessage": { params: { id: string; message: ChatMessage; final?: boolean }; result: null }

  // ---- Local agents (ACP over stdio). Built-in ones plus those the user added; each runs as one
  // process, started when needed and ended after ten idle minutes.
  "agents.list": { params: void; result: Connector[] }
  // What every agent owlit runs is told about owlit (owlit-mcp's instructions, a new session's preamble)
  "agents.rules": { params: void; result: string }
  // Whether the agent is installed and signed in, and what it offers (models, modes, efforts)
  "agents.check": { params: { id: string }; result: Connector }
  "agents.add": { params: { name: string; command: string }; result: Connector }
  // Removes one the user added
  "agents.remove": { params: { id: string }; result: null }
  // One turn of a chat on an agent. Core appends both messages to the chat, streams the answer as
  // chat.update and saves it; resolves when the turn ends.
  "agents.prompt": {
    params: {
      chatId: string
      connectorId: string
      modelId?: string
      modeId?: string
      effortId?: string
      input: PromptInput
      userMessage: ChatMessage
      assistantMessageId: string
    }
    result: { stopReason: StopReason }
  }
  // Stops the chat's running turn; questions it was waiting on close as cancelled
  "agents.cancel": { params: { chatId: string }; result: null }
  // Answers a permission_request with one of its options
  "agents.respondPermission": { params: { chatId: string; requestId: string; optionId: string }; result: null }

  // ---- Windows. clientId names one window for as long as it is loaded.
  // The docs this window has open in an editor (workspace-relative); agents' reads and writes of them
  // go through it
  "ui.setOpenDocs": { params: { clientId: string; paths: string[] }; result: null }
  // A window's answer to a ui.request
  "ui.respond": { params: { requestId: string; result?: unknown; error?: string }; result: null }
  // The user is in this window now (it loaded or came to the front); ui.* actions go to it
  "ui.focus": { params: { clientId: string }; result: null }
  // The window is closing or reloading; core stops sending it anything
  "ui.leave": { params: { clientId: string }; result: null }
  // Things an agent does in the window the user is in (UiActions in workspace.ts). Unavailable when no
  // window is open; NotFound when what the uri names isn't there.
  "ui.open": { params: UiActions["open"]["params"]; result: UiActions["open"]["result"] }
  "ui.jump": { params: UiActions["jump"]["params"]; result: UiActions["jump"]["result"] }
  "ui.mark": { params: UiActions["mark"]["params"]; result: UiActions["mark"]["result"] }
  "ui.say": { params: UiActions["say"]["params"]; result: null }
  // Takes back what a version recorded (VersionInfo): Undo of an agent's write, note or paper, or a
  // restore from a doc's Versions. A file that changed since is refused with Conflict unless forced.
  // redoId undoes the restore.
  "versions.restore": { params: { id: string; force?: boolean }; result: { path: string; kind: VersionInfo["kind"]; redoId: string } }
  // The versions kept, newest first; of one doc or topic, or of everything since a time
  "versions.list": { params: { path?: string; since?: number }; result: VersionInfo[] }

  // ---- Library: the workspace's papers
  // What a pasted reference (DOI, arXiv id, a link to a paper) means, and the paper the library
  // already has for it. Asks OpenAlex, Semantic Scholar and arXiv; writes nothing.
  "library.resolve": { params: { input: string }; result: { paper: ResolvedPaper; existingId?: string } }
  // For each input, the id of the paper in the library it names, or null; asks no one
  "library.known": { params: { inputs: string[] }; result: (string | null)[] }
  // Every paper, with every highlight and note, and the old ids of papers that moved (old → new)
  "library.list": { params: void; result: { papers: Paper[]; highlights: Highlight[]; notes: PaperNote[]; aliases: Record<string, string> } }
  // A PDF file dropped on the library: recognised (arXiv stamp, DOI) and added with its metadata, or
  // kept as local-<hash>. The same file dropped again comes back with existed.
  "library.importPdf": { params: { path: string }; result: { paper: Paper; existed: boolean } }
  // Adds a looked-up paper (its metadata, PDF and text follow as tasks). A paper the library already
  // has under any of its ids comes back as it is.
  // An agent's addition is kept as a version (Undo moves the paper to .owlit/trash/); chatId says whose
  "library.add": { params: { paper: ResolvedPaper; addedBy?: Paper["addedBy"]; chatId?: string }; result: Paper }
  // The user's judgement, reading position, or a field they corrected (kept over refreshes)
  "library.update": { params: { id: string; patch: PaperPatch }; result: Paper }
  // Moves papers, with their highlights and notes, to .owlit/trash/
  "library.remove": { params: { ids: string[] }; result: null }
  // Puts back what library.remove took (Undo)
  "library.restore": { params: { ids: string[] }; result: Paper[] }
  // Adds a highlight, or replaces the one with its id
  "library.putHighlight": { params: { highlight: Highlight }; result: null }
  "library.removeHighlight": { params: { paperId: string; id: string }; result: Highlight | null }
  // Part of a paper as text: the full text (pages "3-5" or the section under a heading), the digest or
  // the user's note. pages: how many the paper has.
  "library.read": { params: { id: string; part: "text" | "digest" | "note"; pages?: string; section?: string }; result: { text: string; pages?: number } }
  // Papers out in the world (OpenAlex) for a query; inLibrary when the library has one already. Each
  // search is kept in .owlit/searches.jsonl.
  "library.searchOnline": {
    params: { q: string; limit?: number; by?: string }
    result: (ResolvedPaper & { inLibrary?: string; citationCount?: number })[]
  }
  "library.highlights": { params: { id: string }; result: Highlight[] }
  // Queues a reading note by a background agent (the paper menu's Write a reading note); nothing when
  // the paper has one or nothing to read
  "library.requestDigest": { params: { id: string }; result: null }
  // A reading note an agent wrote itself, kept as digest.md; refused when the paper has one
  "library.writeDigest": { params: { id: string; text: string; by?: string }; result: Paper }
  // The paper's reading notes (digest.md) as Markdown, or null
  "library.digest": { params: { id: string }; result: string | null }
  // Brings a pitta library (the folder holding papers/) into the workspace, once; papers already
  // here are skipped. Waits until it is done; progress shows as an import.pitta task.
  "library.importPitta": { params: { root: string }; result: { added: number; skipped: number; failed: string[] } }
  // The paper's full text, line by line with where each sits (text.json), or null before it is read
  "library.text": { params: { id: string }; result: PaperText | null }
  // Looks for the paper's PDF now and waits: arXiv, open-access links, the publisher, Unpaywall. The
  // paper comes back with pdf, or with noPdf saying what was tried.
  "library.fetchPdf": { params: { id: string }; result: Paper }
  // The publisher's page with the user there (Check now): shown where the window reserved room for it
  // (window.owlit.publisherView), waiting for them to pass a check or sign in. Resolves with the paper
  // once the run ends; cancelling its task (paper.pdf.check) ends it.
  "library.checkPublisher": { params: { id: string }; result: Paper }
  // A PDF file the user has (path from window.owlit.pathForFile), copied in as the paper's file
  "library.attachPdf": { params: { id: string; path: string }; result: Paper }
  // An empty note removes note.md
  "library.setNote": { params: { paperId: string; content: string }; result: PaperNote }

  // Development only: the hidden browser opens landing and fetches the PDF, with no task around it
  "library.debugBrowserFetch": { params: { landing: string; pdf?: string; allowHosts: string[] }; result: { bytes: number; head: string } }

  // ---- Search: the workspace's index (papers with their full text, docs, chats, and what links where)
  // Every word must appear; title matches first; each group's best few. indexing: still reading the
  // workspace for the first time, so results are partial.
  "search.palette": { params: { q: string }; result: PaletteResults & { indexing: boolean } }
  // Papers with every word in their metadata or full text, best first. marked: the matched words in
  // each snippet are wrapped in MARK_OPEN and MARK_CLOSE (search.ts)
  "search.papers": { params: { q: string; marked?: boolean }; result: SearchHit[] }
  "search.status": { params: void; result: SearchStatus }
  // Deletes the index and reads the workspace again
  "search.rebuild": { params: void; result: null }
  // What links to a paper or doc (owlit://library/<id>), under any id the paper has had
  "links.to": { params: { uri: string }; result: LinkSource[] }

  // ---- Tasks: background work in the open workspace. Their state shows beside what they are about.
  // Unfinished tasks, then the ones that finished since the workspace opened, most recent first
  "tasks.list": { params: void; result: Task[] }
  // Stops a task. A batch's tasks that haven't started are cancelled with it; running ones finish.
  "tasks.cancel": { params: { id: string }; result: Task | null }
  // The user did what a waiting_for_you task asked (signed in, dropped the PDF, said yes)
  "tasks.resume": { params: { id: string }; result: Task | null }
  // Development only, absent from a packaged owlit: queues a task (debug.<lane>) that sleeps for ms in
  // steps, optionally stopping for tasks.resume after the first one or failing at the end
  "tasks.debugEnqueue": {
    params: { subject: string; lane?: TaskLane; priority?: TaskPriority; ms?: number; steps?: number; fail?: boolean; waitForYou?: boolean }
    result: Task
  }
}

// Every notification core sends: topic → payload
export interface Notifications {
  // Sent once core is up
  "core.hello": CoreVersion
  // A workspace was opened (also after a switch); clients reset what they hold for the old one
  "workspace.opened": WorkspaceInfo
  // The activity switch changed; renderers stop or start reporting
  "activity.status": { enabled: boolean }
  // Any setting changed, from any window or the app menu
  "settings.changed": SettingsView
  // Files in the workspace changed outside core; core's own changes are never echoed here
  "docs.changed": DocsChange
  // An agent's state changed (it started, ended, crashed, was checked)
  "agents.changed": Connector
  // One streamed update of a chat's running turn
  "chat.update": { chatId: string; update: SessionUpdate }
  // Core needs a window to do something only it can (UiActions)
  "ui.request": UiRequest
  // A note was added to a doc, by a window or by an agent over owlit-mcp; a window that already has it
  // (its own) ignores it
  "notes.added": { path: string; note: AgentNote }
  // An undo took a note away
  "notes.removed": { path: string; id: string }
  // An agent wrote a file no window had open; versionId undoes it
  "agent.wrote": { path: string; versionId: string; chatId?: string }
  // An agent in a chat left a note, added a paper or changed a Knowledge topic; versionId undoes it.
  // label names what changed (the doc, the paper's title, the topic).
  "agent.changed": { kind: "note" | "paper" | "knowledge"; versionId: string; path: string; label: string; chatId?: string }

  // Papers changed by core on its own (a task) or by another program; may repeat the window's own
  // changes, which the window takes as they are
  "library.changed": LibraryChange
  // A paper's note changed outside the window (an agent's edit, another program); null when it was emptied
  "library.noteChanged": { paperId: string; note: PaperNote | null }
  // Core changed a topic's sidecar or a paper's passages (an agent wrote to Knowledge)
  "knowledge.changed": { topics?: Record<string, TopicSidecar>; papers?: Record<string, PaperKnowledge> }
  // A Knowledge run ended; items is empty when it changed nothing
  "knowledge.updated": KnowledgeRun
  // A task changed; sent at most every 200ms per task, always with its latest state
  "tasks.changed": { task: Task }
}

export type MethodName = keyof Methods
export type NotificationName = keyof Notifications
export type ParamsOf<M extends MethodName> = Methods[M]["params"]
export type ResultOf<M extends MethodName> = Methods[M]["result"]

export type NoteAnchor = Pick<AgentNote, "quote" | "prefix" | "suffix">

export interface CoreVersion {
  version: string
  // Node's version inside the host, e.g. Electron's
  node: string
}

// What the desktop preload exposes as window.owlit. Absent in a plain browser (pnpm dev:web).
export interface OwlitBridge {
  platform: string
  // Sends one request and resolves with core's response envelope; never rejects for an RPC error
  rpc(method: string, params?: unknown): Promise<RpcResponse>
  // Every notification core sends; returns an unsubscribe
  onNotify(listener: (notification: RpcNotification) => void): () => void
  // Where a dropped or chosen file is on disk, so core can read it; "" for a file that isn't one
  pathForFile(file: { readonly name: string; readonly size: number }): string
  // Pixels the top bar keeps free at its left for the window's own controls (macOS traffic lights);
  // 0 where there are none to avoid (full screen, a system title bar). The window, not core, knows it.
  controlsRoom: number
  onControlsRoom(listener: (room: number) => void): () => void
  // The theme and paper tone, asked once synchronously so the first frame is already drawn in them
  appearance: AppearanceSettings
  // A command from the app's own menu (Settings…, ⌘,)
  onMenu(listener: (command: "settings") => void): () => void
  // Where the publisher's page shows during Check now, in the window's CSS pixels; null takes it away
  setPublisherView(bounds: { x: number; y: number; width: number; height: number } | null): void
}
