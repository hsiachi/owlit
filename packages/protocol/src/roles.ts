// How far Owlit may go in a chat without asking. Owlit's own permission levels, the same whichever agent
// runs underneath; core turns each into that agent's own controls (agents/roles.ts).
export type Role = "reviewer" | "assistant" | "coauthor"

export const ROLES: { id: Role; name: string; description: string }[] = [
  { id: "reviewer", name: "Reviewer", description: "Reads, answers and leaves comments. Never changes what is yours." },
  { id: "assistant", name: "Assistant", description: "Finds and adds papers, keeps its own notes. Your writing changes only when you apply it." },
  { id: "coauthor", name: "Co-author", description: "Also edits your docs and runs commands in this workspace. Every change can be undone." },
]

export const DEFAULT_ROLE: Role = "assistant"

// What a call to core touches, declared by every router method (core/src/rpc/router.ts): a person and
// their Owlit have the same methods, and this is what the role decides over.
// read: changes nothing. own: Owlit's own things (its comments, the papers it added that nobody else
// touched, its highlights, threads and memory). meta: a person's thing, but only its marks and names (a
// paper's star, status and tags; a comment resolved; a thread's name). words: a person's text.
// structure: delete or move a person's thing. admin: the workspace, settings, agents, sharing, chats.
export type Touches = "read" | "own" | "meta" | "words" | "structure" | "admin"

export type RoleAnswer = "allow" | "ask" | "refuse"

// What each role may do with each class, through owlit's own tools; the person at the window is never
// policed. ask: the user is asked in the chat (refused between turns, when nobody is there to ask).
export const ROLE_TABLE: Record<Touches, Record<Role, RoleAnswer>> = {
  read: { reviewer: "allow", assistant: "allow", coauthor: "allow" },
  own: { reviewer: "allow", assistant: "allow", coauthor: "allow" },
  meta: { reviewer: "refuse", assistant: "allow", coauthor: "allow" },
  words: { reviewer: "refuse", assistant: "ask", coauthor: "allow" },
  structure: { reviewer: "refuse", assistant: "ask", coauthor: "allow" },
  admin: { reviewer: "refuse", assistant: "refuse", coauthor: "refuse" },
}

// The line a tool's description ends with, so the agent knows before it tries what each role gets
export function roleLine(touches: Touches): string {
  if (touches === "read") return ""
  if (touches === "own") return "Allowed in every role; the user can undo it."
  if (touches === "admin") return "Refused in every role."
  const say = (role: Role) => {
    const answer = ROLE_TABLE[touches][role]
    return answer === "allow" ? "allowed, the user can undo it" : answer === "ask" ? "the user is asked" : "refused"
  }
  return `Reviewer: ${say("reviewer")}. Assistant: ${say("assistant")}. Co-author: ${say("coauthor")}.`
}
