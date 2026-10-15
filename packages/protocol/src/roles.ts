// How far Owlit may go in a chat without asking. Owlit's own permission levels, the same whichever agent
// runs underneath; core turns each into that agent's own controls (agents/roles.ts).
export type Role = "reviewer" | "assistant" | "coauthor"

export const ROLES: { id: Role; name: string; description: string }[] = [
  { id: "reviewer", name: "Reviewer", description: "Reads, answers and leaves comments. Never changes your files or library." },
  { id: "assistant", name: "Assistant", description: "Finds and adds papers, keeps its own notes. Your writing changes only when you apply it." },
  { id: "coauthor", name: "Co-author", description: "Also edits your docs and runs commands in this workspace. Every change can be undone." },
]

export const DEFAULT_ROLE: Role = "assistant"

// What owlit's own tools ask consent for (agents.consent)
export type ConsentAction = "delete" | "move" | "add_paper"
