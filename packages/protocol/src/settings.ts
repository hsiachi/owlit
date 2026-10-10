// Settings as the window sees and changes them. Keys never leave core: a window learns only that one
// is set and how it ends.

import type { AppearanceSettings, ProfileSettings, ProxySettings } from "./workspace.ts"

export type SecretName = "s2ApiKey" | "openalexApiKey" | "mineruToken"

export interface SettingsView {
  appearance: AppearanceSettings
  profile: ProfileSettings
  library: {
    contactEmail?: string
    proxy?: ProxySettings
    // When the user last finished the library's sign-in window
    proxySignedInAt?: number
    digestLanguage?: string
    digestEveryPaper?: boolean
  }
  parsing: { service?: "cloud" | "self-hosted"; url?: string; auto: boolean }
  // The last four characters of each key that is set
  secrets: Partial<Record<SecretName, string>>
  // The agent that does background work; unset means the first one that is ready
  backgroundAgent?: string
  // The model each agent uses for background work, by agent id; absent means the agent's default
  backgroundModels?: Record<string, string>
  activity: { enabled: boolean }
}

// null clears a value back to its default
export interface SettingsPatch {
  appearance?: Partial<AppearanceSettings>
  profile?: { name?: string | null }
  library?: { contactEmail?: string | null; digestLanguage?: string | null; digestEveryPaper?: boolean }
  parsing?: { service?: "cloud" | "self-hosted" | null; url?: string | null; auto?: boolean }
  backgroundAgent?: string | null
  // One agent's background model; null goes back to the agent's default
  backgroundModel?: { agent: string; model: string | null }
}

// What a service said when owlit tried a key (or reached a server). unknown: it couldn't tell, so the
// value is kept and tried again on real use.
export interface SettingsCheck {
  result: "works" | "rejected" | "unknown"
  // One sentence for the user; absent when it simply works
  message?: string
}

export type SettingsCheckTarget = SecretName | "mineruServer"

// Libraries owlit knows how to reach. Others are set up from a link opened through them.
export const PROXY_PRESETS = {
  tsinghua: { name: "Tsinghua University", proxy: { base: "https://tlink.lib.tsinghua.edu.cn", scheme: "login-url", path: "/go", preset: "tsinghua" } },
} as const satisfies Record<string, { name: string; proxy: ProxySettings }>

export type ProxyPreset = keyof typeof PROXY_PRESETS

// Works out a library proxy from any link opened through it. People don't know what kind of proxy their
// library runs, but they can copy a link from it:
// - login-url: the target rides in ?url= (EZproxy's /login?url=…, Tsinghua's /go?url=…)
// - host-rewrite: the publisher's host with dots turned to hyphens, in front of the proxy's host
//   (dl-acm-org.ezproxy.example.edu)
export function proxyFromLink(link: string): ProxySettings | null {
  // Parsed by hand: this package runs where URL may not exist
  const match = /^(https?):\/\/([^/?#\s]+)([^?#\s]*)(\?[^#\s]*)?/i.exec(link.trim())
  if (!match) return null
  const [, scheme, authority, pathname, query = ""] = match
  const origin = `${scheme.toLowerCase()}://${authority.toLowerCase()}`
  const target = /[?&]url=([^&]*)/i.exec(query)?.[1]
  if (target && /^https?(:|%3A)/i.test(target)) {
    return { base: origin, scheme: "login-url", path: pathname.replace(/\/+$/, "") || "/login" }
  }
  const [host, port] = authority.toLowerCase().split(":")
  const [first, ...rest] = host.split(".")
  if (rest.length >= 2 && /^[a-z0-9]+(-[a-z0-9]+)*-(com|org|net|edu|gov|io|info|[a-z]{2})$/.test(first)) {
    return { base: `${scheme.toLowerCase()}://${rest.join(".")}${port ? `:${port}` : ""}`, scheme: "host-rewrite" }
  }
  return null
}
