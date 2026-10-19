import type { DocComment } from "@owlit/protocol"
import { defineSkill } from "./skills.ts"

// Owlit's own comments on the user's docs: how it answers under one, and how it looks at one again.
// It never edits the doc; its comments are its own words.

export interface ReplyInput {
  path: string
  // The doc as it is now, for the passage's surroundings
  content: string
  comment: DocComment
}

// A reply of the user's under one of Owlit's comments: Owlit answers in the comment, in its own voice,
// as briefly as a comment reply is. The answer is the reply; it writes nothing else.
export function replyPrompt({ path, content, comment }: ReplyInput) {
  const at = content.indexOf(comment.quote)
  const around = at >= 0 ? content.slice(Math.max(0, at - 600), at + comment.quote.length + 600) : comment.quote
  const thread = comment.entries.map((e) => `${e.by === "owlit" ? "Owlit" : "The user"}: ${e.text}`).join("\n\n")
  return [
    `You are Owlit. On the user's doc ${path} you left a comment on the words «${comment.quote}», and the user has replied. Answer their latest reply, in the comment, as a short reply (one to four sentences), in the language they wrote in. You may look things up in their library and docs; you can't change the doc. If they asked you to change something, say what you would change and that they can ask you in a chat (the feather on the comment) to make the edit.`,
    `Around the words:\n\n${around}`,
    `The comment so far:\n\n${thread}`,
    `Answer with the reply only: no preamble, no quoting the thread back.`,
  ].join("\n\n")
}

export const replySkill = defineSkill<ReplyInput>({
  id: "docs.reply",
  format: 1,
  lane: "agent",
  tools: /^library_(search|related)$/,
  writes: ["comment"],
  instructions: replyPrompt,
})

export interface RecheckInput {
  path: string
  content: string
  comment: DocComment
  paperId: string
  title: string
}

// One of Owlit's comments leans on a paper the user has now read in full: Owlit reads the paper again,
// with what the user marked in it, and says in the comment whether what it said still holds
export function recheckPrompt({ path, content, comment, paperId, title }: RecheckInput) {
  const at = content.indexOf(comment.quote)
  const around = at >= 0 ? content.slice(Math.max(0, at - 600), at + comment.quote.length + 600) : comment.quote
  const thread = comment.entries.map((e) => `${e.by === "owlit" ? "Owlit" : "The user"}: ${e.text}`).join("\n\n")
  return [
    `You are Owlit. On the user's doc ${path} you left a comment on the words «${comment.quote}» that leans on the paper “${title}” (${paperId}). The user has since read that paper in full. Read it again (library_read), with what they highlighted and noted in it (library_highlights, library_get), and check whether what you said still holds.`,
    `Around the words:\n\n${around}`,
    `The comment so far:\n\n${thread}`,
    `If it still holds, answer only "Still holds." If it needs correcting or adding to, answer with the short addition to the comment itself (one to three sentences, in the language of the doc), no preamble.`,
  ].join("\n\n")
}

export const recheckSkill = defineSkill<RecheckInput>({
  id: "docs.recheck",
  format: 1,
  lane: "agent",
  writes: ["comment"],
  instructions: recheckPrompt,
})
