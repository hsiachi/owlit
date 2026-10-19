import { createHash } from "node:crypto"
import { isOpenComment, isOwlit, readableText, type DocComment } from "@owlit/protocol"

// Owlit's daily look over the docs while the user is away (rules.ts › docs.dailyScan): sections left half
// done for a week get one comment with what the threads and chats already have for them, and Owlit's own
// comments left behind (the words they were on changed, nobody answered in a week) are folded away.

export const WEEK_MS = 7 * 24 * 3_600_000

export interface Section {
  // The heading line as written ("## Related work"), which a comment on it quotes
  heading: string
  // The heading's words alone
  title: string
  level: number
  body: string
  // A short hash of the heading, which stays while the section is filled in
  key: string
}

const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t#]*$/
const FENCE = /^\s*(```|~~~)/
// Left to do, as people mark it in a draft
const TODO = /\b(TODO|TBD|TK|FIXME|XXX)\b|待写|待补|待定|^\s*(\.\.\.|…)\s*$/m

// A doc's sections: each heading and what is under it up to the next heading (code blocks aren't headings)
export function sectionsOf(content: string): Section[] {
  const lines = content.replace(/^---\n[\s\S]*?\n---\n/, "").split("\n")
  const sections: Section[] = []
  let fenced = false
  let current: { heading: string; title: string; level: number; body: string[] } | null = null
  const close = () => {
    if (current) sections.push({ heading: current.heading, title: current.title, level: current.level, body: current.body.join("\n").trim(), key: keyOf(current.level, current.title) })
  }
  for (const line of lines) {
    if (FENCE.test(line)) fenced = !fenced
    const m = fenced ? null : HEADING.exec(line)
    if (m) {
      close()
      current = { heading: line.trim(), title: m[2]!.trim(), level: m[1]!.length, body: [] }
    } else current?.body.push(line)
  }
  close()
  return sections
}

const keyOf = (level: number, title: string) =>
  createHash("sha1")
    .update(`${level} ${title.replace(/\s+/g, " ")}`)
    .digest("hex")
    .slice(0, 12)

// Left half done: nothing under the heading (and no deeper headings under it either), or marked to do
export function halfDone(sections: readonly Section[]): Section[] {
  return sections.filter((s, i) => {
    const body = s.body.replace(/<!--[\s\S]*?-->/g, "").trim()
    if (TODO.test(body)) return true
    if (body) return false
    const next = sections[i + 1]
    return !next || next.level <= s.level
  })
}

// When each half-done section was first found so, carried over from the last look: one that was filled
// in drops out, one newly half done starts from now
export function halfDoneSince(found: readonly Section[], before: Record<string, number> | undefined, now: number): Record<string, number> {
  return Object.fromEntries(found.map((s) => [s.key, before?.[s.key] ?? now]))
}

// Whether a comment's passage changed: its words and what stood around them aren't in the doc any more
export function passageChanged(comment: DocComment, content: string) {
  const whole = comment.prefix + comment.quote + comment.suffix
  if (content.includes(whole)) return false
  return !readableText(content).text.includes(whole)
}

// Owlit's comments to fold away: still standing, on words that changed, with nothing said in a week
export function foldable(comments: readonly DocComment[], content: string, now: number): DocComment[] {
  return comments.filter((c) => !!c.entries[0] && isOwlit(c.entries[0].by) && isOpenComment(c) && now - Math.max(...c.entries.map((e) => e.at)) >= WEEK_MS && passageChanged(c, content))
}
