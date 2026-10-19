// Chat domain types. Message parts and session updates follow the shape of the
// Agent Client Protocol (ACP) so a real local-agent connector can feed them later.

import type { FileKind } from "./files.ts"
import type { Role } from "./roles.ts"

export type SourceKind = "paper" | "doc" | "thread"

// Something the user can @-mention: a paper, a doc or a thread
export interface Mentionable {
  id: string
  kind: SourceKind
  title: string
  // paper: authors · year; doc: relative path; thread: how many papers
  subtitle?: string
  uri: string
}

// A file the user attached to a message. owlit copies it into the chat's own folder when it is attached
// (.owlit/chats/<chat id>/files/), and the agent reads the copy; the original is never touched.
export interface AttachmentFile {
  id: string
  name: string
  size: number
  mimeType: string
  // The copy, relative to the workspace: what the agent is pointed at and what clicking the chip opens.
  // Missing on files attached before owlit kept copies (only their name was kept)
  path?: string
  // The paper it became, once the user added this PDF to the Library from its chip
  paperId?: string
  // Object URL for image previews; not persisted
  previewUrl?: string
}

export type ToolKind =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "switch_mode"
  | "other"

export type ToolStatus = "pending" | "in_progress" | "completed" | "failed"

export interface ToolLocation {
  path: string
  line?: number
}

// ACP "diff" tool call content: a file's whole text before and after an edit
export interface FileDiff {
  // Workspace-relative path, e.g. "writing/Related work.md"
  path: string
  oldText: string
  newText: string
}

// A passage the user selected and sent along with a message
export interface QuotedSelection {
  text: string
  // The doc or paper it came from
  source: Mentionable
  // Where it starts in a doc, so the passage is found again even when the same words appear twice
  from?: number
  // The page of a paper it was selected on, counted from 1
  page?: number
  // Selected in the paper's note rather than its PDF: the note is the user's, kept at notePath
  // (library/papers/<id>/note.md), and an edit to it is shown in the note before anything changes
  notePath?: string
  // Selected in Owlit's digest of the paper (digest.md): Owlit's reading of it, not the paper's own words
  inDigest?: boolean
  // Asked from a comment on the passage (Ask Owlit on its card): what was said there, in order, each
  // entry with who said it ("Owlit", "You", a reader's name)
  comment?: { entries: { who: string; text: string }[] }
}

export interface PlanEntry {
  content: string
  priority: "high" | "medium" | "low"
  status: "pending" | "in_progress" | "completed"
}

// What the agent called, when it says (Claude Code does): its own name for the tool and the few inputs
// that say what the step is for, so the app can name the step in words. Never a file's contents.
export interface ToolInfo {
  // The agent's tool: "Bash", "Read", "WebSearch", "mcp__owlit__library_search", …
  name: string
  // The agent's own one-line account of the step (Claude Code writes one for each command)
  description?: string
  command?: string
  query?: string
  url?: string
  // What a file search looks for
  pattern?: string
  path?: string
  // What one of owlit's own tools is about, when its input isn't a query or a path: the journal
  // library_journal lists, the paper library_related starts from
  subject?: string
}

// A question the agent asks the user (Claude Code's AskUserQuestion, sent as an ACP form)
export interface QuestionOption {
  label: string
  description?: string
}

export interface AgentQuestion {
  id: string
  // A short label the agent gives the question, if any
  header?: string
  question: string
  // None for a question answered in words only
  options: QuestionOption[]
  multiSelect?: boolean
  // Whether words of the user's own are taken besides (or instead of) the options
  allowsText: boolean
}

// What the user gave for one question: options picked, words typed, or both
export interface QuestionAnswer {
  picks?: string[]
  text?: string
}

export type PermissionKind = "allow_once" | "allow_always" | "reject_once" | "reject_always"

export interface PermissionOption {
  optionId: string
  name: string
  kind: PermissionKind
}

