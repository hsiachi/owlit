import { useEffect, useState } from "react"
import { DialogHeading } from "@/components/info"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useLibraryStore } from "../store"
import type { Paper } from "../types"
import { useLibraryUi } from "../ui-store"

interface Draft {
  title: string
  authors: string
  year: string
  venue: string
  doi: string
  arxiv: string
  url: string
  abstract: string
}

const toDraft = (p: Paper): Draft => ({
  title: p.title,
  authors: p.authors.join("\n"),
  year: p.year ? String(p.year) : "",
  venue: p.venue ?? "",
  doi: p.ids.doi ?? "",
  arxiv: p.ids.arxiv ?? "",
  url: p.ids.url ?? "",
  abstract: p.abstract ?? "",
})

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

// Mounted once in LibraryLayout; opens for whichever paper the ui-store names
export function EditDetailsDialog() {
  const editingId = useLibraryUi((s) => s.editingId)
  const setEditingId = useLibraryUi((s) => s.setEditingId)
  const paper = useLibraryStore((s) => (editingId ? s.papers[editingId] : undefined))
  const updatePaper = useLibraryStore((s) => s.updatePaper)
  const [draft, setDraft] = useState<Draft | null>(null)

  useEffect(() => {
    setDraft(paper ? toDraft(paper) : null)
    // Only reset when a different paper is opened, not on every store change while editing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId])

  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setDraft((d) => (d ? { ...d, [k]: e.target.value } : d))

  const save = () => {
    if (!paper || !draft) return
    const year = Number.parseInt(draft.year, 10)
    updatePaper(paper.id, {
      title: draft.title.trim() || paper.title,
      authors: draft.authors
        .split(/\n|;/)
        .map((a) => a.trim())
        .filter(Boolean),
      year: Number.isFinite(year) ? year : undefined,
      venue: draft.venue.trim() || undefined,
      abstract: draft.abstract.trim() || undefined,
      ids: {
        doi: draft.doi.trim() || undefined,
        arxiv: draft.arxiv.trim() || undefined,
        url: draft.url.trim() || undefined,
      },
    })
    setEditingId(null)
  }

  return (
    <Dialog open={!!paper} onOpenChange={(open) => !open && setEditingId(null)}>
      {/* The title field takes focus once it mounts; the info icon would otherwise, and open its tooltip */}
      <DialogContent className="sm:max-w-lg" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeading title="Edit details" about="Fix what the resolver got wrong, or fill in a PDF-only paper." />
        {draft && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              save()
            }}
          >
            <Field label="Title">
              <Input value={draft.title} onChange={set("title")} autoFocus />
            </Field>
            <Field label="Authors, one per line">
              <Textarea value={draft.authors} onChange={set("authors")} rows={3} />
            </Field>
            <div className="grid grid-cols-[6rem_1fr] gap-3">
              <Field label="Year">
                <Input value={draft.year} onChange={set("year")} inputMode="numeric" />
              </Field>
              <Field label="Venue">
                <Input value={draft.venue} onChange={set("venue")} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="DOI">
                <Input value={draft.doi} onChange={set("doi")} placeholder="10.1145/…" />
              </Field>
              <Field label="arXiv">
                <Input value={draft.arxiv} onChange={set("arxiv")} placeholder="2305.10601" />
              </Field>
            </div>
            <Field label="URL">
              <Input value={draft.url} onChange={set("url")} placeholder="https://" />
            </Field>
            <Field label="Abstract">
              <Textarea value={draft.abstract} onChange={set("abstract")} rows={5} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditingId(null)}>
                Cancel
              </Button>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
