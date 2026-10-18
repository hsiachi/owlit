import { describe, expect, it } from "vitest"
import { FIREFOX_ANDROID_MIN, FIREFOX_MIN, GECKO_ID, manifest, TARGETS } from "./manifest.ts"

const publishers = ["https://*.acm.org/*", "https://*.springer.com/*"]
const built = (target: (typeof TARGETS)[number]) => manifest(target, { version: "1.2.3", publishers })

describe("manifest", () => {
  it.each(TARGETS)("has what a manifest v3 needs, for %s", (target) => {
    const m = built(target)
    expect(m.manifest_version).toBe(3)
    expect(m.name).toBe("owlit")
    expect(m.version).toBe("1.2.3")
    expect(m.action.default_popup).toBe("popup.html")
    expect(m.content_scripts[0]).toMatchObject({ matches: publishers, js: ["content.js"] })
    // Sites are host permissions, never API permissions, in manifest v3
    expect(m.permissions.every((p) => !p.includes("://"))).toBe(true)
    expect(m.host_permissions).toEqual(["http://127.0.0.1/*", ...publishers])
    expect(m.optional_host_permissions).toEqual(["https://*/*", "http://*/*"])
    // A match pattern takes no port
    for (const origin of [...m.host_permissions, ...m.optional_host_permissions]) expect(origin).toMatch(/^https?:\/\/(\*|\*\.[^/:*]+|[^/:*]+)\/\*$/)
  })

  it("runs a module service worker in Chrome, and names nothing of Firefox's", () => {
    const m = built("chrome")
    expect(m.background).toEqual({ service_worker: "background.js", type: "module" })
    expect(m.minimum_chrome_version).toBe("116")
    expect(m.browser_specific_settings).toBeUndefined()
  })

  it("runs a module event page in Firefox, under owlit's add-on id", () => {
    const m = built("firefox")
    expect(m.background).toEqual({ scripts: ["background.js"], type: "module" })
    expect("service_worker" in m.background).toBe(false)
    expect(m.minimum_chrome_version).toBeUndefined()
    expect(m.browser_specific_settings?.gecko).toMatchObject({ id: GECKO_ID, strict_min_version: FIREFOX_MIN })
    expect(GECKO_ID).toBe("extension@owlit.ink")
    expect(m.browser_specific_settings?.gecko_android).toEqual({ strict_min_version: FIREFOX_ANDROID_MIN })
    // addons.mozilla.org refuses a new add-on without it; "none" can't stand beside a data type
    const required = m.browser_specific_settings!.gecko.data_collection_permissions.required
    expect(required.length).toBeGreaterThan(0)
    expect(required.includes("none") && required.length > 1).toBe(false)
  })

  it.each(TARGETS)("names the dev build apart, for %s", (target) => {
    const m = manifest(target, { version: "1.2.3", publishers, dev: true })
    expect(m.name).toBe("owlit (dev)")
    if (target === "firefox") expect(m.browser_specific_settings?.gecko.id).not.toBe(GECKO_ID)
  })
})
