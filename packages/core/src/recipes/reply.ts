import { isOwlit, type DocComment } from "@owlit/protocol"
import { CORRECT, correctable } from "../docs/comments.ts"
import type { Recipe } from "./index.ts"

// The person replied under one of Owlit's comments on their doc: Owlit answers there, in its own voice,
// as briefly as a comment reply is, and rewrites its own comment when the reply shows it wrong. Each
// reply is a turn in the one chat about that comment, so a later answer remembers the earlier ones.

export interface ReplyInput {
  path: string
  // The doc as it is now, for the passage's surroundings
  content: string
  comment: DocComment
}

// The citation rule of agents/rules.ts, repeated where the answer's form is asked for (change them together)
const CITE = `When you say something about a paper, cite it with the sentence it rests on as the link's title, word for word from library_read: [Author Year](owlit://library/<id>#p<page> "sentence").`

const correcting = (where: string) =>
  `If what you said in your own first entry turns out to be wrong, don't only say so: reply with comments_reply (${where}) whose text is ${CORRECT} followed by that entry rewritten so it says the right thing (the whole entry, in the same language, citations kept as they should be), and nothing else. owlit replaces your entry with it and keeps the old words; the user's replies under it stay. A comment that carries over what someone else said (from a Go through) isn't yours to rewrite: answer under it instead.`

// Without an input (owlit_help), the recipe says what to do whenever the user replies under a comment of
// Owlit's
export function replyRecipe(input?: ReplyInput) {
  if (!input) {
    return [
      `When the user replies under one of your comments on their doc, answer their latest reply there with comments_reply (the doc's path and the comment's id, from docs_comments), as a short reply (one to four sentences) in the language they wrote in. You may look things up in their library and docs; don't change the doc. If they asked you to change something, say what you would change and that they can ask you in a chat (the feather on the comment) to make the edit.`,
      CITE,
      correcting("the same path and id"),
    ].join("\n\n")
  }
  const { path, content, comment } = input
  const at = content.indexOf(comment.quote)
  const around = at >= 0 ? content.slice(Math.max(0, at - 600), at + comment.quote.length + 600) : comment.quote
  const thread = comment.entries.map((e) => `${isOwlit(e.by) ? "Owlit" : "The user"}: ${e.text}`).join("\n\n")
  const where = `path "${path}", id "${comment.id}"`
  return [
    `You are Owlit. On the user's doc ${path} you left a comment on the words «${comment.quote}», and the user has replied. Answer their latest reply in the comment with comments_reply (${where}), as a short reply (one to four sentences), in the language they wrote in. You may look things up in their library and docs; you don't change the doc. If they asked you to change something, say what you would change and that they can ask you in a chat (the feather on the comment) to make the edit.`,
    `Around the words:\n\n${around}`,
    `The comment so far:\n\n${thread}`,
    CITE,
    ...(correctable(comment) ? [correcting(where)] : []),
    `The reply is the answer: no preamble, no quoting the thread back. The user reads only the comment, so put nothing in this chat but one line saying you replied.`,
  ].join("\n\n")
}

export const reply: Recipe<ReplyInput | undefined> = {
  description: "answer the user's reply under one of your comments on their doc, in the comment, and correct your own comment when the reply shows it wrong (no thread)",
  text: replyRecipe,
}
