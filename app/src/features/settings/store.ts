// This machine's settings as core reports them (settings.get, then settings.changed), and the Settings
// dialog's open state. Changes go straight to core: there is no Save, and every window hears the result.
// Without the desktop app there is no core; appearance is then kept in localStorage so dev:web can try it.

import type { AppearanceSettings, ProxyPreset, SecretName, SettingsCheckTarget, SettingsPatch, SettingsView } from "@owlit/protocol"
import { create } from "zustand"
import { isDesktop, onNotify, rpc } from "@/lib/rpc"
import { applyAppearance, storedAppearance } from "./appearance"

export const SECTIONS = ["appearance", "agents", "sources", "proxy", "reading", "privacy"] as const
export type SettingsSection = (typeof SECTIONS)[number]

interface SettingsState {
  view: SettingsView | null
  open: boolean
  section: SettingsSection
}

export const useSettings = create<SettingsState>(() => ({ view: null, open: false, section: "appearance" }))

// Opens the dialog at a section when the caller knows what needs setting up, otherwise where it was
// last left
export function openSettings(section?: SettingsSection) {
  useSettings.setState((s) => ({ open: true, section: section ?? s.section }))
}
export const closeSettings = () => useSettings.setState({ open: false })
export const showSection = (section: SettingsSection) => useSettings.setState({ section })

function receive(view: SettingsView) {
  useSettings.setState({ view })
  applyAppearance(view.appearance)
}

export async function updateSettings(patch: SettingsPatch) {
  if (!isDesktop) {
    // Only appearance means anything without core
    const appearance = { ...(useSettings.getState().view?.appearance ?? storedAppearance()), ...patch.appearance }
    receive({ ...webView(), appearance })
    return
  }
  receive(await rpc.settings.update({ patch }))
}

export const setSecret = async (name: SecretName, value: string | null) => receive(await rpc.settings.setSecret({ name, value }))
export const checkSetting = (target: SettingsCheckTarget) => rpc.settings.check({ target })
export const setProxy = async (choice: { preset?: ProxyPreset; link?: string }) => receive(await rpc.settings.setProxy(choice))
export const signInToProxy = async () => receive(await rpc.settings.proxySignIn())
export async function setActivity(enabled: boolean) {
  await rpc.activity.setEnabled({ enabled })
}

const webView = (): SettingsView => ({
  appearance: storedAppearance(),
  library: {},
  parsing: { auto: true },
  secrets: {},
  activity: { enabled: true },
})

export function startSettings() {
  if (!isDesktop) {
    receive(webView())
    return
  }
  onNotify("settings.changed", receive)
  rpc.settings
    .get()
    .then(receive)
    .catch((error) => console.warn("[owlit] couldn't read settings", error))
  window.owlit?.onMenu((command) => command === "settings" && openSettings())
}

export const appearanceOf = (view: SettingsView | null): AppearanceSettings => view?.appearance ?? storedAppearance()
