import { BorderedList } from "@/components/bordered-list"
import { GroupLabel } from "@/components/group-label"
import { DialogHeading } from "@/components/info"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { SHORTCUT_GROUPS, useShortcutsSheet } from "./shortcuts"

// Help › Keyboard Shortcuts (⌘/): every shortcut, grouped, one line each. Short enough to need no search.
export function ShortcutsDialog() {
  const open = useShortcutsSheet((s) => s.open)
  return (
    <Dialog open={open} onOpenChange={(o) => useShortcutsSheet.setState({ open: o })}>
      <DialogContent className="max-h-[min(40rem,calc(100svh-4rem))] gap-0 overflow-y-auto sm:max-w-lg">
        <DialogHeading title="Keyboard shortcuts" description="Every keyboard shortcut in owlit" />
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.title} className="mt-4">
            <GroupLabel as="h3" flush>
              {group.title}
            </GroupLabel>
            <BorderedList as="ul">
              {group.shortcuts.map((s) => (
                <li key={s.id} className="flex min-h-9 items-center gap-3 px-3 py-1 text-sm">
                  <span className="min-w-0 flex-1">
                    {s.label}
                    {s.where && <span className="text-muted-foreground"> {s.where}</span>}
                  </span>
                  <KbdGroup>
                    {s.keys.map((k, i) => (k === "–" ? <span key={i} className="text-xs text-muted-foreground">–</span> : <Kbd key={i}>{k}</Kbd>))}
                  </KbdGroup>
                </li>
              ))}
            </BorderedList>
          </section>
        ))}
      </DialogContent>
    </Dialog>
  )
}
