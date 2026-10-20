import type { ProposalHunk } from "@owlit/protocol"
import { markdownPlain } from "@/lib/markdown-plain"

// Words either side of a passage, enough to tell where in the text it is
const CONTEXT = 32

// Markdown as the words the text shows, its spaces at either end kept so the pieces join as they read
const plain = (md: string) => markdownPlain(md, { lines: true }).replace(/\s+/g, " ")

// The context beside a passage, its far end cut at a word where there are words: core cuts it at a
// number of characters, so its first or last word may be a piece of one
function clip(text: string, side: "before" | "after") {
  const cut = side === "before" ? text.slice(-CONTEXT) : text.slice(0, CONTEXT)
  const space = side === "before" ? cut.indexOf(" ") : cut.lastIndexOf(" ")
  // No space but the one against the passage: one word, or text written without spaces
  if (side === "before" ? space < 0 || space === cut.length - 1 : space <= 0) return side === "before" ? `…${cut}` : `${cut}…`
  return side === "before" ? `…${cut.slice(space + 1)}` : `${cut.slice(0, space)}…`
}

// One passage of a change, as a doc marks it in place: the words around it muted, the words it took out
// struck, the words it put in underlined in Owlit's colour (index.css › suggest-*). Used where the text
// itself isn't at hand: a note's list of Owlit's edits, a doc's Versions.
export function PassageChange({ hunk }: { hunk: ProposalHunk }) {
  return (
    <>
      {hunk.before.trim() && <span className="text-muted-foreground">{clip(plain(hunk.before), "before")}</span>}
      {hunk.removed.trim() && <span className="suggest-del">{plain(hunk.removed)}</span>}
      {hunk.insert.trim() && <span className={hunk.removed.trim() ? "suggest-ins suggest-ins-after" : "suggest-ins"}>{plain(hunk.insert)}</span>}
      {hunk.after.trim() && <span className="text-muted-foreground">{clip(plain(hunk.after), "after")}</span>}
    </>
  )
}
