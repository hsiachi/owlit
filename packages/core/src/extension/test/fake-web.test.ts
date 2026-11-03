import { describe, expect, it } from "vitest"
import { checked, ezproxy, FakeWeb, landing, pdf, redirect, subscribed, tlink } from "./fake-web.ts"

const DOI = "10.1126/science.abc1234"
const TITLE = "A Paper About Something Particular"

describe("the fake web", () => {
  it("follows redirects across hosts and says where the chain ended", async () => {
    const web = new FakeWeb().paper(DOI, TITLE, { url: `https://www.science.org/doi/${DOI}` })
    web.on(`www.science.org/doi/${DOI}`, landing(DOI, TITLE))
    const response = await web.fetchFor("core")(`https://doi.org/${DOI}`)
    expect(response.url).toBe(`https://www.science.org/doi/${DOI}`)
    expect(await response.text()).toContain("citation_doi")
  })

  it("fails a followed redirect to a site the visitor may not read, and shows it as opaque when not followed", async () => {
    const web = new FakeWeb().on("a.example.org/x", redirect("https://b.example.com/y"))
    const redirects = new Map<string, string>()
    const fetch = web.fetchFor("browser", { canRead: (url) => !url.includes("b.example.com"), redirects })
    await expect(fetch("https://a.example.org/x")).rejects.toThrow(TypeError)
    const manual = await fetch("https://a.example.org/x", { redirect: "manual" })
    expect(manual.type).toBe("opaqueredirect")
    expect(redirects.get("https://a.example.org/x")).toBe("https://b.example.com/y")
  })

  it("keeps a check in front of the page until the browser passes it; owlit's own fetch never does", async () => {
    const web = new FakeWeb().paper(DOI, TITLE, { url: "" })
    web.on("www.science.org/doi/pdf/", checked(pdf(DOI)))
    const url = `https://www.science.org/doi/pdf/${DOI}`
    expect((await web.fetchFor("browser")(url)).status).toBe(403)
    web.clear("www.science.org")
    expect((await web.fetchFor("browser")(url)).headers.get("content-type")).toBe("application/pdf")
    expect((await web.fetchFor("core")(url)).status).toBe(403)
  })

  it("sends a signed-in reader through tlink to the publisher, and shows anyone else its gateway", async () => {
    const web = tlink(new FakeWeb().paper(DOI, TITLE, { url: "" }))
    web.on("www.science.org/doi/pdf/", subscribed(pdf(DOI)))
    const url = `https://tlink.lib.tsinghua.edu.cn/go?url=https://www.science.org/doi/pdf/${DOI}`
    const out = await web.fetchFor("browser")(url)
    expect(out.url).toBe(url)
    expect(await out.text()).toContain("tlink")
    web.signIn("tlink.lib.tsinghua.edu.cn")
    const through = await web.fetchFor("browser")(url)
    expect(through.url).toBe(`https://www.science.org/doi/pdf/${DOI}`)
    expect(through.headers.get("content-type")).toBe("application/pdf")
  })

  it("rewrites hosts through EZproxy once signed in", async () => {
    const web = ezproxy(new FakeWeb().paper(DOI, TITLE, { url: "" }))
    web.on("www.science.org/doi/pdf/", pdf(DOI))
    const url = `https://www-science-org.ezproxy.example.edu/doi/pdf/${DOI}`
    expect((await web.fetchFor("browser")(url)).url).toMatch(/^https:\/\/ezproxy\.example\.edu\/login\?url=/)
    web.signIn("ezproxy.example.edu")
    const through = await web.fetchFor("browser")(url)
    expect(through.url).toBe(url)
    expect(through.headers.get("content-type")).toBe("application/pdf")
  })
})
