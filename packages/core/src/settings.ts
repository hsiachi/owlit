import type { AppSettings } from "@owlit/protocol"
import path from "node:path"
import { readJson, writeJsonAtomic } from "./fs-util.ts"
import type { SecretBox } from "./host.ts"

const RECENT_LIMIT = 10

export const defaultSettings = (): AppSettings => ({
  version: 1,
  recentWorkspaces: [],
  connectors: {},
  parsing: {},
  library: {},
  activity: { enabled: true },
  appearance: { theme: "system", tone: "warm", language: "system" },
  profile: {},
})

// The keys in settings.json. On disk each is { sealed: <base64> } when the host can seal (the desktop
// app, with the system keychain); in memory they are plain strings.
const SECRETS = [
  ["library", "s2ApiKey"],
  ["library", "openalexApiKey"],
  ["parsing", "token"],
] as const

interface Sealed {
  sealed: string
}
const isSealed = (value: unknown): value is Sealed => typeof value === "object" && value !== null && typeof (value as Sealed).sealed === "string"

// <userData>/settings.json. Read once, kept in memory, written whole on every change. Keys this
// version doesn't know are kept, so an older build never drops a newer one's settings.
export class SettingsStore {
  readonly file: string
  private value: AppSettings | undefined
  private box: SecretBox | undefined

  constructor(userDataDir: string, box?: SecretBox) {
    this.file = path.join(userDataDir, "settings.json")
    this.box = box
  }

  async get(): Promise<AppSettings> {
    if (!this.value) {
      let stored: Partial<AppSettings> | undefined
      try {
        stored = await readJson<Partial<AppSettings>>(this.file)
      } catch (error) {
        // A settings file that doesn't parse is replaced rather than blocking the app from starting
        console.error(`[core] ${this.file} is unreadable, starting from defaults`, error)
      }
      const defaults = defaultSettings()
      this.value = this.open({ ...defaults, ...stored, appearance: { ...defaults.appearance, ...stored?.appearance } })
    }
    return this.value
  }

  async update(change: (settings: AppSettings) => AppSettings) {
    this.value = change(await this.get())
    await writeJsonAtomic(this.file, this.seal(this.value))
    return this.value
  }

  rememberWorkspace(workspacePath: string) {
    return this.update((s) => ({
      ...s,
      lastWorkspace: workspacePath,
      recentWorkspaces: [workspacePath, ...s.recentWorkspaces.filter((p) => p !== workspacePath)].slice(0, RECENT_LIMIT),
    }))
  }

  forgetWorkspace(workspacePath: string) {
    return this.update((s) => ({
      ...s,
      lastWorkspace: s.lastWorkspace === workspacePath ? undefined : s.lastWorkspace,
      recentWorkspaces: s.recentWorkspaces.filter((p) => p !== workspacePath),
    }))
  }

  // A key written before sealing existed (or by hand) is read as is and sealed on the next write. One
  // that can't be opened (settings.json copied from another machine) is dropped rather than misused.
  private open(settings: AppSettings): AppSettings {
    const copy = structuredClone(settings) as unknown as Record<string, Record<string, unknown>>
    for (const [group, key] of SECRETS) {
      const value = copy[group]?.[key]
      if (!isSealed(value)) continue
      try {
        if (!this.box) throw new Error("nothing here can open sealed keys")
        copy[group][key] = this.box.open(value.sealed)
      } catch (error) {
        console.error(`[core] settings.json: ${group}.${key} couldn't be opened and is left out`, error)
        delete copy[group][key]
      }
    }
    return copy as unknown as AppSettings
  }

  private seal(settings: AppSettings): unknown {
    if (!this.box) return settings
    const copy = structuredClone(settings) as unknown as Record<string, Record<string, unknown>>
    for (const [group, key] of SECRETS) {
      const value = copy[group]?.[key]
      if (typeof value !== "string" || !value) continue
      try {
        copy[group][key] = { sealed: this.box.seal(value) } satisfies Sealed
      } catch (error) {
        // A keychain that refuses shouldn't stop every other setting from being saved
        console.error(`[core] settings.json: ${group}.${key} couldn't be sealed and is written as is`, error)
      }
    }
    return copy
  }
}
