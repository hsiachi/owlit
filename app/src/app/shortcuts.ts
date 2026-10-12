// Every keyboard shortcut owlit has, in one table: tooltips show a key from here and Help › Keyboard
// Shortcuts lists them all, so the two can't disagree. The keys themselves are handled where they act,
// window-wide ones through useShortcut; a new shortcut is added here too.

import { create } from "zustand"
import { useWindowKeydown } from "@/hooks/use-window-keydown"

export interface Shortcut {
  id: string
  label: string
  // Where it applies, said after the label in the list
  where?: string
  keys: string[]
}

export const SHORTCUT_GROUPS: { title: string; shortcuts: Shortcut[] }[] = [
  {
    title: "Everywhere",
    shortcuts: [
      { id: "palette", label: "Find anything", keys: ["⌘", "K"] },
      { id: "find", label: "Find on this page", where: "in the Library and Knowledge", keys: ["/"] },
      { id: "owlit", label: "Ask Owlit", where: "outside Chat", keys: ["⌘", "J"] },
      { id: "owlit-panel", label: "Show or hide the current chat", where: "outside Chat", keys: ["⇧", "⌘", "J"] },
      { id: "settings", label: "Settings", keys: ["⌘", ","] },
      { id: "open-workspace", label: "Open workspace", keys: ["⌘", "O"] },
      { id: "shortcuts", label: "Keyboard shortcuts", keys: ["⌘", "/"] },
    ],
  },
  {
    title: "Docs and Chat",
    shortcuts: [
      { id: "new", label: "New doc", where: "in Docs · New chat in Chat", keys: ["⌘", "N"] },
      { id: "mention", label: "Mention or cite", where: "in a doc, note or message", keys: ["@"] },
      { id: "send", label: "Send", where: "in the composer", keys: ["↵"] },
      { id: "newline", label: "New line", where: "in the composer", keys: ["⇧", "↵"] },
      { id: "rename-row", label: "Rename", where: "in the docs list", keys: ["F2"] },
      { id: "delete-row", label: "Delete", where: "in the docs list, with Undo", keys: ["⌘", "⌫"] },
    ],
  },
  {
    title: "Reading a paper",
    shortcuts: [
      { id: "find-in-paper", label: "Find in paper", keys: ["⌘", "F"] },
      { id: "highlight", label: "Highlight the selection", where: "in colour 1 to 4", keys: ["1", "–", "4"] },
      { id: "copy", label: "Copy the selection", keys: ["⌘", "C"] },
      { id: "save-comment", label: "Save a comment", keys: ["⌘", "↵"] },
      { id: "close", label: "Close the popover", keys: ["Esc"] },
    ],
  },
  {
    title: "Undo",
    shortcuts: [{ id: "undo", label: "Undo", where: "Owlit’s last change to your doc or note too", keys: ["⌘", "Z"] }],
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
