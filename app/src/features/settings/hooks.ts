import { useShortcut } from "@/app/shortcuts"
import { openSettings } from "./store"

// ⌘, opens Settings. In the desktop app the app menu's accelerator usually gets there first and sends
// the same command; this covers a plain browser and a focused field that keeps the key.
export const useSettingsShortcut = () => useShortcut("settings", () => openSettings())
