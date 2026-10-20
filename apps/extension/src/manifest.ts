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

// One icon everywhere, the white feather on owlit's green tile (scripts/icons.mjs draws it): the extensions
// page and the store take all six sizes, the toolbar button 16, 32 and 48. 64 and 96 are the 32 and 48
// slots on a 2x display (the extensions page asks for 96): the browser takes the nearest size listed, and
// 128 scaled down looks soft. One icon for light and dark toolbars too: Chrome has no API for the
// toolbar's colour and a page's colour scheme is a poor guess at it (Dia pairs a dark system with a light
// toolbar), so no theme_icons and no setIcon: the tile reads on both.
const ICONS = { 16: "icons/16.png", 32: "icons/32.png", 48: "icons/48.png", 64: "icons/64.png", 96: "icons/96.png", 128: "icons/128.png" }
const BUTTON = { 16: ICONS[16], 32: ICONS[32], 48: ICONS[48] }

export interface Manifest {
  manifest_version: 3
  name: string
  version: string
  description: string
  icons: Record<number, string>
  // No default_popup: the click acts (background/index.ts), and the popup is set for a tab only when the
  // page can't say what came of it
  action: { default_title: string; default_icon: Record<number, string> }
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
    action: { default_title: "Add to owlit", default_icon: BUTTON },
    content_scripts: [{ matches: publishers, js: ["content.js"], run_at: "document_idle" as const }],
    // contextMenus: the button's right-click menu, where the one setting is
    permissions: ["storage", "activeTab", "scripting", "notifications", "webRequest", "alarms", "contextMenus"],
    // owlit on this machine (any port: a match pattern takes none), and the publishers owlit knows
    host_permissions: ["http://127.0.0.1/*", ...publishers],
    // Any other site, asked for one at a time from a click in the popup or on the Allow page
    // http for a library proxy that answers on plain http (permissions.ts originsOf)
    optional_host_permissions: ["https://*/*", "http://*/*"],
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
