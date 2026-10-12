import { PlusIcon, SearchIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { openPalette } from "@/app/palette-store"
import { keysFor } from "@/app/shortcuts"
import { Kbd } from "@/components/ui/kbd"
import { SidebarHeader } from "@/components/ui/sidebar"

// The top of a list panel (Chat, Docs): the search button, then the panel's New row. Both panels draw it
// from here, so switching between them moves nothing.
export function PanelHeader({ children }: { children: React.ReactNode }) {
  return (
    <SidebarHeader className="gap-1.5 px-2.5 pt-2.5 pb-1">
      {/* Looks like a search field and opens the ⌘K palette, which finds papers, docs and message text */}
      <button
        type="button"
        onClick={openPalette}
        className="flex h-9 w-full items-center gap-2.5 rounded-md border border-border/70 bg-card px-3 text-sm text-muted-foreground outline-none transition-colors hover:border-border hover:text-foreground focus-key:border-foreground/30 focus-key:text-foreground"
      >
        <SearchIcon className="size-4" />
        <span className="flex-1 text-left">Search</span>
        <Kbd className="bg-transparent">{keysFor("palette")}</Kbd>
      </button>
      {children}
    </SidebarHeader>
  )
}

// "New chat", "New doc": the plus sits in the status slot every row of the list starts with, so all titles
// start together. It is never lit as the open page: a fill coming and going reads as the row jumping.
// `extra` is a hover-only button at the row's right end (New folder).
export function NewRow({ label, onClick, extra }: { label: string; onClick: () => void; extra?: React.ReactNode }) {
  return (
    <div className="group/new relative mt-1.5 flex items-center">
      <button
        type="button"
        onClick={onClick}
        className="flex h-9 w-full items-center gap-2 rounded-md pr-2.5 pl-1.5 text-sm outline-hidden transition-colors hover:bg-sidebar-accent focus-key:bg-sidebar-accent"
      >
        <span className="grid size-5 place-items-center">
          <span className="flex size-4.5 items-center justify-center rounded-full bg-foreground/8">
            <PlusIcon className="size-3" />
          </span>
        </span>
        <span className="flex-1 text-left">{label}</span>
        <Kbd className={cn("bg-transparent opacity-0 transition-opacity group-hover/new:opacity-100", extra && "mr-7")}>{keysFor("new")}</Kbd>
      </button>
      {extra}
    </div>
  )
}

// "No chats yet.", where the list's first row would be
export function PanelEmpty({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("px-2.5 py-2 text-sm text-muted-foreground", className)}>{children}</div>
}
