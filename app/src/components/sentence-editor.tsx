import { t } from "@lingui/core/macro"
import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

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
          {t`Cancel`}
        </Button>
        <Button size="sm" onClick={() => onSave(text)}>
          {t`Save`}
        </Button>
      </div>
    </div>
  )
}