export type MessagePart =
  // messageId: the agent's own message this text belongs to, when it says (a new one starts a new paragraph)
  | { type: "text"; text: string; messageId?: string }
  | { type: "thought"; text: string }
  | {
      type: "tool_call"
      toolCallId: string
      title: string
      kind: ToolKind
      status: ToolStatus
      content?: string
      locations?: ToolLocation[]
      diff?: FileDiff
      tool?: ToolInfo
      // Set when one of the agent's own agents took this step (its id, as on the agent part)
      agentId?: string
    }
  | { type: "plan"; entries: PlanEntry[] }
  // An agent the answering agent handed part of the work to, where it was handed out: its task as the
  // agent named it, how it is doing, and the report it handed back
  | { type: "agent"; agentId: string; title: string; status: AgentStatus; report?: string }
  | {
      type: "question"
      requestId: string
      // The step that asks, when the agent names one
      toolCallId?: string
      questions: AgentQuestion[]
      // Set once answered (by question id), skipped or closed
      answers?: Record<string, QuestionAnswer>
      outcome?: "answered" | "skipped" | "cancelled"
      agentId?: string
    }
  | {
      type: "permission"
      requestId: string
      toolCallId: string
      title: string
      kind: ToolKind
      options: PermissionOption[]
      // Set once the user answered
      outcome?: PermissionKind | "cancelled"
      agentId?: string
    }

// How an agent handed part of the work is doing: still at it, finished (with or without a report), broke,
// or stopped with the answer
export type AgentStatus = "working" | "done" | "failed" | "stopped"

export type MessageStatus = "streaming" | "done" | "cancelled" | "error"

export interface ChatMessage {
  id: string
  role: "user" | "assistant"
  parts: MessagePart[]
  attachments?: AttachmentFile[]
  mentions?: Mentionable[]
  context?: Mentionable[]
  selection?: QuotedSelection
  createdAt: number
  // When a reply ended: finished, stopped or broke
  finishedAt?: number
  status?: MessageStatus
  // Connector and model that produced an assistant message
  connectorId?: string
  modelId?: string
  // Why a reply broke, in owlit's words, and the agent's own words for it when it gave some ("API Error:
  // 403 Request not allowed"), kept apart from the answer
  error?: string
  errorDetail?: string
  // What an answer was built from, set when its turn ends: each paper it read or cited, and how far
  // (core's view of the turn's library_read calls, not the agent's word)
  readFrom?: ReadFrom[]
}

// full: it read the paper's text; digest: only Owlit's digest; abstract: neither, though owlit has the
// text (it went on the abstract or the details); none: owlit has no text of the paper
export interface ReadFrom {
  paperId: string
  depth: "full" | "digest" | "abstract" | "none"
}

export interface Chat {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  pinned: boolean
  connectorId?: string
  modelId?: string
  role?: Role
  effortId?: string
  // The ACP session this chat has on each agent (connector id → session id), so it continues where it
  // left off after a restart; kept by core
  sessions?: Record<string, string>
  // Work the user asked Owlit for in the background (a digest, a thread's gathering): a run, not one of
  // their chats. It isn't in the chat list; its first message, though stored as a question, is the reason
  // it started, in Owlit's words.
  startedBy?: "owlit"
  run?: OwlitRun
  messages: ChatMessage[]
}

// The background task an Owlit run is the session of
export interface OwlitRun {
  taskId: string
  // The task's kind and subject (paper.digest on a paper id, threads.more on a thread id)
  kind: string
  subject: string
}

// A chat without its messages, as the chat list shows it
export type ChatSummary = Omit<Chat, "messages">

// One of Owlit's runs as Home lists what it did while the user was away: its session's summary and how
// its last part ended
export type RunSummary = ChatSummary & { run: OwlitRun; ended: "done" | "error" | "cancelled"; endedAt: number }

// ---- Local agent connectors ----

export type ConnectorStatus =
  | "unknown"
  | "checking"
  | "not_installed"
  | "available"
  | "connected"
  | "error"

export interface AgentModel {
  id: string
  name: string
  description?: string
  // The heading it goes under in the picker, when the agent groups its models (the Owlit engine, by provider)
  group?: string
}

export interface AgentMode {
  id: string
  name: string
  description?: string
}

