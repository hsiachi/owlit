import { createHash } from "node:crypto"
import type { DocComment } from "@owlit/protocol"
import { defineSkill } from "./skills.ts"

// Review: Owlit reads a doc of the user's that changed since it last looked and comments where it has
// something only it can say from the workspace. It never edits the doc; its comments are its own words,
// under the paragraph they are about.

export interface Paragraph {
  text: string
  // A short hash of the paragraph's words, so the next look reads only what is new
  hash: string
}

// A doc's paragraphs: blocks between blank lines, headings included, front matter and empty ones not
export function paragraphsOf(content: string): Paragraph[] {
  const body = content.replace(/^---\n[\s\S]*?\n---\n/, "")
  return body
    .split(/\n\s*\n/)
    .map((text) => text.trim())
    .filter((text) => text.length > 0)
    .map((text) => ({ text, hash: hashOf(text) }))
}

const hashOf = (text: string) => createHash("sha1").update(text.replace(/\s+/g, " ")).digest("hex").slice(0, 12)

export interface ReviewInput {
  path: string
  // The paragraphs to read: those changed since the last look, or all of them the first time
  changed: Paragraph[]
  first: boolean
  // The workspace's other docs, by path, for "another doc says the same"
  otherDocs: string[]
  // What Owlit said here before: still standing, and dismissed by the user (never said again)
  standing: DocComment[]
  dismissed: DocComment[]
}

// At most this many comments in one look: a review is a few things worth saying, not a markup pass
const MOST = 3

const said = (c: DocComment) => `- On «${c.quote.replace(/\s+/g, " ").slice(0, 160)}»: ${c.entries[0]?.text.replace(/\s+/g, " ").slice(0, 300) ?? ""}`

export function reviewPrompt(input: ReviewInput) {
  const what = input.first ? "The user's doc, which you haven't looked at before" : "The paragraphs of the user's doc that changed since you last looked"
  return [
    `You are Owlit, looking over a doc in the user's research workspace on your own: nobody asked, and nobody is waiting. The doc is ${input.path}. You may only leave comments with docs_add_comment; you never change the doc.`,
    `${what}:\n\n${input.changed.map((p) => p.text).join("\n\n")}`,
    `Comment only where you have something the user can't easily see for themselves, from what is in the workspace:
- a claim that a paper in their library contradicts or qualifies (search with library_search, read what it says with library_read or library_get, and name the paper as a link: [Author Year](owlit://library/<id>));
- a cited paper that says something other than what the sentence says it does;
- a citation like [Author 2024] or (Author, 2024) with no paper in the library behind it;
- the same idea, or the opposite, written in another of their docs (docs_read), or gathered in a thread (thread_list, thread_read).
Not style, grammar, structure or wording; not praise; not a summary; nothing you would have to guess. Check before you say it.`,
    `Each comment goes on the exact words it is about (quote them word for word from the doc, a sentence or less) and says what you found in one to three plain sentences, in the language the doc is written in. At most ${MOST} comments; usually fewer. If nothing is worth saying, leave none: that is a good outcome, and you then answer only "Nothing to add."`,
    input.otherDocs.length ? `Their other docs: ${input.otherDocs.slice(0, 80).join(", ")}.` : "",
    input.standing.length ? `You already said these here; don't say them again:\n${input.standing.map(said).join("\n")}` : "",
    input.dismissed.length ? `The user dismissed these comments of yours; don't make them, or ones like them, again:\n${input.dismissed.map(said).join("\n")}` : "",
    `When you are done, answer in one line with what you did ("Left 2 comments." or "Nothing to add.").`,
  ]
    .filter(Boolean)
    .join("\n\n")
}

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

// The library and the user's other docs and threads to check against, and its own comments to write
export const reviewSkill = defineSkill<ReviewInput>({
  id: "docs.review",
  format: 1,
  lane: "agent",
  tools: /^(library_(search|related)|docs_add_comment)$/,
  writes: ["comment"],
  instructions: reviewPrompt,
})
