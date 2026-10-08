import { ExternalLinkIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { externalLinks, formatAdded } from "../lib/format"
import { useLibraryStore } from "../store"
import type { Paper } from "../types"
import { StatusSelect } from "./StatusSelect"
import { TagsEditor } from "./TagsEditor"

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  )
}

// Everything known about one paper, editable where the user owns the value (status, tags).
// Used by the library's detail pane and the paper page's Info tab.
export function PaperInfo({ paper, className }: { paper: Paper; className?: string }) {
  const setStatus = useLibraryStore((s) => s.setStatus)
  const setTags = useLibraryStore((s) => s.setTags)
  const links = externalLinks(paper)
  const venueYear = [paper.venue, paper.year].filter(Boolean).join(" · ")

  return (
    <div className={cn("flex flex-col gap-5", className)}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <Field label="Status">
          <StatusSelect value={paper.status} onChange={(s) => setStatus([paper.id], s)} />
        </Field>
        <Field label="Added">{formatAdded(paper.addedAt)}</Field>
        {paper.pdf?.pages && <Field label="Pages">{paper.pdf.pages}</Field>}
      </div>

      <Field label="Tags">
        <TagsEditor tags={paper.tags} onChange={(tags) => setTags(paper.id, tags)} />
      </Field>

      <Field label="Authors">
        {paper.authors.length > 0 ? (
          <p className="leading-relaxed">{paper.authors.join(", ")}</p>
        ) : (
          <span className="text-muted-foreground">Unknown</span>
        )}
      </Field>

      {venueYear && <Field label="Published">{venueYear}</Field>}

      {links.length > 0 && (
        <Field label="Links">
          <ul className="flex flex-col gap-1">
            {links.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline"
                >
                  {l.label}
                  <ExternalLinkIcon className="size-3 text-muted-foreground" />
                </a>
              </li>
            ))}
          </ul>
        </Field>
      )}

      <Field label="Abstract">
        {paper.abstract ? (
          <p className="leading-relaxed text-foreground/90">{paper.abstract}</p>
        ) : (
          <span className="text-muted-foreground">No abstract.</span>
        )}
      </Field>
    </div>
  )
}
