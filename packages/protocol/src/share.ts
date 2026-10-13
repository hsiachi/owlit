// Sharing a doc by link. owlit pushes the doc, and the papers it cites, to a share server; whoever has the
// link reads them in a browser and comments, and the comments come back to owlit. Core, the share server
// and the web reader (apps/share-server, apps/share-web) all speak these shapes.

export type SharePermission = "comment" | "view"

// A paper the shared doc cites, as the reader sees it: what it is, Owlit's digest, the author's note
export interface SharedPaper {
  id: string
  title: string
  authors: string[]
  year?: number
  venue?: string
  // Where the paper itself is read (its DOI or arXiv page); the PDF is never in the share
  url?: string
  digest?: string
  note?: string
}

// Everything the reader's page draws, pushed whole on every change
export interface ShareBundle {
  version: 1
  // The doc's name
  title: string
  // Who shared it (the profile's name), when there is one
  author?: string
  markdown: string
  papers: Record<string, SharedPaper>
}

// A share as the server gives it to a reader
export interface ShareView {
  id: string
  bundle: ShareBundle
  permission: SharePermission
  updatedAt: number
}

// Where a comment sits: its words and a little text either side, as agents' notes on docs are anchored
export interface ShareAnchor {
  quote: string
  prefix: string
  suffix: string
}

export interface ShareComment {
  id: string
  // The passage it is on; null on a reply
  anchor: ShareAnchor | null
  // The comment a reply answers
  parent?: string
  name: string
  by: "reader" | "author"
  text: string
  at: number
  resolved?: boolean
}

// A doc this workspace shares, as owlit knows it
export interface DocShare {
  path: string
  id: string
  // The link to hand out
  url: string
  permission: SharePermission
  // The author's notes on the cited papers go along
  notes: boolean
  createdAt: number
  // When the reader last got a new version
  pushedAt?: number
  // Why the latest changes haven't reached the server, in a sentence; absent when they have
  problem?: string
  // How many papers the doc cites
  papers: number
  // Shared from another computer: only that one holds the key to change it
  foreign?: boolean
}

// ---- Rules every side agrees on

// How much text either side of a passage an anchor keeps
export const ANCHOR_CONTEXT = 32

