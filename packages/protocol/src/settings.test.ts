import { describe, expect, it } from "vitest"
import { proxyFromLink } from "./settings.ts"

describe("proxyFromLink", () => {
  it("reads an EZproxy login link", () => {
    expect(proxyFromLink("https://ezproxy.lib.example.edu/login?url=https://doi.org/10.1145/1234")).toEqual({
      base: "https://ezproxy.lib.example.edu",
      scheme: "login-url",
      path: "/login",
    })
  })

  it("reads Tsinghua's tlink, with the target encoded or not", () => {
    const tlink = { base: "https://tlink.lib.tsinghua.edu.cn", scheme: "login-url", path: "/go" }
    expect(proxyFromLink("https://tlink.lib.tsinghua.edu.cn/go?url=https://dl.acm.org/doi/10.1145/1")).toEqual(tlink)
    expect(proxyFromLink("  https://TLINK.lib.tsinghua.edu.cn/go/?a=1&url=https%3A%2F%2Fdl.acm.org%2F ")).toEqual(tlink)
  })

  it("reads a host-rewriting proxy from a proxied publisher page", () => {
    expect(proxyFromLink("https://dl-acm-org.ezproxy.example.edu/doi/10.1145/1234")).toEqual({
      base: "https://ezproxy.example.edu",
      scheme: "host-rewrite",
    })
    expect(proxyFromLink("https://www-nature-com.proxy.lib.example.ac.uk:8443/articles/x")).toEqual({
      base: "https://proxy.lib.example.ac.uk:8443",
      scheme: "host-rewrite",
    })
  })

  it("finds nothing in a plain publisher link or text that isn't a link", () => {
    expect(proxyFromLink("https://dl.acm.org/doi/10.1145/1234")).toBeNull()
    expect(proxyFromLink("https://www.sciencedirect.com/science/article/pii/S0")).toBeNull()
    expect(proxyFromLink("my library")).toBeNull()
    expect(proxyFromLink("ftp://ezproxy.example.edu/login?url=https://x")).toBeNull()
  })
})
