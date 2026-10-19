import { isOwlit, type DocComment } from "@owlit/protocol"
import { defineSkill } from "./skills.ts"

// Owlit's own comments on the user's docs: how it answers under one, and how it looks at one again.
// It never edits the doc; its comments are its own words.

// The citation rule of agents/rules.ts, repeated where the answer's form is asked for (change them together)
const CITE = `When you say something about a paper, cite it with the sentence it rests on as the link's title, word for word from library_read: [Author Year](owlit://library/<id>#p<page> "sentence").`

// The answer that rewrites Owlit's own first entry in the comment, when what it said there was wrong:
// reviews.ts reads it (correctionOf), keeping the old words for the card's "was". Not for a point a Go
// through carried over (source): its first entry is what someone said, not Owlit's to rewrite.
export const CORRECT = "CORRECT:"
export const correctable = (comment: DocComment) => !!comment.entries[0] && isOwlit(comment.entries[0].by) && !comment.source
// The rewritten entry an answer gives, or null when it isn't a correction
export function correctionOf(answer: string): string | null {
  const t = answer.trim()
  return t.startsWith(CORRECT) ? t.slice(CORRECT.length).trim() || null : null
}
const CORRECTING = `If what you said in your own first entry turns out to be wrong, don't only say so: answer with ${CORRECT} followed by that entry rewritten so it says the right thing (the whole entry, in the same language, citations kept as they should be), and nothing else. owlit replaces your entry with it and keeps the old words; the user's replies under it stay.`

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
  const thread = comment.entries.map((e) => `${isOwlit(e.by) ? "Owlit" : "The user"}: ${e.text}`).join("\n\n")
  return [
    `You are Owlit. On the user's doc ${path} you left a comment on the words «${comment.quote}», and the user has replied. Answer their latest reply, in the comment, as a short reply (one to four sentences), in the language they wrote in. You may look things up in their library and docs; you can't change the doc. If they asked you to change something, say what you would change and that they can ask you in a chat (the feather on the comment) to make the edit.`,
    `Around the words:\n\n${around}`,
    `The comment so far:\n\n${thread}`,
    CITE,
    ...(correctable(comment) ? [CORRECTING, `Otherwise answer with the reply only: no preamble, no quoting the thread back.`] : [`Answer with the reply only: no preamble, no quoting the thread back.`]),
  ].join("\n\n")
}

export const replySkill = defineSkill<ReplyInput>({
  id: "docs.reply",
  format: 3,
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
  const thread = comment.entries.map((e) => `${isOwlit(e.by) ? "Owlit" : "The user"}: ${e.text}`).join("\n\n")
  return [
    `You are Owlit. On the user's doc ${path} you left a comment on the words «${comment.quote}» that leans on the paper “${title}” (${paperId}). The user has since read that paper in full. Read it again (library_read), with what they highlighted and noted in it (library_highlights, library_get), and check whether what you said still holds.`,
    `Around the words:\n\n${around}`,
    `The comment so far:\n\n${thread}`,
    CITE,
    correctable(comment)
      ? `If it still holds, answer only "Still holds." If it was wrong, answer in the ${CORRECT} form below. If it needs adding to, answer with the short addition to the comment itself (one to three sentences, in the language of the doc), no preamble.`
      : `If it still holds, answer only "Still holds." If it needs correcting or adding to, answer with the short addition to the comment itself (one to three sentences, in the language of the doc), no preamble.`,
    ...(correctable(comment) ? [CORRECTING] : []),
  ].join("\n\n")
}

export const recheckSkill = defineSkill<RecheckInput>({
  id: "docs.recheck",
  format: 3,
  lane: "agent",
  writes: ["comment"],
  instructions: recheckPrompt,
})