const MENTION_OR_LINK = /(!?)\[((?:\\.|[^\]\\])*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
const WIKILINK = /!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g
const PAPER_LINK = /^owlit:\/\/library\/([a-zA-Z0-9][a-zA-Z0-9._-]*)(#[^)\s]*)?$/

// The text outside code: Markdown is changed only there, so a code sample keeps its brackets
function outsideCode(text: string, change: (part: string) => string) {
  return text
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/)
    .map((part, i) => (i % 2 ? part : change(part)))
    .join("")
}

// The papers a doc cites (owlit://library/<id> links), in the order they first appear
export function citedPaperIds(markdown: string): string[] {
  const ids: string[] = []
  outsideCode(markdown, (part) => {
    for (const m of part.matchAll(MENTION_OR_LINK)) {
      const id = PAPER_LINK.exec(m[3])?.[1]
      if (id && !m[1] && !ids.includes(id)) ids.push(id)
    }
    return part
  })
  return ids
}

const unescapeLabel = (label: string) => label.replace(/\\([[\]\\])/g, "$1")

// A doc, a note or a digest made fit to leave the computer. What would point into the workspace becomes
// its plain words: links to other docs, chats and Knowledge, wikilinks, local pictures and files, and
// citations of papers the share doesn't carry. Comments in the source (<!-- -->) and front matter are
// left out, since they were never meant to be read. Web links, pictures on the web and citations of
// shared papers stay.
export function shareableMarkdown(markdown: string, shared: (paperId: string) => boolean): string {
  const text = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")
  return outsideCode(text, (part) =>
    part
      .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
      .replace(MENTION_OR_LINK, (whole, bang: string, label: string, url: string) => {
        const words = unescapeLabel(label)
        if (bang) return /^https:\/\//i.test(url) ? whole : words
        const paper = PAPER_LINK.exec(url)
        if (paper) return shared(paper[1]) ? whole : words
        if (/^(https?:|mailto:|#)/i.test(url)) return whole
        return words
      })
      .replace(WIKILINK, (_, target: string, alias?: string) => (alias ?? target.split("/").pop() ?? target).trim())
      .replace(/==([^=\n]+)==/g, "$1"),
  )
}

// A Markdown source as its words read once drawn, with where each character came from in the source. A
// reader's comment is anchored on what they saw; the author's editor finds the same words in the source
// through this. It drops what drawing hides: block marks at a line's start, emphasis and code marks, a
// link's address; a wikilink reads as its alias.
export function readableText(markdown: string): { text: string; at: number[] } {
  let text = ""
  const at: number[] = []
  const keep = (from: number, to: number) => {
    for (let i = from; i < to; i++) {
      text += markdown[i]
      at.push(i)
    }
  }
  let i = 0
  let lineStart = true
  while (i < markdown.length) {
    if (lineStart) {
      lineStart = false
      // Several marks can lead one line ("> - [ ] ")
      const lead = /^[ \t]{0,3}(?:(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d+[.)][ \t]+(?:\[[ xX]\][ \t]+)?))+/.exec(markdown.slice(i, i + 80))
      if (lead) {
        i += lead[0].length
        continue
      }
    }
    const rest = markdown.slice(i)
    const ch = markdown[i]
    if (ch === "\n") {
      keep(i, i + 1)
      i++
      lineStart = true
      continue
    }
    if (ch === "\\" && i + 1 < markdown.length && /[\\`*_{}[\]()#+\-.!=~|>]/.test(markdown[i + 1])) {
      keep(i + 1, i + 2)
      i += 2
      continue
    }
    const wiki = /^!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/.exec(rest)
    if (wiki) {
      const alias = wiki[2]
      const shown = alias ?? wiki[1]
      const offset = alias ? wiki[0].indexOf("|") + 1 : wiki[0].indexOf("[[") + 2
      keep(i + offset, i + offset + shown.length)
      i += wiki[0].length
      continue
    }
    const link = /^!?\[((?:\\.|[^\]\\])*)\]\([^)\s]+(?:\s+"[^"]*")?\)/.exec(rest)
    if (link) {
      const open = link[0].indexOf("[") + 1
      // The label is read again, so emphasis inside it drops too
      const inner = readableText(link[1])
      for (let k = 0; k < inner.text.length; k++) {
        text += inner.text[k]
        at.push(i + open + inner.at[k])
      }
      i += link[0].length
      continue
    }
    const mark = /^(\*\*|__|~~|==|\*|`)/.exec(rest)
    if (mark) {
      i += mark[0].length
      continue
    }
    keep(i, i + 1)
    i++
  }
  return { text, at }
}

// How many characters two strings share at their end, and at their start
const sharedEnd = (a: string, b: string) => {
  let n = 0
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++
  return n
}
const sharedStart = (a: string, b: string) => {
  let n = 0
  while (n < a.length && n < b.length && a[n] === b[n]) n++
  return n
}

// Where an anchored passage starts in this text: of every place its words appear, the one whose
// surroundings match best. Null when the words are no longer there.
export function findAnchor(text: string, anchor: ShareAnchor): number | null {
  if (!anchor.quote) return null
  let best: number | null = null
  let bestScore = -1
  for (let i = text.indexOf(anchor.quote); i >= 0; i = text.indexOf(anchor.quote, i + 1)) {
    const score =
      sharedEnd(text.slice(Math.max(0, i - anchor.prefix.length), i), anchor.prefix) +
      sharedStart(text.slice(i + anchor.quote.length, i + anchor.quote.length + anchor.suffix.length), anchor.suffix)
    if (score > bestScore) {
      best = i
      bestScore = score
    }
  }
  return best
}

// The passage an anchor names in a Markdown source, as source offsets: found in the source itself when
// the words are there as written, else in the words as drawn. Null when they are gone.
export function locateInMarkdown(markdown: string, anchor: ShareAnchor): { from: number; to: number } | null {
  const direct = findAnchor(markdown, anchor)
  if (direct !== null) return { from: direct, to: direct + anchor.quote.length }
  const readable = readableText(markdown)
  const at = findAnchor(readable.text, anchor)
  if (at === null) return null
  const last = at + anchor.quote.length - 1
  return { from: readable.at[at], to: readable.at[last] + 1 }
}

// An anchor on text[from..to)
export const anchorAt = (text: string, from: number, to: number): ShareAnchor => ({
  quote: text.slice(from, to),
  prefix: text.slice(Math.max(0, from - ANCHOR_CONTEXT), from),
  suffix: text.slice(to, to + ANCHOR_CONTEXT),
})

// What a reader may send, at most
export const SHARE_LIMITS = {
  name: 60,
  comment: 4000,
  quote: 1000,
  // The bundle as JSON, in bytes
  bundle: 4 * 1024 * 1024,
} as const
