import type { Unseen } from "@owlit/protocol"
import type { EditorView } from "@codemirror/view"
import { changedPassages, markSeen, proposalsOf, useSeen } from "@/app/seen"
import { nameOf } from "@/lib/actors"
import { dateTime } from "@/lib/time"
import { setChanged } from "./editor/changed-since"
import { setProposals } from "./editor/proposals"

// On screen this long, the doc as it reads is seen, the rule the comments chip keeps for new comments
// (OwlitChip)
const SEEN_AFTER_MS = 3000

async function sha1(text: string) {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

// The ids of someone else's unseen changes to the doc, as one key
const unseenKey = (unseen: Unseen, path: string) =>
  unseen.changes
    .filter((c) => c.target.kind === "doc" && c.target.path === path)
    .map((c) => c.id)
    .join()

// While a doc is open in view: the paragraphs others wrote since the user last had it on screen get a line
// in the margin, and Owlit's landed passages their marks with Keep and Undo, for this visit (asked again
// when another change comes), and the doc as it reads is marked seen once it has stayed on screen
// SEEN_AFTER_MS, again after each change settles, and on closing a doc that was open that long. text: the
// doc as written to disk. Returns what the editor calls on a change, on Keep all, and on closing.
export function followChangedSince(view: EditorView, path: () => string | undefined, text: () => string) {
  let base: string | undefined
  let closed = false
  const show = () => {
    const p = path()
    if (!p) return
    // A doc the user never had on screen (one Owlit made) has no mark: Owlit's passages in it count from
    // when the user's marks began
    void proposalsOf(p, text(), base).then(
      (proposals) => !closed && view.dispatch({ effects: setProposals.of(proposals) }),
      () => undefined,
    )
    if (!base) return
    void changedPassages(p, base).then(
      (passages) => !closed && view.dispatch({ effects: setChanged.of(passages.map((c) => ({ text: c.text, title: `${nameOf(c.actor)} · ${dateTime(c.at)}` }))) }),
      () => undefined,
    )
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  let longEnough = false
  const mark = () => {
    const p = path()
    if (!p || document.visibilityState !== "visible") return
    longEnough = true
    void sha1(text()).then((hash) => markSeen({ kind: "doc", path: p, hash }))
  }
  const later = () => {
    clearTimeout(timer)
    if (begun) timer = setTimeout(mark, SEEN_AFTER_MS)
  }
  // The visit's baseline is the mark the user had when it began, once core's marks have come
  const begin = () => {
    const p = path()
    base = p ? useSeen.getState().marks.docs[p]?.hash : undefined
    show()
    later()
  }
  let begun = useSeen.getState().loaded
  if (begun) begin()
  const off = useSeen.subscribe((s, prev) => {
    if (!begun && s.loaded) {
      begun = true
      begin()
    } else if (begun && s.unseen !== prev.unseen) {
      const p = path()
      if (p && unseenKey(s.unseen, p) && unseenKey(s.unseen, p) !== unseenKey(prev.unseen, p)) show()
    }
  })

  return {
    changed: later,
    // Keep all: the doc as it reads is seen now
    seen: mark,
    close() {
      clearTimeout(timer)
      if (longEnough) mark()
      closed = true
      off()
    },
  }
}
