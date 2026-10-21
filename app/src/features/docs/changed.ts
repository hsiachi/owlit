import { t } from "@lingui/core/macro"
import type { Proposal, Unseen } from "@owlit/protocol"
import type { EditorView } from "@codemirror/view"
import { changedPassages, markSeen, proposalsOf, useSeen } from "@/app/seen"
import { nameOf } from "@/lib/actors"
import { sha1 } from "@/lib/sha1"
import { dateTime } from "@/lib/time"
import { capital } from "@/lib/words"
import { changedPlaces, setChanged, type ChangedLine } from "./editor/changed-since"
import { proposalSpots, setProposals } from "./editor/proposals"

// A doc with nothing marked in it is seen once it has been on screen this long, the rule the comments
// button keeps for new comments (CommentsToggle)
const SEEN_AFTER_MS = 3000
// A marked passage counts as looked at once it has stayed this long in the part of the doc on screen:
// long enough to read that something changed there, not long enough to have to stop scrolling
export const LOOKED_AFTER_MS = 1500
// How often what is on screen is looked at
const TICK_MS = 500

// The ids of someone else's unseen changes to the doc, as one key
const unseenKey = (unseen: Unseen, path: string) =>
  unseen.changes
    .filter((c) => c.target.kind === "doc" && c.target.path === path)
    .map((c) => c.id)
    .join()

// A marked place in the doc, by key
export interface Place {
  key: string
  from: number
  to: number
}

// One look at what is on screen: each place in a visible range starts its clock (`since`, kept between
// looks), one off screen loses it, and one on screen LOOKED_AFTER_MS joins `looked`. A place with no
// width (where a paragraph was removed) is on screen when its position is.
export function look(places: Place[], visible: readonly { from: number; to: number }[], since: Map<string, number>, looked: Set<string>, now: number) {
  for (const p of places) {
    if (looked.has(p.key)) continue
    const shown = visible.some((r) => p.from <= r.to && p.to >= r.from)
    if (!shown) {
      since.delete(p.key)
      continue
    }
    const from = since.get(p.key) ?? now
    since.set(p.key, from)
    if (now - from >= LOOKED_AFTER_MS) looked.add(p.key)
  }
}

// While a doc is open in view: the paragraphs others wrote or removed since the user last had it on
// screen get a line in the margin, and Owlit's landed passages their marks with Undo, for this visit
// (asked again when another change comes). The doc as it reads is marked seen once each of those has
// been on screen a moment (look), the way a person reads a long doc: Owlit's change at the bottom of a
// page read only at the top stays unseen. A doc with nothing marked is seen after SEEN_AFTER_MS on
// screen. Seen again after each change settles, and on closing once everything was looked at. text: the
// doc as written to disk. Returns what the editor calls on a change, on Clear marks and on closing.
export function followChangedSince(view: EditorView, path: () => string | undefined, text: () => string) {
  let base: string | undefined
  let closed = false
  let proposals: Proposal[] = []
  let changed: ChangedLine[] = []
  const since = new Map<string, number>()
  const looked = new Set<string>()
  // Counts the asks for what to mark: an answer to an ask overtaken by another, or by Clear marks, is dropped
  let asked = 0
  const show = () => {
    const p = path()
    if (!p) return
    const ask = ++asked
    // A doc the user never had on screen (one Owlit made) has no mark: Owlit's passages in it count from
    // when the user's marks began
    void proposalsOf(p, text(), base).then(
      (next) => {
        if (closed || ask !== asked) return
        proposals = next
        view.dispatch({ effects: setProposals.of(next) })
      },
      () => undefined,
    )
    if (!base) return
    void changedPassages(p, base, text()).then(
      (passages) => {
        if (closed || ask !== asked) return
        changed = passages.map((c) => {
          const who = capital(nameOf(c.actor))
          const when = dateTime(c.at)
          const words = c.text.length > 60 ? `${c.text.slice(0, 60)}…` : c.text
          return c.removed
            ? { text: c.text, title: t({ message: `${who} removed “${words}” · ${when}`, comment: "hover on the mark where a paragraph was removed from a doc" }), removed: c.removed }
            : { text: c.text, title: `${who} · ${when}` }
        })
        view.dispatch({ effects: setChanged.of(changed) })
      },
      () => undefined,
    )
  }

  // Every marked place as the doc reads now: Owlit's passages (a doc Owlit wrote whole is one place, its
  // top), others' paragraphs
  const places = (): Place[] => [
    ...(proposals.some((p) => p.whole) ? [{ key: "whole", from: 0, to: 0 }] : proposalSpots(view.state, proposals)),
    ...changedPlaces(view.state, changed),
  ]
  const lookedAtAll = () => places().every((p) => looked.has(p.key))

  let openedAt = Date.now()
  let changedAt = Date.now()
  let markedText: string | undefined
  let markedOnce = false
  const mark = () => {
    const p = path()
    if (!p) return
    const now = text()
    if (now === markedText) return
    markedText = now
    markedOnce = true
    void sha1(now).then((hash) => markSeen({ kind: "doc", path: p, hash }))
  }
  const tick = () => {
    if (!begun || document.visibilityState !== "visible") {
      since.clear()
      return
    }
    const now = Date.now()
    const all = places()
    look(all, view.visibleRanges, since, looked, now)
    const settled = now - changedAt >= SEEN_AFTER_MS && (all.length > 0 || now - openedAt >= SEEN_AFTER_MS)
    if (settled && lookedAtAll()) mark()
  }
  const timer = setInterval(tick, TICK_MS)

  // The visit's baseline is the mark the user had when it began, once core's marks have come
  const begin = () => {
    const p = path()
    base = p ? useSeen.getState().marks.docs[p]?.hash : undefined
    openedAt = changedAt = Date.now()
    show()
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
    changed: () => {
      changedAt = Date.now()
    },
    // Clear marks: the doc as it reads now is seen, as a visit marks it, and the visit counts from here, so
    // a change coming later in it is marked against this text, not the one the visit began with. Owlit's
    // marks go with setProposals (editor/proposals.ts); others' paragraphs go too, being seen as well.
    clear() {
      const p = path()
      if (!p) return
      const now = text()
      asked++
      markedText = now
      markedOnce = true
      proposals = []
      changed = []
      view.dispatch({ effects: setChanged.of([]) })
      void sha1(now).then((hash) => {
        base = hash
        markSeen({ kind: "doc", path: p, hash })
      })
    },
    close() {
      clearInterval(timer)
      if (markedOnce && lookedAtAll()) mark()
      closed = true
      off()
    },
  }
}
