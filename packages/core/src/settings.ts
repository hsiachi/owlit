import type { AppSettings } from "@owlit/protocol"
import path from "node:path"
import { readJson, writeJsonAtomic } from "./fs-util.ts"

const RECENT_LIMIT = 10

export const defaultSettings = (): AppSettings => ({
  version: 1,
  recentWorkspaces: [],
  connectors: {},
  parsing: {},
  activity: { enabled: true },
})

// <userData>/settings.json. Read once, kept in memory, written whole on every change. Keys this
// version doesn't know are kept, so an older build never drops a newer one's settings.
export class SettingsStore {
  readonly file: string
  private value: AppSettings | undefined

  constructor(userDataDir: string) {
    this.file = path.join(userDataDir, "settings.json")
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
      this.value = { ...defaultSettings(), ...stored }
    }
    return this.value
  }

  async update(change: (settings: AppSettings) => AppSettings) {
    this.value = change(await this.get())
    await writeJsonAtomic(this.file, this.value)
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
}
