import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { InfoIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { MentionToken } from "@/features/chat/components/composer/MentionToken"
import { mentionRoute, mentionTitle } from "@/features/docs/lib/mentions"
import type { Ref } from "../types"

// The 8px `note` dot: something Owlit added or changed since the user last looked
export function NoteDot({ className, label = "Changed since you last looked" }: { className?: string; label?: string }) {
  return <span role="img" aria-label={label} title={label} className={cn("note-dot inline-block size-2 shrink-0 rounded-full", className)} />
}

// A source as a mention: a paper passage opens the paper at it, a doc opens the doc
export function RefToken({ r, className }: { r: Ref; className?: string }) {
  const navigate = useNavigate()
  const to = mentionRoute(r.uri)
  return (
    <MentionToken
      label={r.label}
      title={mentionTitle(r.uri) ?? r.label}
      className={className}
      onClick={() => {
        if (to) navigate(to)
      }}
    />
  )
}

export function Refs({ refs }: { refs: Ref[] }) {
  return (
    <>
      {refs.map((r, i) => (
        <span key={`${r.uri}-${i}`}>
          {i > 0 && <span className="px-1 text-muted-foreground/70">·</span>}
          <RefToken r={r} />
        </span>
      ))}
    </>
  )
}

export function Info({ children, label = "About this" }: { children: React.ReactNode; label?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label={label} className="inline-flex size-4 items-center justify-center rounded-sm align-[-0.2em] text-muted-foreground outline-none hover:text-foreground focus-key:ring-2 focus-key:ring-ring/50">
          <InfoIcon className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 text-pretty">{children}</TooltipContent>
    </Tooltip>
  )
}

// Edits one sentence in place: Enter or Save keeps it, Esc or Cancel leaves it as it was
export function SentenceEditor({ value, onSave, onCancel, className }: { value: string; onSave: (text: string) => void; onCancel: () => void; className?: string }) {
  const [text, setText] = useState(value)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])
  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        ref={ref}
        value={text}
        rows={1}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            onSave(text)
          }
          if (e.key === "Escape") {
            e.preventDefault()
            onCancel()
          }
        }}
        className={cn("-mx-2 -my-1 resize-none rounded-md border bg-card px-2 py-1 [field-sizing:content] outline-none focus-visible:border-foreground/30", className)}
      />
      <div className="flex justify-end gap-1">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => onSave(text)}>
          Save
        </Button>
      </div>
    </div>
  )
}
