import { describe, expect, it, vi } from "vitest"
import { askForKnownSites, askForOrigins, hasKnownSites, knownSites, notYetAllowed } from "./permissions.ts"

const manifest = { host_permissions: ["http://127.0.0.1/*", "https://*.acm.org/*", "https://*.wiley.com/*"] }

// browser.permissions with a set of granted origins; request grants what the user says yes to
function stub({ granted = [] as string[], answer = true as boolean | Error } = {}) {
  const have = new Set(granted)
  return {
    have,
    contains: vi.fn(async ({ origins = [] }: chrome.permissions.Permissions) => origins.every((o) => have.has(o))),
    request: vi.fn(({ origins = [] }: chrome.permissions.Permissions) => {
      if (answer instanceof Error) return Promise.reject(answer)
      if (answer) for (const o of origins) have.add(o)
      return Promise.resolve(answer)
    }),
  }
}

describe("the publishers' sites", () => {
  it("are the manifest's https host permissions, not owlit's own address", () => {
    expect(knownSites(manifest)).toEqual(["https://*.acm.org/*", "https://*.wiley.com/*"])
  })

  it("are missing when any one of them is", async () => {
    expect(await hasKnownSites(stub({ granted: ["https://*.acm.org/*"] }), manifest)).toBe(false)
    expect(await hasKnownSites(stub({ granted: knownSites(manifest) }), manifest)).toBe(true)
  })

  it("are asked for together, in one request made before anything is awaited", async () => {
    const permissions = stub()
    const asked = askForKnownSites(permissions, manifest)
    // Firefox honours a request only inside the click's own turn
    expect(permissions.request).toHaveBeenCalledTimes(1)
    expect(permissions.request).toHaveBeenCalledWith({ origins: knownSites(manifest) })
    expect(await asked).toBe("granted")
    expect(await hasKnownSites(permissions, manifest)).toBe(true)
  })

  it("stay missing when the user says no", async () => {
    const permissions = stub({ answer: false })
    expect(await askForKnownSites(permissions, manifest)).toBe("refused")
    expect(await hasKnownSites(permissions, manifest)).toBe(false)
  })

  it("come back as unasked, not an error, when the browser won't ask", async () => {
    const permissions = stub({ answer: new Error("permissions.request may only be called from a user input handler") })
    expect(await askForKnownSites(permissions, manifest)).toBe("unasked")
  })
})

describe("one site", () => {
  it("is asked for alone, at once", async () => {
    const permissions = stub()
    const asked = askForOrigins(permissions, ["https://example.org/*"])
    expect(permissions.request).toHaveBeenCalledWith({ origins: ["https://example.org/*"] })
    expect(await asked).toBe("granted")
  })
})

describe("the sites owlit's papers wait to be allowed on", () => {
  it("leaves out a site the extension may already read", async () => {
    const permissions = stub({ granted: ["https://sagepub.com/*", "https://*.sagepub.com/*"] })
    const waits = [
      { host: "sagepub.com", papers: 2 },
      { host: "example-press.org", papers: 1 },
    ]
    expect(await notYetAllowed(permissions, waits)).toEqual({ needed: [{ host: "example-press.org", papers: 1 }], allowed: ["sagepub.com"] })
  })

  it("counts a proxy allowed over plain http as allowed", async () => {
    const permissions = stub({ granted: ["http://ezproxy.example.edu/*", "http://*.ezproxy.example.edu/*"] })
    expect(await notYetAllowed(permissions, [{ host: "ezproxy.example.edu", papers: 1 }])).toEqual({ needed: [], allowed: ["ezproxy.example.edu"] })
  })
})
