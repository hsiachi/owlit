import { useLocation } from "react-router-dom"
import { CheckIcon } from "lucide-react"
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu"
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu"
import { usePaperActions } from "../actions"
import { STATUS_LABEL, STATUS_ORDER } from "../lib/status"
import { useLibraryStore } from "../store"
import type { Paper } from "../types"
import { StatusIcon } from "./StatusSelect"

interface MenuItem {
  key: string
  label: string
  // Single letter that triggers the item while the menu is open
  shortcut?: string
  onSelect?: () => void
  destructive?: boolean
  checked?: boolean
  icon?: React.ReactNode
  children?: MenuItem[]
}

type Section = MenuItem[]

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
  if (single && !onPaperPage) first.push({ key: "open", label: "Open", shortcut: "O", onSelect: () => actions.open(single.id) })
  first.push({
    key: "star",
    label: allStarred ? "Unstar" : "Star",
    shortcut: "S",
    onSelect: () => actions.setStarred(ids, !allStarred),
  })
  first.push({
    key: "status",
    label: "Mark as",
    children: STATUS_ORDER.map((s) => ({
      key: s,
      label: STATUS_LABEL[s],
      icon: <StatusIcon status={s} />,
      checked: single?.status === s,
      onSelect: () => actions.setStatus(ids, s),
    })),
  })
  sections.push(first)

  if (single) {
    sections.push([
      { key: "cite", label: "Copy citation", shortcut: "C", onSelect: () => actions.copyCitation(single) },
      { key: "edit", label: "Edit details", shortcut: "E", onSelect: () => actions.editDetails(single.id) },
    ])
  }

  sections.push([
    {
      key: "remove",
      label: papers.length > 1 ? `Remove ${papers.length} papers` : "Remove",
      shortcut: "D",
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

// A bare letter clicks the item carrying it; clicking (rather than calling onSelect) lets Radix close the menu
function onShortcutKey(e: React.KeyboardEvent<HTMLDivElement>) {
  if (e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1) return
  const el = e.currentTarget.querySelector<HTMLElement>(`[data-shortcut="${e.key.toUpperCase()}"]`)
  if (!el) return
  e.preventDefault()
  el.click()
}

// The two Radix menu flavours share markup shape but not components, so the tree is built from a kit
interface Kit {
  Item: typeof DropdownMenuItem
  Separator: typeof DropdownMenuSeparator
  Shortcut: typeof DropdownMenuShortcut
  Sub: typeof DropdownMenuSub
  SubTrigger: typeof DropdownMenuSubTrigger
  SubContent: typeof DropdownMenuSubContent
}

function renderSections(sections: Section[], k: Kit) {
  return sections.map((section, i) => (
    <div key={i}>
      {i > 0 && <k.Separator />}
      {section.map((item) =>
        item.children ? (
          <k.Sub key={item.key}>
            <k.SubTrigger>{item.label}</k.SubTrigger>
            <k.SubContent className="w-40">
              {item.children.map((c) => (
                <k.Item key={c.key} onSelect={c.onSelect}>
                  {c.icon}
                  {c.label}
                  {c.checked && <CheckIcon className="ml-auto text-muted-foreground" />}
                </k.Item>
              ))}
            </k.SubContent>
          </k.Sub>
        ) : (
          <k.Item
            key={item.key}
            data-shortcut={item.shortcut}
            onSelect={item.onSelect}
            variant={item.destructive ? "destructive" : "default"}
          >
            {item.label}
            {item.shortcut && <k.Shortcut className={item.destructive ? "text-current opacity-70" : undefined}>{item.shortcut}</k.Shortcut>}
          </k.Item>
        ),
      )}
    </div>
  ))
}

const dropdownKit: Kit = {
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
  Shortcut: DropdownMenuShortcut,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
}

const contextKit: Kit = {
  Item: ContextMenuItem as unknown as typeof DropdownMenuItem,
  Separator: ContextMenuSeparator as unknown as typeof DropdownMenuSeparator,
  Shortcut: ContextMenuShortcut as unknown as typeof DropdownMenuShortcut,
  Sub: ContextMenuSub as unknown as typeof DropdownMenuSub,
  SubTrigger: ContextMenuSubTrigger as unknown as typeof DropdownMenuSubTrigger,
  SubContent: ContextMenuSubContent as unknown as typeof DropdownMenuSubContent,
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
    <DropdownMenuContent align={align} className="w-48" onKeyDown={onShortcutKey}>
      {renderSections(sections, dropdownKit)}
    </DropdownMenuContent>
  )
}

export function PaperContextContent({ ids }: { ids: string[] }) {
  const sections = useMenuSections(usePapers(ids))
  return (
    <ContextMenuContent className="w-48" onKeyDown={onShortcutKey}>
      {renderSections(sections, contextKit)}
    </ContextMenuContent>
  )
}
