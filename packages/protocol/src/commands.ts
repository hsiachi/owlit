import type { Role } from "./roles.ts"

// The recipes a person starts by name, as a message that begins with "/<name>": the composer offers them
// when "/" starts a message, and core hands the turn the recipe (core/src/recipes/) in place of the name.
// The names are core's recipe names. The rest of the message is the person's own words for it (what to
// look at, which comments).
export const COMMANDS = ["review", "revise", "go-through"] as const

export type CommandName = (typeof COMMANDS)[number]

// The role a command puts a chat in when picked, so the role menu shows what it will do. A review only
// reads and comments, so it is a Reviewer's; revising edits the doc, which a Reviewer can't, so it
// takes Assistant from a Reviewer and keeps any other role. Going through writes only Owlit's own record
// and comments, which every role may.
export function commandRole(name: CommandName, role: Role): Role {
  if (name === "review") return "reviewer"
  if (name === "revise" && role === "reviewer") return "assistant"
  return role
}

// The command a message starts with, and the words after it; null when it starts with none. The name
// ends at a space, a line's end or the message's end, so "/reviewer" or a path ("/Users/…") is text.
export function commandOf(text: string): { name: CommandName; rest: string } | null {
  const m = /^\/([a-z-]+)(?=\s|$)/.exec(text)
  const name = m?.[1]
  if (!name || !(COMMANDS as readonly string[]).includes(name)) return null
  return { name: name as CommandName, rest: text.slice(m[0].length).trim() }
}
