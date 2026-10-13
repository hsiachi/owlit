import { cn } from "@/lib/utils"

// Rows on the page with nothing around them and nothing between them: dialog choices, the welcome page,
// the agent choice, Shortcuts, Versions, Recently removed. The list reaches 8px past its column on both
// sides, so a row's text lines up with the text around it while the row's own shape (rowClass), a soft
// rounded fill on hover or focus, reaches past it.
export function RowList({ as: Tag = "div", className, children, ...props }: { as?: "div" | "ul" } & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag className={cn("-mx-2 flex flex-col gap-0.5", className)} {...props}>
      {children}
    </Tag>
  )
}

// A row's shape; rowHover for rows that do something when clicked
export const rowClass = "rounded-lg px-2"
export const rowHover = "transition-colors hover:bg-accent focus-key:bg-accent outline-none"

// A choice's icon, in a small tinted tile
export function RowIcon({ children }: { children: React.ReactNode }) {
  return <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4">{children}</span>
}
