import { describe, expect, it } from "vitest"
import { bypassHosts, hasProxyEnv, proxyUrl, systemProxyEnv } from "./proxy.ts"

const SCUTIL = `<dictionary> {
  ExceptionsList : <array> {
    0 : 127.0.0.1
    1 : 192.168.0.0/16
    2 : localhost
    3 : *.local
    4 : <local>
  }
  HTTPEnable : 1
  HTTPPort : 7890
  HTTPProxy : 127.0.0.1
}`

describe("proxyUrl", () => {
  it("reads the first way a PAC answer gives", () => {
    expect(proxyUrl("PROXY 127.0.0.1:7890; DIRECT")).toBe("http://127.0.0.1:7890")
    expect(proxyUrl("HTTPS proxy.example.com:443")).toBe("https://proxy.example.com:443")
    expect(proxyUrl("SOCKS5 127.0.0.1:7891")).toBe("socks5h://127.0.0.1:7891")
    expect(proxyUrl("SOCKS 127.0.0.1:1080")).toBe("socks4a://127.0.0.1:1080")
    expect(proxyUrl("DIRECT")).toBeNull()
    expect(proxyUrl("")).toBeNull()
  })
})

describe("bypassHosts", () => {
  it("turns macOS's bypass list into NO_PROXY's form", () => {
    expect(bypassHosts(SCUTIL)).toEqual(["127.0.0.1", "192.168.0.0/16", "localhost", ".local"])
    expect(bypassHosts("<dictionary> {\n  HTTPEnable : 0\n}")).toEqual([])
  })
})

describe("systemProxyEnv", () => {
  const bypass = async () => bypassHosts(SCUTIL)

  it("sets each variable in both cases, with the system's bypass list", async () => {
    const env = await systemProxyEnv(async () => "PROXY 127.0.0.1:7890", bypass)
    expect(env).toEqual({
      https_proxy: "http://127.0.0.1:7890",
      HTTPS_PROXY: "http://127.0.0.1:7890",
      http_proxy: "http://127.0.0.1:7890",
      HTTP_PROXY: "http://127.0.0.1:7890",
      no_proxy: "localhost,127.0.0.1,::1,192.168.0.0/16,.local",
      NO_PROXY: "localhost,127.0.0.1,::1,192.168.0.0/16,.local",
    })
  })

  it("puts a SOCKS proxy in ALL_PROXY only", async () => {
    const env = await systemProxyEnv(async () => "SOCKS5 127.0.0.1:7891", bypass)
    expect(env.ALL_PROXY).toBe("socks5h://127.0.0.1:7891")
    expect(env.all_proxy).toBe("socks5h://127.0.0.1:7891")
    expect(env).not.toHaveProperty("HTTPS_PROXY")
    expect(env).not.toHaveProperty("HTTP_PROXY")
  })

  it("is empty when the system goes direct or can't say", async () => {
    expect(await systemProxyEnv(async () => "DIRECT", bypass)).toEqual({})
    expect(await systemProxyEnv(() => Promise.reject(new Error("gone")), bypass)).toEqual({})
  })

  it("keeps the proxy when the bypass list can't be read", async () => {
    const env = await systemProxyEnv(async () => "PROXY 127.0.0.1:7890", () => Promise.reject(new Error("no scutil")))
    expect(env.NO_PROXY).toBe("localhost,127.0.0.1,::1")
  })
})

describe("hasProxyEnv", () => {
  it("sees proxy variables in either case", () => {
    expect(hasProxyEnv({ https_proxy: "http://p:1" })).toBe(true)
    expect(hasProxyEnv({ ALL_PROXY: "socks5h://p:1" })).toBe(true)
    expect(hasProxyEnv({ NO_PROXY: "localhost", HTTPS_PROXY: "" })).toBe(false)
  })
})
