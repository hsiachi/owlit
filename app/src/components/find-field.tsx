import { t } from "@lingui/core/macro"
import { useRef } from "react"
import { SearchIcon, XIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { keysFor } from "@/app/shortcuts"
import { useWindowKeydown } from "@/hooks/use-window-keydown"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"

// The one find field of a list page: a bright field on the sheet whose border darkens with focus, the "/"
// key (which jumps to it from anywhere on the page) or a clear button at the right. Esc clears it and
// leaves. `children` go at its right end (the Library's Add a PDF file).
export function FindField({
  value,
  onChange,
  onEnter,
  placeholder,
  label,
  children,
}: {
  value: string
  onChange: (value: string) => void
  onEnter?: () => void
  placeholder: string
  label: string
  children?: React.ReactNode
}) {
  const input = useRef<HTMLInputElement>(null)
  useWindowKeydown((e) => {
    if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return
    // Typing "/" in a field stays typing
    if ((e.target as HTMLElement).closest("input, textarea, [contenteditable]")) return
    e.preventDefault()
    input.current?.focus()
  })

  return (
    <div className="mt-4 flex h-11 items-center gap-2 rounded-xl border bg-card pr-1.5 pl-3.5 transition-colors focus-within:border-foreground/30">
      <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
      <input
        ref={input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onEnter?.()
          if (e.key === "Escape") {
            onChange("")
            e.currentTarget.blur()
          }
        }}
        placeholder={placeholder}
        aria-label={label}
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-muted-foreground"
      />
      {value ? (
        <Button variant="ghost" size="icon-sm" aria-label={t({ message: "Clear", comment: "verb: empty the search field" })} onClick={() => onChange("")} className="text-muted-foreground">
          <XIcon />
        </Button>
      ) : (
        <Kbd className={cn("bg-transparent", !children && "mr-1.5")}>{keysFor("find")}</Kbd>
      )}
      {children}
    </div>
  )
}
