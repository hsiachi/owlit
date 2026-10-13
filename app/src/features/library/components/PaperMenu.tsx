import { plural, t } from "@lingui/core/macro"
import { useLocation } from "react-router-dom"
import { toast } from "sonner"
import { MenuItems, type MenuGroups } from "@/components/action-menu"
import { isDesktop, rpc } from "@/lib/rpc"
import { usePaperActions } from "../actions"
import { STATUS_ORDER, statusLabel } from "../lib/status"
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
  if (single && !onPaperPage) first.push({ label: t({ message: "Open", comment: "menu: open a paper to read" }), onSelect: () => actions.open(single.id) })
  first.push({ label: allStarred ? t({ message: "Unstar", comment: "verb: unstar a paper" }) : t({ message: "Star", comment: "verb: star a paper" }), onSelect: () => actions.setStarred(ids, !allStarred) })
  first.push({
    label: t`Mark as`,
    children: STATUS_ORDER.map((s) => ({ label: statusLabel(s), checked: single?.status === s, onSelect: () => actions.setStatus(ids, s) })),
  })

  const copy: MenuGroups[number] = [
    { label: papers.length > 1 ? t`Copy citations` : t`Copy citation`, onSelect: () => actions.copyCitation(papers) },
    { label: t`Copy BibTeX`, onSelect: () => actions.copyBibtex(papers) },
  ]
  if (single) copy.push({ label: t`Edit details`, onSelect: () => actions.editDetails(single.id) })
  // Asks the paper services again (a title missing its subtitle, a wrong abstract); a paper they can't
  // know (a local PDF without a DOI) has nobody to ask. The user's own corrections stay.
  if (isDesktop && single && (single.ids.doi || single.ids.arxiv || single.ids.s2 || single.ids.openalex)) {
    copy.push({
      label: t`Refresh details`,
      onSelect: () => void rpc.library.refresh({ id: single.id }).catch((error: Error) => toast.error(error.message || t`Couldn't refresh the details.`)),
    })
  }
  // A paper with something to read; one with a note can have it written again (a better model, after a
  // change of language), which only the user ever asks for
  if (isDesktop && single && (single.pdf || single.text)) {
    copy.push({
      label: single.hasDigest ? t`Rewrite reading note` : t`Write a reading note`,
      onSelect: () => void rpc.library.requestDigest({ id: single.id, rewrite: single.hasDigest }).catch(() => toast.error(t`Couldn't ask for a reading note.`)),
    })
  }

  const remove = [
    {
      label: papers.length > 1 ? plural(papers.length, { one: "Remove # paper", other: "Remove # papers" }) : t({ message: "Remove", comment: "verb: remove the paper from the library" }),
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
