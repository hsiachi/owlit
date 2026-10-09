import type { ActivityEvent } from "./activity.ts"
import type { Chat, ChatMessage, ChatSummary, Connector, PromptInput, SessionUpdate, StopReason } from "./chat.ts"
import type { AgentNote, DocsChange, DocsListing, DocStat } from "./docs.ts"
import type { Highlight, LibraryChange, Paper, PaperNote, PaperPatch, ResolvedPaper } from "./library.ts"
import type { Task, TaskLane, TaskPriority } from "./tasks.ts"
import type { UiRequest, WorkspaceInfo } from "./workspace.ts"

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
  "notes.add": { params: { path: string; note: AgentNote }; result: null }
  // The note removed, or null if it wasn't there
  "notes.remove": { params: { path: string; id: string }; result: AgentNote | null }
  // Passages edited while the doc was open, saved as they read now: note id → its new anchor
  "notes.reanchor": { params: { path: string; moved: Record<string, NoteAnchor> }; result: null }

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
  // Puts a file back as it was before an agent's write (Undo once its editor is gone); refused with
  // Conflict when the file changed since
  "versions.restore": { params: { id: string }; result: { path: string } }

  // ---- Library: the workspace's papers
  // What a pasted reference (DOI, arXiv id, a link to a paper) means, and the paper the library
  // already has for it. Asks OpenAlex, Semantic Scholar and arXiv; writes nothing.
  "library.resolve": { params: { input: string }; result: { paper: ResolvedPaper; existingId?: string } }
  // For each input, the id of the paper in the library it names, or null; asks no one
  "library.known": { params: { inputs: string[] }; result: (string | null)[] }
  // Every paper, with every highlight and note
  "library.list": { params: void; result: { papers: Paper[]; highlights: Highlight[]; notes: PaperNote[] } }
  // Adds a looked-up paper (its metadata, PDF and text follow as tasks). A paper the library already
  // has under any of its ids comes back as it is.
  "library.add": { params: { paper: ResolvedPaper; addedBy?: Paper["addedBy"] }; result: Paper }
  // The user's judgement, reading position, or a field they corrected (kept over refreshes)
  "library.update": { params: { id: string; patch: PaperPatch }; result: Paper }
  // Moves papers, with their highlights and notes, to .owlit/trash/
  "library.remove": { params: { ids: string[] }; result: null }
  // Puts back what library.remove took (Undo)
  "library.restore": { params: { ids: string[] }; result: Paper[] }
  // Adds a highlight, or replaces the one with its id
  "library.putHighlight": { params: { highlight: Highlight }; result: null }
  "library.removeHighlight": { params: { paperId: string; id: string }; result: Highlight | null }
  // Looks for the paper's PDF now and waits: arXiv, open-access links, the publisher, Unpaywall. The
  // paper comes back with pdf, or with noPdf saying what was tried.
  "library.fetchPdf": { params: { id: string }; result: Paper }
  // A PDF file the user has (path from window.owlit.pathForFile), copied in as the paper's file
  "library.attachPdf": { params: { id: string; path: string }; result: Paper }
  // An empty note removes note.md
  "library.setNote": { params: { paperId: string; content: string }; result: PaperNote }

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
  // Files in the workspace changed outside core; core's own changes are never echoed here
  "docs.changed": DocsChange
  // An agent's state changed (it started, ended, crashed, was checked)
  "agents.changed": Connector
  // One streamed update of a chat's running turn
  "chat.update": { chatId: string; update: SessionUpdate }
  // Core needs a window to read or change a doc open in its editor
  "ui.request": UiRequest
  // An agent wrote a file no window had open; versionId undoes it
  "agent.wrote": { path: string; versionId: string; chatId?: string }

  // Papers changed by core on its own (a task) or by another program; may repeat the window's own
  // changes, which the window takes as they are
  "library.changed": LibraryChange
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
}
