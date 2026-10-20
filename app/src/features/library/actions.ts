import { plural, t } from "@lingui/core/macro"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { copyText } from "@/lib/clipboard"
import { apaCitation, bibtexAll, citedPapers } from "./lib/cite"
import { paperById, useLibraryStore } from "./store"
import { useLibraryUi } from "./ui-store"
import { toastUndo } from "@/lib/toast"
import { useAgentWindow } from "@/features/agent/store"
import type { PageRect, Paper, QuotedSelection } from "@owlit/protocol"
import { paperMentionable } from "@/features/docs/lib/mentions"
import { useThreadsStore } from "@/features/threads/store"
import { rpc } from "@/lib/rpc"
import type { LearnedId, Resolved } from "./client"
import { importPdf, undoAdds } from "./disk"
import { libraryClient } from "./store"

// Actions on one or several papers, shared by the row menu, the detail pane and the paper page
export function usePaperActions() {
  const navigate = useNavigate()
  const setStarred = useLibraryStore((s) => s.setStarred)
  const setStatus = useLibraryStore((s) => s.setStatus)
  const removePapers = useLibraryStore((s) => s.removePapers)
  const restorePapers = useLibraryStore((s) => s.restorePapers)
  const setEditingId = useLibraryUi((s) => s.setEditingId)
  const clearSelection = useLibraryUi((s) => s.clearSelection)

  const open = (id: string) => {
    useLibraryUi.getState().leaveFor(id)
    navigate(`/library/${id}`)
  }

  // APA, one reference per line
  const copyCitation = async (papers: Paper[]) => {
    if (await copyText(papers.map(apaCitation).join("\n\n"))) toast(papers.length > 1 ? plural(papers.length, { one: "# citation copied", other: "# citations copied" }) : t`Citation copied`)
  }

  const copyBibtex = async (papers: Paper[]) => {
    if (await copyText(bibtexAll(papers))) toast(papers.length > 1 ? plural(papers.length, { one: "BibTeX for # paper copied", other: "BibTeX for # papers copied" }) : t`BibTeX copied`)
  }

  // Removal is immediate; the toast's Undo puts everything back
  const remove = (ids: string[], opts: { afterRemove?: () => void } = {}) => {
    const removed = removePapers(ids)
    if (removed.length === 0) return
    clearSelection()
    opts.afterRemove?.()
    toastUndo(removed.length === 1 ? t`Removed from library` : plural(removed.length, { one: "Removed # paper", other: "Removed # papers" }), () => restorePapers(removed), {
      description: removed.length === 1 ? removed[0].title : undefined,
    })
  }

  const editDetails = (id: string) => setEditingId(id)

  return { open, setStarred, setStatus, copyCitation, copyBibtex, remove, editDetails }
}

// A doc's reference list, from the papers its Markdown links to in order of first use: APA, one per
// paragraph, or a .bib whose keys don't collide
export async function copyReferences(markdown: string, format: "apa" | "bibtex") {
  const { papers, aliases } = useLibraryStore.getState()
  const cited = citedPapers(markdown, (id) => paperById(papers, aliases, id), useThreadsStore.getState().threads)
  if (!cited.length) return void toast(t`This doc doesn't cite any papers`)
  const text = format === "apa" ? cited.map(apaCitation).join("\n\n") : bibtexAll(cited)
  if (await copyText(text)) toast(plural(cited.length, { one: "# reference copied", other: "# references copied" }))
}

// Deleting is immediate; the toast's Undo brings the highlight back
export function deleteHighlight(id: string) {
  const { removeHighlight, restoreHighlight } = useLibraryStore.getState()
  const removed = removeHighlight(id)
  if (removed) toastUndo(t`Highlight deleted`, () => restoreHighlight(removed))
}

// A passage of a paper (a selection, a highlight, a line of its note) handed to the agent window; rects
// keep a PDF selection drawn until it is asked about
export function askAboutPassage(paperId: string, quote: Omit<QuotedSelection, "source">, rects?: PageRect[]) {
  const paper = useLibraryStore.getState().papers[paperId]
  if (!paper || !quote.text) return
  useAgentWindow.getState().open({ ...quote, source: paperMentionable(paper) }, rects?.length ? { paperId, rects } : undefined)
}

// ---- Adding a paper

// What a paper can be added from: a reference typed or pasted (a DOI, an arXiv id, a link), a paper
// already looked up, or a PDF on disk (its path)
export type AddSource = { ref: string } | { resolved: Resolved } | { file: string }

export interface Added {
  paper: Paper
  // The Library had it already (under one of its ids, or as the same title)
  existed: boolean
  // Ids core added to that paper from the lookup, which may bring its PDF
  learned: LearnedId[]
  // A PDF file became the PDF of a paper that had none
  placed?: boolean
}