// Reasoning effort, when the agent exposes it (Claude Code, Codex)
export interface AgentEffort {
  id: string
  name: string
  description?: string
}

export interface SignInMethod {
  id: string
  name: string
  description?: string
  apiKey?: boolean
  // Methods for the same provider replace each other (ChatGPT and an OpenAI key)
  provider?: string
}

// A sign-in the agent holds now; a key shows only its last four characters
export interface SignIn {
  methodId: string
  name: string
  hint?: string
}

// owlit's own copy of an agent's ACP adapter (Claude Code, Codex), kept in owlit's data folder, so someone
// with the agent signed in needs nothing else
export interface AgentSetup {
  // The agent's own command (claude, codex) is on this Mac
  cliFound: boolean
  // About how big the adapter is
  sizeMb: number
  // The version of owlit's copy, once set up
  installed?: string
  // A newer adapter than the one set up
  latest?: string
  // Being set up now, 0 to 1
  progress?: number
  // Why the last setup failed
  error?: string
}

export interface Connector {
  id: string
  name: string
  description: string
  // Command the desktop shell will spawn (ACP over stdio)
  command: string
  installHint?: string
  // What the user runs in a terminal to sign in, for agents that need it
  signIn?: string
  // Sign-ins the agent runs itself, offered in owlit (the Owlit engine): a browser sign-in, or an API key
  // for one provider when apiKey is set
  signInMethods?: SignInMethod[]
  // The ones it is signed in with now
  signIns?: SignIn[]
  // It signs in inside owlit (Settings), not in a terminal (the Owlit engine)
  signsInHere?: boolean
  // The agent's own sign-in in the browser that owlit runs (Claude Code's Claude subscription, Codex's
  // ChatGPT): the methodId for agents.signIn
  browserSignIn?: string
  builtIn: boolean
  status: ConnectorStatus
  version?: string
  authenticated?: boolean
  error?: string
  models: AgentModel[]
  modes: AgentMode[]
  efforts?: AgentEffort[]
  defaultModelId?: string
  defaultModeId?: string
  defaultEffortId?: string
  // Kinds of attached file this agent can't read (profiles.ts knows), said on a file's chip before sending
  cannotRead?: FileKind[]
  // For the agents owlit can set up itself
  setup?: AgentSetup
}

// ---- Session updates streamed from an agent (ACP SessionUpdate subset) ----

export type SessionUpdate =
  | { type: "agent_message_chunk"; text: string; messageId?: string }
  | { type: "agent_thought_chunk"; text: string }
  | {
      type: "tool_call"
      toolCallId: string
      title: string
      kind: ToolKind
      status: ToolStatus
      content?: string
      locations?: ToolLocation[]
      diff?: FileDiff
      tool?: ToolInfo
      agentId?: string
    }
  | {
      type: "tool_call_update"
      toolCallId: string
      status?: ToolStatus
      title?: string
      content?: string
      locations?: ToolLocation[]
      diff?: FileDiff
      tool?: ToolInfo
    }
  | { type: "plan"; entries: PlanEntry[] }
  | { type: "agent_started"; agentId: string; title: string }
  | { type: "agent_update"; agentId: string; title?: string; status?: AgentStatus; report?: string }
  | {
      type: "permission_request"
      requestId: string
      toolCallId: string
      title: string
      kind: ToolKind
      options: PermissionOption[]
      agentId?: string
    }
  | { type: "permission_resolved"; requestId: string; outcome: PermissionKind | "cancelled" }
  | { type: "question_request"; requestId: string; toolCallId?: string; questions: AgentQuestion[]; agentId?: string }
  | { type: "question_resolved"; requestId: string; outcome: "answered" | "skipped" | "cancelled"; answers?: Record<string, QuestionAnswer> }

export type StopReason = "end_turn" | "cancelled" | "refusal" | "error"

export interface PromptInput {
  text: string
  mentions: Mentionable[]
  attachments: AttachmentFile[]
  // What is on screen when asking from the agent window (the open doc or paper)
  context?: Mentionable[]
  selection?: QuotedSelection
}
