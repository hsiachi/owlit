import { cn } from "@/lib/utils"
import { externalLinks, formatAdded } from "../lib/format"
import { useLibraryStore } from "../store"
import type { Paper } from "../types"
import { TagsEditor } from "./TagsEditor"

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-sm leading-relaxed">{children}</div>
    </div>
  )
}

// Everything known about one paper, editable where the user owns the value (tags).
// Used by the library's detail pane and the paper page's Info tab.
export function PaperInfo({ paper, className }: { paper: Paper; className?: string }) {
  const setTags = useLibraryStore((s) => s.setTags)
  const links = externalLinks(paper)
  const published = [paper.venue, paper.year].filter(Boolean).join(" · ")
  const added = [formatAdded(paper.addedAt), paper.pdf?.pages && `${paper.pdf.pages} pages`, !paper.pdf && "no PDF"]
    .filter(Boolean)
    .join(" · ")

  return (
    <div className={cn("flex flex-col gap-5", className)}>
      <Field label="Tags">
        <TagsEditor tags={paper.tags} onChange={(tags) => setTags(paper.id, tags)} />
      </Field>

      <Field label="Authors">
        {paper.authors.length > 0 ? paper.authors.join(", ") : <span className="text-muted-foreground">Unknown</span>}
      </Field>

      {published && <Field label="Published">{published}</Field>}

      <Field label="Added">{added}</Field>

      {links.length > 0 && (
        <Field label="Links">
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                target="_blank"
                rel="noreferrer"
                className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
              >
                {l.label}
              </a>
            ))}
          </div>
        </Field>
      )}

      <Field label="Abstract">
        {paper.abstract ? (
          <p className="text-foreground/90">{paper.abstract}</p>
        ) : (
          <span className="text-muted-foreground">No abstract.</span>
        )}
      </Field>
    </div>
  )
}
