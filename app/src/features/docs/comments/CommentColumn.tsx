import { t } from "@lingui/core/macro"
import { MessageSquareTextIcon } from "lucide-react"
import { useLayoutEffect, useMemo, useRef } from "react"
import { Tip } from "@/components/tip"
import { cn } from "@/lib/utils"
import { openEditor } from "../editors"
import { commentSpots, newCommentRange, NEW_KEY, setHotComment } from "../editor/comment-marks"
import { anchorAt } from "@owlit/protocol"
import { useDocsUiStore } from "../ui-store"
import { ClosedCard, NewCard, OpenCard } from "./CommentCard"
import { useCommentTops } from "./layout"
import { useCommentViews } from "./hooks"
import { askAbout, deleteEntry, editEntry, reply, resolve, startComment, type CommentView } from "./model"

const GAP = 8

// The column of comment cards beside a doc, each card level with the words it is on, as in Google Docs:
// the open card sits exactly level with its words, the cards above it pack upward from it and the ones
// below pack downward, so none overlap and the one being read never moves away from its words. Cards
// move there over --t-layout, so the eye can follow.
//
// When the page is too narrow for a column, it folds to pins: one small comment mark per comment, level
// with its words, and the open card floats over the doc just under its words' first line.
export function CommentColumn({ fileId, pins }: { fileId: string; pins: boolean }) {
  const views = useCommentViews(fileId)
  const tops = useCommentTops((s) => s[fileId])
  const open = useDocsUiStore((s) => (s.openComment?.docId === fileId ? s.openComment.key : null))
  const drafting = useDocsUiStore((s) => s.newComment?.docId === fileId)
  const column = useRef<HTMLDivElement>(null)

  // Only the comments the editor has placed, in the order their words come
  const placed = useMemo(() => {
    const at = (v: CommentView) => tops?.[v.key]?.top ?? Infinity
    return views.filter((v) => tops?.[v.key]).sort((a, b) => at(a) - at(b))
  }, [views, tops])

  // Cards are positioned by hand after React has drawn them, once their heights are known, and again
  // whenever one changes size (a reply typed, a card opened)
  useLayoutEffect(() => {
    const el = column.current
    if (!el || !tops) return
    const pack = () => {
      // A card's first line sits level with the first line of its words, so it starts a little above them
      const wantOf = (c: HTMLElement) => (tops[c.dataset.card!]?.top ?? 0) - 6
      const cards = [...el.querySelectorAll<HTMLElement>(":scope > [data-card]")].sort((a, b) => wantOf(a) - wantOf(b))
      const want = cards.map(wantOf)
      const heights = cards.map((c) => c.offsetHeight)
      const top = [...want]
      let k = cards.findIndex((c) => c.dataset.card === (drafting ? NEW_KEY : open))
      if (k < 0) k = 0
      for (let i = k + 1; i < cards.length; i++) top[i] = Math.max(want[i], top[i - 1] + heights[i - 1] + GAP)
      for (let i = k - 1; i >= 0; i--) top[i] = Math.min(want[i], top[i + 1] - heights[i] - GAP)
      // Nothing goes above the column's top; if the upward packing ran out of room, everything moves down
      const shift = Math.max(0, -(top[0] ?? 0))
      cards.forEach((c, i) => (c.style.top = `${top[i] + shift}px`))
      el.style.minHeight = `${Math.max(0, ...cards.map((_, i) => top[i] + shift + heights[i]))}px`
    }
    pack()
    const resized = new ResizeObserver(pack)
    for (const c of el.querySelectorAll(":scope > [data-card]")) resized.observe(c)
    return () => resized.disconnect()
    // pins: the column is a new element when it unfolds from pins
  }, [placed, tops, open, drafting, pins])

  const ui = useDocsUiStore.getState
  const hover = (key: string, on: boolean) => openEditor(fileId)?.dispatch({ effects: setHotComment.of(on ? key : null) })
  // The card under the pointer becomes the open one and stops being "pointed at"
  const setOpen = (key: string | null) => {
    openEditor(fileId)?.dispatch({ effects: setHotComment.of(null) })
    ui().setOpenComment(fileId, key)
  }
  const fromOf = (key: string) => {
    const view = openEditor(fileId)
    return view ? commentSpots(view.state).find((s) => s.item.key === key && !s.lost)?.from : undefined
  }
  const saveNew = (text: string) => {
    const view = openEditor(fileId)
    const range = view && newCommentRange(view.state)
    if (!view || !range || range.to <= range.from) return ui().setNewComment(null)
    const comment = startComment(fileId, anchorAt(view.state.doc.toString(), range.from, range.to), text)
    ui().setNewComment(null)
    setOpen(`c:${comment.id}`)
  }

  const openCard = (view: CommentView) => (
    <OpenCard
      view={view}
      lost={!!tops?.[view.key]?.lost}
      actions={{
        onAsk: () => askAbout(fileId, view, fromOf(view.key)),
        onResolve: () => resolve(fileId, view),
        onReply: (text) => reply(fileId, view, text),
        onEdit: (entryId, text) => view.doc && editEntry(fileId, view.doc.id, entryId, text),
        onDelete: (entryId) => view.doc && deleteEntry(fileId, view.doc.id, entryId),
        onClose: () => setOpen(null),
      }}
    />
  )
  const newCard = <NewCard onSave={saveNew} onCancel={() => ui().setNewComment(null)} />

  if (pins) {
    const opened = placed.find((v) => v.key === open)
    const floatTop = drafting ? tops?.[NEW_KEY]?.top : opened ? tops?.[opened.key]?.top : undefined
    return (
      <div className="relative w-7 shrink-0">
        {placed.map((v) => (
          <Tip key={v.key} label={t`Comment by ${v.entries[0].name}`} side="left">
            <button
              type="button"
              aria-label={t`Comment by ${v.entries[0].name}`}
              onClick={() => setOpen(open === v.key ? null : v.key)}
              onMouseEnter={() => hover(v.key, true)}
              onMouseLeave={() => hover(v.key, false)}
              style={{ top: tops![v.key].top }}
              className={cn("absolute left-0.5 grid size-6 place-items-center rounded-md text-comment-mark hover:bg-comment-wash", open === v.key && "bg-comment-wash")}
            >
              <MessageSquareTextIcon className="size-3.5" />
            </button>
          </Tip>
        ))}
        {floatTop !== undefined && (
          // Just under the first line of its words, so the card never covers what it is about
          <div className="absolute right-9 z-20 w-[300px]" style={{ top: floatTop + 30 }}>
            {drafting ? newCard : opened && openCard(opened)}
          </div>
        )}
      </div>
    )
  }

  return (
    <div ref={column} className="relative w-[272px] shrink-0">
      {placed.map((v) => (
        <div
          key={v.key}
          data-card={v.key}
          className={cn(
            "absolute inset-x-0 transition-[top,translate] duration-(--t-layout) ease-(--ease) motion-reduce:transition-none",
            // The open card steps out toward its words
            open === v.key && "z-10 -translate-x-2",
          )}
        >
          {open === v.key ? openCard(v) : <ClosedCard view={v} lost={!!tops?.[v.key]?.lost} onOpen={() => setOpen(v.key)} onHover={(on) => hover(v.key, on)} />}
        </div>
      ))}
      {drafting && tops?.[NEW_KEY] && (
        <div data-card={NEW_KEY} className="absolute inset-x-0 z-10 -translate-x-2 transition-[top] duration-(--t-layout) ease-(--ease)">
          {newCard}
        </div>
      )}
    </div>
  )
}
