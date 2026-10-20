import { t } from "@lingui/core/macro"
import { useEffect, useRef, useState } from "react"
import type { Proposal, Unseen } from "@owlit/protocol"
import { markSeen, proposalsOf, useSeen } from "@/app/seen"
import { citationLabel } from "../lib/format"
import { PassageChange } from "@/components/passage-change"
import { Button } from "@/components/ui/button"
import { undoAll, undoChange } from "@/lib/changes"
import { hasCore } from "@/lib/rpc"
import { sha1 } from "@/lib/sha1"
import { useLibraryStore } from "../store"
import { notePathOf } from "./note-actions"

// On screen this long, the note as it reads is seen: the rule a doc keeps (docs/changed.ts)
const SEEN_AFTER_MS = 3000
// The ids of others' unseen changes to the note, as one key, so a new one asks again
const unseenKey = (unseen: Unseen, path: string) =>
  unseen.changes
    .filter((c) => c.target.kind === "doc" && c.target.path === path)
    .map((c) => c.id)
    .join()

// Owlit's edits to a paper's note since the person last had it on screen, listed above the note: each
// passage as the words it took out (struck) and put in (underlined, Owlit's colour), with Undo through
// the change log. The note is a rich editor that can't carry the doc's marks in place, so the passages sit
// above it. Undo takes back the whole entry: an entry Owlit made in several passages goes back together.
// The list is this visit's, as a doc's marks are: once the note has been seen, the next visit shows none.
// Keyed by the paper, so another paper's note is a new visit.
export function NoteChanges({ paperId }: { paperId: string }) {
  const path = notePathOf(paperId)
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [undone, setUndone] = useState<ReadonlySet<string>>(new Set())
  const loaded = useSeen((s) => s.loaded)
  const key = useSeen((s) => unseenKey(s.unseen, path))
  // The visit's baseline: the mark the person had when it began
  const base = useRef<{ loaded: boolean; hash?: string }>({ loaded: false })

  useEffect(() => {
    if (!loaded) return
    if (!base.current.loaded) base.current = { loaded: true, hash: useSeen.getState().marks.docs[path]?.hash }
    let live = true
    const text = useLibraryStore.getState().notes[paperId]?.content ?? ""
    proposalsOf(path, text, base.current.hash).then(
      (next) => live && setProposals(next),
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [loaded, key, path, paperId])

  // Seen once on screen SEEN_AFTER_MS, again after each change settles, and on leaving a note that was
  const content = useLibraryStore((s) => s.notes[paperId]?.content ?? "")
  const longEnough = useRef(false)
  useEffect(() => {
    if (!loaded) return
    const mark = () => {
      if (document.visibilityState !== "visible") return
      longEnough.current = true
      void sha1(useLibraryStore.getState().notes[paperId]?.content ?? "").then((hash) => markSeen({ kind: "doc", path, hash }))
    }
    const timer = setTimeout(mark, SEEN_AFTER_MS)
    return () => clearTimeout(timer)
  }, [loaded, content, path, paperId])
  useEffect(() => {
    longEnough.current = false
    return () => {
      if (!longEnough.current) return
      void sha1(useLibraryStore.getState().notes[paperId]?.content ?? "").then((hash) => markSeen({ kind: "doc", path, hash }))
    }
  }, [path, paperId])

  const shown = proposals.filter((p) => !undone.has(p.id))
  if (!shown.length) return null

  const undo = (p: Proposal) => {
    setUndone((s) => new Set([...s, p.id]))
    if (hasCore) {
      const found = useLibraryStore.getState().papers[paperId]
      const paper = found && citationLabel(found)
      const what = paper ? t`Your note on ${paper}` : t`Your note`
      // A note Owlit wrote whole goes back with Owlit's later changes to it, newest first
      if (p.whole) void undoAll([...p.whole.also.toReversed(), p.id], what)
      else undoChange(p.id, what)
      return
    }
    // The browser preview has no change log: the passages go back in the note as it reads
    const { notes, setNote } = useLibraryStore.getState()
    let text = notes[paperId]?.content ?? ""
    for (const h of p.hunks) text = text.replace(h.before + h.insert + h.after, h.before + h.removed + h.after)
    setNote(paperId, text)
  }

  return (
    <section aria-label={t`Owlit's edits to this note`} className="mb-4 flex flex-col gap-2 text-sm">
      <p className="text-muted-foreground">{t({ message: "Owlit edited your note since you last looked", comment: "above the passages Owlit changed in a paper's note" })}</p>
      {shown.map((p) => (
        <div key={p.id} className="group/edit relative flex items-start gap-2 pl-3 before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-owlit">
          <p className="min-w-0 flex-1 leading-relaxed text-foreground">
            {p.whole && <span className="text-muted-foreground">{t`Owlit wrote this note`}</span>}
            {/* A passage undone on its own comes empty, keeping the others' places */}
            {p.hunks.filter((h) => h.insert || h.removed).map((h, i) => (
              <span key={i}>
                {i > 0 && " … "}
                <PassageChange hunk={h} />
              </span>
            ))}
          </p>
          <Button variant="text" size="inline" onClick={() => undo(p)} className="shrink-0">
            {t({ message: "Undo", comment: "verb: undo a passage Owlit changed" })}
          </Button>
        </div>
      ))}
    </section>
  )
}
