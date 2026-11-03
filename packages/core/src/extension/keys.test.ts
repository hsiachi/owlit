import { PROXY_PRESETS, type ProxySettings } from "@owlit/protocol"
import { describe, expect, it } from "vitest"
import { gateOf, laneOf, proxyGate, watchOf } from "./keys.ts"
import { extensionRoute } from "./route.ts"

const TLINK: ProxySettings = PROXY_PRESETS.tsinghua.proxy
const EZPROXY: ProxySettings = { base: "https://ezproxy.uni.edu", scheme: "host-rewrite" }
const EZPROXY_LOGIN: ProxySettings = { base: "https://login.ezproxy.uni.edu", scheme: "login-url", path: "/login" }

describe("a page's gate", () => {
  it("is one Elsevier gate on all of its hosts, Cell Press's included", () => {
    for (const url of [
      "https://linkinghub.elsevier.com/retrieve/pii/S0747563219302602",
      "https://www.sciencedirect.com/science/article/pii/S0747563219302602",
      "https://pdf.sciencedirectassets.com/271802/1-s2.0-S0747563219302602/main.pdf",
      "https://www.cell.com/cell/fulltext/S0092-8674(23)00001-1",
      "https://cell.com/neuron/fulltext/S0896-6273(24)00001-1",
    ]) {
      expect(gateOf(url)).toBe("pub:elsevier")
    }
  })

  it("is the publisher's under a society subdomain", () => {
    expect(gateOf("https://agupubs.onlinelibrary.wiley.com/doi/10.1029/2020GL0001")).toBe("pub:wiley")
    expect(gateOf("https://www.thieme-connect.com/products/ejournals/abstract/10.1055/s-0040-1")).toBe("pub:thieme")
    expect(gateOf("https://www.thieme-connect.de/products/ejournals/pdf/10.1055/s-0040-1.pdf")).toBe("pub:thieme")
  })

  it("names a publisher hosted at a university by its own host, not the university's domain", () => {
    expect(gateOf("https://misq.umn.edu/article/10.25300/misq/2024/1234")).toBe("pub:misq")
    expect(gateOf("https://www.umn.edu/")).toBe("site:umn.edu")
  })

  it("is the site's registrable domain for a publisher owlit has no row for", () => {
    expect(gateOf("https://www.emerald.com/insight/content/doi/10.1108/x")).toBe("site:emerald.com")
    expect(gateOf("https://journals.example.ac.uk/article/1")).toBe("site:example.ac.uk")
  })

  it("keeps the predicted gate on a CDN, else reads the CDN as what the table says", () => {
    expect(gateOf("https://watermark02.silverchair.com/abc.pdf?token=x", undefined, "pub:oup")).toBe("pub:oup")
    expect(gateOf("https://watermark.silverchair.com/abc.pdf", undefined, "site:rupress.org")).toBe("site:rupress.org")
    expect(gateOf("https://watermark.silverchair.com/abc.pdf")).toBe("site:silverchair.com")
    expect(gateOf("https://pdf.sciencedirectassets.com/x/main.pdf", undefined, "pub:elsevier")).toBe("pub:elsevier")
  })

  it("reads doi.org by the DOI's prefix, or keeps the predicted gate", () => {
    expect(gateOf("https://doi.org/10.1093/abm/kaz001")).toBe("pub:oup")
    expect(gateOf("https://doi.org/10.1016%2Fj.chb.2019.07.016")).toBe("pub:elsevier")
    expect(gateOf("https://doi.org/10.9999/nobody.1")).toBe("site:doi.org")
    expect(gateOf("https://dx.doi.org/10.1093/abm/kaz001", undefined, "site:example.org")).toBe("site:example.org")
    expect(gateOf("https://hdl.handle.net/10.1/2")).toBe("site:handle.net")
  })

  it("never makes an identity provider a gate of its own", () => {
    const openAthens = "https://login.openathens.net/auth/uni.edu/o/12345?t=%2Fsaml"
    expect(gateOf(openAthens, undefined, "pub:sage")).toBe("pub:sage")
    expect(gateOf("https://wayf.surfnet.nl/ds?entityID=x", undefined, "pub:wiley")).toBe("pub:wiley")
    expect(gateOf("https://idp.uni.edu/idp/profile/SAML2/Redirect/SSO", undefined, "pub:tandf")).toBe("pub:tandf")
    // Through the proxy: its sign-in, holding the proxy's whole lane
    expect(gateOf(openAthens, EZPROXY, "pub:sage")).toBe("proxy:ezproxy.uni.edu")
  })
})

