// How far Owlit may go in a chat without asking. Owlit's own permission levels, the same whichever agent
// runs underneath; core turns each into that agent's own controls (agents/roles.ts).
export type Role = "reviewer" | "assistant" | "coauthor"

export const ROLES: { id: Role; name: string }[] = [
  { id: "reviewer", name: "Reviewer" },
  { id: "assistant", name: "Assistant" },
  { id: "coauthor", name: "Co-author" },
]

export const DEFAULT_ROLE: Role = "assistant"

// What a call to core touches, declared by every router method (core/src/rpc/router.ts): a person and
// their Owlit have the same methods, and this is what the role decides over.
// read: changes nothing. own: Owlit's own things (its comments, the papers it added that nobody else
// touched, its highlights, threads and memory). meta: a person's thing, but only its marks and names (a
// paper's star, status and tags; a comment resolved; a thread's name). words: a person's text.
// structure: delete or move a person's thing. admin: the workspace, settings, agents, sharing, chats.
export type Touches = "read" | "own" | "meta" | "words" | "structure" | "admin"

// propose: the change is made at once and recorded as Owlit's, marked until the person has seen it, with
// Undo per passage or row; nothing waits on a card. It differs from allow only in what the person is
// promised: the change is a proposal they may take back in part, not a decision made for them.
export type RoleAnswer = "allow" | "propose" | "refuse"

// What each role may do with each class, through owlit's own tools; the person at the window is never
// policed. Nothing asks: a change either lands (shown and undoable) or is refused with why.
export const ROLE_TABLE: Record<Touches, Record<Role, RoleAnswer>> = {
  read: { reviewer: "allow", assistant: "allow", coauthor: "allow" },
  own: { reviewer: "allow", assistant: "allow", coauthor: "allow" },
  meta: { reviewer: "refuse", assistant: "allow", coauthor: "allow" },
  words: { reviewer: "refuse", assistant: "propose", coauthor: "allow" },
  structure: { reviewer: "refuse", assistant: "propose", coauthor: "allow" },
  admin: { reviewer: "refuse", assistant: "refuse", coauthor: "refuse" },
}

// The line a tool's description ends with, so the agent knows before it tries what each role gets
export function roleLine(touches: Touches): string {
  if (touches === "read") return ""
  if (touches === "own") return "Allowed in every role; the user can undo it."
  if (touches === "admin") return "Refused in every role."
  const say = (role: Role) => {
    const answer = ROLE_TABLE[touches][role]
    return answer === "allow" ? "allowed, the user can undo it" : answer === "propose" ? "lands as a proposal the user sees marked and may undo in part" : "refused"
  }
  return `Reviewer: ${say("reviewer")}. Assistant: ${say("assistant")}. Co-author: ${say("coauthor")}.`
}

// Whether the role's agent may change things with commands; every role may run read-only ones inside the
// sandbox. The engine's own controls hold it (core/agents/profiles.ts).
export const RUNS_COMMANDS: Record<Role, boolean> = { reviewer: false, assistant: false, coauthor: true }

// What a role may do, one sentence a class, read off the table, in the words the agent hears (its role
// note). The app says the same sentences in the interface's language, for the person, from the same
// table (app/src/features/chat/lib/selection.ts), so the product and the code promise one thing; a
// sentence changed here changes there. commands: false for an engine with no command tool (the Owlit
// engine), which would otherwise be told a Co-author runs commands.
export function roleSentences(role: Role, { commands = true }: { commands?: boolean } = {}): string[] {
  const out = ["Reads the user's workspace", "Keeps its own comments, threads, memory and highlights"]
  if (ROLE_TABLE.meta[role] !== "refuse") out.push("Stars, tags and sorts the user's papers, with Undo")
  const words = ROLE_TABLE.words[role]
  out.push(words === "refuse" ? "Never changes the user's writing" : words === "propose" ? "Edits the user's docs as marked proposals; they may undo any part" : "Edits the user's docs; they may undo any part")
  if (ROLE_TABLE.structure[role] !== "refuse") out.push("Moves or deletes docs into the Trash, with Undo")
  if (!commands) return out
  if (RUNS_COMMANDS[role]) out.push("Runs commands in this workspace; what they change outside the user's docs has no Undo")
  else if (words !== "refuse") out.push("Never changes anything with commands")
  return out
}

// What an agent is told its role is, before how to work within it: the role's name and its sentences
export function roleSummary(role: Role, options?: { commands?: boolean }) {
  const name = ROLES.find((r) => r.id === role)!.name
  return `In this chat Owlit works as ${name}: ${roleSentences(role, options).join(". ")}.`
}
