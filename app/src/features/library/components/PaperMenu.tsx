import { useLocation } from "react-router-dom"
import { toast } from "sonner"
import { MenuItems, type MenuGroups } from "@/components/action-menu"
import { isDesktop, rpc } from "@/lib/rpc"
import { usePaperActions } from "../actions"
import { useDigestMarks, waitForDigest } from "../digests"
import { STATUS_LABEL, STATUS_ORDER } from "../lib/status"
import { useLibraryStore } from "../store"
import type { Paper } from "../types"
import { useLibraryUi } from "../ui-store"

// The same actions, whether reached from a row's ⋯, a right-click or the paper page's header.
// `afterRemove` lets the paper page leave once its paper is gone.
function usePaperMenu(papers: Paper[], afterRemove?: () => void): MenuGroups {
  const actions = usePaperActions()
  const { pathname } = useLocation()
  const ids = papers.map((p) => p.id)
  const single = papers.length === 1 ? papers[0] : null
  const allStarred = papers.length > 0 && papers.every((p) => p.starred)
  const onPaperPage = single !== null && pathname === `/library/${single.id}`

  const first: MenuGroups[number] = []
  if (single && !onPaperPage) first.push({ label: "Open", onSelect: () => actions.open(single.id) })
  first.push({ label: allStarred ? "Unstar" : "Star", onSelect: () => actions.setStarred(ids, !allStarred) })
  first.push({
    label: "Mark as",
    children: STATUS_ORDER.map((s) => ({ label: STATUS_LABEL[s], checked: single?.status === s, onSelect: () => actions.setStatus(ids, s) })),
  })

  const copy: MenuGroups[number] = [
    { label: papers.length > 1 ? "Copy citations" : "Copy citation", onSelect: () => actions.copyCitation(papers) },
    { label: "Copy BibTeX", onSelect: () => actions.copyBibtex(papers) },
  ]
  if (single) copy.push({ label: "Edit details", onSelect: () => actions.editDetails(single.id) })
  // Asks the paper services again (a title missing its subtitle, a wrong abstract); a paper they can't
  // know (a local PDF without a DOI) has nobody to ask. The user's own corrections stay.
  if (isDesktop && single && (single.ids.doi || single.ids.arxiv || single.ids.s2 || single.ids.openalex)) {
    copy.push({
      label: "Refresh details",
      onSelect: () => void rpc.library.refresh({ id: single.id }).catch((error: Error) => toast.error(error.message || "Couldn't refresh the details.")),
    })
  }
  // A paper with something to read; one with a digest can have it written again (a better model, after a
  // change of language), which only the user ever asks for. Asked for here, it is waited for: the user
  // hears when it is done.
  if (isDesktop && single && (single.pdf || single.text)) {
    copy.push({
      label: single.hasDigest ? "Rewrite the digest" : "Write a digest",
      onSelect: () => {
        useDigestMarks.getState().markAsked(single.id)
        waitForDigest(single.id)
        void rpc.library.requestDigest({ id: single.id, rewrite: single.hasDigest }).catch(() => toast.error("Couldn't ask for a digest."))
      },
    })
  }

  const remove = [
    {
      label: papers.length > 1 ? `Remove ${papers.length} papers` : "Remove",
      destructive: true,
      onSelect: () => actions.remove(ids, { afterRemove }),
    },
  ]

  return [first, copy, remove]
}

// The items of a paper menu, for ActionsDropdownContent or ActionsOnRightClick to hold. Being the menu's
// own children, they (and the hooks above) exist only while the menu is open.
export function PaperMenu({ ids, afterRemove }: { ids: string[]; afterRemove?: () => void }) {
  const all = useLibraryStore((s) => s.papers)
  const papers = ids.map((id) => all[id]).filter((p): p is Paper => !!p)
  return <MenuItems groups={usePaperMenu(papers, afterRemove)} />
}

// A row's menu acts on every selected paper when the row is one of them, else on the row alone
export function PaperRowMenu({ id }: { id: string }) {
  const selected = useLibraryUi((s) => s.selectedIds)
  return <PaperMenu ids={selected.includes(id) ? selected : [id]} />
}
