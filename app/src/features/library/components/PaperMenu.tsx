import type { ComponentType } from "react"
import { useLocation } from "react-router-dom"
import {
  BookOpenIcon,
  CircleCheckIcon,
  CircleDotIcon,
  CircleIcon,
  CopyIcon,
  PencilIcon,
  StarIcon,
  StarOffIcon,
  Trash2Icon,
} from "lucide-react"
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu"
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu"
import { usePaperActions } from "../actions"
import { useLibraryStore } from "../store"
import type { Paper, ReadStatus } from "../types"
import { STATUS_LABEL, STATUS_ORDER } from "../lib/status"

interface MenuItem {
  key: string
  label: string
  icon?: ComponentType<{ className?: string }>
  onSelect?: () => void
  destructive?: boolean
  children?: MenuItem[]
}

type Section = MenuItem[]

const STATUS_ICON: Record<ReadStatus, ComponentType<{ className?: string }>> = {
  unread: CircleIcon,
  reading: CircleDotIcon,
  read: CircleCheckIcon,
}

// The same actions, whether reached from a row's ⋯, a right-click or the paper page's header.
// `afterRemove` lets the paper page leave once its paper is gone.
function useMenuSections(papers: Paper[], afterRemove?: () => void): Section[] {
  const actions = usePaperActions()
  const { pathname } = useLocation()
  const ids = papers.map((p) => p.id)
  const single = papers.length === 1 ? papers[0] : null
  const allStarred = papers.length > 0 && papers.every((p) => p.starred)
  const onPaperPage = single !== null && pathname === `/library/${single.id}`

  const sections: Section[] = []

  const first: Section = []
  if (single && !onPaperPage) first.push({ key: "open", label: "Open", icon: BookOpenIcon, onSelect: () => actions.open(single.id) })
  first.push({
    key: "star",
    label: allStarred ? "Unstar" : "Star",
    icon: allStarred ? StarOffIcon : StarIcon,
    onSelect: () => actions.setStarred(ids, !allStarred),
  })
  first.push({
    key: "status",
    label: "Status",
    children: STATUS_ORDER.map((s) => ({
      key: s,
      label: STATUS_LABEL[s],
      icon: STATUS_ICON[s],
      onSelect: () => actions.setStatus(ids, s),
    })),
  })
  sections.push(first)

  if (single) {
    sections.push([
      { key: "cite", label: "Copy citation", icon: CopyIcon, onSelect: () => actions.copyCitation(single) },
      { key: "edit", label: "Edit details", icon: PencilIcon, onSelect: () => actions.editDetails(single.id) },
    ])
  }

  sections.push([
    {
      key: "remove",
      label: papers.length > 1 ? `Remove ${papers.length} papers` : "Remove",
      icon: Trash2Icon,
      destructive: true,
      onSelect: () => actions.remove(ids, { afterRemove }),
    },
  ])

  return sections
}

function usePapers(ids: string[]): Paper[] {
  const papers = useLibraryStore((s) => s.papers)
  return ids.map((id) => papers[id]).filter((p): p is Paper => !!p)
}

export function PaperDropdownContent({
  ids,
  afterRemove,
  align = "end",
}: {
  ids: string[]
  afterRemove?: () => void
  align?: "start" | "end"
}) {
  const sections = useMenuSections(usePapers(ids), afterRemove)
  return (
    <DropdownMenuContent align={align} className="w-48">
      {sections.map((section, i) => (
        <div key={i}>
          {i > 0 && <DropdownMenuSeparator />}
          {section.map((item) =>
            item.children ? (
              <DropdownMenuSub key={item.key}>
                <DropdownMenuSubTrigger>
                  {item.icon && <item.icon />}
                  {item.label}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {item.children.map((c) => (
                    <DropdownMenuItem key={c.key} onSelect={c.onSelect}>
                      {c.icon && <c.icon />}
                      {c.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : (
              <DropdownMenuItem
                key={item.key}
                onSelect={item.onSelect}
                variant={item.destructive ? "destructive" : "default"}
              >
                {item.icon && <item.icon />}
                {item.label}
              </DropdownMenuItem>
            ),
          )}
        </div>
      ))}
    </DropdownMenuContent>
  )
}

export function PaperContextContent({ ids }: { ids: string[] }) {
  const sections = useMenuSections(usePapers(ids))
  return (
    <ContextMenuContent className="w-48">
      {sections.map((section, i) => (
        <div key={i}>
          {i > 0 && <ContextMenuSeparator />}
          {section.map((item) =>
            item.children ? (
              <ContextMenuSub key={item.key}>
                <ContextMenuSubTrigger>
                  {item.icon && <item.icon />}
                  {item.label}
                </ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  {item.children.map((c) => (
                    <ContextMenuItem key={c.key} onSelect={c.onSelect}>
                      {c.icon && <c.icon />}
                      {c.label}
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
            ) : (
              <ContextMenuItem
                key={item.key}
                onSelect={item.onSelect}
                variant={item.destructive ? "destructive" : "default"}
              >
                {item.icon && <item.icon />}
                {item.label}
              </ContextMenuItem>
            ),
          )}
        </div>
      ))}
    </ContextMenuContent>
  )
}
