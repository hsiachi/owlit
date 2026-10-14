import { cn } from "@/lib/utils"

// One choice in a dialog, drawn as a Settings row is: the name, an optional muted line under it, the
// control (a switch) at the right, centred on both. Rows part by a hairline (divide-y on their list), never
// a box, and carry no icon tile: a tile marks a row you click to go somewhere (RowIcon).
export function FormRow({ name, help, control, className }: { name: React.ReactNode; help?: React.ReactNode; control?: React.ReactNode; className?: string }) {
  const Tag = control ? "label" : "div"
  return (
    <Tag className={cn("flex min-h-12 items-center gap-3 py-2.5 text-sm", className)}>
      <span className="min-w-0 flex-1">
        <span className="block">{name}</span>
        {help && <span className="block text-detail leading-5 text-muted-foreground">{help}</span>}
      </span>
      {control && <span className="flex shrink-0 items-center">{control}</span>}
    </Tag>
  )
}
