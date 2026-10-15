// Theme and paper tone on the document. The theme becomes the .dark class (index.css hangs the dark
// tokens off it), the tone becomes data-tone. In the desktop app the theme also drives the system's
// appearance (nativeTheme), so "System" and prefers-color-scheme stay in step with the menus and
// scrollbars; the first values come from the preload, so the first frame is already right.

import type { AppearanceSettings } from "@owlit/protocol"
import { bridge, isDesktop } from "@/lib/rpc"

const KEY = "owlit.appearance"
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)")
let current: AppearanceSettings = bridge?.appearance ?? storedAppearance()

export function storedAppearance(): AppearanceSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<AppearanceSettings> | null
    return { theme: stored?.theme ?? "system", tone: stored?.tone ?? "warm", language: stored?.language ?? "system" }
  } catch {
    return { theme: "system", tone: "warm", language: "system" }
  }
}

function paint() {
  const root = document.documentElement
  const dark = current.theme === "dark" || (current.theme === "system" && darkQuery.matches)
  // Every surface takes the new colours in the same frame: left alone, whatever has a colour transition
  // (buttons, rows) would trail the rest by a beat and the switch would look smeared. Reading the layout
  // commits the change before the transitions come back.
  root.classList.add("no-transitions")
  root.classList.toggle("dark", dark)
  if (current.tone === "warm") delete root.dataset.tone
  else root.dataset.tone = current.tone
  void document.body.offsetHeight
  // A timer, not a frame callback: a hidden window runs no frames, and a system switch can land there
  setTimeout(() => root.classList.remove("no-transitions"))
}

export function applyAppearance(next: AppearanceSettings) {
  current = next
  if (!isDesktop) {
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      // A browser that keeps nothing still shows the change for this visit
    }
  }
  paint()
}

export function startAppearance() {
  paint()
  darkQuery.addEventListener("change", paint)
}
