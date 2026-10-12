// Links to parts of the app rather than to workspace things, which Owlit writes when it explains how to
// use owlit (owlit_help): owlit://settings/<section> opens Settings there, owlit://shortcuts opens the
// shortcut list. They open over the page, so nothing navigates.

import { parseOwlitUri } from "@owlit/protocol"
import { openSettings, settingsPlace, type SettingsPlace } from "@/features/settings/store"
import { openShortcuts } from "./shortcuts"

const settingsLink = (href: string) => {
  const u = parseOwlitUri(href)
  if (u?.kind !== "settings") return null
  const place = u.section ? settingsPlace(u.section) : null
  return { id: place ? (u.section as SettingsPlace) : undefined, label: place?.label }
}

const isShortcuts = (href: string) => parseOwlitUri(href)?.kind === "shortcuts"

// What the link opens, in words; null for anything that isn't one of these links
export function appLinkTitle(href: string) {
  const settings = settingsLink(href)
  if (settings) return settings.label ? `Settings › ${settings.label}` : "Settings"
  if (isShortcuts(href)) return "Keyboard shortcuts"
  return null
}

// Opens it and says so; false for anything else
export function openAppLink(href: string) {
  const settings = settingsLink(href)
  if (settings) {
    openSettings(settings.id)
    return true
  }
  if (isShortcuts(href)) {
    openShortcuts()
    return true
  }
  return false
}