describe("through tlink", () => {
  it("reads a page through it back to the publisher's", () => {
    expect(gateOf("https://tlink.lib.tsinghua.edu.cn/go?url=https://www.sciencedirect.com/science/article/pii/S1", TLINK)).toBe("pub:elsevier")
    expect(gateOf("https://tlink.lib.tsinghua.edu.cn/go?url=https%3A%2F%2Fmisq.umn.edu%2Farticle%2F1", TLINK)).toBe("pub:misq")
    // The target's own query rides along unencoded
    expect(gateOf("https://tlink.lib.tsinghua.edu.cn/go?url=https://journals.sagepub.com/doi/pdf/10.1177/1?download=true&x=1", TLINK)).toBe("pub:sage")
    // The browser sent on to the publisher's own host
    expect(gateOf("https://www.science.org/doi/10.1126/science.abc1001", TLINK)).toBe("pub:science")
  })

  it("makes its own pages and the school's sign-in the proxy's gate, never the sign-in's", () => {
    expect(gateOf("https://tlink.lib.tsinghua.edu.cn/gologin", TLINK)).toBe("proxy:tlink.lib.tsinghua.edu.cn")
    expect(gateOf("https://tlink.lib.tsinghua.edu.cn/go", TLINK)).toBe("proxy:tlink.lib.tsinghua.edu.cn")
    expect(gateOf("https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/abc", TLINK, "pub:science")).toBe("proxy:tlink.lib.tsinghua.edu.cn")
    expect(proxyGate(TLINK)).toBe("proxy:tlink.lib.tsinghua.edu.cn")
  })

  it("watches the publisher's hosts and tlink's, never the school's sign-in", () => {
    const lane = laneOf(extensionRoute("10.1126/science.abc1001", TLINK))
    expect(lane).toBe("proxy:tlink.lib.tsinghua.edu.cn")
    expect(watchOf("pub:science", lane, TLINK).sort()).toEqual(["science.org", "tlink.lib.tsinghua.edu.cn"])
    expect(watchOf("proxy:tlink.lib.tsinghua.edu.cn", lane, TLINK)).toEqual(["tlink.lib.tsinghua.edu.cn"])
    for (const gate of ["pub:science", "proxy:tlink.lib.tsinghua.edu.cn"] as const) {
      expect(watchOf(gate, lane, TLINK).some((h) => h.endsWith("tsinghua.edu.cn") && h !== "tlink.lib.tsinghua.edu.cn")).toBe(false)
    }
  })

  it("predicts a paper's gate from its route through it", () => {
    const route = extensionRoute("10.1016/j.chb.2019.07.016", TLINK, "https://linkinghub.elsevier.com/retrieve/pii/S0747563219302602")
    expect(gateOf(route.url, TLINK)).toBe("pub:elsevier")
  })
})

describe("through a host-rewriting EZproxy", () => {
  it("reads the hidden host back, hyphens of its own included", () => {
    expect(gateOf("https://www-sciencedirect-com.ezproxy.uni.edu/science/article/pii/S1", EZPROXY)).toBe("pub:elsevier")
    expect(gateOf("https://www-thieme--connect-de.ezproxy.uni.edu/products/1", EZPROXY)).toBe("pub:thieme")
    expect(gateOf("https://watermark-silverchair-com.ezproxy.uni.edu/x.pdf", EZPROXY, "pub:oup")).toBe("pub:oup")
    expect(gateOf("https://ezproxy.uni.edu/login", EZPROXY)).toBe("proxy:ezproxy.uni.edu")
    // The school's sign-in under the proxy's domain
    expect(gateOf("https://idp.uni.edu/idp/profile/SAML2", EZPROXY, "pub:elsevier")).toBe("proxy:ezproxy.uni.edu")
  })

  it("watches the publisher's real and rewritten hosts", () => {
    const route = extensionRoute("10.1016/j.chb.2019.07.016", EZPROXY, "https://linkinghub.elsevier.com/retrieve/pii/S1")
    const lane = laneOf(route)
    expect(lane).toBe("proxy:ezproxy.uni.edu")
    expect(gateOf(route.url, EZPROXY)).toBe("pub:elsevier")
    const watch = watchOf("pub:elsevier", lane, EZPROXY)
    expect(watch).toEqual(expect.arrayContaining(["elsevier.com", "sciencedirect.com", "cell.com", "www-sciencedirect-com.ezproxy.uni.edu", "linkinghub-elsevier-com.ezproxy.uni.edu"]))
    // Its PDF CDN proves nothing about the check
    expect(watch.some((h) => h.includes("sciencedirectassets"))).toBe(false)
  })

  it("reads an EZproxy login link like tlink's", () => {
    expect(gateOf("https://login.ezproxy.uni.edu/login?url=https://onlinelibrary.wiley.com/doi/10.1111/x", EZPROXY_LOGIN)).toBe("pub:wiley")
  })
})

describe("a paper's lane", () => {
  it("is its own gate without a proxy", () => {
    expect(laneOf(extensionRoute("10.1016/j.chb.2019.07.016", undefined, "https://linkinghub.elsevier.com/retrieve/pii/S1"))).toBe("pub:elsevier")
    expect(laneOf(extensionRoute("10.9999/nobody.1", undefined))).toBe("site:doi.org")
    expect(laneOf(extensionRoute("10.9999/nobody.1", undefined, "https://journals.example.org/a/1"))).toBe("site:example.org")
  })

  it("watches an unknown site and its www name, and the publisher's own hosts directly", () => {
    expect(watchOf("site:example.org", "site:example.org")).toEqual(["example.org"])
    expect(watchOf("pub:misq", "pub:misq")).toEqual(["misq.umn.edu"])
    expect(watchOf("pub:oup", "pub:oup")).toEqual(["oup.com"])
  })
})
