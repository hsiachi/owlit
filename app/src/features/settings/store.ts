// This machine's settings as core reports them (settings.get, then settings.changed), and the Settings
// dialog's open state. Changes go straight to core: there is no Save, and every window hears the result.
// Without the desktop app there is no core; appearance is then kept in localStorage so dev:web can try it.

import { interfaceLocale, noteLanguageFor, noteLanguageOfLocale, type AppearanceSettings, type ProxyPreset, type SecretName, type SettingsCheckTarget, type SettingsPatch, type SettingsView } from "@owlit/protocol"
import type { MessageDescriptor } from "@lingui/core"
import { msg } from "@lingui/core/macro"
import { create } from "zustand"
import { setProfileId, WEB_PROFILE_ID } from "@/lib/actors"
import { applyLocale, i18n } from "@/lib/i18n"
import { isDesktop, onNotify, rpc } from "@/lib/rpc"
import { applyAppearance, storedAppearance } from "./appearance"

// The dialog's sections in order, by the names its list and owlit:// links show. They follow what the
// user came to do (what Owlit does, which agents run it, getting papers, how it looks), not core's modules.
// Labels are messages, said in the interface's language where they show.
export const SECTIONS = [
  { id: "owlit", label: msg`Owlit` },
  { id: "agents", label: msg`Agents` },
  { id: "papers", label: msg`Papers` },
  { id: "appearance", label: msg`Appearance` },
] as const satisfies readonly { id: string; label: MessageDescriptor }[]
export type SettingsSection = (typeof SECTIONS)[number]["id"]

// Groups inside a section that a link can open at, by the names links use, so owlit://settings/proxy
// in an older chat, from when most of these were sections, still lands in the right place.
const GROUPS = {
  profile: { section: "owlit", label: null },
  memory: { section: "owlit", label: msg`What Owlit keeps in mind` },
  roles: { section: "owlit", label: msg`What Owlit may do` },
  background: { section: "owlit", label: msg`Background work` },
  privacy: { section: "owlit", label: msg`Privacy` },
  updates: { section: "owlit", label: msg`Updates` },
  sources: { section: "papers", label: msg`Finding papers` },
  proxy: { section: "papers", label: msg`Library proxy` },
  extension: { section: "papers", label: msg`Browser extension` },
  "publisher-apis": { section: "papers", label: msg`Publishers' APIs` },
  reading: { section: "papers", label: msg`Reading PDFs` },
} as const satisfies Record<string, { section: SettingsSection; label: MessageDescriptor | null }>
export type SettingsGroup = keyof typeof GROUPS
export type SettingsPlace = SettingsSection | SettingsGroup

// Where an owlit://settings/<id> link goes, with the words it shows ("Papers › Library proxy")
export function settingsPlace(id: string): { section: SettingsSection; group?: SettingsGroup; label: string } | null {
  const section = SECTIONS.find((s) => s.id === id)
  if (section) return { section: section.id, label: i18n._(section.label) }
  if (!(id in GROUPS)) return null
  const group = GROUPS[id as SettingsGroup]
  const sectionLabel = i18n._(SECTIONS.find((s) => s.id === group.section)!.label)
  return { section: group.section, group: id as SettingsGroup, label: group.label ? `${sectionLabel} › ${i18n._(group.label)}` : sectionLabel }
}

interface SettingsState {
  view: SettingsView | null
  open: boolean
  section: SettingsSection
  // The group to bring into view once the section is drawn; cleared once it is
  group: SettingsGroup | null
}

export const useSettings = create<SettingsState>(() => ({ view: null, open: false, section: "owlit", group: null }))

// Opens the dialog at a section, or a group in one, when the caller knows what needs setting up;
// otherwise where it was last left
export function openSettings(place?: SettingsPlace) {
  const to = place ? settingsPlace(place) : null
  useSettings.setState((s) => ({ open: true, section: to?.section ?? s.section, group: to?.group ?? null }))
}
export const closeSettings = () => useSettings.setState({ open: false })
export const showSection = (section: SettingsSection) => useSettings.setState({ section, group: null })

function receive(view: SettingsView) {
  useSettings.setState({ view })
  setProfileId(view.profile.id)
  applyAppearance(view.appearance)
  applyLocale(view.locale)
}

export async function updateSettings(patch: SettingsPatch) {
  if (!isDesktop) {
    // Only appearance and the name mean anything without core; the name lasts until reload
    const view = useSettings.getState().view
    const appearance = { ...(view?.appearance ?? storedAppearance()), ...patch.appearance }
    const name = patch.profile?.name === undefined ? view?.profile.name : patch.profile.name || undefined
    receive({ ...webView(appearance), profile: { id: WEB_PROFILE_ID, ...(name ? { name } : {}) } })
    return
  }
  receive(await rpc.settings.update({ patch }))
}

export const setSecret = async (name: SecretName, value: string | null) => receive(await rpc.settings.setSecret({ name, value }))
export const checkSetting = (target: SettingsCheckTarget) => rpc.settings.check({ target })
export const setProxy = async (choice: { preset?: ProxyPreset; link?: string }) => receive(await rpc.settings.setProxy(choice))
export const signInToProxy = () => rpc.settings.proxySignIn()
export async function setActivity(enabled: boolean) {
  await rpc.activity.setEnabled({ enabled })
}

// What core would say, for dev:web: the interface and digest languages as core works them out
function webView(appearance = storedAppearance()): SettingsView {
  const locale = interfaceLocale(appearance.language, navigator.languages)
  const digestLanguageSystem = appearance.language === "system" ? noteLanguageFor(navigator.languages) : noteLanguageOfLocale(locale)
  return { appearance, locale, profile: { id: WEB_PROFILE_ID }, library: { digestLanguageSystem }, parsing: { auto: true }, secrets: {}, activity: { enabled: true }, onboarded: true }
}

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
}

export const appearanceOf = (view: SettingsView | null): AppearanceSettings => view?.appearance ?? storedAppearance()
