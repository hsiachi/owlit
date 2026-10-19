import { describe, expect, it } from "vitest"
import { extensionRoute, siteOf, throughProxy } from "./route.ts"

describe("where the extension goes for a paper", () => {
  it("sends the extension to the publisher's page and PDF, through the proxy where it is set", () => {
    const tlink = { base: "https://tlink.lib.tsinghua.edu.cn", scheme: "login-url" as const, path: "/go" }
    expect(extensionRoute("10.1177/0956797620904990", undefined)).toEqual({
      url: "https://journals.sagepub.com/doi/10.1177/0956797620904990",
      pdfUrl: "https://journals.sagepub.com/doi/pdf/10.1177/0956797620904990",
      host: "sagepub.com",
      proxied: false,
    })
    expect(extensionRoute("10.1177/0956797620904990", tlink)).toEqual({
      url: "https://tlink.lib.tsinghua.edu.cn/go?url=https://journals.sagepub.com/doi/10.1177/0956797620904990",
      pdfUrl: "https://tlink.lib.tsinghua.edu.cn/go?url=https://journals.sagepub.com/doi/pdf/10.1177/0956797620904990",
      host: "tlink.lib.tsinghua.edu.cn",
      proxied: true,
      signIn: "https://tlink.lib.tsinghua.edu.cn/go",
    })
    // The preset's sign-in page, for settings saved before it existed too
    expect(extensionRoute("10.1177/0956797620904990", { ...tlink, preset: "tsinghua" }).signIn).toBe("https://tlink.lib.tsinghua.edu.cn/gologin")
    // Open to all: never through the proxy
    expect(extensionRoute("10.1145/3613904.3642549", tlink)).toMatchObject({ url: "https://dl.acm.org/doi/10.1145/3613904.3642549", host: "acm.org", proxied: false })
    // A publisher owlit has no row for: where the DOI is registered, not doi.org
    expect(extensionRoute("10.1136/bmj.n71", undefined, "https://www.bmj.com/lookup/doi/10.1136/bmj.n71")).toEqual({ url: "https://www.bmj.com/lookup/doi/10.1136/bmj.n71", host: "bmj.com", proxied: false })
  })

  it("follows the site a DOI is registered to", () => {
    // A journal that moved to SAGE keeps its 10.1111 (Wiley) DOIs
    expect(extensionRoute("10.1111/j.0963-7214.2005.00355.x", undefined, "https://journals.sagepub.com/doi/10.1111/j.0963-7214.2005.00355.x")).toMatchObject({
      url: "https://journals.sagepub.com/doi/10.1111/j.0963-7214.2005.00355.x",
      pdfUrl: "https://journals.sagepub.com/doi/pdf/10.1111/j.0963-7214.2005.00355.x",
      host: "sagepub.com",
    })
    // ACL's old DOIs live in the ACM's library, and ACM's own 10.5555 ones too
    expect(extensionRoute("10.3115/1654595.1654614", undefined, "http://portal.acm.org/citation.cfm?doid=1654595.1654614")).toMatchObject({ url: "https://dl.acm.org/doi/10.3115/1654595.1654614", host: "acm.org" })
    expect(extensionRoute("10.5555/2034396.2034432", undefined)).toMatchObject({ url: "https://dl.acm.org/doi/10.5555/2034396.2034432", host: "acm.org" })
    // Not known: the prefix decides
    expect(extensionRoute("10.1111/x", undefined)).toMatchObject({ host: "wiley.com" })
    expect(siteOf("www.ncbi.nlm.nih.gov")).toBe("nih.gov")
    expect(siteOf("www.ucl.ac.uk")).toBe("ucl.ac.uk")
  })

  it("rewrites a host for an EZproxy that works by host names", () => {
    expect(throughProxy("https://dl.acm.org/doi/10.1145/1", { base: "https://proxy.lib.example.edu", scheme: "host-rewrite" })).toBe(
      "https://dl-acm-org.proxy.lib.example.edu/doi/10.1145/1",
    )
    expect(throughProxy("https://x.org/a", { base: "https://ezp.example.edu", scheme: "login-url" })).toBe("https://ezp.example.edu/login?url=https://x.org/a")
  })
})
