import { cn } from "@/lib/utils"

// A few words inside a sentence that do something ("Import your library", "2 couldn't be added"): the
// text's own ink with a faint underline that darkens on hover. A text button would break the sentence; a
// link's blue is for things in the workspace (mention).
export function InlineLink({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "rounded-sm text-foreground underline decoration-foreground/30 underline-offset-3 outline-none hover:decoration-foreground/60 focus-key:decoration-foreground/60 focus-key:ring-2 focus-key:ring-ring/50",
        className,
      )}
      {...props}
    />
  )
}
