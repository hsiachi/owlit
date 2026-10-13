import { t } from "@lingui/core/macro"
import { InfoIcon } from "lucide-react"
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

// An explanation behind an info icon. The icon keeps a 20px target but takes a line no taller than text.
export function Info({ children, label = t`About this` }: { children: React.ReactNode; label?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="-my-0.5 inline-grid size-5 shrink-0 place-items-center rounded-full align-[-0.2em] text-muted-foreground outline-none hover:text-foreground focus-key:ring-2 focus-key:ring-ring/50"
        >
          <InfoIcon className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-72 text-pretty">
        {children}
      </TooltipContent>
    </Tooltip>
  )
}

// A dialog's title, with what it is about behind an info icon rather than as a line under it. The words
// are the dialog's description for screen readers too. Without `about`, `description` is only that.
// A dialog with an info icon in its title should keep focus off it on open (onOpenAutoFocus), or its
// tooltip opens on arrival.
export function DialogHeading({ title, about, description }: { title: React.ReactNode; about?: string; description?: string }) {
  return (
    <DialogHeader>
      <DialogTitle className="flex items-center gap-1">
        {title}
        {about && <Info>{about}</Info>}
      </DialogTitle>
      {(about ?? description) && <DialogDescription className="sr-only">{about ?? description}</DialogDescription>}
    </DialogHeader>
  )
}
