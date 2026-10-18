// The extension's manifest.json for each browser it is built for (scripts/build.mjs writes it). One
// codebase: the two differ only in what each browser's manifest v3 needs.

export type Target = "chrome" | "firefox"
export const TARGETS: Target[] = ["chrome", "firefox"]

// The add-on's id on addons.mozilla.org: fixed, so updates and the stored token follow the same add-on
export const GECKO_ID = "extension@owlit.ink"
export const GECKO_DEV_ID = "extension-dev@owlit.ink"
// Firefox 140 (an ESR): the oldest that reads data_collection_permissions, which addons.mozilla.org
// requires; it also has everything else used here (module event pages, optional_host_permissions,
// storage.session, scripting)
export const FIREFOX_MIN = "140.0"
// Firefox for Android reads data_collection_permissions from 142
export const FIREFOX_ANDROID_MIN = "142.0"
// Module service workers, and webRequest's responseHeaders without extraHeaders
export const CHROME_MIN = "116"

const ICONS = { 16: "icons/16.png", 32: "icons/32.png", 48: "icons/48.png", 128: "icons/128.png" }

export interface Manifest {
  manifest_version: 3
  name: string
  version: string
  description: string
  icons: Record<number, string>
  action: { default_title: string; default_popup: string; default_icon: Record<number, string> }
  background: { service_worker: string; type: "module" } | { scripts: string[]; type: "module" }
  content_scripts: { matches: string[]; js: string[]; run_at: "document_idle" }[]
  permissions: string[]
  host_permissions: string[]
  optional_host_permissions: string[]
  minimum_chrome_version?: string
  browser_specific_settings?: {
    gecko: { id: string; strict_min_version: string; data_collection_permissions: { required: string[] } }
    gecko_android: { strict_min_version: string }
  }
}

// dev: the build for Owlit Dev (scripts/build.mjs --dev), named apart so the two can sit side by side
export function manifest(target: Target, { version, publishers, dev = false }: { version: string; publishers: string[]; dev?: boolean }): Manifest {
  const shared = {
    manifest_version: 3 as const,
    name: dev ? "owlit (dev)" : "owlit",
    version,
    description: "Add the paper of the page you're on to owlit, with its PDF, using your browser's access.",
    icons: ICONS,
    action: { default_title: "owlit", default_popup: "popup.html", default_icon: ICONS },
    content_scripts: [{ matches: publishers, js: ["content.js"], run_at: "document_idle" as const }],
    permissions: ["storage", "activeTab", "scripting", "notifications", "webRequest", "alarms"],
    // owlit on this machine (any port: a match pattern takes none), and the publishers owlit knows
    host_permissions: ["http://127.0.0.1/*", ...publishers],
    // Any other site, asked for one at a time from a click in the popup
    optional_host_permissions: ["https://*/*"],
  }
  if (target === "chrome") return { ...shared, background: { service_worker: "background.js", type: "module" }, minimum_chrome_version: CHROME_MIN }
  return {
    ...shared,
    // Firefox runs no extension service worker: its manifest v3 background is an event page, the same
    // module loaded as a script, which Firefox unloads when idle as Chrome stops a worker
    background: { scripts: ["background.js"], type: "module" },
    browser_specific_settings: {
      gecko: {
        id: dev ? GECKO_DEV_ID : GECKO_ID,
        strict_min_version: FIREFOX_MIN,
        // What leaves the browser, though only to owlit on this machine: the addresses of paper pages
        // (browsingActivity) and their details and PDFs (websiteContent)
        data_collection_permissions: { required: ["browsingActivity", "websiteContent"] },
      },
      gecko_android: { strict_min_version: FIREFOX_ANDROID_MIN },
    },
  }
}
