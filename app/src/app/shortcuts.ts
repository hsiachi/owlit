// Every keyboard shortcut owlit has, in one table: tooltips show a key from here and Help › Keyboard
// Shortcuts lists them all, so the two can't disagree. The keys themselves are handled where they act,
// window-wide ones through useShortcut; a new shortcut is added here too.

import type { MessageDescriptor } from "@lingui/core"
import { msg } from "@lingui/core/macro"
import { create } from "zustand"
import { useWindowKeydown } from "@/hooks/use-window-keydown"

export interface Shortcut {
  id: string
  // Words are messages, said in the interface's language where the list shows them
  label: MessageDescriptor
  // Where it applies, said after the label in the list
  where?: MessageDescriptor
  keys: string[]
}

export const SHORTCUT_GROUPS: { title: MessageDescriptor; shortcuts: Shortcut[] }[] = [
  {
    title: msg`Everywhere`,
    shortcuts: [
      { id: "palette", label: msg`Find anything`, keys: ["⌘", "K"] },
      { id: "find", label: msg`Find on this page`, where: msg`in the Library and Threads`, keys: ["/"] },
      { id: "owlit", label: msg`Ask Owlit`, where: msg`outside Chat`, keys: ["⌘", "J"] },
      { id: "owlit-panel", label: msg`Show or hide the current chat`, where: msg`outside Chat`, keys: ["⇧", "⌘", "J"] },
      { id: "settings", label: msg`Settings`, keys: ["⌘", ","] },
      { id: "open-workspace", label: msg`Open workspace`, keys: ["⌘", "O"] },
      { id: "shortcuts", label: msg`Keyboard shortcuts`, keys: ["⌘", "/"] },
    ],
  },
  {
    title: msg`Docs and Chat`,
    shortcuts: [
      { id: "new", label: msg`New doc`, where: msg`in Docs · New chat in Chat`, keys: ["⌘", "N"] },
      { id: "mention", label: msg`Mention or cite`, where: msg`in a doc, note or message`, keys: ["@"] },
      { id: "send", label: msg({ message: "Send", comment: "verb, in the keyboard shortcut list" }), where: msg`in the composer`, keys: ["↵"] },
      { id: "newline", label: msg`New line`, where: msg`in the composer`, keys: ["⇧", "↵"] },
      { id: "comment", label: msg({ message: "Comment on the selection", comment: "in the keyboard shortcut list" }), where: msg`in a doc`, keys: ["⌥", "⌘", "M"] },
      { id: "next-comment", label: msg`Next comment`, where: msg`in a doc`, keys: ["⌥", "⌘", "]"] },
      { id: "prev-comment", label: msg`Previous comment`, where: msg`in a doc`, keys: ["⌥", "⌘", "["] },
      { id: "rename-row", label: msg({ message: "Rename", comment: "verb, in the keyboard shortcut list" }), where: msg`in the docs list`, keys: ["F2"] },
      { id: "delete-row", label: msg({ message: "Delete", comment: "verb, in the keyboard shortcut list" }), where: msg`in the docs list, with Undo`, keys: ["⌘", "⌫"] },
    ],
  },
  {
    title: msg`Reading a paper`,
    shortcuts: [
      { id: "find-in-paper", label: msg`Find in paper`, keys: ["⌘", "F"] },
      { id: "highlight", label: msg`Highlight the selection`, where: msg`in colour 1 to 4`, keys: ["1", "–", "4"] },
      { id: "copy", label: msg`Copy the selection`, keys: ["⌘", "C"] },
      { id: "save-comment", label: msg`Save a comment`, keys: ["⌘", "↵"] },
      { id: "close", label: msg`Close the popover`, keys: ["Esc"] },
    ],
  },
  {
    title: msg({ message: "Undo", comment: "heading of a group in the keyboard shortcut list" }),
    shortcuts: [{ id: "undo", label: msg({ message: "Undo", comment: "verb, in the keyboard shortcut list" }), where: msg`Owlit’s last change to your doc or note too`, keys: ["⌘", "Z"] }],
  },
]

const byId = new Map(SHORTCUT_GROUPS.flatMap((g) => g.shortcuts).map((s) => [s.id, s]))

function shortcut(id: string) {
  const found = byId.get(id)
  if (!found) throw new Error(`No shortcut ${id}`)
  return found
}

// The key as a tooltip shows it: "⌘J"
export const keysFor = (id: string) => shortcut(id).keys.join("")

// Whether a key press is the table's keys. ⌘ is Ctrl outside macOS. A letter needs Shift exactly when
// the table has ⇧; a symbol may come with Shift, which some keyboards need to type it.
function pressed(e: KeyboardEvent, keys: string[]) {
  const key = keys[keys.length - 1].toLowerCase()
  if (e.key.toLowerCase() !== key) return false
  if ((e.metaKey || e.ctrlKey) !== keys.includes("⌘") || e.altKey !== keys.includes("⌥")) return false
  return keys.includes("⇧") ? e.shiftKey : !e.shiftKey || !/^[a-z]$/.test(key)
}

// Runs `handler` when the shortcut's keys are pressed anywhere in the window
export function useShortcut(id: string, handler: () => void, { enabled = true }: { enabled?: boolean } = {}) {
  const { keys } = shortcut(id)
  useWindowKeydown((e) => {
    if (!pressed(e, keys)) return
    e.preventDefault()
    handler()
  }, enabled)
}

// Help › Keyboard Shortcuts (⌘/)
export const useShortcutsSheet = create<{ open: boolean }>(() => ({ open: false }))
export const openShortcuts = () => useShortcutsSheet.setState({ open: true })
export const closeShortcuts = () => useShortcutsSheet.setState({ open: false })

// ⌘/ opens the list. In the desktop app the Help menu's accelerator usually gets there first and sends
// the same command; this covers a plain browser.
export const useShortcutsShortcut = () => useShortcut("shortcuts", () => (useShortcutsSheet.getState().open ? closeShortcuts() : openShortcuts()))
