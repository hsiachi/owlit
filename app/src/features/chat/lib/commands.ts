import { t } from "@lingui/core/macro"
import { COMMANDS, type CommandName } from "@owlit/protocol"

// What the composer's "/" list says of each command, in the interface's language. The name stays as typed
// ("/review"): it is what goes in the message, and core finds the recipe by it.
export function commandWords(name: CommandName): string {
  switch (name) {
    case "review":
      return t({ message: "Read a doc as a reader and leave comments where it doesn't hold. Say what to look at, or who the reader is.", comment: "the /review command in the composer's list" })
    case "revise":
      return t({ message: "Revise a doc by its comments with Owlit, a paragraph at a time: edit, then resolve each saying what was done.", comment: "the /revise command in the composer's list" })
    case "go-through":
      return t({ message: "Go through a meeting, reviews or someone's notes against your docs: what changes, as comments on the docs.", comment: "the /go-through command in the composer's list" })
  }
}

// The commands whose name starts with what is typed after "/"
export const commandsFor = (query: string): CommandName[] => COMMANDS.filter((name) => name.startsWith(query.toLowerCase()))
