import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { SHORTCUT_GROUPS, useShortcutsSheet } from "./shortcuts"

// Help › Keyboard Shortcuts (⌘/): every shortcut, grouped, one line each. Short enough to need no search.
export function ShortcutsDialog() {
  const open = useShortcutsSheet((s) => s.open)
  return (
    <Dialog open={open} onOpenChange={(o) => useShortcutsSheet.setState({ open: o })}>
      <DialogContent className="max-h-[min(40rem,calc(100svh-4rem))] gap-0 overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription className="sr-only">Every keyboard shortcut in owlit</DialogDescription>
        </DialogHeader>
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.title} className="mt-4">
            <h3 className="mb-1.5 text-xs text-muted-foreground">{group.title}</h3>
            <ul className="divide-y rounded-lg border">
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
            </ul>
          </section>
        ))}
      </DialogContent>
    </Dialog>
  )
}
