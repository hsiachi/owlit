import { cn } from "@/lib/utils"

// The underline of words in a sentence that do something; `muted` keeps a muted line's ink, for a line
// that is all links (a list of names), where links in ink would outweigh the line. Also for an <a>.
export const inlineLinkClass = (muted?: boolean) =>
  cn(
    "rounded-sm underline underline-offset-3 outline-none focus-key:ring-2 focus-key:ring-ring/50",
    muted
      ? "text-muted-foreground decoration-muted-foreground/40 hover:text-foreground hover:decoration-foreground/60 focus-key:text-foreground"
      : "text-foreground decoration-foreground/30 hover:decoration-foreground/60 focus-key:decoration-foreground/60",
  )

// A few words inside a sentence that do something ("Import your library", "2 couldn't be added"): the
// text's own ink with a faint underline that darkens on hover. A text button would break the sentence; a
// link's blue is for things in the workspace (mention).
export function InlineLink({ muted, className, ...props }: React.ComponentProps<"button"> & { muted?: boolean }) {
  return <button type="button" className={cn(inlineLinkClass(muted), className)} {...props} />
}
