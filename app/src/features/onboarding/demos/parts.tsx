import { t } from "@lingui/core/macro"
import type { ReactNode } from "react"
import { ArrowUpIcon, PlusIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { KIND_ICON } from "@/lib/kinds"
import type { CursorState, Layer } from "./engine"
import s from "./demos.module.css"

const PaperIcon = KIND_ICON.paper

// The fake pointer, moved by a scene's script
export function Cursor({ x, y, on, press, ms }: CursorState) {
  return (
    <div className={s.cur} data-on={on || undefined} data-press={press || undefined} style={{ transform: `translate(${x}px, ${y}px)`, transitionDuration: `${ms}ms, 250ms` }}>
      <svg viewBox="0 0 14 20" aria-hidden>
        <path d="M1 1v15.5l3.8-3.6 2.6 5.8 2.6-1.1-2.6-5.7H13z" fill="#111" stroke="#fff" strokeWidth={1.2} strokeLinejoin="round" />
      </svg>
    </div>
  )
}

// A scene's pictures, the newest on top; one that gives way fades out over the one coming in
export function Layers<S>({ layers, children }: { layers: Layer<S>[]; children: (state: S) => ReactNode }) {
  return layers.map((l) => (
    <div key={l.id} className={cn(s.layer, l.leaving ? s.leaving : l.id > 0 && s.entering)}>
      {children(l.state)}
    </div>
  ))
}

export function PaperRow({ title, meta, className }: { title: string; meta: string; className?: string }) {
  return (
    <div className={cn(s.row, className)}>
      <PaperIcon />
      <span className={s.t}>{title}</span>
      <span className={s.m}>{meta}</span>
    </div>
  )
}

// The status ring of a step: breathing while it works, filled once done
export function Ring({ done }: { done?: boolean }) {
  return <span className={s.ring} data-working={done ? undefined : true} data-done={done || undefined} />
}

// The Chat composer at the window's scale: the text (or its placeholder), the round plus, the agent and
// Owlit's role, Send
export function MiniComposer({ text, placeholder, agentName, className }: { text?: string | null; placeholder: string; agentName: string; className?: string }) {
  const empty = text == null
  return (
    <div className={cn(s.composer, "bg-card shadow-xs ring-1 ring-border", className)}>
      <div className={s.ct} data-ph={empty || undefined}>
        {empty ? placeholder : text}
      </div>
      <div className={s.cf}>
        <PlusIcon />
        <span className={s.sp} />
        <span>{agentName}</span>
        <span>{t`Assistant`}</span>
        <span className={s.send}>
          <ArrowUpIcon />
        </span>
      </div>
    </div>
  )
}
