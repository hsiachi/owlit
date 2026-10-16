import type { ActivityAnswer, ActivityEvent, ActivityQuery } from "./activity.ts"
import type { ArchiveSummary, InitiativeSettings } from "./initiative.ts"
import type { EditStats } from "./edit-stats.ts"
import type { AttachmentFile, Chat, ChatMessage, ChatSummary, Connector, RunSummary, PromptInput, QuestionAnswer, SessionUpdate, StopReason } from "./chat.ts"
import type { ConsentAction, Role } from "./roles.ts"
import type { CommentAnchor, DocComment, DocOwlit, DocsChange, DocsListing, DocStat, VersionInfo } from "./docs.ts"
import type { FoundPapers, Highlight, ImportPreview, ImportSource, ImportSummary, LibraryChange, OnlineFilters, OnlineSource, Paper, PaperFigure, PaperNote, PaperWear, PaperPatch, PaperText, ResolvedPaper, TrashedPaper } from "./library.ts"
import type { Thread, ThreadBatch, ThreadEdit, ThreadPaper, ThreadSize, ThreadSummary, ThreadWrite } from "./threads.ts"
import type { LinkSource, PaletteResults, SearchHit, SearchStatus } from "./search.ts"
import type { Task, TaskLane, TaskPriority } from "./tasks.ts"
import type { AppearanceSettings, UiActions, UiRequest, WelcomeInfo, WorkspaceInfo, WorkspaceState } from "./workspace.ts"
import type { Locale } from "./languages.ts"
import type { ClaudeNote, MemoryKind, MemoryLine } from "./memory.ts"
import type { DocShare, SharePermission, ShareComment } from "./share.ts"
import type { ProxyPreset, SecretName, SettingsCheck, SettingsCheckTarget, SettingsPatch, SettingsView } from "./settings.ts"
import type { UpdateCheck, UpdatesView } from "./updates.ts"

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
  // A short plain-text report for someone helping with a problem: versions, the agents and what keeps
  // them from running, where owlit keeps its data. No keys, no paper titles, no file contents.
  "core.diagnostics": { params: void; result: string }
  // Owlit updating itself (core updates/): where it stands, a check now, the switch for checking by
  // itself, and the window having shown "Updated to"
  "updates.get": { params: void; result: UpdatesView }
  "updates.check": { params: void; result: UpdateCheck }
  "updates.setAuto": { params: { auto: boolean }; result: UpdatesView }
  "updates.seen": { params: void; result: void }
  // Quits and installs the downloaded update. While a chat is still answering it doesn't, and says how
  // many are, unless force: the window asks first.
  "updates.restart": { params: { force?: boolean }; result: { answering: number } }
  // The open workspace, or null before one is chosen
  "workspace.current": { params: void; result: WorkspaceInfo | null }
  // The open workspace, and whether one is opening right now
  "workspace.state": { params: void; result: WorkspaceState }
  // For the welcome page: recent workspaces (missing ones too) and a name for a new one
  "workspace.welcome": { params: void; result: WelcomeInfo }
  // Makes a new folder name in parent and opens it; refuses a name that is taken
  "workspace.create": { params: { parent: string; name: string }; result: WorkspaceInfo }
  // Copies the example workspace the app ships into the folder Create would use (Documents), or opens the
  // copy made before, and opens it
  "workspace.createExample": { params: void; result: WorkspaceInfo }
  // Takes a workspace off the recent list (one that was moved, once it has been found elsewhere)
  "workspace.forget": { params: { path: string }; result: null }
  // Open a folder as the workspace, closing the current one; creates .owlit/ if missing
  "workspace.open": { params: { path: string }; result: WorkspaceInfo }
  // Recently opened folders, most recent first; folders that no longer exist are left out
  "workspace.recent": { params: void; result: WorkspaceInfo[] }
  "workspace.clearRecent": { params: void; result: null }
  // .owlit/workspace.json's layout: what the window shows, kept with the workspace (the agent
  // window's chat, …)
  // How far Owlit goes in this workspace without being asked; set records feedback.dialChanged
  "initiative.get": { params: void; result: InitiativeSettings }
  "initiative.set": { params: { patch: Partial<InitiativeSettings> }; result: InitiativeSettings }
  // What the user did with Owlit's work that only a window sees (a comment of Owlit's came into view)
  "initiative.feedback": { params: { what: "seen" | "apply" | "undo"; subject: string; detail?: Record<string, string | number | boolean> }; result: null }
  // Everything Owlit did on its own here (what it heard, each decision, what you did with its work, its
  // runs) as one archive in a new folder outside the workspace, from since (ms) on
  "archive.export": { params: { to: string; since?: number }; result: ArchiveSummary }
  "workspace.layout":{ params: void; result: Record<string, unknown> }
  // Merges into the layout; a key set to null is removed
  "workspace.setLayout": { params: { patch: Record<string, unknown> }; result: Record<string, unknown> }
  // One thing the user did; dropped when activity is turned off or no workspace is open
  "activity.emit": { params: { event: ActivityEvent }; result: null }
  "activity.status": { params: void; result: { enabled: boolean } }
  // What the user did lately, for an agent (owlit-mcp's activity_read)
  "activity.query": { params: { query: ActivityQuery }; result: ActivityAnswer }
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
  // A PDF in the workspace as text, each page after a <!-- page N --> line (the same reading and page
  // numbers as a paper in the Library); pages picks some ("3-5,8")
  "docs.readPdf": { params: { path: string; pages?: string }; result: { text: string; pages: number } }
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
  // Owlit and a doc: kept out or let in, and its last look
  "docs.owlit": { params: { path: string }; result: DocOwlit }
  // Owlit goes through this material (a meeting's transcript, reviews, comments from someone) against
  // the user's docs: a record beside it, and the points as comments where they belong. Asked, at any
  // position of the dial; the task that does it
  "docs.goThrough": { params: { path: string }; result: Task }
  "docs.setOwlitOut": { params: { path: string; out: boolean }; result: DocOwlit }
  "docs.open": { params: { path: string }; result: null }
  // Shows a file or folder in Finder, selected
  "docs.reveal": { params: { path: string }; result: null }

  // ---- Comments on docs, kept beside the files (.owlit/docs/comments/); they follow renames, moves and
  // deletes made through docs.* or outside owlit
  // Every doc's comments, by path, resolved ones included
  "comments.all": { params: void; result: Record<string, DocComment[]> }
  // Starts a comment, or puts back one deleted
  // agent: the comment is an agent's (owlit-mcp), kept as a version so the window can offer Undo
  // agent: from an agent over owlit-mcp, in a chat (chatId) or a background run (run, e.g. "docs.review:<task id>")
  "comments.add": { params: { path: string; comment: DocComment; agent?: { chatId?: string; run?: string } }; result: null }
  // Replaces a comment as it is now (a reply, an edit, a deleted entry, resolved or opened again); the
  // comment as it was, or null if it wasn't there
  "comments.put": { params: { path: string; comment: DocComment }; result: DocComment | null }
  // The comment removed, or null if it wasn't there
  "comments.remove": { params: { path: string; id: string }; result: DocComment | null }
  // One of Owlit's comments the user doesn't want; journaled as feedback.dismiss
  "comments.dismiss": { params: { path: string; id: string }; result: DocComment }
  // Passages edited while the doc was open, saved as they read now: comment id → its new anchor
  "comments.reanchor": { params: { path: string; moved: Record<string, CommentAnchor> }; result: null }

  // ---- Sharing a doc by link: the share server holds what readers see; their comments come back here.
  // Shares are by doc path and follow renames. server is where links point; null when none is set up.
  "share.list": { params: void; result: { server: string | null; shares: DocShare[] } }
  // Makes a link for the doc and pushes it with the papers it cites; from then on every change is pushed
  "share.create": { params: { path: string; notes: boolean }; result: DocShare }
  "share.update": { params: { path: string; permission?: SharePermission; notes?: boolean }; result: DocShare }
  // The link stops working for everyone who has it
  "share.stop": { params: { path: string }; result: null }
  // The doc's comments as last fetched, fetching them again first when the server can be reached
  "share.comments": { params: { path: string }; result: ShareComment[] }
  // The author's reply, under the profile's name
  "share.reply": { params: { path: string; parent: string; text: string }; result: ShareComment }
  "share.resolve": { params: { path: string; id: string; resolved: boolean }; result: null }

  // ---- Threads: papers Owlit gathered for a question and what it makes of them, in .owlit/threads/
  "threads.list": { params: void; result: ThreadSummary[] }
  // As stored: Owlit's text with the user's changes beside it (shownThread gives what the user sees)
  "threads.get": { params: { id: string }; result: Thread }
  // An agent's write, merged so the user's changes stay; left names rows not written because the user
  // removed them, userKept what of the write gave way to the user's own changes to the groups
  "threads.write": { params: ThreadWrite; result: { id: string; title: string; added: number; updated: number; left: string[]; userKept: string[] } }
  "threads.edit": { params: { id: string; edit: ThreadEdit }; result: Thread }
  // Keep it separate: the rows an agent added to this thread become a thread of their own, for
  // the question they were found for; or a group's rows (group), copied where they are in other groups too
  "threads.split": { params: { id: string; rows: string[]; asked: string; group?: { column: string; id: string } }; result: Thread }
  // Undo of a split: the rows go back where they came from, as they were there, and this thread to
  // the trash; the thread they went back to
  "threads.unsplit": { params: { id: string }; result: Thread }
  // Owlit's work on the thread in batches, oldest first, for About
  "threads.about": { params: { id: string }; result: ThreadBatch[] }
  // Owlit gathers papers for a question, in the background: the thread is there at once (empty,
  // titled by the question until Owlit names it) and fills as the task runs
  "threads.gather": { params: { question: string; project?: string; size: ThreadSize }; result: Thread }
  // More of Owlit's work on a thread: find more papers, read the abstract-only ones in full, check
  // for new papers now
  "threads.run": { params: { id: string; run: "more" | "read" | "check" }; result: Task }
  // A new column: a question Owlit answers for every paper
  "threads.ask": { params: { id: string; question: string }; result: Thread }
  // Owlit answers a column again where it has no answer yet (the user's own answers always stay)
  "threads.fill": { params: { id: string; column: string }; result: Task }
  // Group another way: a new grouping, by what the user said to group by, which Owlit fills in the
  // background (groups first, then each paper's)
  "threads.group": { params: { id: string; question: string }; result: Thread }
  // A column that sets every paper against sentences the user picked from a doc of theirs
  "threads.compare": { params: { id: string; doc: string; sentences: string[] }; result: Thread }
  // Moves the thread to .owlit/trash/
  "threads.delete": { params: { id: string }; result: null }
  "threads.undelete": { params: { id: string }; result: Thread }

  // ---- Chats, in .owlit/chats/. A message still streaming when owlit stopped comes back cancelled.
  // Most recently updated first, without messages
  // Your chats; Owlit's own runs aren't among them
  "chats.list": { params: void; result: ChatSummary[] }
  "chats.get": { params: { id: string }; result: Chat }
  // Owlit's runs that ended after since, newest first
  "chats.runs": { params: { since: number }; result: RunSummary[] }
  "chats.create": { params: { chat: ChatSummary }; result: ChatSummary }
  // Title, pin, agent settings, last use
  "chats.update": { params: { id: string; patch: Partial<Omit<ChatSummary, "id" | "createdAt">> }; result: ChatSummary }
  // Moves the chat, with the copies of its attached files, to .owlit/trash/
  "chats.delete": { params: { id: string }; result: null }
  "chats.appendMessage": { params: { id: string; message: ChatMessage }; result: null }
  // Replaces a message by id. While final is false the disk catches up within half a second;
  // final (the end of a turn) writes at once.
  // Takes messages out of a chat (a broken reply and its question, when Retry asks again)
  "chats.removeMessages": { params: { id: string; messageIds: string[] }; result: null }
  "chats.patchMessage": { params: { id: string; message: ChatMessage; final?: boolean }; result: null }
  // Brings back the chat deleted last under this id, with its files (Undo)
  "chats.restore": { params: { id: string }; result: Chat }
  // A file the user attaches to a message in this chat (which may not exist yet: a new chat's composer
  // names the id it will get). Given by its path on disk (window.owlit.pathForFile), or as bytes (base64)
  // when it has none (a pasted image). What owlit already has isn't copied: a file inside the workspace
  // comes back as a doc, a PDF the Library has (the same file) as that paper; anything else is copied into
  // the chat's folder. Refused for a folder.
  "chats.attach": {
    params: { chatId: string; path?: string; name?: string; mimeType?: string; data?: string }
    result: { kind: "file"; file: AttachmentFile } | { kind: "doc"; path: string } | { kind: "paper"; paperId: string }
  }
  // A copy whose chip was removed before sending; one a sent message still has is kept
  "chats.detach": { params: { chatId: string; path: string }; result: null }
  // Opens an attached file's copy in the system's app for it
  "chats.openFile": { params: { path: string }; result: null }

  // ---- Local agents (ACP over stdio). Built-in ones plus those the user added; each runs as one
  // process, started when needed and ended after ten idle minutes.
  "agents.list": { params: void; result: Connector[] }
  // What every agent owlit runs is told about owlit (owlit-mcp's instructions, a new session's preamble)
  "agents.rules": { params: void; result: string }
  // How to use owlit, for an agent asked about owlit itself: the list of topics, or one topic
  "agents.guide": { params: { topic?: string }; result: string }
  // Whether the agent is installed and signed in, and what it offers (models, modes, efforts)
  "agents.check": { params: { id: string }; result: Connector }
  // Fetches owlit's own copy of the agent's adapter (or a newer one) into owlit's data folder; returns at
  // once, and agents.changed carries the progress and the end
  "agents.setUp": { params: { id: string }; result: Connector }
  "agents.cancelSetUp": { params: { id: string }; result: Connector }
  "agents.add": { params: { name: string; command: string }; result: Connector }
  // Removes one the user added
  "agents.remove": { params: { id: string }; result: null }
  // Signs in with one of the agent's own sign-ins (Connector.signInMethods), then checks it again. A
  // browser sign-in resolves once the user has finished in the browser.
  "agents.signIn": { params: { id: string; methodId: string; apiKey?: string }; result: Connector }
  // One sign-in (methodId), or all of them
  "agents.signOut": { params: { id: string; methodId?: string }; result: Connector }
  // One turn of a chat on an agent. Core appends both messages to the chat, streams the answer as
  // chat.update and saves it; resolves when the turn ends.
  "agents.prompt": {
    params: {
      chatId: string
      connectorId: string
      modelId?: string
      role?: Role
      effortId?: string
      input: PromptInput
      // The two messages the app already shows: what the user sent, and the answer about to stream in
      userMessage: ChatMessage
      assistantMessageId: string
    }
    result: { stopReason: StopReason }
  }
  // Whether the agent of a chat may do something through owlit's own tools, by the chat's role: allowed,
  // refused (with why, for the agent), or asked of the user in the chat first. owlit-mcp asks before
  // deleting or moving docs and before adding papers.
  "agents.consent": { params: { chatId: string; action: ConsentAction; title: string }; result: { allowed: boolean; reason?: string } }
  // Deletes or moves the user's docs for an agent (owlit-mcp's docs_delete and docs_move, after consent),
  // keeping each file's text so the chat offers Undo
  "agents.deleteDocs": { params: { paths: string[]; chatId?: string }; result: { deleted: string[] } }
  "agents.moveDoc": { params: { path: string; to: string; chatId?: string }; result: { path: string } }
  // Stops the chat's running turn; questions it was waiting on close as cancelled
  "agents.cancel": { params: { chatId: string }; result: null }
  // Answers a permission_request with one of its options
  "agents.respondPermission": { params: { chatId: string; requestId: string; optionId: string }; result: null }
  // Answers a question_request by question id; null skips it (the agent goes on without an answer)
  "agents.answerQuestion": { params: { chatId: string; requestId: string; answers: Record<string, QuestionAnswer> | null }; result: null }

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
  // Takes back what a version recorded (VersionInfo): Undo of an agent's write, note or paper, or a
  // restore from a doc's Versions. A file that changed since is refused with Conflict unless forced.
  // redoId undoes the restore.
  "versions.restore": { params: { id: string; force?: boolean }; result: { path: string; kind: VersionInfo["kind"]; redoId: string } }
  // How much an agent's writes to one file changed it, from before the first version's write to after the
  // last one's; null when they aren't a file's or are no longer kept
  "versions.stats": { params: { from: string; to: string }; result: EditStats | null }
  // The versions kept, newest first; of one doc or topic, or of everything since a time
  "versions.list": { params: { path?: string; since?: number }; result: VersionInfo[] }

  // ---- Memory: what Owlit keeps in mind about the user (.owlit/memory.md)
  // The list, and the notes Claude Code kept for this folder that the user hasn't kept or dropped
  "memory.list": { params: void; result: { lines: MemoryLine[]; claudeNotes: ClaudeNote[] } }
  // An agent's change (owlit-mcp's memory_write); versionId undoes it. Errors are said to the agent.
  "memory.write": {
    params: { op: "add" | "replace" | "remove"; id?: string; kind?: MemoryKind; text?: string; chatId?: string }
    result: { line: MemoryLine | null; before: MemoryLine | null; versionId?: string }
  }
  // The user's change from Settings: a new line (no id), an edit, or a removed line put back (its id)
  "memory.put": { params: { id?: string; kind: MemoryKind; text: string; at?: number; chatId?: string }; result: MemoryLine[] }
  "memory.remove": { params: { id: string }; result: MemoryLine[] }
  // Copies the chosen Claude Code notes in (as the user edited them) and drops the rest, so none is
  // offered again
  "memory.decideClaudeNotes": { params: { keep: { file: string; kind: MemoryKind; text: string }[]; drop: string[] }; result: MemoryLine[] }

  // ---- Library: the workspace's papers
  // What a pasted reference (DOI, arXiv id, a link to a paper) means, and the paper the library
  // already has for it. Asks OpenAlex, Semantic Scholar and arXiv; writes nothing.
  "library.resolve": { params: { input: string }; result: { paper: ResolvedPaper; existingId?: string } }
  // A paper a search showed lately, as it showed it (the whole abstract), or the Library's record of it;
  // null when owlit knows nothing of it
  "library.found": { params: { id: string }; result: ThreadPaper | null }
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
  // Papers an agent added and the user hasn't worked with, to .owlit/trash/ as versions (Undo); papers
  // it may not remove come back in refused, with why
  "library.removeByAgent": { params: { ids: string[]; chatId?: string }; result: { removed: string[]; refused: { id: string; why: string }[] } }
  // Puts back what library.remove took (Undo), from the newest trash entry of each paper; a paper that is
  // in the library already comes back as it is
  "library.restore": { params: { ids: string[] }; result: Paper[] }
  // Papers removed in the last 30 days, newest first, one entry per paper; papers back in the library,
  // and copies folded into another paper, are left out
  "library.trash": { params: void; result: TrashedPaper[] }
  // Refresh details: asks the services about the paper again now and rewrites its details (the user's
  // own corrections stay). A paper found to be a copy of another is folded into it: that one comes back.
  "library.refresh": { params: { id: string }; result: Paper | null }
  // Adds a highlight, or replaces the one with its id
  "library.putHighlight": { params: { highlight: Highlight }; result: null }
  "library.removeHighlight": { params: { paperId: string; id: string }; result: Highlight | null }
  // Part of a paper as text: the full text (pages "3-5" or the section under a heading), the digest or
  // the user's note. pages: how many the paper has.
  "library.read": { params: { id: string; part: "text" | "digest" | "note"; pages?: string; section?: string }; result: { text: string; pages?: number } }
  // Papers out in the world for a query, from one source (OpenAlex unless asked); inLibrary when the
  // library has one already. A filter the source can't apply is refused. Each search, and each of the
  // two below, is kept in .owlit/searches.jsonl.
  "library.searchOnline": { params: { q: string; limit?: number; by?: string; source?: OnlineSource } & OnlineFilters; result: FoundPapers }
  // A paper's neighbours: what it cites, what cites it, or what resembles it. ref is a library id, an id
  // a search just returned, a DOI or an arXiv id.
  "library.related": {
    params: { ref: string; kind: "references" | "cited_by" | "similar"; limit?: number; by?: string } & Pick<OnlineFilters, "year" | "sort">
    result: FoundPapers
  }
  // Every research article a journal published in a year or years (Crossref), optionally only those
  // whose title or abstract has every word of query. journal is a name or an ISSN; a conference is
  // refused, since its proceedings can't be listed yet.
  "library.journal": { params: { journal: string; year: string; query?: string; offset?: number; limit?: number; by?: string }; result: FoundPapers }
  "library.highlights": { params: { id: string }; result: Highlight[] }
  // Queues a digest by a background agent (the paper menu's Write a digest, an agent's
  // library_request_digest); nothing when the paper has nothing to read. rewrite: the user asks for the
  // note there to be written again (a newer way of writing, another language); without it a paper that
  // has one is left as it is.
  "library.requestDigest": { params: { id: string; rewrite?: boolean }; result: null }
  // The paper's figures and tables as pictures, for its digest
  "library.figures": { params: { id: string }; result: PaperFigure[] }
  // A page of the paper's PDF as a small picture (base64), for a glance at a page a note points at
  "library.pagePicture": { params: { id: string; page: number }; result: { data: string; mimeType: string } }
  // The paper's digests (digest.md) as Markdown, or null
  "library.digest": { params: { id: string }; result: string | null }
  // Brings a pitta library (the folder holding papers/) into the workspace, once; papers already
  // here are skipped. Waits until it is done; progress shows as an import.pitta task.
  "library.importPitta": { params: { root: string }; result: { added: number; skipped: number; failed: string[] } }
  // Brings in a library at once: a Zotero library (zotero.sqlite, the folder holding it, or a Better BibTeX JSON
  // export), a BibTeX file, or a folder of PDFs. Returns once it has started; the import.<source> task
  // shows the progress, and an interrupted import carries on when the workspace opens again. Papers the
  // library has are skipped; nothing gets a digest. parse answers ahead whether MinerU reads every new PDF.
  "library.import": { params: { source: ImportSource; path: string; collectionsAsTags?: boolean; parse?: boolean }; result: ImportSummary }
  // The Zotero library in its usual place (~/Zotero), or null when there is none
  "library.findZotero": { params: void; result: string | null }
  // What importing that library would do, without adding anything
  "library.previewImport": { params: { source: ImportSource; path: string }; result: ImportPreview }
  // A cancelled or stopped import goes on, skipping what it did
  "library.continueImport": { params: { id: string }; result: ImportSummary }
  // Recent imports, newest first
  "library.imports": { params: void; result: ImportSummary[] }
  // The user's answer when an import asks before MinerU reads every PDF (confirm_spend): parse false
  // imports without MinerU for this import's papers. The import carries on either way.
  "library.importAnswer": { params: { id: string; parse: boolean }; result: ImportSummary }
  // The Library's line about a finished import is put away
  "library.dismissImport": { params: { id: string }; result: null }
  // The paper's full text, line by line with where each sits (text.json), or null before it is read
  "library.wear": { params: { id: string }; result: PaperWear }
  "library.text": { params: { id: string }; result: PaperText | null }
  // Looks for the paper's PDF now and waits: arXiv, open-access links, the publisher, Unpaywall. The
  // paper comes back with pdf, or with pdfState saying what was tried.
  "library.fetchPdf": { params: { id: string }; result: Paper }
  // Papers owlit couldn't get alone (pdfState), got from the user's own browser one at a time, behind
  // owlit's window and a few seconds apart: first those whose PDF their browser saves by itself, taken
  // from Downloads as each lands, then the article pages of the rest, for them to save the PDF from.
  // Joins the run going on, or resumes it when it stopped for the user. Runs as the task
  // papers.fromBrowser; the papers come back with pdfState.run.
  "library.getInBrowser": { params: { ids: string[] }; result: Paper[] }
  // Brings the user's browser to the front, at the paper's tab when owlit opened one for it (or the tab
  // the run is stopped on), where a page may be asking them something
  "library.showBrowser": { params: { id?: string }; result: null }
  // The user's answer about a downloaded PDF owlit offered (pdfState.run.offered): take it, or not
  "library.takeDownload": { params: { id: string; take: boolean }; result: Paper }
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
  // A workspace started or stopped opening, or one opened
  "workspace.state": WorkspaceState
  // The activity switch changed; renderers stop or start reporting
  "activity.status": { enabled: boolean }
  // Any setting changed, from any window or the app menu
  "settings.changed": SettingsView
  // Where an update stands changed: a check, a download, the switch
  "updates.changed": UpdatesView
  // Files in the workspace changed outside core; core's own changes are never echoed here
  "docs.changed": DocsChange
  // The dial moved, in any window
  "initiative.changed": InitiativeSettings
  // Owlit was kept out of a doc or let in, or looked at it
  "docs.owlit": { path: string; state: DocOwlit }
  // An agent's state changed (it started, ended, crashed, was checked)
  "agents.changed": Connector
  // One streamed update of a chat's running turn, for that turn's reply (messageId)
  "chat.update": { chatId: string; messageId: string; update: SessionUpdate }
  // A reply that had ended was opened again because the agent went on after its turn, or that reply ended
  // again: the reply as core has it (status "streaming" while it runs). What it adds streams as chat.update.
  "chat.lateReply": { chatId: string; message: ChatMessage }
  // A run Owlit started on its own began or ended: its session whole, as core has it (the first
  // message says why it started; the reply is "streaming" while it runs). Its steps stream as chat.update.
  "chats.run": { chat: Chat }
  // Core needs a window to do something only it can (UiActions)
  "ui.request": UiRequest
  // A note was added to a doc, by a window or by an agent over owlit-mcp; a window that already has it
  // (its own) ignores it
  "comments.changed": { path: string; comment: DocComment }
  // An undo took a note away
  "comments.removed": { path: string; id: string }
  // Owlit's memory changed (an agent, Settings, an undo); the whole list as it is now
  "memory.changed": { lines: MemoryLine[] }
  // An agent wrote a file no window had open; versionId undoes it
  "agent.wrote": { path: string; versionId: string; chatId?: string }
  // An agent in a chat left a note, added a paper or wrote to a thread; versionId undoes it.
  // label names what changed (the doc, the paper's title, the thread's title).
  // op "removed": an agent took back a paper it added (absent: an addition or a write)
  // kind "thread": path is the thread's id; created when the write started it, rows the papers it
  // added and updated how many it changed, asked the question it was for
  // kind "memory": path is the line's id and label its text (the old text when removed); op "updated"
  // when it replaced a line, memory which kind of line
  "agent.changed": {
    kind: "note" | "paper" | "thread" | "memory"
    op?: "removed" | "updated"
    memory?: MemoryKind
    versionId: string
    path: string
    label: string
    chatId?: string
    created?: boolean
    rows?: string[]
    updated?: number
    asked?: string
  }

  // Papers changed by core on its own (a task) or by another program; may repeat the window's own
  // changes, which the window takes as they are
  "library.changed": LibraryChange
  // A paper's note changed outside the window (an agent's edit, another program); null when it was emptied
  "library.noteChanged": { paperId: string; note: PaperNote | null }
  // A thread changed (an agent wrote to it, the user changed it in another window, an undo); null:
  // it was deleted
  "threads.changed": { id: string; thread: Thread | null }
  // A shared doc's state changed (pushed, couldn't push, renamed); share null: no longer shared
  "share.changed": { path: string; share: DocShare | null }
  // New or changed comments on a shared doc: all of them, as they are now
  "share.comments": { path: string; comments: ShareComment[] }
  // A task changed; sent at most every 200ms per task, always with its latest state
  "tasks.changed": { task: Task }
}

