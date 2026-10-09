// Links to parts of the app rather than to workspace things, which Owlit writes when it explains how to
// use owlit (owlit_help): owlit://settings/<section> opens Settings there, owlit://shortcuts opens the
// shortcut list. They open over the page, so nothing navigates.

import { openSettings, SECTIONS, type SettingsSection } from "@/features/settings/store"
import { openShortcuts } from "./shortcuts"

const SECTION_NAMES: Record<SettingsSection, string> = {
  appearance: "Appearance",
  agents: "Agents",
  sources: "Paper sources",
  proxy: "Library proxy",
  reading: "PDF reading",
  privacy: "Privacy",
}

const settingsSection = (href: string) => {
  const m = /^owlit:\/\/settings(?:\/([a-z]+))?\/?$/.exec(href)
  if (!m) return null
  return { section: SECTIONS.find((s) => s === m[1]) }
}

// What the link opens, in words; null for anything that isn't one of these links
export function appLinkTitle(href: string) {
  const settings = settingsSection(href)
  if (settings) return settings.section ? `Settings › ${SECTION_NAMES[settings.section]}` : "Settings"
  if (href === "owlit://shortcuts") return "Keyboard shortcuts"
  return null
}

// Opens it and says so; false for anything else
export function openAppLink(href: string) {
  const settings = settingsSection(href)
  if (settings) {
    openSettings(settings.section)
    return true
  }
  if (href === "owlit://shortcuts") {
    openShortcuts()
    return true
  }
  return false
}
