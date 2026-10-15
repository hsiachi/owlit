import { t } from "@lingui/core/macro"
import { useDocumentState } from "@embedpdf/core/react"
import { useNavigate } from "react-router-dom"
import { Tip } from "@/components/tip"
import { shortDate } from "@/lib/time"
import { boundsOf } from "./passages"
import { useReaderStore } from "./reader-store"
import { useWearStore, type CitedMark, type WearSource } from "./wear"

// How far left of the sentence's lines the mark stands, and how wide it is, in screen pixels
const GAP = 7
const WIDTH = 2
// The part of the margin that answers the pointer: wider than the mark, so it can be found
const HIT = 12

// Owlit's trace on a page: a thin bar in the margin beside each sentence its answers rested on, in a chat
// or a thread. Hovering it rings the sentence and says where; a click goes back to the latest answer
// (the chat's message, or the paper's row opened in its thread). Fixed colour, since the
// page is white in both themes.
export function CitedLayer({ documentId, pageIndex }: { documentId: string; pageIndex: number }) {
  const scale = useDocumentState(documentId)?.scale ?? 1
  const marks = useWearStore((s) => s.marks)
  const here = marks.filter((m) => m.page === pageIndex)
  if (!here.length) return null
  return (
    <>
      {here.map((m) => (
        <Mark key={m.key} mark={m} scale={scale} />
      ))}
    </>
  )
}

function Mark({ mark, scale }: { mark: CitedMark; scale: number }) {
  const navigate = useNavigate()
  const box = boundsOf(mark.rects)
  // The latest answer that cited it is the one a click goes back to
  const latest = mark.cited.at(-1)!
  const ring = (on: boolean) => {
    const reader = useReaderStore.getState()
    if (on) reader.setRing({ passageId: mark.target.id, page: mark.page, box, pulse: false })
    else if (reader.ring?.passageId === mark.target.id) reader.setRing(null)
  }
  const label = (
    <span className="flex flex-col gap-0.5">
      {mark.cited.slice(-3).map((c) => (
        <span key={c.kind === "chat" ? `${c.chatId}-${c.messageId}` : `${c.threadId}-${c.column ?? ""}`}>{sourceLine(c)}</span>
      ))}
    </span>
  )
  const open = () =>
    navigate(latest.kind === "chat" ? `/chat/${latest.chatId}?message=${encodeURIComponent(latest.messageId)}` : `/threads/${latest.threadId}?paper=${encodeURIComponent(latest.row)}`)
  return (
    // Above the sentence: the margin is too narrow for it at the side, and below would cover what is ringed
    <Tip label={label} side="top">
      <button
        type="button"
        aria-label={sourceName(latest)}
        onPointerEnter={() => ring(true)}
        onPointerLeave={() => ring(false)}
        onFocus={() => ring(true)}
        onBlur={() => ring(false)}
        onClick={open}
        className="group absolute cursor-pointer outline-none"
        style={{ left: box.x * scale - GAP - HIT / 2, top: box.y * scale, width: HIT, height: box.h * scale }}
      >
        <span
          aria-hidden
          className="absolute inset-y-0 rounded-full bg-(--pdf-owlit) opacity-70 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          style={{ left: (HIT - WIDTH) / 2, width: WIDTH }}
        />
      </button>
    </Tip>
  )
}

function sourceName(c: WearSource) {
  if (c.kind === "chat") return t`Owlit cited this in “${c.chatTitle}”`
  const title = c.threadTitle
  const column = c.column
  return column ? t`An answer in “${title}” rests on this: ${column}` : t`An answer in “${title}” rests on this`
}

const sourceLine = (c: WearSource) => `${sourceName(c)} · ${shortDate(c.at)}`