export type MethodName = keyof Methods
export type NotificationName = keyof Notifications
export type ParamsOf<M extends MethodName> = Methods[M]["params"]
export type ResultOf<M extends MethodName> = Methods[M]["result"]

export interface CoreVersion {
  version: string
  // Node's version inside the host, e.g. Electron's
  node: string
}

export type MenuCommand = "settings" | "shortcuts" | "how-to" | "tour" | "intro" | "import" | "diagnostics"

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
  // The interface's locale, asked the same way so the first frame is already in its language
  locale: Locale
  // A command from the app's own menu (Settings…, Help › Keyboard Shortcuts, Help › Ask Owlit How To…)
  onMenu(listener: (command: MenuCommand) => void): () => void
  // The system's folder picker; the chosen folder, or null when cancelled
  chooseFolder(options: { title: string; message?: string; buttonLabel?: string; defaultPath?: string }): Promise<string | null>
  // The system's file picker, showing only files with these extensions (without the dot); null when cancelled
  chooseFile(options: { title: string; message?: string; buttonLabel?: string; extensions: string[] }): Promise<string | null>
  // A right-click the page leaves to the system's text menu: whether what is selected can be handed to
  // Owlit, so the menu starts with "Ask Owlit". Told synchronously, so the app knows before it draws the menu.
  textMenuAsk(ask: boolean): void
  // "Ask Owlit" was chosen in that menu
  onTextMenuAsk(listener: () => void): () => void
  // A system notification, shown only while no owlit window is in front; clicking it brings the window
  // forward and calls onNotificationClick with its chatId
  notify(notification: { title: string; body: string; chatId: string }): void
  // Quits and installs the downloaded update; asks first, in the system's dialog, while a chat is answering
  restartToUpdate(): Promise<void>
  onNotificationClick(listener: (chatId: string) => void): () => void
}