// The one way a paper enters the Library from the window: the find field, a chat step's Add, an
// attachment, a dropped PDF. One the Library has is returned as it is (core may have taught it ids);
// rejects with a sentence when the reference can't be looked up or the file read.
export async function addPaperFrom(source: AddSource): Promise<Added> {
  if ("file" in source) {
    const { paper, existed, placed } = await importPdf(source.file)
    return { paper, existed, learned: [], ...(placed ? { placed } : {}) }
  }
  const resolved = "ref" in source ? await libraryClient.resolve(source.ref) : source.resolved
  const { papers } = useLibraryStore.getState()
  const existing = (resolved.existingId ? papers[resolved.existingId] : undefined) ?? sameIds(papers, resolved)
  if (existing) return { paper: existing, existed: true, learned: resolved.learned ?? [] }
  return { paper: useLibraryStore.getState().addPaper(resolved), existed: false, learned: [] }
}

// A paper the store has under an id the lookup gave, for when core's answer predates the store's
export function sameIds(papers: Record<string, Paper>, r: Resolved): Paper | undefined {
  return Object.values(papers).find(
    (p) => (r.ids.doi && p.ids.doi?.toLowerCase() === r.ids.doi.toLowerCase()) || (r.ids.arxiv && p.ids.arxiv === r.ids.arxiv) || (r.ids.url && p.ids.url === r.ids.url),
  )
}

const learnedName = (kind: LearnedId) =>
  kind === "arxiv"
    ? t({ message: "arXiv id", comment: "in: Already in your library · owlit added its arXiv id" })
    : kind === "s2"
      ? t({ message: "Semantic Scholar id", comment: "in: Already in your library · owlit added its Semantic Scholar id" })
      : t({ message: "OpenAlex id", comment: "in: Already in your library · owlit added its OpenAlex id" })

// A paper already in the Library, and the ids owlit learnt for it from the lookup
export function alreadyWords(learned: LearnedId[]) {
  const names = learned.map(learnedName).join(", ")
  return names ? t({ message: `Already in your library · owlit added its ${names}`, comment: "names: the ids owlit learnt, e.g. arXiv id" }) : t`Already in your library`
}

// Says what an add did, the same way from every door: a new paper with Undo (undo: false where the
// door has its own, as an import does), one already there with Open, and the ids owlit learnt for it
export function sayAdded(added: Added, open: (id: string) => void, options: { undo?: boolean } = {}) {
  const { paper } = added
  const openAction = { label: t({ message: "Open", comment: "button: open a paper to read" }), onClick: () => open(paper.id) }
  if (added.placed) return void toast(t`PDF attached`, { description: paper.title, action: openAction })
  if (added.existed) {
    return void toast(alreadyWords(added.learned), { description: paper.title, action: openAction })
  }
  if (options.undo === false) return void toast(t`Added to library`, { description: paper.title, action: openAction })
  toastUndo(t`Added to library`, () => undoAdded([paper.id]), { description: paper.title })
}

// Takes back papers just added, by their entries in the change log (each add is one), so the Undo is the
// log's and Redo works
export const undoAdded = (ids: string[]) => undoAdds(ids)

// The find field's, the chat step's and the attachment's add, with what it did said; null when it failed
// (said too)
export async function addAndSay(source: AddSource, open: (id: string) => void): Promise<Added | null> {
  try {
    const added = await addPaperFrom(source)
    sayAdded(added, open)
    return added
  } catch (error) {
    toast.error((error instanceof Error && error.message) || t`Couldn't add that paper.`)
    return null
  }
}

// The paper menu's Refresh details: the services asked again, and what that did said. A paper found to
// be a copy of another goes into it (core folds it), and the toast names that one.
export async function refreshDetails(paper: Paper, open: (id: string) => void) {
  try {
    const after = await rpc.library.refresh({ id: paper.id })
    if (after && after.id !== paper.id) {
      const title = after.title
      return void toast(t`Folded into “${title}”`, { description: t`It was a copy of a paper already in your library.`, action: { label: t({ message: "Open", comment: "button: open a paper to read" }), onClick: () => open(after.id) } })
    }
    const changed = after ? DETAIL_FIELDS.filter(([key]) => JSON.stringify(after[key]) !== JSON.stringify(paper[key])).map(([, name]) => name()) : []
    toast(changed.length ? t`Details refreshed` : t`Details checked; nothing changed`, { description: changed.length ? changed.join(", ") : paper.title })
  } catch (error) {
    toast.error((error instanceof Error && error.message) || t`Couldn't refresh the details.`)
  }
}

const DETAIL_FIELDS: [keyof Paper, () => string][] = [
  ["title", () => t({ message: "title", comment: "a paper's field, in a list of what Refresh details changed" })],
  ["authors", () => t({ message: "authors", comment: "a paper's field, in a list of what Refresh details changed" })],
  ["year", () => t({ message: "year", comment: "a paper's field, in a list of what Refresh details changed" })],
  ["venue", () => t({ message: "venue", comment: "a paper's field, in a list of what Refresh details changed" })],
  ["abstract", () => t({ message: "abstract", comment: "a paper's field, in a list of what Refresh details changed" })],
  ["ids", () => t({ message: "ids", comment: "a paper's DOI, arXiv id and the like, in a list of what Refresh details changed" })],
]
